"use strict";

// Firewall master switches: database/cache read, strictly controlled writes,
// history recording. Switch changes always require an authenticated
// SuperAdmin plus an explicit reason, and every change lands in
// firewall_control_history and the hash-chained security audit log.

const { query, runSecurityWrite } = require("../../config/database");
const guardState = require("./guardState");
const securityAudit = require("./securityAuditService");
const securityEvents = require("./securityEventService");

const SWITCH_KEYS = ["db_write_protection", "code_write_protection", "maintenance_mode", "security_lockdown"];

async function refreshCache() {
  try {
    const result = await query("SELECT key, enabled FROM firewall_settings");
    for (const row of result.rows) {
      guardState.setSwitch(row.key, row.enabled);
    }
    guardState.state.initialized = true;
    guardState.state.degraded = false;
  } catch (error) {
    // Fail closed: if the switch state cannot be confirmed, the guard denies
    // unverified application writes.
    guardState.state.degraded = true;
    console.error("Firewall switch state unavailable; guard is failing closed:", error.message);
  }
}

async function getStates() {
  const result = await runSecurityWrite(() =>
    query(
      `SELECT f.key, f.enabled, f.policy_note, f.updated_at, s.username AS updated_by_name
       FROM firewall_settings f
       LEFT JOIN superadmin_users s ON s.id = f.updated_by
       ORDER BY f.key`
    )
  );
  return result.rows;
}

async function setSwitch({ key, enabled, actor, reason, ipAddress }) {
  if (!SWITCH_KEYS.includes(key)) {
    const error = new Error(`Unknown firewall switch: ${key}`);
    error.status = 400;
    error.code = "UNKNOWN_SWITCH";
    throw error;
  }
  if (!reason || String(reason).trim().length < 5) {
    const error = new Error("A reason (at least 5 characters) is required to change a firewall switch.");
    error.status = 400;
    error.code = "REASON_REQUIRED";
    throw error;
  }

  return runSecurityWrite(async () => {
    const current = await query("SELECT enabled FROM firewall_settings WHERE key = $1", [key]);
    if (current.rows.length === 0) {
      const error = new Error(`Unknown firewall switch: ${key}`);
      error.status = 404;
      throw error;
    }
    const previous = current.rows[0].enabled;
    const next = Boolean(enabled);

    await query(
      `UPDATE firewall_settings SET enabled = $1, updated_by = $2, updated_at = now() WHERE key = $3`,
      [next, actor.id, key]
    );
    await query(
      `INSERT INTO firewall_control_history (key, previous, next, actor_id, actor_name, reason, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [key, previous, next, actor.id, actor.username, String(reason).trim(), ipAddress || null]
    );

    guardState.setSwitch(key, next);

    await securityAudit.record({
      actor,
      action: `FIREWALL_SWITCH_${next ? "ENABLED" : "DISABLED"}`,
      targetType: "firewall_switch",
      targetId: key,
      details: { key, previous, next, reason: String(reason).trim() },
      ipAddress
    });
    await securityEvents.record({
      severity: next && (key === "security_lockdown" || key === "maintenance_mode") ? "high" : "medium",
      category: "firewall",
      action: `FIREWALL_SWITCH_${next ? "ON" : "OFF"}`,
      description: `SuperAdmin ${actor.username} turned ${key} ${next ? "ON" : "OFF"}. Reason: ${String(reason).trim()}`,
      username: actor.username,
      isSuperadmin: true,
      ipAddress,
      firewallDecision: "allowed",
      metadata: { key, previous, next }
    });

    return { key, previous, next };
  });
}

async function getHistory({ key = null, limit = 100 } = {}) {
  const result = await runSecurityWrite(() =>
    query(
      `SELECT h.*, s.username AS actor_username
       FROM firewall_control_history h
       LEFT JOIN superadmin_users s ON s.id = h.actor_id
       WHERE ($1::text IS NULL OR h.key = $1)
       ORDER BY h.created_at DESC
       LIMIT $2`,
      [key, Math.min(Number(limit) || 100, 500)]
    )
  );
  return result.rows;
}

module.exports = { SWITCH_KEYS, refreshCache, getStates, setSwitch, getHistory };
