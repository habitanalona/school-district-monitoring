"use strict";

// Security event pipeline: recording, alert fan-out, incident auto-creation
// for critical events, in-memory ring buffer, and the SSE event bus that
// pushes near-real-time updates to the firewall dashboard.

const { EventEmitter } = require("events");
const crypto = require("crypto");
const { query, runSecurityWrite } = require("../../config/database");

const bus = new EventEmitter();
bus.setMaxListeners(50);

// In-memory ring buffer keeps the recent stream readable even if the database
// is unavailable (fail-safe monitoring degradation instead of silence).
const RING_SIZE = 500;
const ringBuffer = [];

function pushRing(entry) {
  ringBuffer.unshift(entry);
  if (ringBuffer.length > RING_SIZE) {
    ringBuffer.pop();
  }
}

const CRITICAL_ACTIONS = new Set([
  "UNAUTHORIZED_DB_DELETION_ATTEMPT",
  "UNAUTHORIZED_DB_MANIPULATION",
  "UNAUTHORIZED_CODE_MODIFICATION",
  "FIREWALL_DISABLE_ATTEMPT",
  "PRIVILEGE_ESCALATION_ATTEMPT",
  "UNAUTHORIZED_SUPERADMIN_ACCESS",
  "AUTH_MECHANISM_CHANGE_ATTEMPT",
  "CODE_INTEGRITY_CRITICAL",
  "REPEATED_MALICIOUS_UPLOADS"
]);

async function createIncidentForEvent(eventRow) {
  const year = new Date().getFullYear();
  const count = await runSecurityWrite(() =>
    query(`SELECT COUNT(*)::int AS total FROM security_incidents WHERE reference LIKE $1`, [`INC-${year}-%`])
  );
  const reference = `INC-${year}-${String(count.rows[0].total + 1).padStart(4, "0")}`;
  const titles = {
    UNAUTHORIZED_DB_DELETION_ATTEMPT: "Unauthorized database deletion attempt",
    UNAUTHORIZED_DB_MANIPULATION: "Unauthorized database manipulation",
    UNAUTHORIZED_CODE_MODIFICATION: "Unauthorized application code modification",
    FIREWALL_DISABLE_ATTEMPT: "Attempt to disable firewall protection",
    PRIVILEGE_ESCALATION_ATTEMPT: "Privilege escalation attempt",
    UNAUTHORIZED_SUPERADMIN_ACCESS: "Unauthorized SuperAdmin access attempt",
    AUTH_MECHANISM_CHANGE_ATTEMPT: "Suspicious authentication mechanism change",
    CODE_INTEGRITY_CRITICAL: "Critical application integrity violation",
    REPEATED_MALICIOUS_UPLOADS: "Repeated malicious upload attempts"
  };
  const inserted = await runSecurityWrite(() =>
    query(
      `INSERT INTO security_incidents (reference, severity, title, description, status, source_event_id, source_ip, actor_hint)
       VALUES ($1, $2, $3, $4, 'new', $5, $6, $7)
       RETURNING id`,
      [
        reference,
        eventRow.severity,
        titles[eventRow.action] || `Critical security event: ${eventRow.action}`,
        eventRow.description || eventRow.action,
        eventRow.id,
        eventRow.ip_address || null,
        eventRow.username || null
      ]
    )
  );
  await runSecurityWrite(() =>
    query("UPDATE security_events SET incident_id = $1 WHERE id = $2", [
      inserted.rows[0].id,
      eventRow.id
    ])
  );
  return inserted.rows[0].id;
}

async function record(payload) {
  const severity = payload.severity || "informational";
  const action = payload.action || "EVENT";
  const entry = {
    eventId: `SEV-${crypto.randomUUID()}`,
    severity,
    category: payload.category || "system",
    action,
    description: payload.description || "",
    username: payload.username || null,
    userRole: payload.userRole || null,
    userId: payload.userId || null,
    isSuperadmin: Boolean(payload.isSuperadmin),
    ipAddress: payload.ipAddress || null,
    userAgent: payload.userAgent || null,
    requestMethod: payload.requestMethod || null,
    endpoint: payload.endpoint || null,
    dbTable: payload.dbTable || null,
    recordId: payload.recordId || null,
    fileName: payload.fileName || null,
    firewallDecision: payload.firewallDecision || "monitored",
    metadata: payload.metadata || {}
  };

  try {
    const inserted = await runSecurityWrite(() =>
      query(
        `INSERT INTO security_events
           (event_id, severity, category, action, description, username, user_role, user_id, is_superadmin,
            ip_address, ip_geolocation, user_agent, request_method, endpoint, db_table, record_id, file_name,
            firewall_decision, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'unknown',$11,$12,$13,$14,$15,$16,$17,$18)
         RETURNING id, created_at`,
        [
          entry.eventId,
          entry.severity,
          entry.category,
          entry.action,
          entry.description,
          entry.username,
          entry.userRole,
          entry.userId,
          entry.isSuperadmin,
          entry.ipAddress,
          entry.userAgent,
          entry.requestMethod,
          entry.endpoint,
          entry.dbTable,
          entry.recordId,
          entry.fileName,
          entry.firewallDecision,
          JSON.stringify(entry.metadata)
        ]
      )
    );

    const row = inserted.rows[0];
    let incidentId = null;
    if (severity === "critical" || CRITICAL_ACTIONS.has(action)) {
      try {
        incidentId = await createIncidentForEvent({
          ...entry,
          id: row.id,
          ip_address: entry.ipAddress
        });
      } catch (error) {
        console.error("Incident auto-creation failed:", error.message);
      }
    }

    if (severity === "high" || severity === "critical") {
      await alert({
        severity,
        title: `${action}`,
        message: entry.description || action,
        source: entry.eventId
      });
    }

    const broadcast = { ...entry, id: row.id, incidentId, createdAt: row.created_at };
    pushRing(broadcast);
    bus.emit("event", broadcast);
    return broadcast;
  } catch (error) {
    // Monitoring degradation must be visible, never silent.
    console.error("SECURITY EVENT WRITE FAILED:", error.message);
    pushRing({ ...entry, degraded: true, error: error.message });
    bus.emit("event", { ...entry, degraded: true });
    return { ...entry, degraded: true };
  }
}

async function alert({ severity = "medium", title, message, source = null }) {
  try {
    await runSecurityWrite(() =>
      query(
        `INSERT INTO security_alerts (severity, title, message, source) VALUES ($1, $2, $3, $4)`,
        [severity, title, message, source]
      )
    );
  } catch (error) {
    console.error("SECURITY ALERT WRITE FAILED:", error.message);
  }
}

async function listEvents({ page = 1, pageSize = 50, severity = "", category = "", action = "", ip = "", search = "" } = {}) {
  const filters = [
    "($1 = '' OR severity = $1)",
    "($2 = '' OR category = $2)",
    "($3 = '' OR action = $3)",
    "($4 = '' OR ip_address = $4)",
    "($5 = '' OR description ILIKE $5 OR username ILIKE $5 OR event_id ILIKE $5)"
  ];
  const params = [severity, category, action, ip, search ? `%${search}%` : ""];
  const where = filters.join(" AND ");
  const count = await runSecurityWrite(() =>
    query(`SELECT COUNT(*)::int AS total FROM security_events WHERE ${where}`, params)
  );
  const data = await runSecurityWrite(() =>
    query(
      `SELECT * FROM security_events WHERE ${where}
       ORDER BY created_at DESC, id DESC LIMIT $6 OFFSET $7`,
      [...params, pageSize, (page - 1) * pageSize]
    )
  );
  return { events: data.rows, total: count.rows[0].total, page, pageSize };
}

async function stats({ hours = 24 } = {}) {
  const result = await runSecurityWrite(() =>
    query(
      `SELECT
         COUNT(*) FILTER (WHERE created_at >= now() - ($1 || ' hours')::interval)::int AS total,
         COUNT(*) FILTER (WHERE created_at >= now() - ($1 || ' hours')::interval AND firewall_decision = 'rejected')::int AS blocked,
         COUNT(*) FILTER (WHERE severity = 'critical')::int AS critical_total,
         COUNT(*) FILTER (WHERE severity = 'high' AND created_at >= now() - ($1 || ' hours')::interval)::int AS high,
         COUNT(*) FILTER (WHERE category = 'auth' AND action = 'LOGIN_FAILED' AND created_at >= now() - ($1 || ' hours')::interval)::int AS failed_logins,
         COUNT(*) FILTER (WHERE category = 'upload' AND created_at >= now() - ($1 || ' hours')::interval)::int AS upload_events,
         COUNT(*) FILTER (WHERE category = 'database' AND created_at >= now() - ($1 || ' hours')::interval)::int AS database_events,
         COUNT(*) FILTER (WHERE category = 'code' AND created_at >= now() - ($1 || ' hours')::interval)::int AS code_events
       FROM security_events`,
      [String(hours)]
    )
  );
  return result.rows[0];
}

async function timeline({ hours = 24, bucketMinutes = 60 } = {}) {
  const result = await runSecurityWrite(() =>
    query(
      `SELECT to_char(date_trunc('hour', created_at) +
               (floor(extract(epoch from created_at) / 60 / $2) * $2 * 60 -
                extract(epoch from date_trunc('hour', created_at))) * interval '1 second', 'YYYY-MM-DD HH24:MI') AS bucket,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE firewall_decision = 'rejected')::int AS blocked,
              COUNT(*) FILTER (WHERE severity IN ('high','critical'))::int AS threats
       FROM security_events
       WHERE created_at >= now() - ($1 || ' hours')::interval
       GROUP BY bucket
       ORDER BY bucket`,
      [String(hours), bucketMinutes]
    )
  );
  return result.rows;
}

function subscribe(listener) {
  bus.on("event", listener);
  return () => bus.off("event", listener);
}

function recentRing(limit = 50) {
  return ringBuffer.slice(0, limit);
}

module.exports = { record, alert, listEvents, stats, timeline, subscribe, recentRing };
