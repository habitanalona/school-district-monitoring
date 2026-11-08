"use strict";

// Subject-period attendance, adviser validation, and configurable academic
// terms.
//
// The paper attendance sheet has nine period columns per school day. This
// module stores one source record per learner, subject, period, and date; the
// class adviser then validates one official record per learner and date, which
// is what SF 2 reads. The two layers are intentionally separate so an adviser
// correction never overwrites the teacher's original submission.

const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const {
  requireIdParam,
  requireInteger,
  requireEnum,
  requireString,
  optionalString,
  fail
} = require("../utils/validators");
const {
  assertCan,
  isSystemAdmin,
  resolveSchool,
  sectionForActor,
  resolveSchoolYear,
  schoolScopeSql
} = require("../utils/formsAccess");
const attendanceService = require("./attendanceService");
const auditService = require("./auditService");
const { hasRole, hasAnyRole } = require("../utils/roles");

const SUBJECT_STATUSES = ["present", "absent", "tardy", "excused"];
const DAILY_STATUSES = ["present", "absent", "tardy", "excused", "half_day"];
const TERM_STATUSES = ["draft", "approved"];
const CONFIG_ROLES = new Set(["system_admin", "district_admin", "staff", "school_head"]);

// Suggested only. Nothing is written until an administrator applies a layout.
const SUGGESTED_PERIODS = [
  { periodNo: 1, label: "Period 1", startTime: "07:30", endTime: "08:30" },
  { periodNo: 2, label: "Period 2", startTime: "08:30", endTime: "09:30" },
  { periodNo: 3, label: "Period 3", startTime: "09:45", endTime: "10:45" },
  { periodNo: 4, label: "Period 4", startTime: "10:45", endTime: "11:45" },
  { periodNo: 5, label: "Period 5", startTime: "12:45", endTime: "13:45" },
  { periodNo: 6, label: "Period 6", startTime: "13:45", endTime: "14:45" },
  { periodNo: 7, label: "Period 7", startTime: "14:45", endTime: "15:45" },
  { periodNo: 8, label: "Period 8", startTime: "15:45", endTime: "16:45" },
  { periodNo: 9, label: "Period 9", startTime: "16:45", endTime: "17:45" }
];

function toIsoDate(value) {
  if (!value) {
    return "";
  }
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoWeekday(dateString) {
  const date = new Date(`${dateString}T00:00:00Z`);
  return ((date.getUTCDay() + 6) % 7) + 1;
}

function weekBounds(dateString) {
  const start = addDays(dateString, -(isoWeekday(dateString) - 1));
  const dates = [];
  for (let index = 0; index < 5; index += 1) {
    dates.push(addDays(start, index));
  }
  return { start, end: dates[4], dates };
}

function clock(value) {
  return String(value).slice(0, 5);
}

function fullName(row) {
  return [row.last_name, row.first_name, row.middle_name, row.extension_name]
    .filter(Boolean)
    .join(" ");
}

function canValidate(actor, section) {
  return (
    isSystemAdmin(actor) ||
    ["district_admin", "school_head"].includes(actor.role) ||
    Number(section.adviser_id) === Number(actor.id)
  );
}

function assertConfigRole(actor) {
  if (!CONFIG_ROLES.has(actor.role)) {
    throw new HttpError(
      403,
      "Only school administrators may change academic terms or class periods.",
      "CONFIG_FORBIDDEN"
    );
  }
}

function assertWriteAssignment(actor, assignment) {
  if (
    Number(assignment.teacher_id) === Number(actor.id) ||
    ["system_admin", "district_admin", "school_head"].includes(actor.role)
  ) {
    return;
  }
  throw new HttpError(
    403,
    "You can only encode attendance for your own teaching assignment.",
    "ASSIGNMENT_FORBIDDEN"
  );
}

/* -------------------------------------------------------------------------- */
/* Academic terms                                                             */
/* -------------------------------------------------------------------------- */

async function listTerms(actor, options) {
  assertCan(actor, "attendance", "access");
  const school = await resolveSchool(actor, options.schoolId);
  const year = await resolveSchoolYear(options.schoolYearId);
  const result = await query(
    `SELECT * FROM school_terms
     WHERE school_id = $1 AND school_year_id = $2
     ORDER BY term_no ASC`,
    [school.id, year.id]
  );
  return {
    schoolId: Number(school.id),
    schoolName: school.school_name,
    schoolYearId: Number(year.id),
    schoolYearName: year.name,
    termModel: year.term_model,
    startsOn: toIsoDate(year.starts_on),
    endsOn: toIsoDate(year.ends_on),
    terms: result.rows.map((row) => ({
      id: Number(row.id),
      termNo: Number(row.term_no),
      name: row.name,
      startsOn: toIsoDate(row.starts_on),
      endsOn: toIsoDate(row.ends_on),
      status: row.status,
      approvedAt: row.approved_at
    })),
    canConfigure: CONFIG_ROLES.has(actor.role),
    canApprove: CONFIG_ROLES.has(actor.role)
  };
}

async function provisionTerms(actor, payload) {
  assertCan(actor, "attendance", "edit");
  assertConfigRole(actor);
  const school = await resolveSchool(actor, payload.schoolId);
  const year = await resolveSchoolYear(payload.schoolYearId);
  const existing = await query(
    "SELECT COUNT(*)::int AS total FROM school_terms WHERE school_id = $1 AND school_year_id = $2",
    [school.id, year.id]
  );
  if (existing.rows[0].total > 0) {
    return listTerms(actor, { schoolId: school.id, schoolYearId: year.id });
  }
  const termCount = year.term_model === "three_term" ? 3 : 4;
  const prefix = year.term_model === "three_term" ? "Term" : "Quarter";
  const start = toIsoDate(year.starts_on);
  const end = toIsoDate(year.ends_on);
  const totalDays = Math.max(
    Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000) + 1,
    termCount
  );
  const baseLength = Math.max(Math.floor(totalDays / termCount), 1);
  const client = await getClient();
  try {
    await client.query("BEGIN");
    let termStart = start;
    for (let index = 1; index <= termCount; index += 1) {
      const termEnd =
        index === termCount ? end : addDays(termStart, baseLength - 1);
      await client.query(
        `INSERT INTO school_terms
           (school_id, school_year_id, term_no, name, starts_on, ends_on, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)
         ON CONFLICT (school_id, school_year_id, term_no) DO NOTHING`,
        [school.id, year.id, index, `${prefix} ${index}`, termStart, termEnd, actor.id]
      );
      termStart = addDays(termEnd, 1);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "attendance.terms.provision",
    entityType: "school_term",
    entityId: school.id,
    details: { schoolId: Number(school.id), schoolYearId: Number(year.id), terms: termCount }
  });
  return listTerms(actor, { schoolId: school.id, schoolYearId: year.id });
}

async function saveTerms(actor, payload) {
  assertCan(actor, "attendance", "edit");
  assertConfigRole(actor);
  const school = await resolveSchool(actor, payload.schoolId);
  const year = await resolveSchoolYear(payload.schoolYearId);
  if (!Array.isArray(payload.terms) || !payload.terms.length) {
    fail("Provide at least one term.");
  }
  if (payload.terms.length > 6) {
    fail("A school year may have at most six terms.");
  }
  const prepared = payload.terms
    .map((entry) => {
      const termNo = requireInteger(entry.termNo, "Term number", { min: 1, max: 6 });
      const name = requireString(entry.name, "Term name", { max: 64 });
      const startsOn = attendanceService.requireDate(entry.startsOn, "Term start");
      const endsOn = attendanceService.requireDate(entry.endsOn, "Term end");
      if (endsOn < startsOn) {
        fail(`${name} ends before it starts.`, { field: "endsOn" });
      }
      return { termNo, name, startsOn, endsOn };
    })
    .sort((left, right) => left.termNo - right.termNo);
  const seen = new Set();
  prepared.forEach((entry) => {
    if (seen.has(entry.termNo)) {
      fail(`Term number ${entry.termNo} appears more than once.`, { field: "termNo" });
    }
    seen.add(entry.termNo);
  });
  for (let index = 1; index < prepared.length; index += 1) {
    if (prepared[index].startsOn <= prepared[index - 1].endsOn) {
      fail(
        `${prepared[index].name} overlaps ${prepared[index - 1].name}. Teaching terms must not overlap.`,
        { field: "startsOn" }
      );
    }
  }
  const client = await getClient();
  try {
    await client.query("BEGIN");
    for (const entry of prepared) {
      await client.query(
        `INSERT INTO school_terms
           (school_id, school_year_id, term_no, name, starts_on, ends_on, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7)
         ON CONFLICT (school_id, school_year_id, term_no) DO UPDATE SET
           name = EXCLUDED.name,
           starts_on = EXCLUDED.starts_on,
           ends_on = EXCLUDED.ends_on,
           status = 'draft',
           approved_by = NULL,
           approved_at = NULL,
           updated_at = now()`,
        [school.id, year.id, entry.termNo, entry.name, entry.startsOn, entry.endsOn, actor.id]
      );
    }
    await client.query(
      `DELETE FROM school_terms
       WHERE school_id = $1 AND school_year_id = $2 AND term_no <> ALL($3::smallint[])`,
      [school.id, year.id, prepared.map((entry) => entry.termNo)]
    );
    if (payload.termModel) {
      await client.query(
        `UPDATE school_years SET term_model = $1, updated_at = now() WHERE id = $2`,
        [requireEnum(payload.termModel, "Term model", ["three_term", "four_quarter", "custom"]), year.id]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "attendance.terms.save",
    entityType: "school_term",
    entityId: school.id,
    details: {
      schoolId: Number(school.id),
      schoolYearId: Number(year.id),
      terms: prepared.map((entry) => `${entry.termNo}:${entry.name}`)
    }
  });
  return listTerms(actor, { schoolId: school.id, schoolYearId: year.id });
}

async function approveTerms(actor, payload) {
  assertCan(actor, "attendance", "edit");
  assertConfigRole(actor);
  const school = await resolveSchool(actor, payload.schoolId);
  const year = await resolveSchoolYear(payload.schoolYearId);
  const result = await query(
    `UPDATE school_terms SET
       status = 'approved',
       approved_by = $1,
       approved_at = now(),
       updated_at = now()
     WHERE school_id = $2 AND school_year_id = $3
     RETURNING id`,
    [actor.id, school.id, year.id]
  );
  if (!result.rows.length) {
    throw new HttpError(409, "Configure the academic terms before approving them.", "TERMS_NOT_CONFIGURED");
  }
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "attendance.terms.approve",
    entityType: "school_term",
    entityId: school.id,
    details: { schoolId: Number(school.id), schoolYearId: Number(year.id), terms: result.rows.length }
  });
  return listTerms(actor, { schoolId: school.id, schoolYearId: year.id });
}

async function termsForSchool(schoolId, schoolYearId, runner = { query }) {
  const result = await runner.query(
    `SELECT * FROM school_terms
     WHERE school_id = $1 AND school_year_id = $2
     ORDER BY term_no ASC`,
    [schoolId, schoolYearId]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    termNo: Number(row.term_no),
    name: row.name,
    startsOn: toIsoDate(row.starts_on),
    endsOn: toIsoDate(row.ends_on),
    status: row.status
  }));
}

function termForDate(terms, date) {
  return terms.find((term) => date >= term.startsOn && date <= term.endsOn) || null;
}

/* -------------------------------------------------------------------------- */
/* Class periods                                                              */
/* -------------------------------------------------------------------------- */

async function activePeriods(schoolId, schoolYearId, section, runner = { query }) {
  const result = await runner.query(
    `SELECT DISTINCT ON (period_no)
            id, period_no, label, start_time, end_time, grade_level_id, section_id
     FROM class_periods
     WHERE school_id = $1 AND school_year_id = $2
       AND (section_id = $3 OR section_id IS NULL)
       AND (grade_level_id = $4 OR grade_level_id IS NULL)
     ORDER BY period_no ASC,
              (section_id IS NOT NULL) DESC,
              (grade_level_id IS NOT NULL) DESC`,
    [schoolId, schoolYearId, section.id, section.grade_level_id]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    periodNo: Number(row.period_no),
    label: row.label || `Period ${row.period_no}`,
    startTime: clock(row.start_time),
    endTime: clock(row.end_time),
    scope: row.section_id ? "section" : row.grade_level_id ? "grade" : "school"
  }));
}

async function listPeriods(actor, options) {
  assertCan(actor, "attendance", "access");
  const school = await resolveSchool(actor, options.schoolId);
  const year = await resolveSchoolYear(options.schoolYearId);
  let section = null;
  if (options.sectionId) {
    section = await sectionForActor(actor, options.sectionId);
    if (Number(section.school_id) !== Number(school.id)) {
      throw new HttpError(409, "That section belongs to another school.", "SECTION_SCHOOL_MISMATCH");
    }
  }
  const gradeLevelId = section ? section.grade_level_id : options.gradeLevelId;
  const params = [school.id, year.id];
  let filter = "";
  if (section) {
    params.push(section.id);
    filter = ` AND section_id = $${params.length}`;
  } else if (gradeLevelId) {
    params.push(Number(gradeLevelId));
    filter = ` AND grade_level_id = $${params.length} AND section_id IS NULL`;
  } else {
    filter = " AND section_id IS NULL AND grade_level_id IS NULL";
  }
  const result = await query(
    `SELECT * FROM class_periods
     WHERE school_id = $1 AND school_year_id = $2 ${filter}
     ORDER BY period_no ASC`,
    params
  );
  const periods = result.rows.map((row) => ({
    id: Number(row.id),
    periodNo: Number(row.period_no),
    label: row.label || `Period ${row.period_no}`,
    startTime: clock(row.start_time),
    endTime: clock(row.end_time)
  }));
  return {
    schoolId: Number(school.id),
    schoolName: school.school_name,
    schoolYearId: Number(year.id),
    schoolYearName: year.name,
    gradeLevelId: gradeLevelId ? Number(gradeLevelId) : null,
    sectionId: section ? Number(section.id) : null,
    periods,
    configured: periods.length > 0,
    suggested: SUGGESTED_PERIODS,
    effective: section ? await activePeriods(school.id, year.id, section) : periods,
    canConfigure: CONFIG_ROLES.has(actor.role)
  };
}

async function savePeriods(actor, payload) {
  assertCan(actor, "attendance", "edit");
  assertConfigRole(actor);
  const school = await resolveSchool(actor, payload.schoolId);
  const year = await resolveSchoolYear(payload.schoolYearId);
  let section = null;
  if (payload.sectionId) {
    section = await sectionForActor(actor, payload.sectionId);
    if (Number(section.school_id) !== Number(school.id)) {
      throw new HttpError(409, "That section belongs to another school.", "SECTION_SCHOOL_MISMATCH");
    }
  }
  if (!Array.isArray(payload.periods) || payload.periods.length > 12) {
    fail("Provide between 1 and 12 periods.");
  }
  if (!payload.periods.length) {
    fail("Provide at least one period.");
  }
  const prepared = payload.periods
    .map((entry) => {
      const periodNo = requireInteger(entry.periodNo, "Period number", { min: 1, max: 12 });
      const startTime = requireString(entry.startTime, "Start time", { min: 4, max: 8 });
      const endTime = requireString(entry.endTime, "End time", { min: 4, max: 8 });
      if (!/^\d{2}:\d{2}(:\d{2})?$/.test(startTime) || !/^\d{2}:\d{2}(:\d{2})?$/.test(endTime)) {
        fail("Period times must use the HH:MM format.", { field: "startTime" });
      }
      if (endTime <= startTime) {
        fail(`Period ${periodNo} ends before it starts.`, { field: "endTime" });
      }
      return {
        periodNo,
        label: optionalString(entry.label, "Period label", { max: 64 }) || `Period ${periodNo}`,
        startTime,
        endTime
      };
    })
    .sort((left, right) => left.periodNo - right.periodNo);
  const seen = new Set();
  prepared.forEach((entry) => {
    if (seen.has(entry.periodNo)) {
      fail(`Period number ${entry.periodNo} appears more than once.`, { field: "periodNo" });
    }
    seen.add(entry.periodNo);
  });
  for (let index = 1; index < prepared.length; index += 1) {
    if (prepared[index].startTime < prepared[index - 1].endTime) {
      fail(
        `Period ${prepared[index].periodNo} starts before period ${prepared[index - 1].periodNo} ends.`,
        { field: "startTime" }
      );
    }
  }
  const gradeLevelId = section ? null : payload.gradeLevelId ? Number(payload.gradeLevelId) : null;
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM class_periods
       WHERE school_id = $1 AND school_year_id = $2
         AND COALESCE(grade_level_id, 0) = COALESCE($3::bigint, 0)
         AND COALESCE(section_id, 0) = COALESCE($4::bigint, 0)`,
      [school.id, year.id, gradeLevelId, section ? section.id : null]
    );
    for (const entry of prepared) {
      await client.query(
        `INSERT INTO class_periods
           (school_id, school_year_id, grade_level_id, section_id, period_no, label,
            start_time, end_time, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          school.id,
          year.id,
          gradeLevelId,
          section ? section.id : null,
          entry.periodNo,
          entry.label,
          entry.startTime,
          entry.endTime,
          actor.id
        ]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "attendance.periods.save",
    entityType: "class_period",
    entityId: school.id,
    details: {
      schoolId: Number(school.id),
      schoolYearId: Number(year.id),
      gradeLevelId,
      sectionId: section ? Number(section.id) : null,
      periods: prepared.length
    }
  });
  return listPeriods(actor, {
    schoolId: school.id,
    schoolYearId: year.id,
    sectionId: section ? section.id : undefined,
    gradeLevelId
  });
}

async function deletePeriod(actor, id) {
  assertCan(actor, "attendance", "edit");
  assertConfigRole(actor);
  const result = await query("SELECT * FROM class_periods WHERE id = $1", [id]);
  const row = result.rows[0];
  if (!row) {
    throw new HttpError(404, "Class period not found.", "PERIOD_NOT_FOUND");
  }
  const school = await resolveSchool(actor, row.school_id);
  await query("DELETE FROM class_periods WHERE id = $1", [id]);
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "attendance.periods.delete",
    entityType: "class_period",
    entityId: id,
    details: {
      schoolId: Number(school.id),
      schoolYearId: Number(row.school_year_id),
      periodNo: Number(row.period_no)
    }
  });
  return { deleted: true };
}

/* -------------------------------------------------------------------------- */
/* Teaching assignments                                                       */
/* -------------------------------------------------------------------------- */

async function teacherLoads(actor, options) {
  assertCan(actor, "attendance", "access");
  const year = await resolveSchoolYear(options.schoolYearId);
  const params = [year.id];
  const clauses = ["ta.school_year_id = $1"];
  if (hasAnyRole(actor, ["teacher", "adviser"])) {
    params.push(actor.id);
    clauses.push(`(ta.teacher_id = $${params.length} OR sec.adviser_id = $${params.length})`);
  }
  const scope = schoolScopeSql(actor, "s", params, options.schoolId);
  if (scope) {
    clauses.push(scope);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const result = await query(
    `SELECT ta.id AS assignment_id, ta.teacher_id, ta.school_id,
            sec.id AS section_id, sec.name AS section_name, sec.adviser_id,
            gl.id AS grade_level_id, gl.name AS grade_level_name,
            sub.id AS subject_id, sub.code AS subject_code, sub.name AS subject_name,
            s.school_name, y.name AS school_year_name,
            u.full_name AS teacher_name,
            (SELECT COUNT(*)::int FROM class_periods cp
              WHERE cp.school_id = ta.school_id AND cp.school_year_id = ta.school_year_id
                AND (cp.section_id = sec.id OR cp.section_id IS NULL)
                AND (cp.grade_level_id = sec.grade_level_id OR cp.grade_level_id IS NULL)) AS period_count,
            (SELECT COUNT(*)::int FROM subject_attendance sa
              WHERE sa.assignment_id = ta.id) AS recorded_periods
     FROM teacher_assignments ta
     JOIN sections sec ON sec.id = ta.section_id
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     JOIN subjects sub ON sub.id = ta.subject_id
     JOIN schools s ON s.id = ta.school_id
     JOIN school_years y ON y.id = ta.school_year_id
     LEFT JOIN users u ON u.id = ta.teacher_id
     ${where}
     ORDER BY s.school_name ASC, gl.sort_order ASC, sec.name ASC, sub.name ASC`,
    params
  );
  return {
    schoolYear: { id: Number(year.id), name: year.name },
    loads: result.rows.map((row) => ({
      assignmentId: Number(row.assignment_id),
      teacherId: row.teacher_id ? Number(row.teacher_id) : null,
      teacherName: row.teacher_name,
      schoolId: Number(row.school_id),
      schoolName: row.school_name,
      sectionId: Number(row.section_id),
      sectionName: row.section_name,
      gradeLevelId: Number(row.grade_level_id),
      gradeLevelName: row.grade_level_name,
      subjectId: Number(row.subject_id),
      subjectCode: row.subject_code,
      subjectName: row.subject_name,
      adviserId: row.adviser_id ? Number(row.adviser_id) : null,
      periodCount: Number(row.period_count),
      recordedPeriods: Number(row.recorded_periods),
      schoolYearName: row.school_year_name
    }))
  };
}

async function sectionSubjects(actor, options) {
  assertCan(actor, "attendance", "access");
  const { section, year } = await attendanceService.ensureSectionYear(
    actor,
    options.sectionId,
    options.schoolYearId
  );
  const result = await query(
    `SELECT ta.id AS assignment_id, ta.teacher_id, sub.id AS subject_id,
            sub.code AS subject_code, sub.name AS subject_name,
            u.full_name AS teacher_name
     FROM teacher_assignments ta
     JOIN subjects sub ON sub.id = ta.subject_id
     LEFT JOIN users u ON u.id = ta.teacher_id
     WHERE ta.section_id = $1 AND ta.school_year_id = $2
     ORDER BY sub.name ASC, ta.id ASC`,
    [section.id, year.id]
  );
  return {
    sectionId: Number(section.id),
    schoolYearId: Number(year.id),
    adviserId: section.adviser_id ? Number(section.adviser_id) : null,
    adviserName: section.adviser_name,
    subjects: result.rows.map((row) => ({
      assignmentId: Number(row.assignment_id),
      subjectId: Number(row.subject_id),
      subjectCode: row.subject_code,
      subjectName: row.subject_name,
      teacherId: row.teacher_id ? Number(row.teacher_id) : null,
      teacherName: row.teacher_name
    }))
  };
}

async function resolveAssignment(actor, section, year, subjectId, assignmentId) {
  const subjectResult = await query(
    `SELECT s.*, gl.name AS grade_level_name
     FROM subjects s
     LEFT JOIN grade_levels gl ON gl.id = s.grade_level_id
     WHERE s.id = $1 AND s.school_id = $2`,
    [subjectId, section.school_id]
  );
  const subject = subjectResult.rows[0];
  if (!subject) {
    throw new HttpError(404, "Subject not found in this school.", "SUBJECT_NOT_FOUND");
  }
  if (subject.grade_level_id && Number(subject.grade_level_id) !== Number(section.grade_level_id)) {
    throw new HttpError(
      409,
      "That subject is not offered to this section's grade level.",
      "SUBJECT_GRADE_MISMATCH"
    );
  }
  const result = await query(
    `SELECT ta.*, u.full_name AS teacher_name
     FROM teacher_assignments ta
     LEFT JOIN users u ON u.id = ta.teacher_id
     WHERE ta.section_id = $1 AND ta.subject_id = $2 AND ta.school_year_id = $3
     ORDER BY ta.id ASC`,
    [section.id, subjectId, year.id]
  );
  let assignment = null;
  if (assignmentId) {
    assignment = result.rows.find((row) => Number(row.id) === Number(assignmentId));
    if (!assignment) {
      throw new HttpError(404, "That teaching assignment was not found.", "ASSIGNMENT_NOT_FOUND");
    }
  } else if (hasAnyRole(actor, ["teacher", "adviser"])) {
    assignment = result.rows.find((row) => Number(row.teacher_id) === Number(actor.id));
  }
  if (!assignment) {
    assignment = result.rows.find((row) => row.teacher_id) || result.rows[0] || null;
  }
  if (!assignment) {
    throw new HttpError(
      409,
      "Assign a subject teacher to this section and subject before encoding subject attendance.",
      "ASSIGNMENT_REQUIRED"
    );
  }
  if (Number(assignment.school_id) !== Number(section.school_id)) {
    throw new HttpError(409, "The teaching assignment belongs to another school.", "ASSIGNMENT_SCHOOL_MISMATCH");
  }
  return { subject, assignment };
}

async function scheduleFor(section, assignment, periods, date) {
  if (!periods.length) {
    return { active: [], meets: false, source: "unconfigured" };
  }
  const schedules = await query(
    "SELECT day_of_week, start_time, end_time FROM class_schedules WHERE assignment_id = $1 ORDER BY start_time ASC",
    [assignment.id]
  );
  if (!schedules.rows.length) {
    return { active: periods, meets: true, source: "all_periods" };
  }
  const weekday = isoWeekday(date);
  const matching = schedules.rows.filter((row) => Number(row.day_of_week) === weekday);
  if (!matching.length) {
    return { active: [], meets: false, source: "timetable" };
  }
  const starts = new Set(matching.map((row) => clock(row.start_time)));
  const active = periods.filter((period) => starts.has(period.startTime));
  if (!active.length) {
    // The timetable exists but no configured period matches its start time.
    // Keeping all periods is safer than silently making the day unencodable;
    // the mismatch is reported so an administrator can correct the layout.
    return { active: periods, meets: true, source: "timetable_unmatched" };
  }
  return { active, meets: true, source: "timetable" };
}

/* -------------------------------------------------------------------------- */
/* Subject teacher matrix                                                     */
/* -------------------------------------------------------------------------- */

async function getMatrix(actor, options) {
  assertCan(actor, "attendance", "access");
  const { section, year } = await attendanceService.ensureSectionYear(
    actor,
    options.sectionId,
    options.schoolYearId
  );
  const subjectId = requireIdParam(options.subjectId, "Subject");
  const { subject, assignment } = await resolveAssignment(
    actor,
    section,
    year,
    subjectId,
    options.assignmentId
  );
  const anchor = attendanceService.requireDate(options.date, "Attendance date");
  const mode = options.mode === "day" ? "day" : "week";
  const bounds = mode === "week" ? weekBounds(anchor) : { dates: [anchor], start: anchor, end: anchor };
  const periods = await activePeriods(section.school_id, year.id, section);
  const learners = await attendanceService.roster(section, year.id);
  const terms = await termsForSchool(section.school_id, year.id);
  const calendar = await query(
    `SELECT calendar_date, day_type, label FROM school_calendar_days
     WHERE school_id = $1 AND school_year_id = $2 AND calendar_date BETWEEN $3 AND $4`,
    [section.school_id, year.id, bounds.start, bounds.end]
  );
  const calendarMap = new Map(
    calendar.rows.map((row) => [toIsoDate(row.calendar_date), row])
  );
  const records = await query(
    `SELECT id, enrollment_id, attendance_date, period_no, status, remarks
     FROM subject_attendance
     WHERE section_id = $1 AND school_year_id = $2 AND subject_id = $3
       AND attendance_date BETWEEN $4 AND $5`,
    [section.id, year.id, subject.id, bounds.start, bounds.end]
  );
  const submissions = await query(
    `SELECT * FROM subject_attendance_submissions
     WHERE section_id = $1 AND school_year_id = $2 AND subject_id = $3
       AND attendance_date BETWEEN $4 AND $5`,
    [section.id, year.id, subject.id, bounds.start, bounds.end]
  );
  const validation = await query(
    `SELECT DISTINCT attendance_date FROM adviser_attendance
     WHERE section_id = $1 AND school_year_id = $2 AND attendance_date BETWEEN $3 AND $4`,
    [section.id, year.id, bounds.start, bounds.end]
  );
  const submissionMap = new Map(
    submissions.rows.map((row) => [toIsoDate(row.attendance_date), row])
  );
  const lockedDates = new Set(validation.rows.map((row) => toIsoDate(row.attendance_date)));
  const recordMap = new Map(
    records.rows.map((row) => [
      `${row.enrollment_id}|${toIsoDate(row.attendance_date)}|${Number(row.period_no)}`,
      row
    ])
  );

  const dates = [];
  for (const date of bounds.dates) {
    const day = isoWeekday(date);
    const entry = calendarMap.get(date);
    const dayType = entry
      ? entry.day_type
      : day >= 1 && day <= 5
        ? "school_day"
        : "no_class";
    const schedule = await scheduleFor(section, assignment, periods, date);
    const submission = submissionMap.get(date);
    dates.push({
      date,
      weekday: day,
      dayType,
      label: entry ? entry.label : null,
      term: termForDate(terms, date),
      meets: schedule.meets,
      scheduleSource: schedule.source,
      activePeriods: schedule.active.map((period) => period.periodNo),
      submitted: Boolean(submission && submission.status === "submitted"),
      submissionStatus: submission ? submission.status : null,
      submissionId: submission ? Number(submission.id) : null,
      submittedAt: submission ? submission.submitted_at : null,
      submittedBy: submission ? Number(submission.submitted_by) : null,
      locked: lockedDates.has(date)
    });
  }

  const canWriteAssignment =
    Number(assignment.teacher_id) === Number(actor.id) ||
    ["system_admin", "district_admin", "school_head"].includes(actor.role);

  const roster = learners.map((learner) => {
    const cells = {};
    const totals = { present: 0, absent: 0, tardy: 0, excused: 0, recorded: 0, required: 0 };
    dates.forEach((date) => {
      const active = new Set(date.activePeriods);
      periods.forEach((period) => {
        const key = `${date.date}|${period.periodNo}`;
        const record = recordMap.get(`${learner.enrollment_id}|${key}`);
        if (active.has(period.periodNo) && date.dayType === "school_day") {
          totals.required += 1;
        }
        if (record) {
          cells[key] = {
            status: record.status,
            remarks: record.remarks,
            recordId: Number(record.id),
            locked: date.locked
          };
          totals[record.status] += 1;
          totals.recorded += 1;
        }
      });
    });
    return {
      enrollmentId: Number(learner.enrollment_id),
      learnerId: Number(learner.learner_id),
      lrn: learner.lrn,
      fullName: fullName(learner),
      displayName: [learner.last_name, learner.first_name, learner.middle_name, learner.extension_name]
        .filter(Boolean)
        .join(" "),
      sex: learner.sex,
      cells,
      totals
    };
  });

  const summary = roster.reduce(
    (accumulator, learner) => {
      ["present", "absent", "tardy", "excused", "recorded", "required"].forEach((key) => {
        accumulator[key] += learner.totals[key];
      });
      return accumulator;
    },
    { present: 0, absent: 0, tardy: 0, excused: 0, recorded: 0, required: 0 }
  );

  return {
    section: {
      id: Number(section.id),
      name: section.name,
      gradeLevelId: Number(section.grade_level_id),
      gradeLevelName: section.grade_level_name,
      adviserId: section.adviser_id ? Number(section.adviser_id) : null,
      adviserName: section.adviser_name,
      schoolId: Number(section.school_id),
      schoolName: section.school_name,
      schoolYearId: Number(year.id),
      schoolYearName: year.name
    },
    subject: {
      id: Number(subject.id),
      code: subject.code,
      name: subject.name
    },
    assignment: {
      id: Number(assignment.id),
      teacherId: assignment.teacher_id ? Number(assignment.teacher_id) : null,
      teacherName: assignment.teacher_name
    },
    mode,
    weekStart: bounds.start,
    weekEnd: bounds.end,
    dates,
    periods,
    learners: roster,
    summary,
    submissions: submissions.rows.map((row) => ({
      id: Number(row.id),
      date: toIsoDate(row.attendance_date),
      status: row.status,
      teacherId: row.teacher_id ? Number(row.teacher_id) : null,
      submittedAt: row.submitted_at,
      reopenedAt: row.reopened_at
    })),
    termModel: year.term_model,
    configured: periods.length > 0,
    suggestedPeriods: SUGGESTED_PERIODS,
    canEdit: canWriteAssignment,
    canValidate: canValidate(actor, section),
    canConfigure: CONFIG_ROLES.has(actor.role)
  };
}

async function saveMatrix(actor, payload, meta) {
  assertCan(actor, "attendance", "edit");
  const { section, year } = await attendanceService.ensureSectionYear(
    actor,
    payload.sectionId,
    payload.schoolYearId
  );
  const subjectId = requireIdParam(payload.subjectId, "Subject");
  const { subject, assignment } = await resolveAssignment(
    actor,
    section,
    year,
    subjectId,
    payload.assignmentId
  );
  assertWriteAssignment(actor, assignment);
  if (!Array.isArray(payload.entries) || !payload.entries.length) {
    fail("Provide at least one attendance entry.");
  }
  if (payload.entries.length > 600) {
    fail("A single save may contain at most 600 attendance entries.");
  }
  const anchor = attendanceService.requireDate(payload.date, "Attendance date");
  const bounds = weekBounds(anchor);
  const allowedDates = new Set(bounds.dates);
  const learners = await attendanceService.roster(section, year.id);
  const allowedEnrollment = new Set(learners.map((row) => String(row.enrollment_id)));
  const periods = await activePeriods(section.school_id, year.id, section);
  if (!periods.length) {
    throw new HttpError(
      409,
      "Configure the class periods for this school year before encoding subject attendance.",
      "PERIODS_NOT_CONFIGURED"
    );
  }
  const periodMap = new Map(periods.map((period) => [period.periodNo, period]));
  const dateSchedules = new Map();
  for (const date of allowedDates) {
    dateSchedules.set(date, await scheduleFor(section, assignment, periods, date));
  }
  const calendarRows = await query(
    `SELECT calendar_date, day_type, label FROM school_calendar_days
     WHERE school_id = $1 AND school_year_id = $2 AND calendar_date = ANY($3::date[])`,
    [section.school_id, year.id, [...allowedDates]]
  );
  const calendarMap = new Map(calendarRows.rows.map((row) => [toIsoDate(row.calendar_date), row]));
  const locked = await query(
    `SELECT DISTINCT attendance_date FROM adviser_attendance
     WHERE section_id = $1 AND school_year_id = $2 AND attendance_date = ANY($3::date[])`,
    [section.id, year.id, [...allowedDates]]
  );
  const lockedDates = new Set(locked.rows.map((row) => toIsoDate(row.attendance_date)));
  const overridesLock = ["system_admin", "district_admin", "school_head"].includes(actor.role);
  const submissions = await query(
    `SELECT * FROM subject_attendance_submissions
     WHERE section_id = $1 AND school_year_id = $2 AND subject_id = $3
       AND attendance_date = ANY($4::date[])`,
    [section.id, year.id, subject.id, [...allowedDates]]
  );
  const submissionMap = new Map(
    submissions.rows.map((row) => [toIsoDate(row.attendance_date), row])
  );

  const prepared = payload.entries.map((entry) => {
    const enrollmentId = requireIdParam(entry.enrollmentId, "Enrollment");
    if (!allowedEnrollment.has(String(enrollmentId))) {
      throw new HttpError(
        409,
        "A learner in this sheet is not enrolled in the selected section.",
        "ATTENDANCE_ROSTER_MISMATCH"
      );
    }
    const date = attendanceService.requireDate(entry.date, "Attendance date");
    if (!allowedDates.has(date)) {
      fail("Attendance entries must fall inside the selected week.", { field: "date" });
    }
    const calendarDay = calendarMap.get(date);
    if (calendarDay && calendarDay.day_type !== "school_day") {
      throw new HttpError(
        409,
        `${date} is marked as ${calendarDay.day_type.replace("_", " ")} and cannot take subject attendance.`,
        "ATTENDANCE_NON_CLASS_DAY"
      );
    }
    const schedule = dateSchedules.get(date);
    if (!schedule || !schedule.meets) {
      throw new HttpError(
        409,
        `No class period is scheduled for ${date}.`,
        "NO_SCHEDULED_PERIOD"
      );
    }
    if (!schedule.active.some((period) => period.periodNo === Number(entry.periodNo))) {
      fail(`Period ${entry.periodNo} is not scheduled for this subject on ${date}.`, {
        field: "periodNo"
      });
    }
    if (lockedDates.has(date) && !overridesLock && !canValidate(actor, section)) {
      throw new HttpError(
        409,
        `The adviser already validated ${date}. Ask the adviser to reopen the day before changing it.`,
        "ATTENDANCE_LOCKED"
      );
    }
    const submission = submissionMap.get(date);
    if (
      submission &&
      submission.status === "submitted" &&
      submission.teacher_id &&
      Number(submission.teacher_id) !== Number(actor.id) &&
      !overridesLock
    ) {
      throw new HttpError(
        409,
        `Another subject teacher already submitted attendance for ${date}.`,
        "SUBMISSION_CONFLICT"
      );
    }
    const periodNo = requireInteger(entry.periodNo, "Period", { min: 1, max: 12 });
    if (!periodMap.has(periodNo)) {
      fail(`Period ${periodNo} is not configured for this section.`, { field: "periodNo" });
    }
    const status = entry.status === null || entry.status === "" ? null : requireEnum(entry.status, "Attendance status", SUBJECT_STATUSES);
    return {
      enrollmentId,
      learner: learners.find((row) => String(row.enrollment_id) === String(enrollmentId)),
      date,
      periodNo,
      period: periodMap.get(periodNo),
      status,
      remarks: optionalString(entry.remarks, "Remarks", { max: 255 })
    };
  });

  const client = await getClient();
  let saved = 0;
  let cleared = 0;
  try {
    await client.query("BEGIN");
    for (const entry of prepared) {
      if (!entry.status) {
        const removed = await client.query(
          `DELETE FROM subject_attendance
           WHERE enrollment_id = $1 AND subject_id = $2 AND period_no = $3 AND attendance_date = $4`,
          [entry.enrollmentId, subject.id, entry.periodNo, entry.date]
        );
        cleared += removed.rowCount || 0;
        continue;
      }
      await client.query(
        `INSERT INTO subject_attendance
           (learner_id, enrollment_id, school_id, school_year_id, grade_level_id, section_id,
            subject_id, assignment_id, class_period_id, period_no, period_label,
            attendance_date, status, remarks, recorded_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)
         ON CONFLICT (enrollment_id, subject_id, period_no, attendance_date) DO UPDATE SET
           status = EXCLUDED.status,
           remarks = EXCLUDED.remarks,
           class_period_id = EXCLUDED.class_period_id,
           period_label = EXCLUDED.period_label,
           assignment_id = EXCLUDED.assignment_id,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
        [
          entry.learner.learner_id,
          entry.enrollmentId,
          section.school_id,
          year.id,
          section.grade_level_id,
          section.id,
          subject.id,
          assignment.id,
          entry.period.id,
          entry.periodNo,
          entry.period.label,
          entry.date,
          entry.status,
          entry.remarks,
          actor.id
        ]
      );
      saved += 1;
    }
    if (payload.submit === true) {
      const datesWithEntries = [...new Set(prepared.filter((entry) => entry.status).map((entry) => entry.date))];
      for (const date of datesWithEntries) {
        await client.query(
          `INSERT INTO subject_attendance_submissions
             (school_id, school_year_id, section_id, subject_id, assignment_id, teacher_id,
              attendance_date, status, submitted_by, submitted_at, reopened_by, reopened_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted', $8, now(), NULL, NULL)
           ON CONFLICT (section_id, subject_id, attendance_date) DO UPDATE SET
             status = 'submitted',
             teacher_id = EXCLUDED.teacher_id,
             assignment_id = EXCLUDED.assignment_id,
             submitted_by = EXCLUDED.submitted_by,
             submitted_at = now(),
             reopened_by = NULL,
             reopened_at = NULL,
             updated_at = now()`,
          [
            section.school_id,
            year.id,
            section.id,
            subject.id,
            assignment.id,
            assignment.teacher_id || actor.id,
            date,
            actor.id
          ]
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (saved || cleared || payload.submit === true) {
    await auditService.record({
      userId: actor.id,
      districtId: actor.districtId,
      ipAddress: meta && meta.ip,
      action: payload.submit === true ? "attendance.subject.submit" : "attendance.subject.save",
      entityType: "subject_attendance",
      entityId: section.id,
      details: {
        sectionId: Number(section.id),
        subjectId: Number(subject.id),
        assignmentId: Number(assignment.id),
        weekStart: bounds.start,
        saved,
        cleared,
        submitted: payload.submit === true
      }
    });
  }
  return getMatrix(actor, {
    sectionId: section.id,
    schoolYearId: year.id,
    subjectId: subject.id,
    assignmentId: assignment.id,
    date: anchor,
    mode: "week"
  });
}

async function reopenSubmission(actor, id, payload) {
  assertCan(actor, "attendance", "edit");
  const result = await query(
    `SELECT sas.*, sec.adviser_id, sec.school_id, sec.name AS section_name, sec.school_year_id
     FROM subject_attendance_submissions sas
     JOIN sections sec ON sec.id = sas.section_id
     WHERE sas.id = $1`,
    [id]
  );
  const submission = result.rows[0];
  if (!submission) {
    throw new HttpError(404, "Attendance submission not found.", "SUBMISSION_NOT_FOUND");
  }
  const section = await sectionForActor(actor, submission.section_id);
  if (!canValidate(actor, section)) {
    throw new HttpError(
      403,
      "Only the class adviser or a school administrator may reopen a submitted day.",
      "REOPEN_FORBIDDEN"
    );
  }
  await query(
    `UPDATE subject_attendance_submissions SET
       status = 'reopened',
       reopened_by = $1,
       reopened_at = now(),
       remarks = $2,
       updated_at = now()
     WHERE id = $3`,
    [actor.id, optionalString(payload && payload.remarks, "Remarks", { max: 255 }), id]
  );
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "attendance.subject.reopen",
    entityType: "subject_attendance_submission",
    entityId: id,
    details: {
      sectionId: Number(submission.section_id),
      subjectId: Number(submission.subject_id),
      date: toIsoDate(submission.attendance_date)
    }
  });
  return { reopened: true, id: Number(id) };
}

/* -------------------------------------------------------------------------- */
/* Adviser consolidation                                                      */
/* -------------------------------------------------------------------------- */

function suggestedDailyStatus(statuses) {
  if (!statuses.length) {
    return null;
  }
  if (statuses.some((status) => status === "present")) {
    return "present";
  }
  if (statuses.some((status) => status === "tardy")) {
    return "tardy";
  }
  if (statuses.some((status) => status === "excused")) {
    return "excused";
  }
  return "absent";
}

async function consolidation(actor, options) {
  assertCan(actor, "attendance", "access");
  const { section, year } = await attendanceService.ensureSectionYear(
    actor,
    options.sectionId,
    options.schoolYearId
  );
  const date = attendanceService.requireDate(options.date, "Attendance date");
  const learners = await attendanceService.roster(section, year.id);
  const assignments = await query(
    `SELECT ta.id AS assignment_id, ta.teacher_id, ta.subject_id,
            sub.code AS subject_code, sub.name AS subject_name,
            u.full_name AS teacher_name
     FROM teacher_assignments ta
     JOIN subjects sub ON sub.id = ta.subject_id
     LEFT JOIN users u ON u.id = ta.teacher_id
     WHERE ta.section_id = $1 AND ta.school_year_id = $2
     ORDER BY sub.name ASC, ta.id ASC`,
    [section.id, year.id]
  );
  const submissions = await query(
    `SELECT * FROM subject_attendance_submissions
     WHERE section_id = $1 AND school_year_id = $2 AND attendance_date = $3`,
    [section.id, year.id, date]
  );
  const records = await query(
    `SELECT sa.*, sub.name AS subject_name
     FROM subject_attendance sa
     JOIN subjects sub ON sub.id = sa.subject_id
     WHERE sa.section_id = $1 AND sa.school_year_id = $2 AND sa.attendance_date = $3`,
    [section.id, year.id, date]
  );
  const validated = await query(
    `SELECT aa.*, u.full_name AS validated_by_name
     FROM adviser_attendance aa
     LEFT JOIN users u ON u.id = aa.validated_by
     WHERE aa.section_id = $1 AND aa.school_year_id = $2 AND aa.attendance_date = $3`,
    [section.id, year.id, date]
  );
  const terms = await termsForSchool(section.school_id, year.id);
  const calendar = await query(
    `SELECT day_type, label FROM school_calendar_days
     WHERE school_id = $1 AND school_year_id = $2 AND calendar_date = $3`,
    [section.school_id, year.id, date]
  );
  const corrections = await query(
    `SELECT c.*, sa.period_no, sa.attendance_date, sa.subject_id,
            sub.name AS subject_name, l.last_name, l.first_name,
            req.full_name AS requested_by_name
     FROM subject_attendance_corrections c
     JOIN subject_attendance sa ON sa.id = c.subject_attendance_id
     JOIN subjects sub ON sub.id = sa.subject_id
     JOIN learners l ON l.id = sa.learner_id
     LEFT JOIN users req ON req.id = c.requested_by
     WHERE sa.section_id = $1 AND sa.school_year_id = $2 AND sa.attendance_date = $3
     ORDER BY c.created_at DESC`,
    [section.id, year.id, date]
  );
  const submissionMap = new Map(
    submissions.rows.map((row) => [String(row.subject_id), row])
  );
  const validatedMap = new Map(
    validated.rows.map((row) => [String(row.enrollment_id), row])
  );
  const recordsByEnrollment = new Map();
  records.rows.forEach((row) => {
    const key = String(row.enrollment_id);
    if (!recordsByEnrollment.has(key)) {
      recordsByEnrollment.set(key, []);
    }
    recordsByEnrollment.get(key).push(row);
  });

  const rosters = learners.map((learner) => {
    const learnerRecords = recordsByEnrollment.get(String(learner.enrollment_id)) || [];
    const subjects = {};
    learnerRecords.forEach((record) => {
      subjects[String(record.subject_id)] = {
        status: record.status,
        remarks: record.remarks,
        periodNo: Number(record.period_no),
        recordId: Number(record.id)
      };
    });
    const statuses = learnerRecords.map((record) => record.status);
    const absentCount = statuses.filter((status) => status === "absent").length;
    const presentCount = statuses.filter((status) => status !== "absent").length;
    const validationRow = validatedMap.get(String(learner.enrollment_id));
    return {
      enrollmentId: Number(learner.enrollment_id),
      learnerId: Number(learner.learner_id),
      lrn: learner.lrn,
      fullName: fullName(learner),
      sex: learner.sex,
      subjects,
      subjectCount: new Set(learnerRecords.map((record) => record.subject_id)).size,
      recordedPeriods: learnerRecords.length,
      absentSubjects: absentCount,
      presentSubjects: presentCount,
      conflict: absentCount > 0 && presentCount > 0,
      suggestedStatus: suggestedDailyStatus(statuses),
      validated: validationRow
        ? {
            status: validationRow.status,
            remarks: validationRow.remarks,
            source: validationRow.source,
            validatedAt: validationRow.validated_at,
            validatedBy: validationRow.validated_by_name || null
          }
        : null
    };
  });

  const subjectRows = assignments.rows.map((row) => {
    const submission = submissionMap.get(String(row.subject_id));
    const hasRecords = records.rows.some((record) => String(record.subject_id) === String(row.subject_id));
    return {
      assignmentId: Number(row.assignment_id),
      subjectId: Number(row.subject_id),
      subjectCode: row.subject_code,
      subjectName: row.subject_name,
      teacherId: row.teacher_id ? Number(row.teacher_id) : null,
      teacherName: row.teacher_name,
      submitted: Boolean(submission && submission.status === "submitted"),
      submissionStatus: submission ? submission.status : null,
      submittedAt: submission ? submission.submitted_at : null,
      submissionId: submission ? Number(submission.id) : null,
      hasRecords,
      recorded: records.rows.filter((record) => String(record.subject_id) === String(row.subject_id)).length
    };
  });

  return {
    section: {
      id: Number(section.id),
      name: section.name,
      gradeLevelId: Number(section.grade_level_id),
      gradeLevelName: section.grade_level_name,
      adviserId: section.adviser_id ? Number(section.adviser_id) : null,
      adviserName: section.adviser_name,
      schoolId: Number(section.school_id),
      schoolName: section.school_name,
      schoolYearId: Number(year.id),
      schoolYearName: year.name
    },
    date,
    dayType: calendar.rows[0] ? calendar.rows[0].day_type : isoWeekday(date) <= 5 ? "school_day" : "no_class",
    dayLabel: calendar.rows[0] ? calendar.rows[0].label : null,
    term: termForDate(terms, date),
    subjects: subjectRows,
    learners: rosters,
    validatedCount: rosters.filter((learner) => learner.validated).length,
    missingSubjects: subjectRows.filter((subject) => !subject.submitted).length,
    conflicts: rosters.filter((learner) => learner.conflict).length,
    corrections: corrections.rows.map((row) => ({
      id: Number(row.id),
      subjectAttendanceId: Number(row.subject_attendance_id),
      subjectId: Number(row.subject_id),
      subjectName: row.subject_name,
      learnerName: fullName(row),
      periodNo: Number(row.period_no),
      proposedStatus: row.proposed_status,
      reason: row.reason,
      status: row.status,
      requestedBy: row.requested_by_name,
      createdAt: row.created_at,
      reviewNotes: row.review_notes
    })),
    canValidate: canValidate(actor, section)
  };
}

async function validateDay(actor, payload, meta) {
  assertCan(actor, "attendance", "edit");
  const { section, year } = await attendanceService.ensureSectionYear(
    actor,
    payload.sectionId,
    payload.schoolYearId
  );
  if (!canValidate(actor, section)) {
    throw new HttpError(
      403,
      "Only the class adviser or a school administrator may validate the official daily attendance.",
      "VALIDATION_FORBIDDEN"
    );
  }
  const date = attendanceService.requireDate(payload.date, "Attendance date");
  const learners = await attendanceService.roster(section, year.id);
  const allowed = new Map(learners.map((row) => [String(row.enrollment_id), row]));
  const records = await query(
    `SELECT enrollment_id, subject_id, status FROM subject_attendance
     WHERE section_id = $1 AND school_year_id = $2 AND attendance_date = $3`,
    [section.id, year.id, date]
  );
  const recordsByEnrollment = new Map();
  records.rows.forEach((row) => {
    const key = String(row.enrollment_id);
    if (!recordsByEnrollment.has(key)) {
      recordsByEnrollment.set(key, []);
    }
    recordsByEnrollment.get(key).push(row);
  });
  let entries;
  if (Array.isArray(payload.learners) && payload.learners.length) {
    entries = payload.learners.map((entry) => {
      const enrollmentId = requireIdParam(entry.enrollmentId, "Enrollment");
      if (!allowed.has(String(enrollmentId))) {
        throw new HttpError(
          409,
          "A learner in this validation is not enrolled in the selected section.",
          "ATTENDANCE_ROSTER_MISMATCH"
        );
      }
      const status =
        entry.status === null || entry.status === ""
          ? null
          : requireEnum(entry.status, "Attendance status", DAILY_STATUSES);
      return {
        enrollmentId,
        status,
        remarks: optionalString(entry.remarks, "Remarks", { max: 255 }),
        manual: Boolean(entry.manual)
      };
    });
  } else {
    // Daily attendance is an adviser decision, never inferred from a subject
    // sheet. Requiring explicit statuses keeps a single subject absence from
    // becoming a whole-day absence.
    throw new HttpError(
      400,
      "Choose an official status for each learner before validating the day.",
      "VALIDATION_EXPLICIT_REQUIRED"
    );
  }

  const client = await getClient();
  let written = 0;
  let cleared = 0;
  try {
    await client.query("BEGIN");
    for (const entry of entries) {
      if (!entry.status) {
        const removed = await client.query(
          "DELETE FROM adviser_attendance WHERE enrollment_id = $1 AND attendance_date = $2",
          [entry.enrollmentId, date]
        );
        cleared += removed.rowCount || 0;
        continue;
      }
      const learnerRecords = recordsByEnrollment.get(String(entry.enrollmentId)) || [];
      const summary = {
        subjects: learnerRecords.map((record) => ({
          subjectId: Number(record.subject_id),
          status: record.status
        })),
        recordedPeriods: learnerRecords.length,
        absentPeriods: learnerRecords.filter((record) => record.status === "absent").length,
        presentPeriods: learnerRecords.filter((record) => record.status !== "absent").length,
        conflict:
          learnerRecords.some((record) => record.status === "absent") &&
          learnerRecords.some((record) => record.status !== "absent")
      };
      const learner = allowed.get(String(entry.enrollmentId));
      await client.query(
        `INSERT INTO adviser_attendance
           (learner_id, enrollment_id, school_id, school_year_id, grade_level_id, section_id,
            attendance_date, status, source, subject_summary, remarks, validated_by, validated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, now())
         ON CONFLICT (enrollment_id, attendance_date) DO UPDATE SET
           status = EXCLUDED.status,
           source = EXCLUDED.source,
           subject_summary = EXCLUDED.subject_summary,
           remarks = EXCLUDED.remarks,
           validated_by = EXCLUDED.validated_by,
           validated_at = now(),
           updated_at = now()`,
        [
          learner.learner_id,
          entry.enrollmentId,
          section.school_id,
          year.id,
          section.grade_level_id,
          section.id,
          date,
          entry.status,
          entry.manual || !learnerRecords.length ? "manual" : "subject_consolidation",
          JSON.stringify(summary),
          entry.remarks,
          actor.id
        ]
      );
      written += 1;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: "attendance.adviser.validate",
    entityType: "adviser_attendance",
    entityId: section.id,
    details: {
      sectionId: Number(section.id),
      date,
      written,
      cleared,
      subjectsSubmitted: new Set(records.rows.map((row) => row.subject_id)).size
    }
  });
  return consolidation(actor, { sectionId: section.id, schoolYearId: year.id, date });
}

// Validation locks subject entry for teachers. Reopening removes the official
// daily rows so a missing or late subject submission can still be recorded
// before the day is validated again.
async function reopenValidation(actor, options, meta) {
  assertCan(actor, "attendance", "access");
  const { section, year } = await attendanceService.ensureSectionYear(
    actor,
    options.sectionId,
    options.schoolYearId
  );
  if (!canValidate(actor, section)) {
    throw new HttpError(
      403,
      "Only the class adviser, school head, or district administrator can reopen a validated day.",
      "FORBIDDEN"
    );
  }
  const date = attendanceService.requireDate(options.date, "Attendance date");
  const removed = await query(
    `DELETE FROM adviser_attendance
     WHERE section_id = $1 AND school_year_id = $2 AND attendance_date = $3
     RETURNING enrollment_id`,
    [section.id, year.id, date]
  );
  if (!removed.rowCount) {
    throw new HttpError(409, "This day has not been validated yet.", "NOT_VALIDATED");
  }
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: "attendance.adviser.reopen_validation",
    entityType: "adviser_attendance",
    entityId: section.id,
    details: {
      sectionId: Number(section.id),
      date,
      cleared: removed.rowCount
    }
  });
  return consolidation(actor, { sectionId: section.id, schoolYearId: year.id, date });
}

/* -------------------------------------------------------------------------- */
/* Corrections                                                                */
/* -------------------------------------------------------------------------- */

async function listCorrections(actor, options) {
  assertCan(actor, "attendance", "access");
  const { section, year } = await attendanceService.ensureSectionYear(
    actor,
    options.sectionId,
    options.schoolYearId
  );
  const params = [section.id, year.id];
  let filter = "";
  if (options.status) {
    params.push(requireEnum(options.status, "Status", ["pending", "approved", "rejected"]));
    filter = ` AND c.status = $${params.length}`;
  }
  if (
    hasRole(actor, "teacher") &&
    !hasAnyRole(actor, ["adviser", "coordinator", "school_head", "nt"])
  ) {
    params.push(actor.id);
    filter += ` AND c.requested_by = $${params.length}`;
  }
  const result = await query(
    `SELECT c.*, sa.period_no, sa.attendance_date, sa.subject_id,
            sub.name AS subject_name, l.last_name, l.first_name, l.lrn,
            req.full_name AS requested_by_name, rev.full_name AS reviewed_by_name
     FROM subject_attendance_corrections c
     JOIN subject_attendance sa ON sa.id = c.subject_attendance_id
     JOIN subjects sub ON sub.id = sa.subject_id
     JOIN learners l ON l.id = sa.learner_id
     LEFT JOIN users req ON req.id = c.requested_by
     LEFT JOIN users rev ON rev.id = c.reviewed_by
     WHERE sa.section_id = $1 AND sa.school_year_id = $2 ${filter}
     ORDER BY c.created_at DESC`,
    params
  );
  return {
    sectionId: Number(section.id),
    canReview: canValidate(actor, section),
    corrections: result.rows.map((row) => ({
      id: Number(row.id),
      subjectAttendanceId: Number(row.subject_attendance_id),
      subjectName: row.subject_name,
      learnerName: fullName(row),
      lrn: row.lrn,
      periodNo: Number(row.period_no),
      date: toIsoDate(row.attendance_date),
      proposedStatus: row.proposed_status,
      reason: row.reason,
      status: row.status,
      requestedBy: row.requested_by_name,
      reviewedBy: row.reviewed_by_name,
      createdAt: row.created_at,
      reviewNotes: row.review_notes
    }))
  };
}

async function requestCorrection(actor, payload, meta) {
  assertCan(actor, "attendance", "add");
  const result = await query(
    `SELECT sa.*, sec.adviser_id, sec.school_id
     FROM subject_attendance sa
     JOIN sections sec ON sec.id = sa.section_id
     WHERE sa.id = $1`,
    [requireIdParam(payload.subjectAttendanceId, "Subject attendance record")]
  );
  const record = result.rows[0];
  if (!record) {
    throw new HttpError(404, "Attendance record not found.", "ATTENDANCE_NOT_FOUND");
  }
  const section = await sectionForActor(actor, record.section_id);
  if (
    Number(record.recorded_by) !== Number(actor.id) &&
    !canValidate(actor, section) &&
    !["system_admin", "district_admin", "school_head"].includes(actor.role)
  ) {
    throw new HttpError(
      403,
      "You can only request corrections for attendance you recorded.",
      "CORRECTION_FORBIDDEN"
    );
  }
  const locked = await query(
    "SELECT 1 FROM adviser_attendance WHERE enrollment_id = $1 AND attendance_date = $2",
    [record.enrollment_id, record.attendance_date]
  );
  if (!locked.rows.length) {
    throw new HttpError(
      409,
      "This day has not been validated yet. Edit and resubmit the attendance instead of filing a correction.",
      "CORRECTION_NOT_REQUIRED"
    );
  }
  const pending = await query(
    `SELECT 1 FROM subject_attendance_corrections
     WHERE subject_attendance_id = $1 AND status = 'pending'`,
    [record.id]
  );
  if (pending.rows.length) {
    throw new HttpError(409, "A correction request is already pending for this record.", "CORRECTION_PENDING");
  }
  const inserted = await query(
    `INSERT INTO subject_attendance_corrections
       (subject_attendance_id, requested_by, proposed_status, reason, status)
     VALUES ($1, $2, $3, $4, 'pending')
     RETURNING id`,
    [
      record.id,
      actor.id,
      requireEnum(payload.status, "Proposed status", SUBJECT_STATUSES),
      requireString(payload.reason, "Reason", { min: 5, max: 1000 })
    ]
  );
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: "attendance.correction.request",
    entityType: "subject_attendance_correction",
    entityId: inserted.rows[0].id,
    details: {
      sectionId: Number(record.section_id),
      subjectId: Number(record.subject_id),
      date: toIsoDate(record.attendance_date),
      periodNo: Number(record.period_no)
    }
  });
  return { id: Number(inserted.rows[0].id), status: "pending" };
}

async function reviewCorrection(actor, id, payload, meta) {
  assertCan(actor, "attendance", "edit");
  const result = await query(
    `SELECT c.*, sa.section_id, sa.subject_id, sa.attendance_date, sa.period_no,
            sa.enrollment_id, sec.adviser_id
     FROM subject_attendance_corrections c
     JOIN subject_attendance sa ON sa.id = c.subject_attendance_id
     JOIN sections sec ON sec.id = sa.section_id
     WHERE c.id = $1`,
    [id]
  );
  const correction = result.rows[0];
  if (!correction) {
    throw new HttpError(404, "Correction request not found.", "CORRECTION_NOT_FOUND");
  }
  const section = await sectionForActor(actor, correction.section_id);
  if (!canValidate(actor, section)) {
    throw new HttpError(
      403,
      "Only the class adviser or a school administrator may review corrections.",
      "CORRECTION_REVIEW_FORBIDDEN"
    );
  }
  if (correction.status !== "pending") {
    throw new HttpError(409, "This correction has already been reviewed.", "CORRECTION_REVIEWED");
  }
  const decision = requireEnum(payload.decision, "Decision", ["approved", "rejected"]);
  const notes = optionalString(payload.notes, "Review notes", { max: 1000 });
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE subject_attendance_corrections SET
         status = $1,
         reviewed_by = $2,
         reviewed_at = now(),
         review_notes = $3,
         updated_at = now()
       WHERE id = $4`,
      [decision, actor.id, notes, id]
    );
    if (decision === "approved") {
      await client.query(
        `UPDATE subject_attendance SET
           status = $1,
           updated_by = $2,
           updated_at = now()
         WHERE id = $3`,
        [correction.proposed_status, actor.id, correction.subject_attendance_id]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: "attendance.correction.review",
    entityType: "subject_attendance_correction",
    entityId: Number(id),
    details: {
      sectionId: Number(correction.section_id),
      subjectId: Number(correction.subject_id),
      date: toIsoDate(correction.attendance_date),
      periodNo: Number(correction.period_no),
      decision
    }
  });
  return { id: Number(id), status: decision };
}

/* -------------------------------------------------------------------------- */
/* Term summary                                                               */
/* -------------------------------------------------------------------------- */

async function dailyAttendanceRows(sectionId, schoolYearId, start, end, runner = { query }) {
  const result = await runner.query(
    `SELECT aa.enrollment_id, aa.attendance_date, aa.status
     FROM adviser_attendance aa
     WHERE aa.section_id = $1 AND aa.school_year_id = $2
       AND aa.attendance_date BETWEEN $3 AND $4
     UNION ALL
     SELECT ar.enrollment_id, ar.attendance_date, ar.status
     FROM attendance_records ar
     WHERE ar.section_id = $1 AND ar.school_year_id = $2
       AND ar.attendance_date BETWEEN $3 AND $4
       AND NOT EXISTS (
         SELECT 1 FROM adviser_attendance aa2
         WHERE aa2.enrollment_id = ar.enrollment_id
           AND aa2.attendance_date = ar.attendance_date
       )`,
    [sectionId, schoolYearId, start, end]
  );
  return result.rows;
}

async function attendanceTermsForEnrollment(
  schoolId,
  schoolYearId,
  enrollmentId,
  sectionId,
  runner = { query }
) {
  const terms = (
    await termsForSchool(schoolId, schoolYearId, runner)
  ).filter((term) => term.status === "approved");
  if (!terms.length || !sectionId) {
    return [];
  }
  const daily = await dailyAttendanceRows(
    sectionId,
    schoolYearId,
    terms[0].startsOn,
    terms[terms.length - 1].endsOn,
    runner
  );
  return terms.map((term) => {
    const totals = { present: 0, absent: 0, tardy: 0, excused: 0, half_day: 0, recorded: 0 };
    daily.forEach((record) => {
      if (Number(record.enrollment_id) !== Number(enrollmentId)) return;
      const date = toIsoDate(record.attendance_date);
      if (date < term.startsOn || date > term.endsOn) return;
      totals[record.status] += 1;
      totals.recorded += 1;
    });
    return {
      termNo: term.termNo,
      name: term.name,
      startsOn: term.startsOn,
      endsOn: term.endsOn,
      totals
    };
  });
}

async function termSummary(actor, options) {
  assertCan(actor, "attendance", "access");
  const { section, year } = await attendanceService.ensureSectionYear(
    actor,
    options.sectionId,
    options.schoolYearId
  );
  const terms = await termsForSchool(section.school_id, year.id);
  let term = null;
  if (options.termNo) {
    term = terms.find((entry) => entry.termNo === requireInteger(options.termNo, "Term", { min: 1, max: 6 })) || null;
    if (!term) {
      throw new HttpError(404, "Term not found for this school.", "TERM_NOT_FOUND");
    }
  } else if (options.date) {
    term = termForDate(terms, attendanceService.requireDate(options.date, "Attendance date"));
  }
  const start = term ? term.startsOn : toIsoDate(year.starts_on);
  const end = term ? term.endsOn : toIsoDate(year.ends_on);
  const learners = await attendanceService.roster(section, year.id);
  const records = await dailyAttendanceRows(section.id, year.id, start, end);
  const calendar = await query(
    `SELECT calendar_date, day_type, label FROM school_calendar_days
     WHERE school_id = $1 AND school_year_id = $2 AND calendar_date BETWEEN $3 AND $4`,
    [section.school_id, year.id, start, end]
  );
  const calendarMap = new Map(calendar.rows.map((row) => [toIsoDate(row.calendar_date), row.day_type]));
  const days = [];
  for (let date = start; date <= end; date = addDays(date, 1)) {
    const weekday = isoWeekday(date);
    const dayType = calendarMap.get(date) || (weekday <= 5 ? "school_day" : "no_class");
    days.push({ date, dayType, weekday });
  }
  const schoolDays = days.filter((day) => day.dayType === "school_day");
  const recordMap = new Map(
    records.map((row) => [`${row.enrollment_id}:${toIsoDate(row.attendance_date)}`, row.status])
  );
  const learnersOut = learners.map((learner) => {
    const totals = { present: 0, absent: 0, tardy: 0, excused: 0, half_day: 0, recorded: 0 };
    let missing = 0;
    schoolDays.forEach((day) => {
      const status = recordMap.get(`${learner.enrollment_id}:${day.date}`);
      if (status) {
        totals[status] += 1;
        totals.recorded += 1;
      } else {
        missing += 1;
      }
    });
    const effective = totals.present + totals.tardy + totals.half_day * 0.5;
    return {
      enrollmentId: Number(learner.enrollment_id),
      learnerId: Number(learner.learner_id),
      lrn: learner.lrn,
      fullName: fullName(learner),
      sex: learner.sex,
      totals,
      missingDays: missing,
      attendanceRate: totals.recorded ? Math.round((effective / totals.recorded) * 1000) / 10 : null
    };
  });
  const totals = learnersOut.reduce(
    (accumulator, learner) => {
      Object.keys(accumulator).forEach((key) => {
        accumulator[key] += learner.totals[key];
      });
      return accumulator;
    },
    { present: 0, absent: 0, tardy: 0, excused: 0, half_day: 0, recorded: 0 }
  );
  return {
    section: {
      id: Number(section.id),
      name: section.name,
      schoolName: section.school_name,
      schoolYearId: Number(year.id),
      schoolYearName: year.name,
      gradeLevelName: section.grade_level_name
    },
    term: term || { termNo: null, name: `${year.name} full year`, status: null, startsOn: start, endsOn: end },
    range: { start, end },
    schoolDays: schoolDays.length,
    learners: learnersOut,
    totals,
    attendanceRate: totals.recorded
      ? Math.round(((totals.present + totals.tardy + totals.half_day * 0.5) / totals.recorded) * 1000) / 10
      : null
  };
}

async function recordSummarySnapshot(actor, options) {
  const result = await query(
    `INSERT INTO attendance_summary_snapshots
       (scope, school_id, school_year_id, section_id, enrollment_id, period_key, payload, generated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
     ON CONFLICT (scope, school_id, school_year_id,
                  COALESCE(section_id, 0), COALESCE(enrollment_id, 0), period_key)
     DO UPDATE SET
       payload = EXCLUDED.payload,
       generated_by = EXCLUDED.generated_by,
       generated_at = now()
     RETURNING id`,
    [
      requireEnum(options.scope, "Snapshot scope", ["sf2_month", "sf9_term", "sf10_history"]),
      options.schoolId,
      options.schoolYearId,
      options.sectionId || null,
      options.enrollmentId || null,
      requireString(options.periodKey, "Period key", { max: 24 }),
      JSON.stringify(options.payload),
      actor ? actor.id : null
    ]
  );
  return Number(result.rows[0].id);
}

module.exports = {
  SUBJECT_STATUSES,
  DAILY_STATUSES,
  SUGGESTED_PERIODS,
  toIsoDate,
  weekBounds,
  isoWeekday,
  canValidate,
  listTerms,
  provisionTerms,
  saveTerms,
  approveTerms,
  termsForSchool,
  termForDate,
  listPeriods,
  activePeriods,
  savePeriods,
  deletePeriod,
  teacherLoads,
  sectionSubjects,
  scheduleFor,
  getMatrix,
  saveMatrix,
  reopenSubmission,
  consolidation,
  suggestedDailyStatus,
  validateDay,
  reopenValidation,
  listCorrections,
  requestCorrection,
  reviewCorrection,
  dailyAttendanceRows,
  attendanceTermsForEnrollment,
  termSummary,
  recordSummarySnapshot
};
