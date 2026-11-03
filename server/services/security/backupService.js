"use strict";

// Backup and verification. Backups are produced with pg_dump (custom format)
// into a directory OUTSIDE the served application tree, and registered in
// backup_records. Verification confirms the file exists, is non-trivial in
// size, and that pg_restore can list its contents. A backup that fails
// verification can never be used by recovery restore — enforced in
// recoveryService, not merely by UI convention.
//
// The database connection reaches pg_dump/pg_restore through libpq environment
// variables (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE), never through a
// command-line argument, so the password cannot be read from the process list.
// It is never logged.

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { query, runSecurityWrite } = require("../../config/database");
const securityAudit = require("./securityAuditService");
const securityEvents = require("./securityEventService");

const PROJECT_ROOT = path.join(__dirname, "..", "..", "..");
const BACKUP_DIR = process.env.SECURITY_BACKUP_DIR || path.join(PROJECT_ROOT, "backups", "security");

function runTool(command, args, env) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { env: { ...process.env, ...env }, timeout: 10 * 60 * 1000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.toolOutput = String(stderr || "").slice(0, 500);
        return reject(error);
      }
      resolve({ stdout, stderr });
    });
  });
}

function toolEnv() {
  // pg_dump/pg_restore read the connection from the environment, so the
  // connection URL — including its password — never appears in a command line
  // (where any local user could read it from the process list).
  const env = { PGCONNECT_TIMEOUT: "15" };
  let url;
  try {
    url = new URL(process.env.DATABASE_URL || "");
  } catch (error) {
    throw new Error("DATABASE_URL is not a valid PostgreSQL connection string.");
  }
  if (url.hostname) env.PGHOST = url.hostname;
  if (url.port) env.PGPORT = url.port;
  if (url.username) env.PGUSER = decodeURIComponent(url.username);
  if (url.password) env.PGPASSWORD = decodeURIComponent(url.password);
  const database = url.pathname.replace(/^\//, "");
  if (database) env.PGDATABASE = decodeURIComponent(database);
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

function ensureDir() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

async function createBackup({ label, actor, note = null }) {
  ensureDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `sdms-security-backup-${stamp}.dump`;
  const filePath = path.join(BACKUP_DIR, fileName);

  try {
    await runTool("pg_dump", ["--format=custom", "--file", filePath], toolEnv());
  } catch (error) {
    await securityEvents.record({
      severity: "high",
      category: "system",
      action: "BACKUP_FAILED",
      description: `Backup "${label}" failed: ${error.message}`
    });
    const err = new Error("Backup creation failed. Ensure pg_dump is installed and DATABASE_URL is reachable.");
    err.status = 500;
    err.code = "BACKUP_FAILED";
    throw err;
  }

  const stat = fs.statSync(filePath);
  const inserted = await runSecurityWrite(() =>
    query(
      `INSERT INTO backup_records (label, file_path, file_size, kind, created_by, created_by_name, status, note)
       VALUES ($1, $2, $3, 'database', $4, $5, 'pending', $6)
       RETURNING *`,
      [label, filePath, stat.size, actor.id, actor.username, note]
    )
  );
  await securityAudit.record({
    actor,
    action: "BACKUP_CREATED",
    targetType: "backup_record",
    targetId: inserted.rows[0].id,
    details: { label, fileName, size: stat.size }
  });
  return inserted.rows[0];
}

async function verifyBackup(id, actor) {
  const record = (await runSecurityWrite(() => query("SELECT * FROM backup_records WHERE id = $1", [id]))).rows[0];
  if (!record) {
    const error = new Error("Backup record not found.");
    error.status = 404;
    throw error;
  }
  let status = "failed";
  let note = null;
  try {
    if (!fs.existsSync(record.file_path)) {
      note = "Backup file is missing on disk.";
    } else {
      const stat = fs.statSync(record.file_path);
      if (stat.size < 1024) {
        note = "Backup file is implausibly small.";
      } else {
        await runTool("pg_restore", ["--list", record.file_path], toolEnv());
        status = "verified";
      }
    }
  } catch (error) {
    note = `Verification failed: ${error.message}`;
  }

  await runSecurityWrite(() =>
    query("UPDATE backup_records SET status = $1, verified_at = now(), verified_by = $2, note = $3 WHERE id = $4", [
      status,
      actor.id,
      note,
      id
    ])
  );
  await securityAudit.record({
    actor,
    action: status === "verified" ? "BACKUP_VERIFIED" : "BACKUP_VERIFICATION_FAILED",
    targetType: "backup_record",
    targetId: id,
    details: { label: record.label, status, note }
  });
  if (status !== "verified") {
    await securityEvents.record({
      severity: "medium",
      category: "system",
      action: "BACKUP_VERIFICATION_FAILED",
      description: `Backup "${record.label}" failed verification${note ? `: ${note}` : "."}`,
      username: actor.username,
      isSuperadmin: true,
      firewallDecision: "monitored"
    });
  }
  return { id, status, note };
}

async function listBackups() {
  const result = await runSecurityWrite(() =>
    query("SELECT * FROM backup_records ORDER BY created_at DESC LIMIT 200")
  );
  return result.rows;
}

// Controlled restoration. Requires:
//   - a verified backup,
//   - a typed confirmation string (DEFINITELY-RESTORE),
//   - the caller's current password (re-authentication).
// Restoration runs pg_restore against DATABASE_URL. Forensic evidence (the
// security module's own tables and the audit trail) is preserved by dumping
// them to a sidecar file before the restore and reloading them afterwards.
async function restoreBackup({ id, actor, confirmation, currentPassword }) {
  const record = (await runSecurityWrite(() => query("SELECT * FROM backup_records WHERE id = $1", [id]))).rows[0];
  if (!record) {
    const error = new Error("Backup record not found.");
    error.status = 404;
    throw error;
  }
  if (record.status !== "verified") {
    const error = new Error("Only backups with verified integrity may be restored.");
    error.status = 409;
    error.code = "BACKUP_NOT_VERIFIED";
    throw error;
  }
  if (String(confirmation || "") !== "DEFINITELY-RESTORE") {
    const error = new Error("Typed confirmation is required to restore.");
    error.status = 400;
    error.code = "CONFIRMATION_REQUIRED";
    throw error;
  }
  const bcrypt = require("bcrypt");
  const actorRow = (await runSecurityWrite(() => query("SELECT password_hash FROM superadmin_users WHERE id = $1", [actor.id]))).rows[0];
  if (!actorRow || !(await bcrypt.compare(String(currentPassword || ""), actorRow.password_hash))) {
    const error = new Error("Re-authentication failed.");
    error.status = 401;
    error.code = "REAUTH_FAILED";
    throw error;
  }
  if (!fs.existsSync(record.file_path)) {
    const error = new Error("Backup file is missing on disk.");
    error.status = 410;
    throw error;
  }

  // PRESERVE: export the security module's forensic tables before restore.
  ensureDir();
  const evidencePath = path.join(BACKUP_DIR, `evidence-${Date.now()}.dump`);
  const securityTables = [
    "superadmin_users",
    "firewall_settings",
    "firewall_control_history",
    "security_events",
    "security_incidents",
    "security_audit_logs",
    "database_activity_logs",
    "code_integrity_records",
    "security_baselines",
    "file_upload_security_logs",
    "system_health_records",
    "security_alerts",
    "backup_records",
    "recovery_sessions",
    "approved_maintenance_sessions"
  ];
  try {
    await runTool(
      "pg_dump",
      [
        "--format=custom",
        ...securityTables.flatMap((table) => ["--table", table]),
        "--file",
        evidencePath
      ],
      toolEnv()
    );
  } catch (error) {
    const err = new Error("Evidence preservation failed; restore aborted to protect forensic data.");
    err.status = 500;
    err.code = "EVIDENCE_PRESERVATION_FAILED";
    throw err;
  }

  try {
    await runTool("pg_restore", ["--clean", "--if-exists", "--no-owner", "--no-privileges", record.file_path], toolEnv());
    // Evidence tables are NOT re-imported automatically: the SuperAdmin
    // reviews the evidence export and decides what to reinstate.
  } catch (error) {
    await securityEvents.record({
      severity: "critical",
      category: "recovery",
      action: "RESTORE_FAILED",
      description: `Restore of backup "${record.label}" failed: ${error.message}. Evidence preserved at ${path.basename(evidencePath)}.`,
      username: actor.username,
      isSuperadmin: true,
      firewallDecision: "allowed",
      metadata: { evidencePath }
    });
    const err = new Error("Restore failed. Forensic evidence was preserved and the recovery session remains open.");
    err.status = 500;
    err.code = "RESTORE_FAILED";
    throw err;
  }

  await securityAudit.record({
    actor,
    action: "BACKUP_RESTORED",
    targetType: "backup_record",
    targetId: id,
    details: { label: record.label, evidencePath: path.basename(evidencePath) }
  });
  await securityEvents.record({
    severity: "critical",
    category: "recovery",
    action: "BACKUP_RESTORED",
    description: `SuperAdmin ${actor.username} restored backup "${record.label}". Evidence preserved at ${path.basename(evidencePath)}.`,
    username: actor.username,
    isSuperadmin: true,
    firewallDecision: "allowed",
    metadata: { evidencePath }
  });
  return { restored: true, evidencePath: path.basename(evidencePath) };
}

module.exports = { createBackup, verifyBackup, listBackups, restoreBackup, BACKUP_DIR };
