"use strict";

const { query } = require("../config/database");
const { HttpError } = require("./httpError");
const { can } = require("../services/permissionService");
const { assertSchoolScope, resolveSchoolId, learnerScopeSql } = require("./learnerAccess");

const DISTRICT_WIDE = new Set(["district_admin", "psds", "staff"]);
const SCHOOL_BOUND = new Set(["school_head", "teacher", "coordinator", "adviser", "nt", "learner"]);

function isSystemAdmin(actor) {
  return actor && actor.role === "system_admin";
}

function canDo(actor, moduleKey, action = "access") {
  return can(actor.permissionMatrix, moduleKey, action);
}

function assertCan(actor, moduleKey, action = "access", message) {
  if (!canDo(actor, moduleKey, action)) {
    throw new HttpError(
      403,
      message || "You do not have permission to perform this action.",
      "FORBIDDEN"
    );
  }
}

// Resolves the school a write belongs to and verifies it is inside the actor's
// scope. School-bound accounts can never write to another school even when
// they hand-craft an API request with a different schoolId.
async function resolveSchool(actor, rawSchoolId, options = {}) {
  const runner = options.client || { query };
  const requested = rawSchoolId ? Number(rawSchoolId) : null;
  let schoolId = resolveSchoolId(actor, requested);
  // PSDS accounts supervise a district rather than one school, so they must be
  // able to name the school they are working with.
  if (!schoolId && actor.role === "psds" && requested) {
    schoolId = requested;
  }
  if (!schoolId) {
    throw new HttpError(
      400,
      options.required === false
        ? "A school is required for this operation."
        : "Select a school before continuing.",
      "SCHOOL_REQUIRED"
    );
  }
  const result = await runner.query(
    `SELECT s.*, d.district_name, d.district_code
     FROM schools s JOIN districts d ON d.id = s.district_id
     WHERE s.id = $1`,
    [schoolId]
  );
  const school = result.rows[0];
  if (!school) {
    throw new HttpError(404, "School not found.", "SCHOOL_NOT_FOUND");
  }
  assertSchoolScope(actor, school.id, school.district_id);
  return school;
}

function assertSchoolRead(actor, schoolId, districtId) {
  assertSchoolScope(actor, schoolId, districtId);
}

// Adds a school-scope predicate to a query. The alias must refer to the
// `schools` table (every caller joins it), so scoping uses `s.id` and
// `s.district_id`. `requestedSchoolId` is optional; district users may narrow
// to one school, school users are pinned to their own.
function schoolScopeSql(actor, alias, params, requestedSchoolId) {
  if (isSystemAdmin(actor)) {
    if (requestedSchoolId) {
      params.push(Number(requestedSchoolId));
      return `${alias}.id = $${params.length}`;
    }
    return "";
  }
  if (DISTRICT_WIDE.has(actor.role)) {
    params.push(actor.districtId);
    let clause = `${alias}.district_id = $${params.length}`;
    if (requestedSchoolId) {
      params.push(Number(requestedSchoolId));
      clause += ` AND ${alias}.id = $${params.length}`;
    }
    return clause;
  }
  if (SCHOOL_BOUND.has(actor.role) && actor.schoolId) {
    if (requestedSchoolId && Number(requestedSchoolId) !== Number(actor.schoolId)) {
      throw new HttpError(403, "You can only access records in your own school.", "SCHOOL_FORBIDDEN");
    }
    params.push(actor.schoolId);
    return `${alias}.id = $${params.length}`;
  }
  return "FALSE";
}

// Section visibility: teachers and advisers are limited to sections they
// advise or teach. Other school roles see all sections in their school.
async function sectionForActor(actor, sectionId, options = {}) {
  const runner = options.client || { query };
  const result = await runner.query(
    `SELECT sec.*, gl.name AS grade_level_name, gl.sort_order,
            y.name AS school_year_name, y.is_current,
            s.district_id, s.school_name, s.school_code,
            adv.full_name AS adviser_name
     FROM sections sec
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     JOIN school_years y ON y.id = sec.school_year_id
     JOIN schools s ON s.id = sec.school_id
     LEFT JOIN users adv ON adv.id = sec.adviser_id
     WHERE sec.id = $1`,
    [sectionId]
  );
  const section = result.rows[0];
  if (!section) {
    throw new HttpError(404, "Section not found.", "SECTION_NOT_FOUND");
  }
  if (!isSystemAdmin(actor)) {
    assertSchoolScope(actor, section.school_id, section.district_id);
    if (actor.role === "teacher" || actor.role === "adviser") {
      const allowed =
        Number(section.adviser_id) === Number(actor.id) ||
        (
          await runner.query(
            `SELECT 1 FROM teacher_assignments
             WHERE section_id = $1 AND teacher_id = $2
             LIMIT 1`,
            [section.id, actor.id]
          )
        ).rows.length > 0;
      if (!allowed) {
        throw new HttpError(
          403,
          "You can only work with sections you advise or teach.",
          "SECTION_FORBIDDEN"
        );
      }
    }
  }
  return section;
}

async function assertLearnerVisible(actor, learnerId, options = {}) {
  const runner = options.client || { query };
  const params = [Number(learnerId)];
  const scope = learnerScopeSql(actor, "l", params);
  const result = await runner.query(
    `SELECT l.*, s.district_id, s.school_name, s.school_code
     FROM learners l JOIN schools s ON s.id = l.school_id
     WHERE l.id = $1 ${scope ? `AND ${scope}` : ""}`,
    params
  );
  if (!result.rows[0]) {
    throw new HttpError(404, "Learner not found.", "LEARNER_NOT_FOUND");
  }
  return result.rows[0];
}

async function learnerEnrollment(learnerId, schoolYearId, options = {}) {
  const runner = options.client || { query };
  const result = await runner.query(
    `SELECT e.*, gl.name AS grade_level_name, sec.name AS section_name,
            sec.adviser_id AS section_adviser_id, y.name AS school_year_name,
            s.school_name, s.school_code, s.district_id
     FROM enrollments e
     JOIN grade_levels gl ON gl.id = e.grade_level_id
     LEFT JOIN sections sec ON sec.id = e.section_id
     JOIN school_years y ON y.id = e.school_year_id
     JOIN schools s ON s.id = e.school_id
     WHERE e.learner_id = $1 AND e.school_year_id = $2`,
    [learnerId, schoolYearId]
  );
  return result.rows[0] || null;
}

async function resolveSchoolYear(schoolYearId, options = {}) {
  const runner = options.client || { query };
  if (schoolYearId) {
    const result = await runner.query("SELECT * FROM school_years WHERE id = $1", [schoolYearId]);
    if (!result.rows[0]) {
      throw new HttpError(404, "School year not found.", "SCHOOL_YEAR_NOT_FOUND");
    }
    return result.rows[0];
  }
  const result = await runner.query(
    "SELECT * FROM school_years ORDER BY is_current DESC, name DESC LIMIT 1"
  );
  if (!result.rows[0]) {
    throw new HttpError(
      400,
      "Create a school year before using school forms.",
      "SCHOOL_YEAR_REQUIRED"
    );
  }
  return result.rows[0];
}

function auditActor(actor, req) {
  return {
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: req ? req.ip : null
  };
}

module.exports = {
  DISTRICT_WIDE,
  SCHOOL_BOUND,
  isSystemAdmin,
  canDo,
  assertCan,
  resolveSchool,
  assertSchoolRead,
  schoolScopeSql,
  sectionForActor,
  assertLearnerVisible,
  learnerEnrollment,
  resolveSchoolYear,
  auditActor
};
