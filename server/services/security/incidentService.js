"use strict";

// Security incident lifecycle management.

const { query, runSecurityWrite } = require("../../config/database");
const securityAudit = require("./securityAuditService");

const STATUSES = ["new", "investigating", "contained", "recovery_in_progress", "resolved", "closed"];
const STATUS_FLOW = {
  new: ["investigating", "closed"],
  investigating: ["contained", "resolved", "closed"],
  contained: ["recovery_in_progress", "resolved"],
  recovery_in_progress: ["resolved"],
  resolved: ["closed"],
  closed: []
};

async function list({ status = "", severity = "", page = 1, pageSize = 50 } = {}) {
  const filters = ["($1 = '' OR status = $1)", "($2 = '' OR severity = $2)"];
  const params = [status, severity];
  const where = filters.join(" AND ");
  const count = await runSecurityWrite(() =>
    query(`SELECT COUNT(*)::int AS total FROM security_incidents WHERE ${where}`, params)
  );
  const data = await runSecurityWrite(() =>
    query(
      `SELECT i.*, s.username AS assignee_name
       FROM security_incidents i
       LEFT JOIN superadmin_users s ON s.id = i.assigned_to
       WHERE ${where}
       ORDER BY i.opened_at DESC, i.id DESC LIMIT $3 OFFSET $4`,
      [...params, pageSize, (page - 1) * pageSize]
    )
  );
  return { incidents: data.rows, total: count.rows[0].total, page, pageSize };
}

async function get(id) {
  const result = await runSecurityWrite(() =>
    query(
      `SELECT i.*, s.username AS assignee_name
       FROM security_incidents i
       LEFT JOIN superadmin_users s ON s.id = i.assigned_to
       WHERE i.id = $1`,
      [id]
    )
  );
  return result.rows[0] || null;
}

async function transition({ id, to, actor, resolution = null, ipAddress = null }) {
  const incident = await get(id);
  if (!incident) {
    const error = new Error("Incident not found.");
    error.status = 404;
    throw error;
  }
  if (!STATUSES.includes(to)) {
    const error = new Error(`Unknown incident status: ${to}`);
    error.status = 400;
    error.code = "UNKNOWN_STATUS";
    throw error;
  }
  const allowed = STATUS_FLOW[incident.status] || [];
  if (!allowed.includes(to)) {
    const error = new Error(`Cannot move incident from "${incident.status}" to "${to}".`);
    error.status = 409;
    error.code = "INVALID_TRANSITION";
    throw error;
  }
  await runSecurityWrite(() =>
    query(
      `UPDATE security_incidents
       SET status = $1, resolution = COALESCE($2, resolution),
           closed_at = CASE WHEN $1 = 'closed' THEN now() ELSE closed_at END,
           updated_at = now()
       WHERE id = $3`,
      [to, resolution, id]
    )
  );
  await securityAudit.record({
    actor,
    action: "INCIDENT_STATUS_CHANGED",
    targetType: "security_incident",
    targetId: id,
    details: { reference: incident.reference, from: incident.status, to, resolution },
    ipAddress
  });
  return get(id);
}

async function assign({ id, assigneeId, actor, ipAddress = null }) {
  const incident = await get(id);
  if (!incident) {
    const error = new Error("Incident not found.");
    error.status = 404;
    throw error;
  }
  await runSecurityWrite(() =>
    query("UPDATE security_incidents SET assigned_to = $1, updated_at = now() WHERE id = $2", [assigneeId, id])
  );
  await securityAudit.record({
    actor,
    action: "INCIDENT_ASSIGNED",
    targetType: "security_incident",
    targetId: id,
    details: { reference: incident.reference, assigneeId },
    ipAddress
  });
  return get(id);
}

async function countsByStatus() {
  const result = await runSecurityWrite(() =>
    query(
      `SELECT status, COUNT(*)::int AS total
       FROM security_incidents GROUP BY status ORDER BY status`
    )
  );
  return result.rows;
}

module.exports = { list, get, transition, assign, countsByStatus, STATUSES };
