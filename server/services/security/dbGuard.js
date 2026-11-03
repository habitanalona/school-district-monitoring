"use strict";

// Database write guard — the enforcement layer for DATABASE WRITE PROTECTION.
//
// Every SQL statement executed through server/config/database.js (the single
// choke point used by all services) passes through guardQuery(). Writes are
// classified and decided against the firewall switch state and the execution
// context carried by AsyncLocalStorage:
//
//   - source "security"/"worker"  -> the module's own writes, always allowed
//     (and recorded), so protection can never disable its own auditing.
//   - source "application"        -> ordinary request handling; subject to the
//     switches below.
//
// Decisions:
//   - DDL (CREATE/ALTER/DROP/TRUNCATE/GRANT/REVOKE/...) is rejected for
//     application code in EVERY switch state; schema changes only happen via
//     versioned migrations, which run outside this guard.
//   - Writes to the security module's own tables are rejected for application
//     code in every state.
//   - When security_lockdown is ON, all application writes are frozen.
//   - When db_write_protection is ON, anonymous (unauthenticated-context)
//     writes are rejected; authenticated, authorized writes proceed and are
//     recorded.
//   - If switch state is unknown (guard degraded), writes fail CLOSED.
//
// All writes — allowed or rejected — are recorded in database_activity_logs
// with a normalized fingerprint (table names only, never parameter values).

const guardState = require("./guardState");
const { HttpError } = require("../../utils/httpError");

let pool = null;
let recording = false;

// DDL is matched only at the start of a statement. Keyword-only matching would
// misclassify ordinary writes such as "UPDATE ... SET ..." as schema changes.
const DDL_RE =
  /(?:^|;)\s*(CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|COPY|VACUUM|ANALYZE|REINDEX|SET|RESET|CALL|DO)\b/i;
const WRITE_RE = /\b(INSERT|UPDATE|DELETE)\b/i;
const TABLE_RE = /\b(?:FROM|INTO|JOIN|UPDATE)\s+([a-zA-Z_][\w.]*)/gi;

// Internal audit tables the application may always write (its own audit
// trail); blocking these would create the exact blind spot the firewall exists
// to prevent.
const ALWAYS_ALLOWED_APP_TABLES = new Set(["audit_logs"]);

function initGuard(pgPool) {
  pool = pgPool;
}

function stripLiterals(sql) {
  return String(sql || "")
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/\$\$[\s\S]*?\$\$/g, "''");
}

function classify(sql) {
  const cleaned = stripLiterals(sql);
  if (DDL_RE.test(cleaned)) {
    return "DDL";
  }
  if (WRITE_RE.test(cleaned)) {
    return "WRITE";
  }
  return "READ";
}

function extractTables(sql) {
  const cleaned = stripLiterals(sql);
  const tables = new Set();
  let match;
  TABLE_RE.lastIndex = 0;
  while ((match = TABLE_RE.exec(cleaned)) !== null) {
    tables.add(match[1].split(".").pop().replace(/["`]/g, "").toLowerCase());
  }
  return [...tables];
}

function normalizeFingerprint(sql) {
  return stripLiterals(String(sql || ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function decide({ classification, tables, context }) {
  const source = context && context.source ? context.source : "application";
  const authenticated = Boolean(context && context.authenticated);

  if (source === "security" || source === "worker") {
    return { allowed: true, reason: "INTERNAL_SOURCE", authorized: true };
  }

  if (guardState.state.degraded) {
    return { allowed: false, reason: "GUARD_STATE_UNAVAILABLE", authorized: false };
  }

  if (classification === "DDL") {
    return { allowed: false, reason: "SCHEMA_CHANGES_REQUIRE_MIGRATION", authorized: false };
  }

  const touchesSecurityTables = tables.some((table) => guardState.SECURITY_TABLES.has(table));
  if (touchesSecurityTables) {
    return { allowed: false, reason: "SECURITY_TABLES_ACCESS_DENIED", authorized: false };
  }

  const onlyAuditTables = tables.length > 0 && tables.every((table) => ALWAYS_ALLOWED_APP_TABLES.has(table));
  if (onlyAuditTables) {
    return { allowed: true, reason: "AUDIT_TRAIL_WRITE", authorized: true };
  }

  if (guardState.getSwitch("security_lockdown")) {
    return { allowed: false, reason: "DB_FROZEN_SECURITY_LOCKDOWN", authorized: false };
  }

  if (guardState.getSwitch("db_write_protection") && !authenticated) {
    return { allowed: false, reason: "ANONYMOUS_WRITE_BLOCKED", authorized: false };
  }

  return { allowed: true, reason: "POLICY_APPROVED", authorized: authenticated };
}

async function recordActivity({ operation, tables, decision, context, sql, durationMs }) {
  if (!pool || recording) {
    return;
  }
  recording = true;
  try {
    await pool.query(
      `INSERT INTO database_activity_logs
         (operation, table_name, authorized, actor, source, sql_fingerprint, decision, reason, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        operation,
        tables.join(", ") || null,
        decision.authorized,
        (context && (context.actor || context.source)) || "unknown",
        (context && context.source) || "unknown",
        normalizeFingerprint(sql),
        decision.allowed ? "allowed" : "rejected",
        decision.reason,
        durationMs == null ? null : Math.round(durationMs)
      ]
    );
  } catch (error) {
    // The activity ledger must never take the request down.
    console.error("database_activity_logs write failed:", error.message);
  } finally {
    recording = false;
  }
}

async function guardQuery(execute, { text, params }) {
  const sql = String(text || "");
  const trimmed = sql.trim();

  // The activity recorder writes through the raw pool (never re-enters this
  // function); only its own statement shape is whitelisted here. A global
  // "recording" bypass would let unrelated concurrent requests skip the guard.
  if (/^\s*INSERT\s+INTO\s+database_activity_logs\b/i.test(trimmed)) {
    return execute();
  }

  const classification = classify(trimmed);
  if (classification === "READ") {
    return execute();
  }

  const context = guardState.getContext() || { source: "application", authenticated: false };
  const tables = extractTables(trimmed);
  const decision = decide({ classification, tables, context });
  const startedAt = Date.now();

  if (!decision.allowed) {
    await recordActivity({
      operation: classification,
      tables,
      decision,
      context,
      sql: trimmed,
      durationMs: null
    });
    const error = new HttpError(
      403,
      "The requested database change was rejected by the security firewall.",
      "SECURITY_WRITE_REJECTED"
    );
    error.firewallReason = decision.reason;
    error.firewallOperation = classification;
    throw error;
  }

  const result = await execute();
  await recordActivity({
    operation: classification,
    tables,
    decision,
    context,
    sql: trimmed,
    durationMs: Date.now() - startedAt
  });
  return result;
}

module.exports = { initGuard, guardQuery, classify, extractTables, stripLiterals };
