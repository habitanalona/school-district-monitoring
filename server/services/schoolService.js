"use strict";

const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const { serializeSchool } = require("../utils/serializers");
const { assertDistrictAccess } = require("../utils/scope");
const { requireDistrict } = require("./districtService");
const auditService = require("./auditService");

const SORT_COLUMNS = {
  name: "s.school_name",
  code: "s.school_code",
  type: "s.school_type",
  head: "s.school_head",
  students: "s.student_count",
  teachers: "s.teacher_count",
  performance: "s.performance_score",
  report: "COALESCE(r.report_status, 'pending')",
  status: "s.status",
  district: "d.district_name",
  updated: "s.updated_at"
};

function latestReportJoin(periodIndex) {
  return `LEFT JOIN LATERAL (
    SELECT r.submission_status AS report_status,
           r.reporting_period AS report_period,
           r.submitted_at AS report_submitted_at
    FROM school_reports r
    WHERE r.school_id = s.id
      AND r.report_type = 'Monthly Enrollment'
      AND ($${periodIndex}::text IS NULL OR r.reporting_period = $${periodIndex})
    ORDER BY r.reporting_period DESC, r.updated_at DESC
    LIMIT 1
  ) r ON TRUE`;
}

function buildWhere() {
  return [
    "($1::bigint IS NULL OR s.district_id = $1)",
    "($2 = '' OR s.school_name ILIKE $2 OR s.school_code ILIKE $2 OR s.school_head ILIKE $2 OR d.district_name ILIKE $2)",
    "($3 = '' OR s.school_type = $3)",
    "(($4 = '' AND s.status <> 'archived') OR ($4 = 'all') OR ($4 NOT IN ('', 'all') AND s.status = $4))",
    "($5 = '' OR ($5 = 'pending' AND COALESCE(r.report_status, 'pending') = 'pending') OR r.report_status = $5)"
  ].join(" AND ");
}

async function listSchools({
  districtScopeId = null,
  search = "",
  schoolType = "",
  status = "",
  reportStatus = "",
  period = null,
  sort = "name",
  direction = "asc",
  page = 1,
  pageSize = 10
}) {
  const where = buildWhere();
  const params = [districtScopeId, search ? `%${search}%` : "", schoolType, status, reportStatus, period];
  const sortColumn = SORT_COLUMNS[sort] || SORT_COLUMNS.name;
  const sortDirection = direction === "desc" ? "DESC" : "ASC";

  const fromSql = `FROM schools s
    JOIN districts d ON d.id = s.district_id
    ${latestReportJoin(6)}
    WHERE ${where}`;

  const countResult = await query(`SELECT COUNT(*)::int AS total ${fromSql}`, params);
  const dataResult = await query(
    `SELECT s.*, d.district_name, d.district_code,
            r.report_status, r.report_period, r.report_submitted_at
     ${fromSql}
     ORDER BY ${sortColumn} ${sortDirection} NULLS LAST, s.id ${sortDirection}
     LIMIT $7 OFFSET $8`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  return {
    schools: dataResult.rows.map(serializeSchool),
    total: countResult.rows[0].total,
    page,
    pageSize
  };
}

async function findSchoolRow(id) {
  const result = await query(`SELECT s.* FROM schools s WHERE s.id = $1`, [id]);
  return result.rows[0] || null;
}

async function getSchool(id, districtScopeId = null, period = null) {
  const result = await query(
    `SELECT s.*, d.district_name, d.district_code,
            r.report_status, r.report_period, r.report_submitted_at
     FROM schools s
     JOIN districts d ON d.id = s.district_id
     ${latestReportJoin(3)}
     WHERE s.id = $1
       AND ($2::bigint IS NULL OR s.district_id = $2)`,
    [id, districtScopeId, period]
  );
  if (!result.rows[0]) {
    throw new HttpError(404, "School not found.", "SCHOOL_NOT_FOUND");
  }
  return serializeSchool(result.rows[0]);
}

async function sidebarSchools(districtScopeId, search = "") {
  const result = await query(
    `SELECT s.*, d.district_name, d.district_code
     FROM schools s
     JOIN districts d ON d.id = s.district_id
     WHERE s.status <> 'archived'
       AND ($1::bigint IS NULL OR s.district_id = $1)
       AND ($2 = '' OR s.school_name ILIKE $2 OR s.school_code ILIKE $2)
     ORDER BY s.school_name ASC
     LIMIT 100`,
    [districtScopeId, search ? `%${search}%` : ""]
  );

  const counts = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'active')::int AS active_count,
       COUNT(*) FILTER (WHERE status <> 'archived')::int AS total_count
     FROM schools
     WHERE ($1::bigint IS NULL OR district_id = $1)`,
    [districtScopeId]
  );

  return {
    schools: result.rows.map(serializeSchool),
    activeCount: counts.rows[0].active_count,
    totalCount: counts.rows[0].total_count
  };
}

async function ensureDistrict(user, districtId) {
  assertDistrictAccess(user, districtId);
  await requireDistrict(districtId);
}

async function assertCodeAvailable(schoolCode, excludeId = null) {
  const result = await query(
    `SELECT id FROM schools
     WHERE lower(school_code) = lower($1)
       AND ($2::bigint IS NULL OR id <> $2)`,
    [schoolCode, excludeId]
  );
  if (result.rows[0]) {
    throw new HttpError(409, "That school code is already in use.", "SCHOOL_CODE_IN_USE");
  }
}

async function createSchool(user, payload) {
  await ensureDistrict(user, payload.districtId);
  await assertCodeAvailable(payload.schoolCode);
  const client = await getClient();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO schools (
         school_code, school_name, school_type, address, district_id,
         school_head, contact_email, contact_phone, student_count, teacher_count,
         performance_score, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        payload.schoolCode,
        payload.schoolName,
        payload.schoolType,
        payload.address,
        payload.districtId,
        payload.schoolHead,
        payload.contactEmail,
        payload.contactPhone,
        payload.studentCount,
        payload.teacherCount,
        payload.performanceScore,
        payload.status
      ]
    );
    const id = Number(result.rows[0].id);
    await auditService.record({
      client,
      userId: user.id,
      action: "school.created",
      entityType: "school",
      entityId: id,
      districtId: payload.districtId,
      ipAddress: user.ipAddress || null,
      details: { school_code: payload.schoolCode, school_name: payload.schoolName }
    });
    await client.query("COMMIT");
    return getSchool(id, null, null);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new HttpError(409, "That school code is already in use.", "SCHOOL_CODE_IN_USE");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function updateSchool(user, id, payload) {
  const existing = await findSchoolRow(id);
  if (!existing) {
    throw new HttpError(404, "School not found.", "SCHOOL_NOT_FOUND");
  }
  assertDistrictAccess(user, existing.district_id);
  await ensureDistrict(user, payload.districtId);

  if (existing.status === "archived") {
    throw new HttpError(409, "Restore this school before editing its details.", "SCHOOL_ARCHIVED");
  }
  await assertCodeAvailable(payload.schoolCode, id);

  const changedFields = [
    ["school_name", payload.schoolName],
    ["school_type", payload.schoolType],
    ["address", payload.address],
    ["district_id", payload.districtId],
    ["school_head", payload.schoolHead],
    ["contact_email", payload.contactEmail],
    ["contact_phone", payload.contactPhone],
    ["student_count", payload.studentCount],
    ["teacher_count", payload.teacherCount],
    ["performance_score", payload.performanceScore],
    ["status", payload.status]
  ]
    .filter(([field, value]) => String(existing[field] ?? "") !== String(value ?? ""))
    .map(([field]) => field);

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE schools SET
         school_code = $1,
         school_name = $2,
         school_type = $3,
         address = $4,
         district_id = $5,
         school_head = $6,
         contact_email = $7,
         contact_phone = $8,
         student_count = $9,
         teacher_count = $10,
         performance_score = $11,
         status = $12
       WHERE id = $13`,
      [
        payload.schoolCode,
        payload.schoolName,
        payload.schoolType,
        payload.address,
        payload.districtId,
        payload.schoolHead,
        payload.contactEmail,
        payload.contactPhone,
        payload.studentCount,
        payload.teacherCount,
        payload.performanceScore,
        payload.status,
        id
      ]
    );
    await auditService.record({
      client,
      userId: user.id,
      action: "school.updated",
      entityType: "school",
      entityId: id,
      districtId: payload.districtId,
      ipAddress: user.ipAddress || null,
      details: { school_code: payload.schoolCode, fields: changedFields }
    });
    await client.query("COMMIT");
    return getSchool(id, null, null);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new HttpError(409, "That school code is already in use.", "SCHOOL_CODE_IN_USE");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function archiveSchool(user, id) {
  const existing = await findSchoolRow(id);
  if (!existing) {
    throw new HttpError(404, "School not found.", "SCHOOL_NOT_FOUND");
  }
  assertDistrictAccess(user, existing.district_id);
  if (existing.status === "archived") {
    throw new HttpError(409, "This school is already archived.", "SCHOOL_ALREADY_ARCHIVED");
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE schools SET status = 'archived', archived_at = now() WHERE id = $1`,
      [id]
    );
    await auditService.record({
      client,
      userId: user.id,
      action: "school.archived",
      entityType: "school",
      entityId: id,
      districtId: existing.district_id,
      ipAddress: user.ipAddress || null,
      details: { school_code: existing.school_code, school_name: existing.school_name }
    });
    await client.query("COMMIT");
    return getSchool(id, null, null);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function restoreSchool(user, id) {
  const existing = await findSchoolRow(id);
  if (!existing) {
    throw new HttpError(404, "School not found.", "SCHOOL_NOT_FOUND");
  }
  assertDistrictAccess(user, existing.district_id);
  if (existing.status !== "archived") {
    throw new HttpError(409, "This school is not archived.", "SCHOOL_NOT_ARCHIVED");
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE schools SET status = 'active', archived_at = NULL WHERE id = $1`,
      [id]
    );
    await auditService.record({
      client,
      userId: user.id,
      action: "school.restored",
      entityType: "school",
      entityId: id,
      districtId: existing.district_id,
      ipAddress: user.ipAddress || null,
      details: { school_code: existing.school_code, school_name: existing.school_name }
    });
    await client.query("COMMIT");
    return getSchool(id, null, null);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  SORT_COLUMNS,
  listSchools,
  getSchool,
  sidebarSchools,
  createSchool,
  updateSchool,
  archiveSchool,
  restoreSchool
};
