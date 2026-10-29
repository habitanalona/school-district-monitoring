"use strict";

const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const { serializeActivity, serializeLearnerActivity } = require("../utils/serializers");
const {
  assertCanManageActivities,
  assertSchoolScope,
  resolveSchoolId,
  learnerScopeSql
} = require("../utils/learnerAccess");
const auditService = require("./auditService");

const ACTIVITY_SELECT = `SELECT a.*, sch.school_name, sch.district_id, y.name AS school_year_name,
    adv.full_name AS adviser_name,
    (SELECT COUNT(*)::int FROM learner_activities la WHERE la.activity_id = a.id) AS participant_count
  FROM activities a
  JOIN schools sch ON sch.id = a.school_id
  JOIN districts d ON d.id = sch.district_id
  JOIN school_years y ON y.id = a.school_year_id
  LEFT JOIN users adv ON adv.id = a.adviser_id`;

function scopeFilter(actor, params, requestedSchoolId = null) {
  if (actor.role === "system_admin") {
    if (requestedSchoolId) {
      params.push(requestedSchoolId);
      return `sch.id = $${params.length}`;
    }
    return "";
  }
  if (actor.schoolId) {
    params.push(actor.schoolId);
    return `sch.id = $${params.length}`;
  }
  if (actor.districtId) {
    params.push(actor.districtId);
    return `d.id = $${params.length}`;
  }
  return "FALSE";
}

async function schoolForActor(actor, rawSchoolId) {
  const schoolId = resolveSchoolId(actor, rawSchoolId);
  if (!schoolId) {
    throw new HttpError(400, "Choose the school for this activity.", "SCHOOL_REQUIRED");
  }
  const result = await query(
    `SELECT s.id, s.school_name, s.school_code, s.district_id
     FROM schools s WHERE s.id = $1`,
    [schoolId]
  );
  if (!result.rows[0]) {
    throw new HttpError(404, "School not found.", "SCHOOL_NOT_FOUND");
  }
  assertSchoolScope(actor, result.rows[0].id, result.rows[0].district_id);
  return result.rows[0];
}

async function listActivities(actor, filters = {}) {
  const params = [];
  const conditions = [];
  const scope = scopeFilter(actor, params, filters.schoolId);
  if (scope) {
    conditions.push(scope);
  }
  if (filters.schoolYearId) {
    params.push(filters.schoolYearId);
    conditions.push(`a.school_year_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(a.name ILIKE $${params.length} OR a.category ILIKE $${params.length}
        OR a.organization ILIKE $${params.length} OR a.achievement ILIKE $${params.length})`
    );
  }
  if (filters.category) {
    params.push(filters.category);
    conditions.push(`a.category = $${params.length}`);
  }
  if (filters.level) {
    params.push(filters.level);
    conditions.push(`a.participation_level = $${params.length}`);
  }
  if (filters.learnerId) {
    params.push(filters.learnerId);
    conditions.push(
      `EXISTS (SELECT 1 FROM learner_activities la
               WHERE la.activity_id = a.id AND la.learner_id = $${params.length})`
    );
  }
  if (filters.adviserId) {
    params.push(filters.adviserId);
    conditions.push(`a.adviser_id = $${params.length}`);
  }

  const result = await query(
    `${ACTIVITY_SELECT}
     WHERE ${conditions.length ? conditions.join(" AND ") : "TRUE"}
     ORDER BY y.name DESC, a.start_date DESC NULLS LAST, a.name ASC
     LIMIT 500`,
    params
  );
  return result.rows.map(serializeActivity);
}

async function loadActivity(actor, id) {
  const params = [id];
  const scope = scopeFilter(actor, params);
  const result = await query(
    `${ACTIVITY_SELECT}
     WHERE a.id = $1 ${scope ? `AND ${scope}` : ""}`,
    params
  );
  const activity = result.rows[0];
  if (!activity) {
    throw new HttpError(404, "Activity not found.", "ACTIVITY_NOT_FOUND");
  }
  return activity;
}

async function getActivityDetail(actor, id) {
  const activity = await loadActivity(actor, id);
  const params = [id];
  const learnerScope = learnerScopeSql(actor, "l", params);
  const participants = await query(
    `SELECT la.*, a.name, a.category, a.organization, a.school_year_id,
            a.participation_level, a.start_date, a.end_date,
            a.achievement AS activity_achievement, y.name AS school_year_name,
            adv.full_name AS adviser_name,
            l.lrn, l.first_name, l.middle_name, l.last_name, l.extension_name,
            gl.name AS grade_level_name, sec.name AS section_name
     FROM learner_activities la
     JOIN activities a ON a.id = la.activity_id
     JOIN learners l ON l.id = la.learner_id
     JOIN school_years y ON y.id = a.school_year_id
     LEFT JOIN users adv ON adv.id = a.adviser_id
     LEFT JOIN enrollments e ON e.learner_id = l.id AND e.school_year_id = a.school_year_id
     LEFT JOIN grade_levels gl ON gl.id = e.grade_level_id
     LEFT JOIN sections sec ON sec.id = e.section_id
     WHERE la.activity_id = $1 ${learnerScope ? `AND ${learnerScope}` : ""}
     ORDER BY l.last_name ASC, l.first_name ASC`,
    params
  );

  return {
    activity: serializeActivity(activity),
    participants: participants.rows.map((row) => ({
      ...serializeLearnerActivity(row),
      learnerId: Number(row.learner_id),
      lrn: row.lrn,
      fullName: [row.first_name, row.middle_name, row.last_name, row.extension_name]
        .filter(Boolean)
        .join(" "),
      gradeLevel: row.grade_level_name || null,
      sectionName: row.section_name || null
    }))
  };
}

async function validateAdviser(actor, adviserId, schoolId) {
  if (!adviserId) {
    return null;
  }
  const result = await query(
    `SELECT id, full_name FROM users
     WHERE id = $1 AND school_id = $2 AND is_active AND approval_status = 'active'`,
    [adviserId, schoolId]
  );
  if (!result.rows[0]) {
    throw new HttpError(
      400,
      "The adviser or coach must be an active account in this school.",
      "ADVISER_INVALID"
    );
  }
  return result.rows[0];
}

async function validateYear(schoolYearId) {
  const result = await query(`SELECT * FROM school_years WHERE id = $1`, [schoolYearId]);
  if (!result.rows[0]) {
    throw new HttpError(404, "School year not found.", "SCHOOL_YEAR_NOT_FOUND");
  }
  return result.rows[0];
}

function validateDates(startDate, endDate) {
  if (startDate && endDate && endDate < startDate) {
    throw new HttpError(
      400,
      "The end date cannot be before the start date.",
      "VALIDATION_ERROR",
      { field: "endDate" }
    );
  }
}

async function createActivity(actor, payload) {
  assertCanManageActivities(actor);
  const school = await schoolForActor(actor, payload.schoolId);
  const year = await validateYear(payload.schoolYearId);
  const adviser = await validateAdviser(actor, payload.adviserId, school.id);
  validateDates(payload.startDate, payload.endDate);

  const result = await query(
    `INSERT INTO activities (
       school_id, school_year_id, name, category, organization, adviser_id,
       participation_level, start_date, end_date, achievement, remarks, created_by
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING *`,
    [
      school.id,
      year.id,
      payload.name,
      payload.category,
      payload.organization,
      adviser ? adviser.id : null,
      payload.participationLevel,
      payload.startDate,
      payload.endDate,
      payload.achievement,
      payload.remarks,
      actor.id
    ]
  );
  await auditService.record({
    userId: actor.id,
    action: "activity.created",
    entityType: "activity",
    entityId: result.rows[0].id,
    districtId: school.district_id,
    ipAddress: actor.ipAddress || null,
    details: {
      school_code: school.school_code,
      school_year: year.name,
      name: payload.name,
      category: payload.category,
      level: payload.participationLevel
    }
  });
  return getActivityDetail(actor, result.rows[0].id);
}

async function updateActivity(actor, id, payload) {
  assertCanManageActivities(actor);
  const existing = await loadActivity(actor, id);
  const year = await validateYear(payload.schoolYearId);
  const adviser = await validateAdviser(actor, payload.adviserId, existing.school_id);
  validateDates(payload.startDate, payload.endDate);

  await query(
    `UPDATE activities SET
       school_year_id = $1, name = $2, category = $3, organization = $4,
       adviser_id = $5, participation_level = $6, start_date = $7, end_date = $8,
       achievement = $9, remarks = $10
     WHERE id = $11`,
    [
      year.id,
      payload.name,
      payload.category,
      payload.organization,
      adviser ? adviser.id : null,
      payload.participationLevel,
      payload.startDate,
      payload.endDate,
      payload.achievement,
      payload.remarks,
      id
    ]
  );
  await auditService.record({
    userId: actor.id,
    action: "activity.updated",
    entityType: "activity",
    entityId: id,
    districtId: existing.district_id,
    ipAddress: actor.ipAddress || null,
    details: {
      name: payload.name,
      category: payload.category,
      level: payload.participationLevel
    }
  });
  return getActivityDetail(actor, id);
}

async function deleteActivity(actor, id) {
  assertCanManageActivities(actor);
  const existing = await loadActivity(actor, id);
  if (existing.participant_count > 0) {
    throw new HttpError(
      409,
      "Remove the learner participants before deleting this activity.",
      "ACTIVITY_IN_USE"
    );
  }
  await query(`DELETE FROM activities WHERE id = $1`, [id]);
  await auditService.record({
    userId: actor.id,
    action: "activity.removed",
    entityType: "activity",
    entityId: id,
    districtId: existing.district_id,
    ipAddress: actor.ipAddress || null,
    details: { name: existing.name, school_year: existing.school_year_name }
  });
  return { id: Number(id) };
}

async function addParticipant(actor, activityId, payload) {
  assertCanManageActivities(actor);
  const activity = await loadActivity(actor, activityId);
  const params = [payload.learnerId];
  const scope = learnerScopeSql(actor, "l", params);
  const learner = await query(
    `SELECT l.id, l.lrn, l.school_id, l.district_id, l.first_name, l.last_name
     FROM learners l
     WHERE l.id = $1 AND l.archived_at IS NULL ${scope ? `AND ${scope}` : ""}`,
    params
  );
  if (!learner.rows[0]) {
    throw new HttpError(404, "Learner not found.", "LEARNER_NOT_FOUND");
  }
  if (Number(learner.rows[0].school_id) !== Number(activity.school_id)) {
    throw new HttpError(
      400,
      "The learner must belong to the same school as the activity.",
      "LEARNER_SCHOOL_MISMATCH"
    );
  }

  try {
    const result = await query(
      `INSERT INTO learner_activities (activity_id, learner_id, role, achievement, remarks)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [activityId, payload.learnerId, payload.role, payload.achievement, payload.remarks]
    );
    await auditService.record({
      userId: actor.id,
      action: "activity.participant_added",
      entityType: "activity",
      entityId: activityId,
      districtId: activity.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        learner_id: String(payload.learnerId),
        lrn: learner.rows[0].lrn,
        activity: activity.name,
        role: payload.role
      }
    });
    return { id: Number(result.rows[0].id) };
  } catch (error) {
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "This learner is already recorded in that activity.",
        "ACTIVITY_PARTICIPANT_EXISTS"
      );
    }
    throw error;
  }
}

async function removeParticipant(actor, activityId, participationId) {
  assertCanManageActivities(actor);
  const activity = await loadActivity(actor, activityId);
  const result = await query(
    `DELETE FROM learner_activities
     WHERE id = $1 AND activity_id = $2
     RETURNING learner_id`,
    [participationId, activityId]
  );
  if (!result.rows[0]) {
    throw new HttpError(404, "Activity record not found.", "PARTICIPATION_NOT_FOUND");
  }
  await auditService.record({
    userId: actor.id,
    action: "activity.participant_removed",
    entityType: "activity",
    entityId: activityId,
    districtId: activity.district_id,
    ipAddress: actor.ipAddress || null,
    details: {
      learner_id: String(result.rows[0].learner_id),
      activity: activity.name
    }
  });
  return { id: Number(participationId) };
}

module.exports = {
  listActivities,
  getActivityDetail,
  createActivity,
  updateActivity,
  deleteActivity,
  addParticipant,
  removeParticipant
};
