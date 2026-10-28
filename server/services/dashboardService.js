"use strict";

const { query } = require("../config/database");
const { serializeAudit } = require("../utils/serializers");

function fallbackPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

async function resolvePeriod(districtId, requestedPeriod) {
  if (requestedPeriod) {
    return requestedPeriod;
  }
  const result = await query(
    `SELECT MAX(r.reporting_period) AS period
     FROM school_reports r
     JOIN schools s ON s.id = r.school_id
     WHERE ($1::bigint IS NULL OR s.district_id = $1)`,
    [districtId]
  );
  return result.rows[0].period || fallbackPeriod();
}

async function getSummary(districtId, requestedPeriod) {
  const period = await resolvePeriod(districtId, requestedPeriod);
  const result = await query(
    `WITH scoped AS (
       SELECT * FROM schools
       WHERE status <> 'archived'
         AND ($1::bigint IS NULL OR district_id = $1)
     ),
     reporting AS (
       SELECT s.id AS school_id,
              COALESCE(r.submission_status, 'pending') AS status
       FROM scoped s
       LEFT JOIN school_reports r
         ON r.school_id = s.id
        AND r.reporting_period = $2
        AND r.report_type = 'Monthly Enrollment'
     )
     SELECT
       (SELECT COUNT(*)::int FROM scoped) AS total_schools,
       (SELECT COUNT(*)::int FROM scoped WHERE status = 'active') AS active_schools,
       (SELECT COALESCE(SUM(student_count), 0)::int FROM scoped) AS total_students,
       (SELECT COALESCE(SUM(teacher_count), 0)::int FROM scoped) AS total_teachers,
       (SELECT COUNT(*)::int FROM reporting WHERE status = 'pending') AS pending_reports,
       (SELECT COUNT(*)::int FROM scoped s
         JOIN reporting r ON r.school_id = s.id
         WHERE s.status = 'inactive' OR r.status IN ('pending', 'late')) AS attention_schools`,
    [districtId, period]
  );

  return {
    period,
    totalSchools: result.rows[0].total_schools,
    activeSchools: result.rows[0].active_schools,
    totalStudents: result.rows[0].total_students,
    totalTeachers: result.rows[0].total_teachers,
    pendingReports: result.rows[0].pending_reports,
    attentionSchools: result.rows[0].attention_schools,
    generatedAt: new Date().toISOString()
  };
}

async function getEnrollment(districtId) {
  const result = await query(
    `SELECT s.id, s.school_name, s.student_count, s.school_type, s.status, d.district_name
     FROM schools s
     JOIN districts d ON d.id = s.district_id
     WHERE s.status <> 'archived'
       AND ($1::bigint IS NULL OR s.district_id = $1)
     ORDER BY s.student_count DESC, s.school_name ASC`,
    [districtId]
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

async function getPerformance(districtId) {
  const result = await query(
    `SELECT s.id, s.school_name, s.performance_score, s.school_type, d.district_name
     FROM schools s
     JOIN districts d ON d.id = s.district_id
     WHERE s.status <> 'archived'
       AND s.performance_score IS NOT NULL
       AND ($1::bigint IS NULL OR s.district_id = $1)
     ORDER BY s.performance_score DESC, s.school_name ASC`,
    [districtId]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    name: row.school_name,
    score: Number(row.performance_score),
    type: row.school_type,
    districtName: row.district_name
  }));
}

async function getReportStatus(districtId, requestedPeriod) {
  const period = await resolvePeriod(districtId, requestedPeriod);

  const countsResult = await query(
    `WITH scoped AS (
       SELECT * FROM schools
       WHERE status <> 'archived'
         AND ($1::bigint IS NULL OR district_id = $1)
     )
     SELECT COALESCE(r.submission_status, 'missing') AS status, COUNT(*)::int AS count
     FROM scoped s
     LEFT JOIN school_reports r
       ON r.school_id = s.id
      AND r.reporting_period = $2
      AND r.report_type = 'Monthly Enrollment'
     GROUP BY COALESCE(r.submission_status, 'missing')`,
    [districtId, period]
  );

  const statuses = { pending: 0, submitted: 0, late: 0, reviewed: 0, missing: 0 };
  countsResult.rows.forEach((row) => {
    statuses[row.status] = row.count;
  });
  const total = Object.values(statuses).reduce((sum, count) => sum + count, 0);

  const periodsResult = await query(
    `SELECT DISTINCT r.reporting_period
     FROM school_reports r
     JOIN schools s ON s.id = r.school_id
     WHERE ($1::bigint IS NULL OR s.district_id = $1)
     ORDER BY r.reporting_period DESC
     LIMIT 12`,
    [districtId]
  );

  return {
    period,
    total,
    statuses,
    periods: periodsResult.rows.map((row) => row.reporting_period)
  };
}

async function getRecentActivity(districtId, limit = 8) {
  const result = await query(
    `SELECT a.*, u.full_name AS user_name, d.district_name
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     LEFT JOIN districts d ON d.id = a.district_id
     WHERE ($1::bigint IS NULL OR a.district_id = $1)
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $2`,
    [districtId, limit]
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
