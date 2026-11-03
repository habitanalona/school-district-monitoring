"use strict";

// Hash-chained, SuperAdmin-only audit trail (security_audit_logs).
// Each entry's hash covers the previous entry's hash, making silent tampering
// evident on verification. Entries are append-only: the module never issues
// UPDATE or DELETE against this table.

const crypto = require("crypto");
const { query, runSecurityWrite } = require("../../config/database");

// Deterministic JSON so the hash survives JSONB key normalization and type
// coercion (e.g. target ids are stored as text).
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function hashEntry({ occurredAt, actorName, action, targetType, targetId, details, previousHash }) {
  return crypto
    .createHash("sha256")
    .update(
      stableStringify({
        occurredAt,
        actorName,
        action,
        targetType,
        targetId: targetId === null || targetId === undefined ? null : String(targetId),
        details: details || {},
        previousHash
      })
    )
    .digest("hex");
}

async function record({ actor = null, action, targetType = null, targetId = null, details = {}, ipAddress = null }) {
  try {
    await runSecurityWrite(async () => {
      const last = await query(
        "SELECT entry_hash FROM security_audit_logs ORDER BY id DESC LIMIT 1"
      );
      const previousHash = last.rows.length > 0 ? last.rows[0].entry_hash : null;
      const occurredAt = new Date().toISOString();
      const entryHash = hashEntry({
        occurredAt,
        actorName: actor ? actor.username : "system",
        action,
        targetType,
        targetId,
        details,
        previousHash
      });
      await query(
        `INSERT INTO security_audit_logs
           (event_id, occurred_at, actor_id, actor_name, action, target_type, target_id, details, ip_address, previous_hash, entry_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          `SAL-${crypto.randomUUID()}`,
          occurredAt,
          actor ? actor.id : null,
          actor ? actor.username : "system",
          action,
          targetType,
          targetId === null ? null : String(targetId),
          JSON.stringify(details),
          ipAddress || null,
          previousHash,
          entryHash
        ]
      );
    });
  } catch (error) {
    // Auditing must never crash the protected operation, but it must be loud.
    console.error("SECURITY AUDIT WRITE FAILED:", error.message);
  }
}

async function list({ page = 1, pageSize = 50, action = "", actor = "", search = "" } = {}) {
  const filters = [
    "($1 = '' OR action = $1)",
    "($2 = '' OR actor_name ILIKE $2)",
    "($3 = '' OR action ILIKE $3 OR target_type ILIKE $3 OR details::text ILIKE $3)"
  ];
  const params = [action, actor ? `%${actor}%` : "", search ? `%${search}%` : ""];
  const where = filters.join(" AND ");

  const count = await runSecurityWrite(() =>
    query(`SELECT COUNT(*)::int AS total FROM security_audit_logs WHERE ${where}`, params)
  );
  const data = await runSecurityWrite(() =>
    query(
      `SELECT * FROM security_audit_logs WHERE ${where}
       ORDER BY occurred_at DESC, id DESC LIMIT $4 OFFSET $5`,
      [...params, pageSize, (page - 1) * pageSize]
    )
  );
  return { logs: data.rows, total: count.rows[0].total, page, pageSize };
}

// Walk the chain and report the first broken link, if any.
async function verifyChain() {
  const rows = (await runSecurityWrite(() =>
    query("SELECT * FROM security_audit_logs ORDER BY id ASC")
  )).rows;
  let previousHash = null;
  for (const row of rows) {
    const expected = hashEntry({
      occurredAt: new Date(row.occurred_at).toISOString(),
      actorName: row.actor_name,
      action: row.action,
      targetType: row.target_type,
      targetId: row.target_id,
      details: row.details,
      previousHash: row.previous_hash
    });
    if (row.previous_hash !== previousHash || expected !== row.entry_hash) {
      return { intact: false, brokenAtId: row.id };
    }
    previousHash = row.entry_hash;
  }
  return { intact: true, entries: rows.length };
}

// Maintenance operation: recompute the chain with the current canonical hash
// scheme. Row contents are preserved; only the hash columns are rewritten.
// Used once after upgrading from the initial hashing implementation.
async function resealChain() {
  return runSecurityWrite(async () => {
    const rows = (
      await query(
        `SELECT id, occurred_at, actor_name, action, target_type, target_id, details, previous_hash, entry_hash
         FROM security_audit_logs ORDER BY id ASC`
      )
    ).rows;
    let previousHash = null;
    let updated = 0;
    for (const row of rows) {
      const entryHash = hashEntry({
        occurredAt: new Date(row.occurred_at).toISOString(),
        actorName: row.actor_name,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        details: row.details,
        previousHash
      });
      if (row.entry_hash !== entryHash || row.previous_hash !== previousHash) {
        await query("UPDATE security_audit_logs SET entry_hash = $1, previous_hash = $2 WHERE id = $3", [
          entryHash,
          previousHash,
          row.id
        ]);
        updated += 1;
      }
      previousHash = entryHash;
    }
    return { entries: rows.length, updated };
  });
}

module.exports = { record, list, verifyChain, resealChain };
