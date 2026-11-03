"use strict";

// Emergency Recovery Mode.
//
// Lifecycle: detect -> contain -> preserve -> assess -> verify_backup ->
// restore -> verify_integrity -> reactivate -> completed.
// Transitions are validated; every step appends to progress_notes. Automatic
// containment (engage security lockdown) may follow a critical event, but the
// destructive RESTORE step always requires an explicit SuperAdmin action with
// re-authentication inside backupService.

const { query, runSecurityWrite } = require("../../config/database");
const securityAudit = require("./securityAuditService");
const securityEvents = require("./securityEventService");
const firewallService = require("./firewallService");
const codeIntegrityService = require("./codeIntegrityService");

const FLOW = ["detect", "contain", "preserve", "assess", "verify_backup", "restore", "verify_integrity", "reactivate", "completed"];
const NEXT_STEP = FLOW.reduce((map, step, index) => {
  map[step] = FLOW[index + 1] || null;
  return map;
}, {});

async function createSession({ actor, triggerEvent = "manual", incidentId = null, affectedNotes = null }) {
  const year = new Date().getFullYear();
  const count = await runSecurityWrite(() =>
    query(`SELECT COUNT(*)::int AS total FROM recovery_sessions WHERE reference LIKE $1`, [`REC-${year}-%`])
  );
  const reference = `REC-${year}-${String(count.rows[0].total + 1).padStart(4, "0")}`;
  const inserted = await runSecurityWrite(() =>
    query(
      `INSERT INTO recovery_sessions (reference, trigger_event, incident_id, status, affected_notes, activated_by, activated_by_name)
       VALUES ($1, $2, $3, 'contain', $4, $5, $6)
       RETURNING *`,
      [reference, triggerEvent, incidentId, affectedNotes, actor.id, actor.username]
    )
  );
  await securityAudit.record({
    actor,
    action: "RECOVERY_ACTIVATED",
    targetType: "recovery_session",
    targetId: inserted.rows[0].id,
    details: { reference, triggerEvent }
  });
  await securityEvents.record({
    severity: "critical",
    category: "recovery",
    action: "RECOVERY_MODE_ACTIVATED",
    description: `Emergency recovery ${reference} activated by ${actor.username}.`,
    username: actor.username,
    isSuperadmin: true,
    firewallDecision: "allowed",
    metadata: { reference }
  });
  // CONTAIN: engage lockdown immediately; it is released at reactivate.
  await firewallService.setSwitch({
    key: "security_lockdown",
    enabled: true,
    actor,
    reason: `Emergency recovery ${reference}: containment phase.`,
    ipAddress: null
  });
  return inserted.rows[0];
}

async function getSession(id) {
  const result = await runSecurityWrite(() =>
    query("SELECT * FROM recovery_sessions WHERE id = $1", [id])
  );
  return result.rows[0] || null;
}

async function listSessions() {
  const result = await runSecurityWrite(() =>
    query("SELECT * FROM recovery_sessions ORDER BY activated_at DESC LIMIT 100")
  );
  return result.rows;
}

async function note({ id, actor, message }) {
  const session = await getSession(id);
  if (!session) {
    const error = new Error("Recovery session not found.");
    error.status = 404;
    throw error;
  }
  await runSecurityWrite(() =>
    query(
      `UPDATE recovery_sessions
       SET progress_notes = progress_notes || $1::jsonb, updated_at = now()
       WHERE id = $2`,
      [JSON.stringify([{ at: new Date().toISOString(), by: actor.username, message: String(message).slice(0, 500) }]), id]
    )
  );
  return getSession(id);
}

async function advance({ id, actor, to, backupId = null, message = null }) {
  const session = await getSession(id);
  if (!session) {
    const error = new Error("Recovery session not found.");
    error.status = 404;
    throw error;
  }
  if (session.status === "completed" || session.status === "aborted") {
    const error = new Error("This recovery session is already closed.");
    error.status = 409;
    throw error;
  }
  const expected = NEXT_STEP[session.status];
  if (to !== expected) {
    const error = new Error(`Invalid recovery step. Current: ${session.status}; next allowed: ${expected || "none"}.`);
    error.status = 409;
    error.code = "INVALID_RECOVERY_STEP";
    throw error;
  }
  if (to === "restore" && !backupId) {
    const error = new Error("Select a verified backup before the restore step.");
    error.status = 400;
    error.code = "BACKUP_REQUIRED";
    throw error;
  }
  await runSecurityWrite(() =>
    query(
      `UPDATE recovery_sessions
       SET status = $1, backup_id = COALESCE($2, backup_id), recovery_point = CASE WHEN $2 IS NOT NULL THEN now() ELSE recovery_point END,
           progress_notes = progress_notes || $3::jsonb, updated_at = now()
       WHERE id = $4`,
      [
        to,
        backupId,
        JSON.stringify([{ at: new Date().toISOString(), by: actor.username, message: message || `Advanced to ${to}` }]),
        id
      ]
    )
  );
  await securityAudit.record({
    actor,
    action: "RECOVERY_STEP",
    targetType: "recovery_session",
    targetId: id,
    details: { from: session.status, to, backupId }
  });
  return getSession(id);
}

// VERIFY_INTEGRITY: run code hash verification plus a database liveness probe.
async function runIntegrityChecks({ id, actor }) {
  const codeReport = await codeIntegrityService.verify({ source: "security" });
  const dbProbe = await runSecurityWrite(() => query("SELECT COUNT(*)::int AS users FROM users"));
  await note({
    id,
    actor,
    message: `Integrity check: code=${codeReport.status} (${codeReport.changes.length} change(s)); database probe OK (${dbProbe.rows[0].users} user rows).`
  });
  return { code: codeReport, databaseUsers: dbProbe.rows[0].users };
}

async function reactivate({ id, actor }) {
  const session = await getSession(id);
  if (!session) {
    const error = new Error("Recovery session not found.");
    error.status = 404;
    throw error;
  }
  if (session.status !== "verify_integrity") {
    const error = new Error("Recovery must pass the verify_integrity step before reactivation.");
    error.status = 409;
    error.code = "INVALID_RECOVERY_STEP";
    throw error;
  }
  await firewallService.setSwitch({
    key: "security_lockdown",
    enabled: false,
    actor,
    reason: `Emergency recovery ${session.reference}: integrity verified, reactivating.`,
    ipAddress: null
  });
  await runSecurityWrite(() =>
    query(
      `UPDATE recovery_sessions
       SET status = 'completed', completed_at = now(),
           progress_notes = progress_notes || $1::jsonb, updated_at = now()
       WHERE id = $2`,
      [JSON.stringify([{ at: new Date().toISOString(), by: actor.username, message: "System reactivated after verified recovery." }]), id]
    )
  );
  await securityAudit.record({
    actor,
    action: "RECOVERY_COMPLETED",
    targetType: "recovery_session",
    targetId: id,
    details: { reference: session.reference }
  });
  await securityEvents.record({
    severity: "high",
    category: "recovery",
    action: "RECOVERY_COMPLETED",
    description: `Emergency recovery ${session.reference} completed by ${actor.username}.`,
    username: actor.username,
    isSuperadmin: true,
    firewallDecision: "allowed"
  });
  return getSession(id);
}

async function abort({ id, actor, reason }) {
  const session = await getSession(id);
  if (!session) {
    const error = new Error("Recovery session not found.");
    error.status = 404;
    throw error;
  }
  await runSecurityWrite(() =>
    query(
      `UPDATE recovery_sessions
       SET status = 'aborted', completed_at = now(),
           progress_notes = progress_notes || $1::jsonb, updated_at = now()
       WHERE id = $2`,
      [JSON.stringify([{ at: new Date().toISOString(), by: actor.username, message: `Aborted: ${String(reason || "no reason given").slice(0, 300)}` }]), id]
    )
  );
  await securityAudit.record({
    actor,
    action: "RECOVERY_ABORTED",
    targetType: "recovery_session",
    targetId: id,
    details: { reference: session.reference, reason }
  });
  return getSession(id);
}

module.exports = { createSession, getSession, listSessions, note, advance, runIntegrityChecks, reactivate, abort, FLOW };
