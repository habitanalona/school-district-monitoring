"use strict";

const { HttpError } = require("./httpError");

const DISTRICT_WIDE_ROLES = new Set(["district_admin", "psds", "staff"]);
const SCHOOL_ROLES = new Set(["school_head", "teacher", "adviser", "nt", "learner"]);

const MANAGE_LEARNER_ROLES = new Set(["system_admin", "district_admin", "school_head", "staff"]);
const MANAGE_ACADEMIC_ROLES = new Set([
  "system_admin",
  "district_admin",
  "school_head",
  "staff"
]);
const MANAGE_ACTIVITY_ROLES = new Set([
  "system_admin",
  "district_admin",
  "school_head",
  "staff",
  "teacher",
  "adviser"
]);
const REPORT_ROLES = new Set([
  "system_admin",
  "district_admin",
  "psds",
  "staff",
  "school_head",
  "teacher",
  "adviser",
  "nt"
]);

function isSystemAdmin(actor) {
  return actor.role === "system_admin";
}

// Appends bound parameters and returns an SQL fragment limiting learner rows to
// what the actor may see. Teacher and adviser accounts only see learners who
// belong to a section they advise or teach.
function learnerScopeSql(actor, alias, params) {
  if (isSystemAdmin(actor)) {
    return "";
  }
  if (actor.role === "learner") {
    params.push(actor.id);
    return `${alias}.user_id = $${params.length}`;
  }
  if (DISTRICT_WIDE_ROLES.has(actor.role)) {
    params.push(actor.districtId);
    return `${alias}.district_id = $${params.length}`;
  }
  if (!SCHOOL_ROLES.has(actor.role)) {
    return "FALSE";
  }
  params.push(actor.schoolId);
  let clause = `${alias}.school_id = $${params.length}`;
  if (actor.role === "teacher" || actor.role === "adviser") {
    params.push(actor.id);
    const ref = `$${params.length}`;
    clause +=
      ` AND EXISTS (
         SELECT 1
         FROM enrollments se
         LEFT JOIN sections ss ON ss.id = se.section_id
         LEFT JOIN teacher_assignments ta ON ta.section_id = se.section_id AND ta.school_year_id = se.school_year_id
         WHERE se.learner_id = ${alias}.id
           AND (ss.adviser_id = ${ref} OR ta.teacher_id = ${ref})
       )`;
  }
  return clause;
}

function assertCanManageLearners(actor) {
  if (!MANAGE_LEARNER_ROLES.has(actor.role)) {
    throw new HttpError(
      403,
      "Your role can view learner records but cannot change them.",
      "LEARNER_FORBIDDEN"
    );
  }
}

function assertCanManageAcademics(actor) {
  if (!MANAGE_ACADEMIC_ROLES.has(actor.role)) {
    throw new HttpError(
      403,
      "Only administrators, registrars, and school heads can change school years, sections, and schedules.",
      "ACADEMIC_FORBIDDEN"
    );
  }
}

function assertCanManageActivities(actor) {
  if (!MANAGE_ACTIVITY_ROLES.has(actor.role)) {
    throw new HttpError(
      403,
      "Your role cannot change activity records.",
      "ACTIVITY_FORBIDDEN"
    );
  }
}

function assertCanViewReports(actor) {
  if (!REPORT_ROLES.has(actor.role)) {
    throw new HttpError(403, "Your role cannot export learner reports.", "REPORT_FORBIDDEN");
  }
}

// Returns the school an actor may write to. System and district administrators
// may pass a school in their scope; school accounts are pinned to their school.
function resolveSchoolId(actor, rawSchoolId) {
  if (actor.role === "system_admin" || actor.role === "district_admin" || actor.role === "staff") {
    return rawSchoolId || actor.schoolId || null;
  }
  return actor.schoolId;
}

function assertSchoolScope(actor, schoolId, districtId) {
  if (isSystemAdmin(actor)) {
    return;
  }
  if (actor.role === "district_admin" || actor.role === "staff" || actor.role === "psds") {
    if (!actor.districtId || Number(actor.districtId) !== Number(districtId)) {
      throw new HttpError(403, "You do not have access to that school.", "SCHOOL_FORBIDDEN");
    }
    return;
  }
  if (!actor.schoolId || Number(actor.schoolId) !== Number(schoolId)) {
    throw new HttpError(403, "You can only work with records in your own school.", "SCHOOL_FORBIDDEN");
  }
}

module.exports = {
  DISTRICT_WIDE_ROLES,
  MANAGE_LEARNER_ROLES,
  MANAGE_ACADEMIC_ROLES,
  MANAGE_ACTIVITY_ROLES,
  REPORT_ROLES,
  isSystemAdmin,
  learnerScopeSql,
  assertCanManageLearners,
  assertCanManageAcademics,
  assertCanManageActivities,
  assertCanViewReports,
  resolveSchoolId,
  assertSchoolScope
};
