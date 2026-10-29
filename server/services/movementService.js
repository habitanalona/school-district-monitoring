"use strict";

const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const {
  requireIdParam,
  requireEnum,
  requireString,
  optionalString,
  requireInteger,
  fail
} = require("../utils/validators");
const {
  assertCan,
  resolveSchool,
  resolveSchoolYear,
  assertLearnerVisible,
  learnerEnrollment,
  schoolScopeSql
} = require("../utils/formsAccess");
const auditService = require("./auditService");

const MOVEMENT_TYPES = [
  "transferred_in",
  "transferred_out",
  "dropped_out",
  "reinstated",
  "completed",
  "other"
];
const STATUSES = ["pending", "approved", "rejected"];

const STATUS_TO_ENROLLMENT = {
  transferred_in: "transferred_in",
  transferred_out: "transferred_out",
  dropped_out: "archived",
  reinstated: "enrolled",
  completed: "completed"
};

function requireDate(value, field) {
  const text = requireString(value, field, { min: 10, max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    fail(`${field} must use the YYYY-MM-DD format.`, { field });
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    fail(`${field} is not a valid date.`, { field });
  }
  return text;
}

async function listMovements(actor, filters) {
  assertCan(actor, "movements", "access");
  const params = [];
  const conditions = ["1 = 1"];
  const scope = schoolScopeSql(actor, "s", params, filters.schoolId);
  if (scope) {
    conditions.push(scope);
  }
  if (filters.schoolYearId) {
    params.push(filters.schoolYearId);
    conditions.push(`m.school_year_id = $${params.length}`);
  }
  if (filters.month) {
    params.push(`${filters.month}-01`);
    conditions.push(`m.effective_date >= $${params.length}::date`);
    params.push(`${filters.month}-01`);
    conditions.push(`m.effective_date < ($${params.length}::date + INTERVAL '1 month')`);
  }
  if (filters.movementType) {
    params.push(filters.movementType);
    conditions.push(`m.movement_type = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`m.status = $${params.length}`);
  }
  if (filters.learnerId) {
    params.push(filters.learnerId);
    conditions.push(`m.learner_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(l.lrn ILIKE $${params.length}
        OR concat_ws(' ', l.first_name, l.middle_name, l.last_name) ILIKE $${params.length})`
    );
  }
  const where = conditions.join(" AND ");
  const result = await query(
    `SELECT m.*, l.lrn, l.last_name, l.first_name, l.middle_name, l.extension_name,
            gl.name AS grade_level_name, sec.name AS section_name,
            y.name AS school_year_name, s.school_name,
            fs.school_name AS from_school_name, ts.school_name AS to_school_name,
            appr.full_name AS approved_by_name, creator.full_name AS created_by_name
     FROM learner_movements m
     JOIN learners l ON l.id = m.learner_id
     JOIN schools s ON s.id = m.school_id
     JOIN school_years y ON y.id = m.school_year_id
     LEFT JOIN grade_levels gl ON gl.id = m.grade_level_id
     LEFT JOIN sections sec ON sec.id = m.section_id
     LEFT JOIN schools fs ON fs.id = m.from_school_id
     LEFT JOIN schools ts ON ts.id = m.to_school_id
     LEFT JOIN users appr ON appr.id = m.approved_by
     LEFT JOIN users creator ON creator.id = m.created_by
     WHERE ${where}
     ORDER BY m.effective_date DESC, m.id DESC`,
    params
  );
  const summary = result.rows.reduce(
    (accumulator, row) => {
      if (row.status === "approved") {
        accumulator[row.movement_type] = (accumulator[row.movement_type] || 0) + 1;
      }
      accumulator.pending += row.status === "pending" ? 1 : 0;
      return accumulator;
    },
    { transferred_in: 0, transferred_out: 0, dropped_out: 0, reinstated: 0, completed: 0, other: 0, pending: 0 }
  );
  return { items: result.rows.map(serializeMovement), summary };
}

function serializeMovement(row) {
  return {
    id: Number(row.id),
    learnerId: Number(row.learner_id),
    lrn: row.lrn,
    learnerName: [row.first_name, row.middle_name, row.last_name, row.extension_name]
      .filter(Boolean)
      .join(" "),
    schoolId: Number(row.school_id),
    schoolName: row.school_name,
    schoolYearId: Number(row.school_year_id),
    schoolYearName: row.school_year_name,
    gradeLevelName: row.grade_level_name,
    sectionName: row.section_name,
    movementType: row.movement_type,
    effectiveDate: String(row.effective_date).slice(0, 10),
    fromSchoolId: row.from_school_id ? Number(row.from_school_id) : null,
    toSchoolId: row.to_school_id ? Number(row.to_school_id) : null,
    counterpartSchoolName: row.counterpart_school_name || row.from_school_name || row.to_school_name,
    reason: row.reason,
    referenceNo: row.reference_no,
    status: row.status,
    approvedBy: row.approved_by ? Number(row.approved_by) : null,
    approvedByName: row.approved_by_name,
    approvedAt: row.approved_at,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function createMovement(actor, payload) {
  assertCan(actor, "movements", "add");
  const learner = await assertLearnerVisible(actor, requireIdParam(payload.learnerId, "Learner"));
  const year = await resolveSchoolYear(payload.schoolYearId);
  const school = await resolveSchool(actor, payload.schoolId || learner.school_id);
  if (Number(school.id) !== Number(learner.school_id)) {
    throw new HttpError(409, "The learner belongs to a different school.", "LEARNER_SCHOOL_MISMATCH");
  }
  const enrollment = await learnerEnrollment(learner.id, year.id);
  if (!enrollment) {
    throw new HttpError(409, "The learner has no enrollment for that school year.", "ENROLLMENT_REQUIRED");
  }
  const movementType = requireEnum(payload.movementType, "Movement type", MOVEMENT_TYPES);
  const effectiveDate = requireDate(payload.effectiveDate, "Effective date");
  if (effectiveDate < String(year.starts_on).slice(0, 10) || effectiveDate > String(year.ends_on).slice(0, 10)) {
    fail("Effective date must fall inside the selected school year.", { field: "effectiveDate" });
  }
  const reason = optionalString(payload.reason, "Reason", { max: 2000 });
  if ((movementType === "dropped_out" || movementType === "other") && !reason) {
    fail("A reason is required for that movement type.", { field: "reason" });
  }
  const counterpart = optionalString(payload.counterpartSchoolName, "Other school", { max: 160 });
  if ((movementType === "transferred_in" || movementType === "transferred_out") && !counterpart && !payload.fromSchoolId && !payload.toSchoolId) {
    fail("Name the other school for a transfer.", { field: "counterpartSchoolName" });
  }
  const result = await query(
    `INSERT INTO learner_movements
       (learner_id, enrollment_id, school_id, school_year_id, grade_level_id, section_id,
        movement_type, effective_date, from_school_id, to_school_id, counterpart_school_name,
        reason, reference_no, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', $14)
     RETURNING *`,
    [
      learner.id,
      enrollment.id,
      learner.school_id,
      year.id,
      enrollment.grade_level_id,
      enrollment.section_id,
      movementType,
      effectiveDate,
      payload.fromSchoolId ? requireIdParam(payload.fromSchoolId, "From school") : null,
      payload.toSchoolId ? requireIdParam(payload.toSchoolId, "To school") : null,
      counterpart,
      reason,
      optionalString(payload.referenceNo, "Reference number", { max: 80 }),
      actor.id
    ]
  );
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "movements.create",
    entityType: "learner_movement",
    entityId: result.rows[0].id,
    details: { learnerId: Number(learner.id), movementType, effectiveDate }
  });
  return getMovement(actor, result.rows[0].id);
}

async function getMovement(actor, id) {
  const result = await query(
    `SELECT m.*, l.lrn, l.last_name, l.first_name, l.middle_name, l.extension_name,
            gl.name AS grade_level_name, sec.name AS section_name,
            y.name AS school_year_name, s.school_name,
            fs.school_name AS from_school_name, ts.school_name AS to_school_name,
            appr.full_name AS approved_by_name, creator.full_name AS created_by_name
     FROM learner_movements m
     JOIN learners l ON l.id = m.learner_id
     JOIN schools s ON s.id = m.school_id
     JOIN school_years y ON y.id = m.school_year_id
     LEFT JOIN grade_levels gl ON gl.id = m.grade_level_id
     LEFT JOIN sections sec ON sec.id = m.section_id
     LEFT JOIN schools fs ON fs.id = m.from_school_id
     LEFT JOIN schools ts ON ts.id = m.to_school_id
     LEFT JOIN users appr ON appr.id = m.approved_by
     LEFT JOIN users creator ON creator.id = m.created_by
     WHERE m.id = $1`,
    [id]
  );
  if (!result.rows[0]) {
    throw new HttpError(404, "Movement record not found.", "MOVEMENT_NOT_FOUND");
  }
  await resolveSchool(actor, result.rows[0].school_id);
  return serializeMovement(result.rows[0]);
}

async function decideMovement(actor, id, decision, payload) {
  assertCan(actor, "movements", "edit");
  if (!["approved", "rejected"].includes(decision)) {
    fail("Decision must be approved or rejected.");
  }
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT * FROM learner_movements WHERE id = $1 FOR UPDATE",
      [id]
    );
    const movement = result.rows[0];
    if (!movement) {
      throw new HttpError(404, "Movement record not found.", "MOVEMENT_NOT_FOUND");
    }
    await resolveSchool(actor, movement.school_id, { client });
    if (movement.status !== "pending") {
      throw new HttpError(
        409,
        "Only a pending movement can be approved or rejected.",
        "MOVEMENT_ALREADY_DECIDED"
      );
    }
    await client.query(
      `UPDATE learner_movements SET status = $1, approved_by = $2, approved_at = now(),
         reason = COALESCE($4, reason)
       WHERE id = $3`,
      [decision, actor.id, id, optionalString(payload.comments, "Comments", { max: 2000 })]
    );
    if (decision === "approved") {
      const enrollmentStatus = STATUS_TO_ENROLLMENT[movement.movement_type];
      if (enrollmentStatus) {
        await client.query(
          "UPDATE enrollments SET status = $1, updated_at = now() WHERE id = $2",
          [enrollmentStatus, movement.enrollment_id]
        );
      }
    }
    await client.query("COMMIT");
    await auditService.record({
      userId: actor.id,
      districtId: actor.districtId,
      action: `movements.${decision}`,
      entityType: "learner_movement",
      entityId: id,
      details: { movementType: movement.movement_type, learnerId: Number(movement.learner_id) }
    });
    return getMovement(actor, id);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function deleteMovement(actor, id) {
  assertCan(actor, "movements", "delete");
  const result = await query("SELECT * FROM learner_movements WHERE id = $1", [id]);
  const movement = result.rows[0];
  if (!movement) {
    throw new HttpError(404, "Movement record not found.", "MOVEMENT_NOT_FOUND");
  }
  await resolveSchool(actor, movement.school_id);
  if (movement.status === "approved") {
    throw new HttpError(
      409,
      "Approved movement records are preserved. Record a correcting movement instead.",
      "MOVEMENT_LOCKED"
    );
  }
  await query("DELETE FROM learner_movements WHERE id = $1", [id]);
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "movements.delete",
    entityType: "learner_movement",
    entityId: id,
    details: { movementType: movement.movement_type }
  });
  return { deleted: true };
}

module.exports = {
  MOVEMENT_TYPES,
  STATUSES,
  requireDate,
  listMovements,
  createMovement,
  getMovement,
  decideMovement,
  deleteMovement
};
