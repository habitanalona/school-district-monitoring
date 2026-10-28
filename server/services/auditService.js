"use strict";

const { query } = require("../config/database");
const { serializeAudit } = require("../utils/serializers");

async function record({
  userId = null,
  action,
  entityType,
  entityId = null,
  districtId = null,
  details = {},
  ipAddress = null,
  client = null
}) {
  const runner = client || { query };

  try {
    await runner.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, district_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, action, entityType, entityId === null ? null : String(entityId), districtId, JSON.stringify(details), ipAddress]
    );
  } catch (error) {
    console.error("Audit log write failed:", error.message);
  }
}

function recordForRequest(req, payload) {
  return record({
    userId: req.user ? req.user.id : null,
    districtId: req.user ? req.user.districtId : null,
    ipAddress: req.ip || null,
    ...payload
  });
}

async function listAuditLogs({ districtScopeId = null, page, pageSize, search = "", action = "", entityType = "" }) {
  const filters = [
    "($1::bigint IS NULL OR a.district_id = $1)",
    "($2 = '' OR a.action ILIKE $2 OR a.entity_type ILIKE $2 OR u.full_name ILIKE $2 OR a.details::text ILIKE $2)",
    "($3 = '' OR a.action = $3)",
    "($4 = '' OR a.entity_type = $4)"
  ];
  const params = [districtScopeId, search ? `%${search}%` : "", action, entityType];
  const where = filters.join(" AND ");

  const countResult = await query(
    `SELECT COUNT(*)::int AS total
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE ${where}`,
    params
  );

  const dataResult = await query(
    `SELECT a.*, u.full_name AS user_name, d.district_name
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN districts d ON d.id = a.district_id
     WHERE ${where}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $5 OFFSET $6`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  return {
    logs: dataResult.rows.map(serializeAudit),
    total: countResult.rows[0].total,
    page,
    pageSize
  };
}

module.exports = { record, recordForRequest, listAuditLogs };
