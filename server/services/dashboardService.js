"use strict";

const { query } = require("../config/database");
const { serializeAudit } = require("../utils/serializers");

function fallbackPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Controllers pass a scope object; older callers may still pass a district id.
function normalizeScope(scope) {
  if (scope && typeof scope === "object" && !Array.isArray(scope)) {
    return {
      districtId: scope.districtId === undefined ? null : scope.districtId,
      schoolId: scope.schoolId === undefined ? null : scope.schoolId,
      workspace: scope.workspace || "district",
      userId: scope.userId || null
    };
  }
  return {
    districtId: scope === undefined ? null : scope,
    schoolId: null,
    workspace: "district",
    userId: null
  };
}

function isClassScope(scope) {
  return scope.workspace === "class" || scope.workspace === "learner";
}

function emptyStatuses() {
  return { pending: 0, submitted: 0, late: 0, reviewed: 0, missing: 0 };
}

async function resolvePeriod(scope, requestedPeriod) {
  const normalized = normalizeScope(scope);
  if (requestedPeriod) {
    return requestedPeriod;
  }
  const result = await query(
    `SELECT MAX(r.reporting_period) AS period
     FROM school_reports r
     JOIN schools s ON s.id = r.school_id
     WHERE ($1::bigint IS NULL OR s.district_id = $1)
       AND ($2::bigint IS NULL OR s.id = $2)`,
    [normalized.districtId, normalized.schoolId]
  );
  return result.rows[0].period || fallbackPeriod();
}

async function getSummary(scope, requestedPeriod) {
  const normalized = normalizeScope(scope);
  const period = await resolvePeriod(normalized, requestedPeriod);
  if (isClassScope(normalized)) {
    return {
      period,
      totalSchools: 0,
      activeSchools: 0,
      totalStudents: 0,
      totalTeachers: 0,
      pendingReports: 0,
      attentionSchools: 0,
      workspace: normalized.workspace,
      generatedAt: new Date().toISOString()
    };
  }
  const result = await query(
    `WITH scoped AS (
       SELECT * FROM schools
       WHERE status <> 'archived'
         AND ($1::bigint IS NULL OR district_id = $1)
         AND ($2::bigint IS NULL OR id = $2)
     ),
     reporting AS (
       SELECT s.id AS school_id,
              COALESCE(r.submission_status, 'pending') AS status
       FROM scoped s
       LEFT JOIN school_reports r
         ON r.school_id = s.id
        AND r.reporting_period = $3
        AND r.report_type = 'Monthly Enrollment'
     )
     SELECT
       (SELECT COUNT(*)::int FROM scoped) AS total_schools,
       (SELECT COUNT(*)::int FROM scoped WHERE status = 'active') AS active_schools,
       (SELECT COALESCE(SUM(student_count), 0)::int FROM scoped) AS total_students,
       (SELECT COALESCE(SUM(teacher_count), 0)::int FROM scoped) AS total_teachers,
       (SELECT COUNT(*) FROM reporting WHERE status = 'pending') AS pending_reports,
       (SELECT COUNT(*) FROM scoped s
         JOIN reporting r ON r.school_id = s.id
         WHERE s.status = 'inactive' OR r.status IN ('pending', 'late')) AS attention_schools`,
    [normalized.districtId, normalized.schoolId, period]
  );

  return {
    period,
    totalSchools: result.rows[0].total_schools,
    activeSchools: result.rows[0].active_schools,
    totalStudents: result.rows[0].total_students,
    totalTeachers: result.rows[0].total_teachers,
    pendingReports: result.rows[0].pending_reports,
    attentionSchools: result.rows[0].attention_schools,
    workspace: normalized.workspace,
    generatedAt: new Date().toISOString()
  };
}

async function getEnrollment(scope) {
  const normalized = normalizeScope(scope);
  if (isClassScope(normalized)) {
    return [];
  }
  const result = await query(
    `SELECT s.id, s.school_name, s.student_count, s.school_type, s.status, d.district_name
     FROM schools s
     JOIN districts d ON d.id = s.district_id
     WHERE s.status <> 'archived'
       AND ($1::bigint IS NULL OR s.district_id = $1)
       AND ($2::bigint IS NULL OR s.id = $2)
     ORDER BY s.student_count DESC, s.school_name ASC`,
    [normalized.districtId, normalized.schoolId]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.school_name,
    students: Number(row.student_count),
    type: row.school_type,
    status: row.status,
    districtName: row.district_name
  }));
}

async function getPerformance(scope) {
  const normalized = normalizeScope(scope);
  if (isClassScope(normalized)) {
    return [];
  }
  const result = await query(
    `SELECT s.id, s.school_name, s.performance_score, s.school_type, d.district_name
     FROM schools s
     JOIN districts d ON d.id = s.district_id
     WHERE s.status <> 'archived'
       AND s.performance_score IS NOT NULL
       AND ($1::bigint IS NULL OR s.district_id = $1)
       AND ($2::bigint IS NULL OR s.id = $2)
     ORDER BY s.performance_score DESC, s.school_name ASC`,
    [normalized.districtId, normalized.schoolId]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.school_name,
    score: Number(row.performance_score),
    type: row.school_type,
    districtName: row.district_name
  }));
}

async function getReportStatus(scope, requestedPeriod) {
  const normalized = normalizeScope(scope);
  const period = await resolvePeriod(normalized, requestedPeriod);
  if (isClassScope(normalized)) {
    return {
      period,
      total: 0,
      statuses: emptyStatuses(),
      periods: [],
      workspace: normalized.workspace
    };
  }

  const countsResult = await query(
    `WITH scoped AS (
       SELECT * FROM schools
       WHERE status <> 'archived'
         AND ($1::bigint IS NULL OR district_id = $1)
         AND ($2::bigint IS NULL OR id = $2)
     )
     SELECT COALESCE(r.submission_status, 'missing') AS status, COUNT(*)::int AS count
     FROM scoped s
     LEFT JOIN school_reports r
       ON r.school_id = s.id
      AND r.reporting_period = $3
      AND r.report_type = 'Monthly Enrollment'
     GROUP BY COALESCE(r.submission_status, 'missing')`,
    [normalized.districtId, normalized.schoolId, period]
  );

  const statuses = emptyStatuses();
  countsResult.rows.forEach((row) => {
    statuses[row.status] = row.count;
  });
  const total = Object.values(statuses).reduce((sum, count) => sum + count, 0);

  const periodsResult = await query(
    `SELECT DISTINCT r.reporting_period
     FROM school_reports r
     JOIN schools s ON s.id = r.school_id
     WHERE ($1::bigint IS NULL OR s.district_id = $1)
       AND ($2::bigint IS NULL OR s.id = $2)
     ORDER BY r.reporting_period DESC
     LIMIT 12`,
    [normalized.districtId, normalized.schoolId]
  );

  return {
    period,
    total,
    statuses,
    periods: periodsResult.rows.map((row) => row.reporting_period),
    workspace: normalized.workspace
  };
}

async function getRecentActivity(scope, limit = 8) {
  const normalized = normalizeScope(scope);
  if (normalized.workspace === "learner" || normalized.workspace === "class") {
    const result = await query(
      `SELECT a.*, u.full_name AS user_name, d.district_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN districts d ON d.id = a.district_id
       WHERE a.user_id = $1
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $2`,
      [normalized.userId, limit]
    );
    return result.rows.map(serializeAudit);
  }

  if (normalized.workspace === "school") {
    const result = await query(
      `SELECT a.*, u.full_name AS user_name, d.district_name
       FROM audit_logs a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN districts d ON d.id = a.district_id
       WHERE u.school_id = $1
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT $2`,
      [normalized.schoolId || -1, limit]
    );
    return result.rows.map(serializeAudit);
  }

  const result = await query(
    `SELECT a.*, u.full_name AS user_name, d.district_name
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN districts d ON d.id = a.district_id
     WHERE ($1::bigint IS NULL OR a.district_id = $1)
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $2`,
    [normalized.districtId, limit]
  );
  return result.rows.map(serializeAudit);
}

module.exports = {
  resolvePeriod,
  getSummary,
  getEnrollment,
  getPerformance,
  getReportStatus,
  getRecentActivity
};
