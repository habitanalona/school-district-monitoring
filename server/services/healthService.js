"use strict";

const { query } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const {
  requireIdParam,
  requireEnum,
  optionalString,
  optionalNumber,
  optionalPeriod,
  fail
} = require("../utils/validators");
const {
  assertCan,
  resolveSchool,
  resolveSchoolYear,
  schoolScopeSql,
  assertLearnerVisible,
  learnerEnrollment
} = require("../utils/formsAccess");
const { calculateAge } = require("../utils/age");
const auditService = require("./auditService");

const NUTRITIONAL_STATUSES = [
  "severely_wasted",
  "wasted",
  "normal",
  "overweight",
  "obese",
  "severely_stunted",
  "stunted",
  "tall",
  "not_assessed"
];

function requireDate(value, field) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`${field} must use the YYYY-MM-DD format.`, { field });
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    fail(`${field} is not a valid date.`, { field });
  }
  return value;
}

// BMI is weight (kg) / height (m)^2. Returns null when either measurement is
// missing or implausible; the system never guesses a value.
function calculateBmi(weightKg, heightCm) {
  const weight = Number(weightKg);
  const height = Number(heightCm);
  if (!Number.isFinite(weight) || !Number.isFinite(height) || weight <= 0 || height <= 0) {
    return null;
  }
  const metres = height / 100;
  const bmi = weight / (metres * metres);
  if (!Number.isFinite(bmi) || bmi <= 0 || bmi > 200) {
    return null;
  }
  return Math.round(bmi * 100) / 100;
}

function plausibilityFlags(weightKg, heightCm, bmi, age) {
  const flags = [];
  if (weightKg < 5 || weightKg > 200) {
    flags.push("Weight is outside the plausible range for a school-age learner.");
  }
  if (heightCm < 50 || heightCm > 250) {
    flags.push("Height is outside the plausible range for a school-age learner.");
  }
  if (bmi !== null && (bmi < 10 || bmi > 60)) {
    flags.push("BMI is outside the plausible range; verify the measurements.");
  }
  if (age !== null && age < 3) {
    flags.push("Learner is below the usual school-age range; verify the birth date.");
  }
  return flags;
}

async function listMeasurements(actor, filters) {
  assertCan(actor, "health", "access", "You do not have access to health and nutrition records.");
  const params = [];
  const conditions = ["1 = 1"];
  const scope = schoolScopeSql(actor, "s", params, filters.schoolId);
  if (scope) {
    conditions.push(scope);
  }
  if (filters.schoolYearId) {
    params.push(filters.schoolYearId);
    conditions.push(`h.school_year_id = $${params.length}`);
  }
  if (filters.sectionId) {
    params.push(filters.sectionId);
    conditions.push(`h.enrollment_id IN (SELECT id FROM enrollments WHERE section_id = $${params.length})`);
  }
  if (filters.learnerId) {
    params.push(filters.learnerId);
    conditions.push(`h.learner_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`h.nutritional_status = $${params.length}`);
  }
  const result = await query(
    `SELECT h.*, l.lrn, l.last_name, l.first_name, l.middle_name, l.extension_name,
            gl.name AS grade_level_name, sec.name AS section_name,
            y.name AS school_year_name, s.school_name, u.full_name AS assessed_by_name
     FROM health_measurements h
     JOIN learners l ON l.id = h.learner_id
     JOIN schools s ON s.id = h.school_id
     JOIN school_years y ON y.id = h.school_year_id
     LEFT JOIN enrollments e ON e.id = h.enrollment_id
     LEFT JOIN grade_levels gl ON gl.id = e.grade_level_id
     LEFT JOIN sections sec ON sec.id = e.section_id
     LEFT JOIN users u ON u.id = h.assessed_by
     WHERE ${conditions.join(" AND ")}
     ORDER BY h.measured_on DESC, h.id DESC`,
    params
  );
  return result.rows.map(serializeMeasurement);
}

function serializeMeasurement(row) {
  const weight = Number(row.weight_kg);
  const height = Number(row.height_cm);
  const bmi = row.bmi === null ? calculateBmi(weight, height) : Number(row.bmi);
  return {
    id: Number(row.id),
    learnerId: Number(row.learner_id),
    enrollmentId: row.enrollment_id ? Number(row.enrollment_id) : null,
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
    measuredOn: String(row.measured_on).slice(0, 10),
    ageAtMeasurement: row.age_at_measurement === null ? null : Number(row.age_at_measurement),
    sex: row.sex,
    weightKg: weight,
    heightCm: height,
    bmi,
    nutritionalStatus: row.nutritional_status,
    assessment: row.assessment,
    assessorName: row.assessor_name || row.assessed_by_name,
    remarks: row.remarks,
    flags: plausibilityFlags(weight, height, bmi, row.age_at_measurement === null ? null : Number(row.age_at_measurement))
  };
}

async function createMeasurement(actor, payload) {
  assertCan(actor, "health", "add", "You do not have permission to record health measurements.");
  const learner = await assertLearnerVisible(actor, requireIdParam(payload.learnerId, "Learner"));
  const year = await resolveSchoolYear(payload.schoolYearId);
  await resolveSchool(actor, payload.schoolId || learner.school_id);
  const enrollment = await learnerEnrollment(learner.id, year.id);
  if (!enrollment) {
    throw new HttpError(
      409,
      "The learner has no enrollment for the selected school year.",
      "ENROLLMENT_REQUIRED"
    );
  }
  const measuredOn = requireDate(payload.measuredOn, "Measurement date");
  const weightKg = optionalNumber(payload.weightKg, "Weight (kg)", { min: 1, max: 500 });
  const heightCm = optionalNumber(payload.heightCm, "Height (cm)", { min: 20, max: 300 });
  if (weightKg === null || heightCm === null) {
    fail("Valid weight and height measurements are required.", { field: "weightKg" });
  }
  const bmi = calculateBmi(weightKg, heightCm);
  const age = calculateAge(learner.birth_date, measuredOn);
  const nutritionalStatus = payload.nutritionalStatus
    ? requireEnum(payload.nutritionalStatus, "Nutritional status", NUTRITIONAL_STATUSES)
    : "not_assessed";
  const result = await query(
    `INSERT INTO health_measurements
       (learner_id, enrollment_id, school_id, school_year_id, measured_on, age_at_measurement,
        sex, weight_kg, height_cm, bmi, nutritional_status, assessment, assessor_name,
        assessed_by, remarks, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING *`,
    [
      learner.id,
      enrollment.id,
      learner.school_id,
      year.id,
      measuredOn,
      age,
      learner.sex,
      weightKg,
      heightCm,
      bmi,
      nutritionalStatus,
      optionalString(payload.assessment, "Assessment", { max: 2000 }),
      optionalString(payload.assessorName, "Assessor", { max: 160 }) || actor.fullName,
      actor.id,
      optionalString(payload.remarks, "Remarks", { max: 2000 }),
      actor.id
    ]
  );
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "health.measurement.create",
    entityType: "health_measurement",
    entityId: result.rows[0].id,
    details: {
      learnerId: Number(learner.id),
      schoolId: Number(learner.school_id),
      measuredOn,
      nutritionalStatus,
      bmi
    }
  });
  return getMeasurement(actor, result.rows[0].id);
}

async function getMeasurement(actor, id) {
  assertCan(actor, "health", "access", "You do not have access to health and nutrition records.");
  const result = await query(
    `SELECT h.*, l.lrn, l.last_name, l.first_name, l.middle_name, l.extension_name,
            gl.name AS grade_level_name, sec.name AS section_name, y.name AS school_year_name,
            s.school_name, u.full_name AS assessed_by_name
     FROM health_measurements h
     JOIN learners l ON l.id = h.learner_id
     JOIN schools s ON s.id = h.school_id
     JOIN school_years y ON y.id = h.school_year_id
     LEFT JOIN enrollments e ON e.id = h.enrollment_id
     LEFT JOIN grade_levels gl ON gl.id = e.grade_level_id
     LEFT JOIN sections sec ON sec.id = e.section_id
     LEFT JOIN users u ON u.id = h.assessed_by
     WHERE h.id = $1`,
    [id]
  );
  if (!result.rows[0]) {
    throw new HttpError(404, "Health measurement not found.", "MEASUREMENT_NOT_FOUND");
  }
  await resolveSchool(actor, result.rows[0].school_id);
  return serializeMeasurement(result.rows[0]);
}

async function updateMeasurement(actor, id, payload) {
  assertCan(actor, "health", "edit", "You do not have permission to correct health measurements.");
  const existing = await query("SELECT * FROM health_measurements WHERE id = $1", [id]);
  if (!existing.rows[0]) {
    throw new HttpError(404, "Health measurement not found.", "MEASUREMENT_NOT_FOUND");
  }
  await resolveSchool(actor, existing.rows[0].school_id);
  const weightKg =
    payload.weightKg === undefined
      ? Number(existing.rows[0].weight_kg)
      : optionalNumber(payload.weightKg, "Weight (kg)", { min: 1, max: 500 });
  const heightCm =
    payload.heightCm === undefined
      ? Number(existing.rows[0].height_cm)
      : optionalNumber(payload.heightCm, "Height (cm)", { min: 20, max: 300 });
  if (weightKg === null || heightCm === null) {
    fail("Valid weight and height measurements are required.");
  }
  const bmi = calculateBmi(weightKg, heightCm);
  const nutritionalStatus = payload.nutritionalStatus
    ? requireEnum(payload.nutritionalStatus, "Nutritional status", NUTRITIONAL_STATUSES)
    : existing.rows[0].nutritional_status;
  await query(
    `UPDATE health_measurements SET
       weight_kg = $1, height_cm = $2, bmi = $3, nutritional_status = $4,
       assessment = COALESCE($5, assessment), assessor_name = COALESCE($6, assessor_name),
       remarks = COALESCE($7, remarks), assessed_by = $8, measured_on = COALESCE($9, measured_on)
     WHERE id = $10`,
    [
      weightKg,
      heightCm,
      bmi,
      nutritionalStatus,
      optionalString(payload.assessment, "Assessment", { max: 2000 }),
      optionalString(payload.assessorName, "Assessor", { max: 160 }),
      optionalString(payload.remarks, "Remarks", { max: 2000 }),
      actor.id,
      payload.measuredOn ? requireDate(payload.measuredOn, "Measurement date") : null,
      id
    ]
  );
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "health.measurement.update",
    entityType: "health_measurement",
    entityId: id,
    details: {
      learnerId: Number(existing.rows[0].learner_id),
      bmi,
      nutritionalStatus
    }
  });
  return getMeasurement(actor, id);
}

async function learnerTrend(actor, learnerId, options) {
  assertCan(actor, "health", "access", "You do not have access to health and nutrition records.");
  const learner = await assertLearnerVisible(actor, learnerId);
  const params = [learner.id];
  let yearFilter = "";
  if (options.schoolYearId) {
    params.push(options.schoolYearId);
    yearFilter = `AND h.school_year_id = $${params.length}`;
  }
  const result = await query(
    `SELECT h.*, y.name AS school_year_name FROM health_measurements h
     JOIN school_years y ON y.id = h.school_year_id
     WHERE h.learner_id = $1 ${yearFilter}
     ORDER BY h.measured_on ASC, h.id ASC`,
    params
  );
  const measurements = result.rows.map((row) => ({
    id: Number(row.id),
    measuredOn: String(row.measured_on).slice(0, 10),
    weightKg: Number(row.weight_kg),
    heightCm: Number(row.height_cm),
    bmi: row.bmi === null ? calculateBmi(row.weight_kg, row.height_cm) : Number(row.bmi),
    nutritionalStatus: row.nutritional_status,
    schoolYearName: row.school_year_name,
    flags: plausibilityFlags(
      Number(row.weight_kg),
      Number(row.height_cm),
      row.bmi === null ? calculateBmi(row.weight_kg, row.height_cm) : Number(row.bmi),
      row.age_at_measurement === null ? null : Number(row.age_at_measurement)
    )
  }));
  return {
    learner: {
      id: Number(learner.id),
      lrn: learner.lrn,
      fullName: [learner.first_name, learner.middle_name, learner.last_name]
        .filter(Boolean)
        .join(" ")
    },
    measurements
  };
}

// Aggregate only. This deliberately returns no learner names, so it can be
// shown on a monitoring dashboard without exposing individual health data.
async function schoolSummary(actor, options) {
  assertCan(actor, "health", "access", "You do not have access to health and nutrition records.");
  const params = [];
  const conditions = ["1 = 1"];
  const scope = schoolScopeSql(actor, "s", params, options.schoolId);
  if (scope) {
    conditions.push(scope);
  }
  if (options.schoolYearId) {
    params.push(options.schoolYearId);
    conditions.push(`h.school_year_id = $${params.length}`);
  }
  const result = await query(
    `SELECT h.nutritional_status, COUNT(*)::int AS count,
            AVG(h.bmi)::numeric(6,2) AS average_bmi
     FROM health_measurements h JOIN schools s ON s.id = h.school_id
     WHERE ${conditions.join(" AND ")}
     GROUP BY h.nutritional_status`,
    params
  );
  const byStatus = {};
  let total = 0;
  let weighted = 0;
  let measured = 0;
  result.rows.forEach((row) => {
    byStatus[row.nutritional_status || "not_assessed"] = Number(row.count);
    total += Number(row.count);
    if (row.average_bmi !== null) {
      weighted += Number(row.average_bmi) * Number(row.count);
      measured += Number(row.count);
    }
  });
  return {
    total,
    byStatus,
    severelyWasted: byStatus.severely_wasted || 0,
    averageBmi: measured ? Math.round((weighted / measured) * 100) / 100 : null
  };
}

module.exports = {
  NUTRITIONAL_STATUSES,
  calculateBmi,
  plausibilityFlags,
  listMeasurements,
  createMeasurement,
  getMeasurement,
  updateMeasurement,
  learnerTrend,
  schoolSummary
};
