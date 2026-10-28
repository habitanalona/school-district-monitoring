"use strict";

const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const { serializeReport } = require("../utils/serializers");
const auditService = require("./auditService");

const REPORT_SELECT = `SELECT r.*, s.school_name, s.school_code, s.district_id,
         d.district_name, u.full_name AS submitted_by_name
  FROM school_reports r
  JOIN schools s ON s.id = r.school_id
  JOIN districts d ON d.id = s.district_id
  LEFT JOIN users u ON u.id = r.submitted_by`;

async function listReports({
  districtScopeId = null,
  period = "",
  status = "",
  reportType = "",
  search = "",
  schoolId = null,
  page = 1,
  pageSize = 10
}) {
  const where = [
    "($1::bigint IS NULL OR s.district_id = $1)",
    "($2 = '' OR r.reporting_period = $2)",
    "($3 = '' OR r.submission_status = $3)",
    "($4 = '' OR r.report_type = $4)",
    "($5 = '' OR s.school_name ILIKE $5 OR s.school_code ILIKE $5)",
    "($6::bigint IS NULL OR r.school_id = $6)"
  ].join(" AND ");
  const params = [
    districtScopeId,
    period,
    status,
    reportType,
    search ? `%${search}%` : "",
    schoolId
  ];

  const countResult = await query(
    `SELECT COUNT(*)::int AS total
     FROM school_reports r
     JOIN schools s ON s.id = r.school_id
     WHERE ${where}`,
    params
  );

  const dataResult = await query(
    `${REPORT_SELECT}
     WHERE ${where}
     ORDER BY r.reporting_period DESC, s.school_name ASC, r.updated_at DESC
     LIMIT $7 OFFSET $8`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  return {
    reports: dataResult.rows.map(serializeReport),
    total: countResult.rows[0].total,
    page,
    pageSize
  };
}

async function getReport(id, districtScopeId = null) {
  const result = await query(
    `${REPORT_SELECT}
     WHERE r.id = $1
       AND ($2::bigint IS NULL OR s.district_id = $2)`,
    [id, districtScopeId]
  );
  if (!result.rows[0]) {
    throw new HttpError(404, "School report not found.", "REPORT_NOT_FOUND");
  }
  return serializeReport(result.rows[0]);
}

async function getReportSummary(districtScopeId, period) {
  const result = await query(
    `SELECT r.submission_status AS status, COUNT(*)::int AS count
     FROM school_reports r
     JOIN schools s ON s.id = r.school_id
     WHERE ($1::bigint IS NULL OR s.district_id = $1)
       AND ($2 = '' OR r.reporting_period = $2)
     GROUP BY r.submission_status`,
    [districtScopeId, period]
  );

  const statuses = { pending: 0, submitted: 0, late: 0, reviewed: 0 };
  result.rows.forEach((row) => {
    statuses[row.status] = row.count;
  });
  return {
    period,
    total: Object.values(statuses).reduce((sum, count) => sum + count, 0),
    statuses
  };
}

async function findReportRow(id) {
  const result = await query(
    `SELECT r.*, s.district_id, s.school_name, s.school_code, s.status AS school_status
     FROM school_reports r
     JOIN schools s ON s.id = r.school_id
     WHERE r.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function createReport(actor, payload) {
  const schoolResult = await query(
    `SELECT s.id, s.district_id, s.school_name, s.school_code, s.status
     FROM schools s
     WHERE s.id = $1
       AND ($2::bigint IS NULL OR s.district_id = $2)`,
    [payload.schoolId, actor.role === "system_admin" ? null : actor.districtId]
  );
  const school = schoolResult.rows[0];
  if (!school) {
    throw new HttpError(404, "School not found.", "SCHOOL_NOT_FOUND");
  }
  if (school.status === "archived") {
    throw new HttpError(409, "Reports cannot be added for an archived school.", "SCHOOL_ARCHIVED");
  }

  const isSubmitted = payload.submissionStatus !== "pending";
  const submittedBy = isSubmitted ? actor.id : null;
  const submittedAt = isSubmitted ? new Date() : null;

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO school_reports (
         school_id, reporting_period, report_type, submission_status,
         submitted_by, submitted_at, remarks
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        payload.schoolId,
        payload.reportingPeriod,
        payload.reportType,
        payload.submissionStatus,
        submittedBy,
        submittedAt,
        payload.remarks
      ]
    );
    const id = Number(result.rows[0].id);
    await auditService.record({
      client,
      userId: actor.id,
      districtId: school.district_id,
      ipAddress: actor.ipAddress || null,
      action: "report.created",
      entityType: "school_report",
      entityId: id,
      details: {
        school_code: school.school_code,
        period: payload.reportingPeriod,
        status: payload.submissionStatus
      }
    });
    await client.query("COMMIT");
    return getReport(id);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new HttpError(409, "A report for that school, period, and type already exists.", "REPORT_DUPLICATE");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function updateReport(actor, id, payload) {
  const existing = await findReportRow(id);
  if (!existing) {
    throw new HttpError(404, "School report not found.", "REPORT_NOT_FOUND");
  }
  if (actor.role !== "system_admin" && Number(existing.district_id) !== Number(actor.districtId)) {
    throw new HttpError(403, "You do not have access to that school report.", "DISTRICT_FORBIDDEN");
  }

  const isSubmitted = payload.submissionStatus !== "pending";
  const submittedBy = isSubmitted ? (existing.submitted_by || actor.id) : null;
  const submittedAt = isSubmitted ? (existing.submitted_at || new Date()) : null;

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE school_reports
       SET submission_status = $1, submitted_by = $2, submitted_at = $3, remarks = $4
       WHERE id = $5`,
      [payload.submissionStatus, submittedBy, submittedAt, payload.remarks, id]
    );
    await auditService.record({
      client,
      userId: actor.id,
      districtId: existing.district_id,
      ipAddress: actor.ipAddress || null,
      action: "report.updated",
      entityType: "school_report",
      entityId: id,
      details: {
        school_code: existing.school_code,
        period: existing.reporting_period,
        status: payload.submissionStatus
      }
    });
    await client.query("COMMIT");
    return getReport(id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  listReports,
  getReport,
  getReportSummary,
  createReport,
  updateReport
};
