"use strict";

const { query } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const {
  requireIdParam,
  requireEnum,
  requireString,
  optionalString,
  optionalEmail,
  optionalPhone,
  requireInteger,
  parseBoolean,
  fail
} = require("../utils/validators");
const {
  assertCan,
  canDo,
  resolveSchool,
  resolveSchoolYear,
  schoolScopeSql
} = require("../utils/formsAccess");
const auditService = require("./auditService");

const EMPLOYMENT_TYPES = ["plantilla", "provisional", "contractual", "substitute", "volunteer", "other"];
const EMPLOYMENT_STATUSES = ["active", "inactive"];
const TEACHING_ROLES = ["teacher", "adviser", "coordinator", "school_head"];

function requireDate(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`${field} must use the YYYY-MM-DD format.`, { field });
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`${field} is not a valid date.`, { field });
  }
  return value;
}

function optionalDate(value, field) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requireDate(value, field);
}

function canViewConfidential(actor) {
  return (
    canDo(actor, "personnel", "edit") ||
    actor.role === "school_head" ||
    actor.role === "district_admin" ||
    actor.role === "system_admin"
  );
}

function displayName(row) {
  return [row.first_name, row.middle_name, row.last_name, row.suffix].filter(Boolean).join(" ");
}

async function listPersonnel(actor, filters) {
  assertCan(actor, "personnel", "access");
  const params = [];
  const conditions = ["p.archived_at IS NULL"];
  const scope = schoolScopeSql(actor, "s", params, filters.schoolId);
  if (scope) {
    conditions.push(scope);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(concat_ws(' ', p.first_name, p.middle_name, p.last_name) ILIKE $${params.length}
        OR p.employee_no ILIKE $${params.length} OR p.position ILIKE $${params.length})`
    );
  }
  if (filters.teaching === true || filters.teaching === false) {
    params.push(filters.teaching);
    conditions.push(`p.is_teaching = $${params.length}`);
  }
  if (filters.employmentStatus) {
    params.push(filters.employmentStatus);
    conditions.push(`p.employment_status = $${params.length}`);
  }
  const profileRows = await query(
    `SELECT p.*, s.school_name, s.school_code, u.username, u.role AS account_role,
            (SELECT COUNT(*)::int FROM teacher_assignments ta
             WHERE ta.teacher_id = p.user_id AND ta.school_id = p.school_id) AS assignment_count,
            (SELECT COUNT(*)::int FROM sections sec WHERE sec.adviser_id = p.user_id) AS adviser_count
     FROM personnel_profiles p
     JOIN schools s ON s.id = p.school_id
     LEFT JOIN users u ON u.id = p.user_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY p.last_name ASC, p.first_name ASC`,
    params
  );

  const userParams = [];
  const userConditions = [
    "u.school_id IS NOT NULL",
    "u.role IN ('teacher', 'adviser', 'coordinator', 'school_head', 'nt')",
    "NOT EXISTS (SELECT 1 FROM personnel_profiles pp WHERE pp.user_id = u.id AND pp.archived_at IS NULL)"
  ];
  const userScope = schoolScopeSql(actor, "s", userParams, filters.schoolId);
  if (userScope) {
    userConditions.push(userScope);
  }
  if (filters.search) {
    userParams.push(`%${filters.search}%`);
    userConditions.push(`(u.full_name ILIKE $${userParams.length} OR u.username ILIKE $${userParams.length})`);
  }
  const accountRows = await query(
    `SELECT u.id AS user_id, u.full_name, u.role, u.email, u.school_id, u.is_active,
            s.school_name, s.school_code, u.username
     FROM users u JOIN schools s ON s.id = u.school_id
     WHERE ${userConditions.join(" AND ")}
     ORDER BY u.full_name ASC`,
    userParams
  );

  const confidential = canViewConfidential(actor);
  const items = profileRows.rows.map((row) => serializeProfile(row, confidential)).concat(
    accountRows.rows.map((row) => ({
      id: null,
      userId: Number(row.user_id),
      schoolId: Number(row.school_id),
      schoolName: row.school_name,
      employeeNo: null,
      fullName: row.full_name,
      lastName: null,
      firstName: null,
      middleName: null,
      suffix: null,
      position: row.role === "nt" ? "Non-Teaching Personnel" : "Teaching Personnel",
      employmentType: null,
      employmentStatus: row.is_active ? "active" : "inactive",
      isTeaching: row.role !== "nt",
      specialization: null,
      qualifications: null,
      designation: null,
      contactNumber: confidential ? null : undefined,
      email: confidential ? row.email : undefined,
      dateHired: null,
      accountRole: row.role,
      username: row.username,
      assignmentCount: 0,
      adviserCount: 0,
      completeness: {
        complete: false,
        missing: ["Personnel profile", "Employee number", "Position"]
      },
      source: "account"
    }))
  );
  return {
    items,
    total: items.length,
    confidential
  };
}

function serializeProfile(row, confidential) {
  const missing = [];
  if (!row.employee_no) missing.push("Employee number");
  if (!row.position) missing.push("Position");
  if (!row.employment_type) missing.push("Employment type");
  if (!row.date_hired) missing.push("Date hired");
  const base = {
    id: Number(row.id),
    userId: row.user_id ? Number(row.user_id) : null,
    schoolId: Number(row.school_id),
    schoolName: row.school_name,
    employeeNo: row.employee_no,
    fullName: displayName(row),
    lastName: row.last_name,
    firstName: row.first_name,
    middleName: row.middle_name,
    suffix: row.suffix,
    position: row.position,
    employmentType: row.employment_type,
    employmentStatus: row.employment_status,
    isTeaching: row.is_teaching,
    specialization: row.specialization,
    designation: row.designation,
    dateHired: row.date_hired ? String(row.date_hired).slice(0, 10) : null,
    accountRole: row.account_role,
    username: row.username,
    assignmentCount: Number(row.assignment_count || 0),
    adviserCount: Number(row.adviser_count || 0),
    completeness: { complete: missing.length === 0, missing },
    source: "profile"
  };
  if (confidential) {
    base.qualifications = row.qualifications;
    base.contactNumber = row.contact_number;
    base.email = row.email;
  }
  return base;
}

function readProfile(payload) {
  return {
    employeeNo: requireString(payload.employeeNo, "Employee number", { max: 32 }),
    lastName: requireString(payload.lastName, "Last name", { max: 80 }),
    firstName: requireString(payload.firstName, "First name", { max: 80 }),
    middleName: optionalString(payload.middleName, "Middle name", { max: 80 }),
    suffix: optionalString(payload.suffix, "Suffix", { max: 16 }),
    position: requireString(payload.position, "Position", { max: 120 }),
    employmentType: requireEnum(
      payload.employmentType || "plantilla",
      "Employment type",
      EMPLOYMENT_TYPES
    ),
    employmentStatus: requireEnum(
      payload.employmentStatus || "active",
      "Employment status",
      EMPLOYMENT_STATUSES
    ),
    isTeaching: parseBoolean(payload.isTeaching, true),
    specialization: optionalString(payload.specialization, "Specialization", { max: 160 }),
    qualifications: optionalString(payload.qualifications, "Qualifications", { max: 4000 }),
    designation: optionalString(payload.designation, "Designation", { max: 160 }),
    contactNumber: optionalPhone(payload.contactNumber, "Contact number"),
    email: optionalEmail(payload.email, "Email"),
    dateHired: optionalDate(payload.dateHired, "Date hired")
  };
}

async function createProfile(actor, payload, meta) {
  assertCan(actor, "personnel", "add");
  const school = await resolveSchool(actor, payload.schoolId);
  const data = readProfile(payload);
  let userId = payload.userId ? requireIdParam(payload.userId, "User account") : null;
  if (userId) {
    const user = await query("SELECT id, school_id FROM users WHERE id = $1", [userId]);
    if (!user.rows[0]) {
      throw new HttpError(404, "User account not found.", "USER_NOT_FOUND");
    }
    if (Number(user.rows[0].school_id) !== Number(school.id)) {
      throw new HttpError(409, "That account belongs to another school.", "USER_SCHOOL_MISMATCH");
    }
    const existing = await query("SELECT id FROM personnel_profiles WHERE user_id = $1", [userId]);
    if (existing.rows[0]) {
      throw new HttpError(409, "That account already has a personnel profile.", "PROFILE_EXISTS");
    }
  }
  const duplicate = await query(
    "SELECT id FROM personnel_profiles WHERE school_id = $1 AND employee_no = $2",
    [school.id, data.employeeNo]
  );
  if (duplicate.rows[0]) {
    throw new HttpError(409, "That employee number is already in use.", "EMPLOYEE_NO_IN_USE");
  }
  const result = await query(
    `INSERT INTO personnel_profiles
       (user_id, school_id, employee_no, last_name, first_name, middle_name, suffix,
        position, employment_type, employment_status, is_teaching, specialization,
        qualifications, designation, contact_number, email, date_hired, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
     RETURNING *`,
    [
      userId,
      school.id,
      data.employeeNo,
      data.lastName,
      data.firstName,
      data.middleName,
      data.suffix,
      data.position,
      data.employmentType,
      data.employmentStatus,
      data.isTeaching,
      data.specialization,
      data.qualifications,
      data.designation,
      data.contactNumber,
      data.email,
      data.dateHired,
      actor.id
    ]
  );
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: "personnel.create",
    entityType: "personnel_profile",
    entityId: result.rows[0].id,
    details: { employeeNo: data.employeeNo, schoolId: Number(school.id), teaching: data.isTeaching }
  });
  return getProfile(actor, result.rows[0].id);
}

async function getProfile(actor, id) {
  assertCan(actor, "personnel", "access");
  const result = await query(
    `SELECT p.*, s.school_name, s.school_code, u.username, u.role AS account_role,
            (SELECT COUNT(*)::int FROM teacher_assignments ta
             WHERE ta.teacher_id = p.user_id AND ta.school_id = p.school_id) AS assignment_count,
            (SELECT COUNT(*)::int FROM sections sec WHERE sec.adviser_id = p.user_id) AS adviser_count
     FROM personnel_profiles p
     JOIN schools s ON s.id = p.school_id
     LEFT JOIN users u ON u.id = p.user_id
     WHERE p.id = $1 AND p.archived_at IS NULL`,
    [id]
  );
  if (!result.rows[0]) {
    throw new HttpError(404, "Personnel profile not found.", "PERSONNEL_NOT_FOUND");
  }
  await resolveSchool(actor, result.rows[0].school_id);
  return serializeProfile(result.rows[0], canViewConfidential(actor));
}

async function updateProfile(actor, id, payload, meta) {
  assertCan(actor, "personnel", "edit");
  const existing = await query("SELECT * FROM personnel_profiles WHERE id = $1 AND archived_at IS NULL", [id]);
  if (!existing.rows[0]) {
    throw new HttpError(404, "Personnel profile not found.", "PERSONNEL_NOT_FOUND");
  }
  const school = await resolveSchool(actor, existing.rows[0].school_id);
  const data = readProfile(payload);
  const userId =
    payload.userId === undefined
      ? existing.rows[0].user_id
      : payload.userId
        ? requireIdParam(payload.userId, "User account")
        : null;
  if (userId && Number(userId) !== Number(existing.rows[0].user_id || 0)) {
    const user = await query("SELECT id, school_id FROM users WHERE id = $1", [userId]);
    if (!user.rows[0] || Number(user.rows[0].school_id) !== Number(school.id)) {
      throw new HttpError(409, "That account belongs to another school.", "USER_SCHOOL_MISMATCH");
    }
  }
  const duplicate = await query(
    "SELECT id FROM personnel_profiles WHERE school_id = $1 AND employee_no = $2 AND id <> $3",
    [school.id, data.employeeNo, id]
  );
  if (duplicate.rows[0]) {
    throw new HttpError(409, "That employee number is already in use.", "EMPLOYEE_NO_IN_USE");
  }
  await query(
    `UPDATE personnel_profiles SET
       user_id = $1, employee_no = $2, last_name = $3, first_name = $4, middle_name = $5,
       suffix = $6, position = $7, employment_type = $8, employment_status = $9,
       is_teaching = $10, specialization = $11, qualifications = $12, designation = $13,
       contact_number = $14, email = $15, date_hired = $16
     WHERE id = $17`,
    [
      userId,
      data.employeeNo,
      data.lastName,
      data.firstName,
      data.middleName,
      data.suffix,
      data.position,
      data.employmentType,
      data.employmentStatus,
      data.isTeaching,
      data.specialization,
      data.qualifications,
      data.designation,
      data.contactNumber,
      data.email,
      data.dateHired,
      id
    ]
  );
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: "personnel.update",
    entityType: "personnel_profile",
    entityId: id,
    details: { employeeNo: data.employeeNo, schoolId: Number(school.id) }
  });
  return getProfile(actor, id);
}

async function archiveProfile(actor, id) {
  assertCan(actor, "personnel", "delete");
  const existing = await query("SELECT * FROM personnel_profiles WHERE id = $1 AND archived_at IS NULL", [id]);
  if (!existing.rows[0]) {
    throw new HttpError(404, "Personnel profile not found.", "PERSONNEL_NOT_FOUND");
  }
  await resolveSchool(actor, existing.rows[0].school_id);
  await query("UPDATE personnel_profiles SET archived_at = now() WHERE id = $1", [id]);
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "personnel.archive",
    entityType: "personnel_profile",
    entityId: id,
    details: { employeeNo: existing.rows[0].employee_no }
  });
  return { archived: true };
}

function minutesBetween(start, end) {
  const [sh, sm] = String(start).split(":").map(Number);
  const [eh, em] = String(end).split(":").map(Number);
  return eh * 60 + em - (sh * 60 + sm);
}

function timeText(value) {
  return String(value).slice(0, 5);
}

async function assignmentSummary(actor, options) {
  assertCan(actor, "personnel", "access");
  const school = await resolveSchool(actor, options.schoolId);
  const year = await resolveSchoolYear(options.schoolYearId);
  const result = await query(
    `SELECT u.id AS user_id, u.full_name, u.role, u.email,
            p.id AS profile_id, p.employee_no, p.position, p.is_teaching,
            p.employment_type, p.employment_status, p.designation, p.specialization,
            ta.id AS assignment_id, ta.employee_number,
            sec.id AS section_id, sec.name AS section_name,
            gl.name AS grade_level_name, sub.id AS subject_id, sub.name AS subject_name, sub.code,
            cs.id AS schedule_id, cs.day_of_week, cs.start_time, cs.end_time, cs.room
     FROM users u
     LEFT JOIN personnel_profiles p ON p.user_id = u.id AND p.archived_at IS NULL
     LEFT JOIN teacher_assignments ta
       ON ta.teacher_id = u.id AND ta.school_id = $1 AND ta.school_year_id = $2
     LEFT JOIN sections sec ON sec.id = ta.section_id
     LEFT JOIN grade_levels gl ON gl.id = sec.grade_level_id
     LEFT JOIN subjects sub ON sub.id = ta.subject_id
     LEFT JOIN class_schedules cs ON cs.assignment_id = ta.id
     WHERE u.school_id = $1 AND u.is_active = TRUE
       AND u.role IN ('teacher', 'adviser', 'coordinator', 'school_head', 'nt')
     ORDER BY u.full_name ASC, cs.day_of_week ASC, cs.start_time ASC`,
    [school.id, year.id]
  );
  const byUser = new Map();
  result.rows.forEach((row) => {
    const key = String(row.user_id);
    if (!byUser.has(key)) {
      byUser.set(key, {
        userId: Number(row.user_id),
        profileId: row.profile_id ? Number(row.profile_id) : null,
        fullName: row.full_name,
        role: row.role,
        employeeNo: row.employee_no || row.employee_number || null,
        position: row.position || (row.role === "nt" ? "Non-Teaching Personnel" : "Teaching Personnel"),
        isTeaching: row.profile_id ? row.is_teaching : row.role !== "nt",
        employmentType: row.employment_type,
        employmentStatus: row.employment_status || "active",
        designation: row.designation,
        specialization: row.specialization,
        email: canViewConfidential(actor) ? row.email : null,
        assignments: [],
        schedules: [],
        loadMinutes: 0,
        conflicts: []
      });
    }
    const entry = byUser.get(key);
    if (row.assignment_id) {
      const assignment = entry.assignments.find((item) => Number(item.id) === Number(row.assignment_id));
      if (!assignment) {
        entry.assignments.push({
          id: Number(row.assignment_id),
          sectionId: Number(row.section_id),
          sectionName: row.section_name,
          gradeLevelName: row.grade_level_name,
          subjectId: Number(row.subject_id),
          subjectName: row.subject_name,
          subjectCode: row.code
        });
      }
      if (row.schedule_id) {
        const minutes = minutesBetween(row.start_time, row.end_time);
        entry.loadMinutes += minutes;
        entry.schedules.push({
          id: Number(row.schedule_id),
          assignmentId: Number(row.assignment_id),
          sectionName: row.section_name,
          subjectName: row.subject_name,
          dayOfWeek: Number(row.day_of_week),
          startTime: timeText(row.start_time),
          endTime: timeText(row.end_time),
          room: row.room,
          minutes
        });
      }
    }
  });

  for (const entry of byUser.values()) {
    const byDay = new Map();
    entry.schedules.forEach((schedule) => {
      if (!byDay.has(schedule.dayOfWeek)) {
        byDay.set(schedule.dayOfWeek, []);
      }
      byDay.get(schedule.dayOfWeek).push(schedule);
    });
    byDay.forEach((schedules, day) => {
      schedules.sort((a, b) => a.startTime.localeCompare(b.startTime));
      for (let index = 1; index < schedules.length; index += 1) {
        const previous = schedules[index - 1];
        const current = schedules[index];
        if (current.startTime < previous.endTime) {
          entry.conflicts.push({
            dayOfWeek: day,
            first: previous,
            second: current,
            message: `Overlapping schedules on day ${day}: ${previous.subjectName} (${previous.startTime}-${previous.endTime}) and ${current.subjectName} (${current.startTime}-${current.endTime}).`
          });
        }
      }
    });
    entry.loadHours = Math.round((entry.loadMinutes / 60) * 100) / 100;
    entry.missing = [];
    if (!entry.profileId) entry.missing.push("Personnel profile");
    if (!entry.employeeNo) entry.missing.push("Employee number");
    if (entry.isTeaching && !entry.assignments.length) entry.missing.push("Teaching assignment");
    if (entry.assignments.length && !entry.schedules.length) entry.missing.push("Class schedule");
    entry.complete = entry.missing.length === 0;
  }

  const items = Array.from(byUser.values());
  return {
    school: {
      id: Number(school.id),
      name: school.school_name,
      code: school.school_code,
      districtName: school.district_name
    },
    schoolYear: { id: Number(year.id), name: year.name },
    items,
    counts: {
      total: items.length,
      teaching: items.filter((item) => item.isTeaching).length,
      nonTeaching: items.filter((item) => !item.isTeaching).length,
      incomplete: items.filter((item) => !item.complete).length,
      conflicts: items.reduce((sum, item) => sum + item.conflicts.length, 0)
    }
  };
}

async function summaryCounts(actor, options) {
  assertCan(actor, "personnel", "access");
  const params = [];
  const conditions = ["u.is_active = TRUE", "u.school_id IS NOT NULL"];
  const scope = schoolScopeSql(actor, "s", params, options.schoolId);
  if (scope) {
    conditions.push(scope);
  }
  const result = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE u.role = 'nt')::int AS non_teaching,
            COUNT(*) FILTER (WHERE u.role <> 'nt')::int AS teaching
     FROM users u JOIN schools s ON s.id = u.school_id
     WHERE ${conditions.join(" AND ")}
       AND u.role IN ('teacher', 'adviser', 'coordinator', 'school_head', 'nt')`,
    params
  );
  const profiles = await query(
    `SELECT COUNT(*)::int AS profiled
     FROM personnel_profiles p JOIN schools s ON s.id = p.school_id
     WHERE p.archived_at IS NULL ${scope ? `AND ${scope.replace(/\$(\d+)/g, (m, i) => `$${Number(i)}`)}` : ""}`,
    params.slice(0, scope ? params.length : 0)
  );
  const row = result.rows[0];
  return {
    total: Number(row.total),
    teaching: Number(row.teaching),
    nonTeaching: Number(row.non_teaching),
    profiled: Number(profiles.rows[0].profiled || 0),
    unprofiled: Math.max(Number(row.total) - Number(profiles.rows[0].profiled || 0), 0)
  };
}

module.exports = {
  EMPLOYMENT_TYPES,
  EMPLOYMENT_STATUSES,
  TEACHING_ROLES,
  listPersonnel,
  createProfile,
  getProfile,
  updateProfile,
  archiveProfile,
  assignmentSummary,
  summaryCounts
};
