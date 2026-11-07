"use strict";

const { HttpError } = require("./httpError");
const { query } = require("../config/database");
const { can } = require("../services/permissionService");
const { hasRole, hasAnyRole, roleSetIncludes } = require("./roles");

const DISTRICT_WIDE_ROLES = new Set(["district_admin", "psds", "staff"]);
const SCHOOL_ROLES = new Set(["school_head", "teacher", "coordinator", "adviser", "nt", "learner"]);

// Legacy role sets are retained only for documentation and registration
// defaults. Authorization decisions now come from the permission matrix so a
// per-user override can grant or revoke a right without changing roles.
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

function hasAnyWrite(actor, moduleKeys) {
  return moduleKeys.some(
    (key) =>
      can(actor.permissionMatrix, key, "add") ||
      can(actor.permissionMatrix, key, "edit") ||
      can(actor.permissionMatrix, key, "delete")
  );
}

function isSystemAdmin(actor) {
  return hasRole(actor, "system_admin");
}

// A coordinator, school head, or non-teaching account already sees the whole
// school. When that role is combined with teacher or adviser, the wider read
// scope wins instead of the advisory-only classroom filter.
const SCHOOL_WIDE_LEARNER_ROLES = new Set(["school_head", "coordinator", "nt"]);

// A class adviser who is not also a school or district record keeper works
// inside the advisory sections assigned to them. DepEd makes the adviser
// responsible for enrolling learners in their own class, so writes are pinned
// to sections where they are the adviser, not to sections they merely teach.
function isAdviserScoped(actor) {
  return hasRole(actor, "adviser") && !hasAnyRole(actor, Array.from(MANAGE_LEARNER_ROLES));
}

async function assertAdviserLearnerAccess(actor, learnerId) {
  if (!isAdviserScoped(actor)) {
    return;
  }
  const result = await query(
    `SELECT 1
     FROM enrollments e
     JOIN sections sec ON sec.id = e.section_id
     WHERE e.learner_id = $1
       AND e.school_id = $2
       AND sec.adviser_id = $3
     LIMIT 1`,
    [learnerId, actor.schoolId, actor.id]
  );
  if (!result.rows[0]) {
    throw new HttpError(
      403,
      "Class advisers can only manage learners enrolled in the section they advise.",
      "ADVISER_SECTION_FORBIDDEN"
    );
  }
}

function assertAdviserTargetSection(actor, section) {
  if (!isAdviserScoped(actor)) {
    return;
  }
  if (!section || Number(section.adviser_id) !== Number(actor.id)) {
    throw new HttpError(
      403,
      "Class advisers can only enroll learners in the section they advise.",
      "ADVISER_SECTION_FORBIDDEN"
    );
  }
}

// Appends bound parameters and returns an SQL fragment limiting learner rows to
// what the actor may see. Teacher and adviser accounts only see learners who
// belong to a section they advise or teach.
function learnerScopeSql(actor, alias, params) {
  if (isSystemAdmin(actor)) {
    return "";
  }
  if (hasRole(actor, "learner")) {
    params.push(actor.id);
    return `${alias}.user_id = $${params.length}`;
  }
  if (roleSetIncludes(actor, DISTRICT_WIDE_ROLES)) {
    params.push(actor.districtId);
    return `${alias}.district_id = $${params.length}`;
  }
  if (!roleSetIncludes(actor, SCHOOL_ROLES)) {
    return "FALSE";
  }
  params.push(actor.schoolId);
  let clause = `${alias}.school_id = $${params.length}`;
  if (
    !hasAnyRole(actor, Array.from(SCHOOL_WIDE_LEARNER_ROLES)) &&
    hasAnyRole(actor, ["teacher", "adviser"])
  ) {
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
  if (!hasAnyWrite(actor, ["learners"])) {
    throw new HttpError(
      403,
      "You have view-only access to learner records.",
      "LEARNER_FORBIDDEN"
    );
  }
}

function assertCanManageAcademics(actor) {
  if (!hasAnyWrite(actor, ["school_years", "grade_levels", "sections", "subjects"])) {
    throw new HttpError(
      403,
      "You do not have permission to change academic setup records.",
      "ACADEMIC_FORBIDDEN"
    );
  }
}

function assertCanManageActivities(actor) {
  if (!hasAnyWrite(actor, ["activities"])) {
    throw new HttpError(
      403,
      "You do not have permission to change activity records.",
      "ACTIVITY_FORBIDDEN"
    );
  }
}

function assertCanViewReports(actor) {
  if (!can(actor.permissionMatrix, "learner_reports", "access")) {
    throw new HttpError(
      403,
      "You do not have permission to export learner reports.",
      "REPORT_FORBIDDEN"
    );
  }
}

// Returns the school an actor may write to. System and district administrators
// may pass a school in their scope; school accounts are pinned to their school.
function resolveSchoolId(actor, rawSchoolId) {
  if (hasAnyRole(actor, ["system_admin", "district_admin", "staff"])) {
    return rawSchoolId || actor.schoolId || null;
  }
  return actor.schoolId;
}

function assertSchoolScope(actor, schoolId, districtId) {
  if (isSystemAdmin(actor)) {
    return;
  }
  if (hasAnyRole(actor, ["district_admin", "staff", "psds"])) {
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
  isAdviserScoped,
  learnerScopeSql,
  assertCanManageLearners,
  assertAdviserLearnerAccess,
  assertAdviserTargetSection,
  assertCanManageAcademics,
  assertCanManageActivities,
  assertCanViewReports,
  resolveSchoolId,
  assertSchoolScope
};
