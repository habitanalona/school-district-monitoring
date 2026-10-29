"use strict";

const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const {
  requireIdParam,
  requireEnum,
  requireString,
  optionalString,
  fail
} = require("../utils/validators");
const {
  assertCan,
  canDo,
  resolveSchool,
  sectionForActor,
  resolveSchoolYear,
  assertLearnerVisible,
  schoolScopeSql
} = require("../utils/formsAccess");
const auditService = require("./auditService");
const { calculateAge } = require("../utils/age");

const PERIODS = ["q1", "q2", "q3", "q4"];
const ALL_PERIODS = ["q1", "q2", "q3", "q4", "final"];
const DECISIONS = ["pending", "promoted", "retained", "conditional", "completed", "other"];
const WORKFLOW = ["draft", "recommended", "approved", "finalized"];

function roundGrade(value) {
  return Math.round(Number(value) * 100) / 100;
}

function readGrade(value, field) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) {
    fail(`${field} must be between 0 and 100.`, { field });
  }
  return roundGrade(number);
}

async function subjectsForSection(section, runner = { query }) {
  const result = await runner.query(
    `SELECT sub.id, sub.code, sub.name, sub.grade_level_id,
            (SELECT string_agg(DISTINCT u.full_name, ', ')
             FROM teacher_assignments ta JOIN users u ON u.id = ta.teacher_id
             WHERE ta.subject_id = sub.id AND ta.section_id = $3) AS teacher_names
     FROM subjects sub
     WHERE sub.school_id = $1
       AND (sub.grade_level_id = $2 OR sub.grade_level_id IS NULL)
     ORDER BY sub.name ASC, sub.code ASC`,
    [section.school_id, section.grade_level_id, section.id]
  );
  return result.rows;
}

async function rosterRows(section, yearId) {
  const result = await query(
    `SELECT e.id AS enrollment_id, e.learner_id, e.status AS enrollment_status,
            l.lrn, l.last_name, l.first_name, l.middle_name, l.extension_name, l.sex
     FROM enrollments e JOIN learners l ON l.id = e.learner_id
     WHERE e.section_id = $1 AND e.school_year_id = $2
       AND l.archived_at IS NULL
       AND e.status NOT IN ('transferred_out', 'archived')
     ORDER BY l.last_name ASC, l.first_name ASC, l.id ASC`,
    [section.id, yearId]
  );
  return result.rows;
}

async function policyFor(schoolId, yearId, gradeLevelId, runner = { query }) {
  const result = await runner.query(
    `SELECT * FROM grading_policies
     WHERE school_id = $1 AND school_year_id = $2
       AND (grade_level_id = $3 OR grade_level_id IS NULL)
     ORDER BY grade_level_id NULLS LAST
     LIMIT 1`,
    [schoolId, yearId, gradeLevelId]
  );
  if (result.rows[0]) {
    const row = result.rows[0];
    return {
      id: Number(row.id),
      passingGrade: Number(row.passing_grade),
      finalFormula: row.final_formula,
      quarterWeights: (row.quarter_weights || []).map(Number),
      notes: row.notes,
      gradeLevelId: row.grade_level_id ? Number(row.grade_level_id) : null,
      isDefault: false
    };
  }
  return {
    id: null,
    passingGrade: 75,
    finalFormula: "average",
    quarterWeights: [0.25, 0.25, 0.25, 0.25],
    notes: "Default policy. Configure the school's approved grading policy before finalizing grades.",
    gradeLevelId: null,
    isDefault: true
  };
}

async function gradeEntry(actor, options) {
  assertCan(actor, "grades", "access");
  const section = await sectionForActor(actor, options.sectionId);
  const year = await resolveSchoolYear(options.schoolYearId);
  if (Number(section.school_year_id) !== Number(year.id)) {
    throw new HttpError(409, "That section belongs to a different school year.", "SECTION_YEAR_MISMATCH");
  }
  const subjects = await subjectsForSection(section);
  const learners = await rosterRows(section, year.id);
  const params = [section.id, year.id];
  let subjectFilter = "";
  if (options.subjectId) {
    params.push(options.subjectId);
    subjectFilter = ` AND gr.subject_id = $${params.length}`;
  }
  const records = await query(
    `SELECT gr.* FROM grade_records gr
     JOIN enrollments e ON e.id = gr.enrollment_id
     WHERE e.section_id = $1 AND e.school_year_id = $2 ${subjectFilter}`,
    params
  );
  const policy = await policyFor(section.school_id, year.id, section.grade_level_id);
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
    subjects: subjects.map((subject) => ({
      id: Number(subject.id),
      code: subject.code,
      name: subject.name,
      teacherNames: subject.teacher_names
    })),
    learners: learners.map((learner) => ({
      enrollmentId: Number(learner.enrollment_id),
      learnerId: Number(learner.learner_id),
      lrn: learner.lrn,
      fullName: [learner.first_name, learner.middle_name, learner.last_name, learner.extension_name]
        .filter(Boolean)
        .join(" "),
      sex: learner.sex,
      enrollmentStatus: learner.enrollment_status
    })),
    records: records.rows.map((row) => ({
      id: Number(row.id),
      enrollmentId: Number(row.enrollment_id),
      subjectId: Number(row.subject_id),
      period: row.period,
      grade: Number(row.grade),
      status: row.status,
      remarks: row.remarks,
      finalizedAt: row.finalized_at
    })),
    policy,
    canEdit: canDo(actor, "grades", "edit"),
    canSubmit: canDo(actor, "grades", "add") || canDo(actor, "grades", "edit")
  };
}

async function assertSubjectForSection(section, subjectId, client) {
  const result = await (client || { query }).query(
    `SELECT * FROM subjects
     WHERE id = $1 AND school_id = $2
       AND (grade_level_id = $3 OR grade_level_id IS NULL)`,
    [subjectId, section.school_id, section.grade_level_id]
  );
  if (!result.rows[0]) {
    throw new HttpError(
      409,
      "That subject is not offered to this grade level.",
      "SUBJECT_SECTION_MISMATCH"
    );
  }
  return result.rows[0];
}

async function assertTeacherLoad(actor, section, subjectId, client) {
  if (actor.role !== "teacher") {
    return;
  }
  const result = await (client || { query }).query(
    `SELECT 1 FROM teacher_assignments
     WHERE section_id = $1 AND subject_id = $2 AND teacher_id = $3 LIMIT 1`,
    [section.id, subjectId, actor.id]
  );
  if (!result.rows[0]) {
    throw new HttpError(
      403,
      "You are not assigned to teach that subject in this section.",
      "SUBJECT_NOT_ASSIGNED"
    );
  }
}

async function saveGrades(actor, payload, meta) {
  assertCan(actor, "grades", "add");
  const section = await sectionForActor(actor, payload.sectionId);
  const year = await resolveSchoolYear(payload.schoolYearId || section.school_year_id);
  if (Number(section.school_year_id) !== Number(year.id)) {
    throw new HttpError(409, "That section belongs to a different school year.", "SECTION_YEAR_MISMATCH");
  }
  const subjectId = requireIdParam(payload.subjectId, "Subject");
  await assertSubjectForSection(section, subjectId);
  await assertTeacherLoad(actor, section, subjectId);
  const period = requireEnum(payload.period, "Grading period", PERIODS);
  if (!Array.isArray(payload.entries) || !payload.entries.length) {
    fail("Provide at least one grade entry.");
  }
  const learners = await rosterRows(section, year.id);
  const allowed = new Set(learners.map((row) => String(row.enrollment_id)));
  const prepared = payload.entries.map((entry) => {
    const enrollmentId = requireIdParam(entry.enrollmentId, "Enrollment");
    if (!allowed.has(String(enrollmentId))) {
      throw new HttpError(409, "A learner is not in this section.", "GRADE_ROSTER_MISMATCH");
    }
    return {
      enrollmentId,
      grade: readGrade(entry.grade, "Grade"),
      remarks: optionalString(entry.remarks, "Remarks", { max: 255 })
    };
  });

  const client = await getClient();
  let changed = 0;
  try {
    await client.query("BEGIN");
    for (const entry of prepared) {
      const existing = await client.query(
        `SELECT status, grade FROM grade_records
         WHERE enrollment_id = $1 AND subject_id = $2 AND period = $3 FOR UPDATE`,
        [entry.enrollmentId, subjectId, period]
      );
      if (existing.rows[0] && existing.rows[0].status === "finalized") {
        throw new HttpError(
          409,
          "Finalized grades are locked. Use the authorized correction workflow.",
          "GRADE_FINALIZED"
        );
      }
      if (entry.grade === null) {
        if (existing.rows[0]) {
          await client.query(
            `DELETE FROM grade_records WHERE enrollment_id = $1 AND subject_id = $2 AND period = $3`,
            [entry.enrollmentId, subjectId, period]
          );
          changed += 1;
        }
        continue;
      }
      await client.query(
        `INSERT INTO grade_records
           (enrollment_id, subject_id, school_year_id, period, grade, status, remarks,
            created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, $7)
         ON CONFLICT (enrollment_id, subject_id, period) DO UPDATE SET
           grade = EXCLUDED.grade,
           remarks = EXCLUDED.remarks,
           status = 'draft',
           submitted_by = NULL,
           submitted_at = NULL,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
        [entry.enrollmentId, subjectId, year.id, period, entry.grade, entry.remarks, actor.id]
      );
      if (!existing.rows[0] || Number(existing.rows[0].grade) !== entry.grade) {
        changed += 1;
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  if (changed) {
    await auditService.record({
      userId: actor.id,
      districtId: actor.districtId,
      ipAddress: meta && meta.ip,
      action: "grades.save",
      entityType: "grade_records",
      entityId: section.id,
      details: { sectionId: Number(section.id), subjectId, period, changed }
    });
  }
  return gradeEntry(actor, { sectionId: section.id, schoolYearId: year.id, subjectId });
}

async function submitGrades(actor, payload, meta) {
  assertCan(actor, "grades", "add");
  const section = await sectionForActor(actor, payload.sectionId);
  const subjectId = requireIdParam(payload.subjectId, "Subject");
  const period = requireEnum(payload.period, "Grading period", PERIODS);
  await assertSubjectForSection(section, subjectId);
  await assertTeacherLoad(actor, section, subjectId);
  const result = await query(
    `UPDATE grade_records gr SET
       status = 'submitted', submitted_by = $4, submitted_at = now(), updated_by = $4
     FROM enrollments e
     WHERE e.id = gr.enrollment_id
       AND e.section_id = $1 AND e.school_year_id = $2
       AND gr.subject_id = $3 AND gr.period = $5
       AND gr.status = 'draft'
     RETURNING gr.id`,
    [section.id, section.school_year_id, subjectId, actor.id, period]
  );
  const learners = await rosterRows(section, section.school_year_id);
  const entered = await query(
    `SELECT COUNT(*)::int AS total FROM grade_records gr
     JOIN enrollments e ON e.id = gr.enrollment_id
     WHERE e.section_id = $1 AND e.school_year_id = $2
       AND gr.subject_id = $3 AND gr.period = $4
       AND gr.status IN ('submitted', 'finalized')`,
    [section.id, section.school_year_id, subjectId, period]
  );
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: "grades.submit",
    entityType: "grade_records",
    entityId: section.id,
    details: {
      sectionId: Number(section.id),
      subjectId,
      period,
      submitted: result.rowCount,
      entered: entered.rows[0].total,
      roster: learners.length
    }
  });
  return {
    submitted: result.rowCount,
    entered: entered.rows[0].total,
    roster: learners.length,
    missing: Math.max(learners.length - Number(entered.rows[0].total), 0)
  };
}

async function computeFinal(section, subjectId, yearId, policy, client) {
  const learners = await (client || { query }).query(
    `SELECT id AS enrollment_id FROM enrollments
     WHERE section_id = $1 AND school_year_id = $2 AND status NOT IN ('transferred_out', 'archived')`,
    [section.id, yearId]
  );
  let computed = 0;
  const missing = [];
  for (const learner of learners.rows) {
    const rows = await (client || { query }).query(
      `SELECT period, grade, status FROM grade_records
       WHERE enrollment_id = $1 AND subject_id = $2 AND period IN ('q1','q2','q3','q4')`,
      [learner.enrollment_id, subjectId]
    );
    const byPeriod = new Map(rows.rows.map((row) => [row.period, row]));
    const complete = PERIODS.every(
      (period) => byPeriod.get(period) && byPeriod.get(period).status === "finalized"
    );
    if (!complete) {
      missing.push(Number(learner.enrollment_id));
      continue;
    }
    let final;
    if (policy.finalFormula === "weighted") {
      final = PERIODS.reduce((sum, period, index) => {
        return sum + Number(byPeriod.get(period).grade) * Number(policy.quarterWeights[index] || 0.25);
      }, 0);
    } else {
      final = PERIODS.reduce((sum, period) => sum + Number(byPeriod.get(period).grade), 0) / PERIODS.length;
    }
    await (client || { query }).query(
      `INSERT INTO grade_records
         (enrollment_id, subject_id, school_year_id, period, grade, status, finalized_by, finalized_at)
       VALUES ($1, $2, $3, 'final', $4, 'finalized', NULL, now())
       ON CONFLICT (enrollment_id, subject_id, period) DO UPDATE SET
         grade = EXCLUDED.grade, status = 'finalized', finalized_at = now(), updated_at = now()
       WHERE grade_records.status <> 'finalized'`,
      [learner.enrollment_id, subjectId, yearId, roundGrade(final)]
    );
    computed += 1;
  }
  return { computed, missing };
}

async function finalizeGrades(actor, payload, meta) {
  assertCan(actor, "grades", "edit");
  const section = await sectionForActor(actor, payload.sectionId);
  const subjectId = requireIdParam(payload.subjectId, "Subject");
  const period = requireEnum(payload.period, "Grading period", PERIODS);
  await assertSubjectForSection(section, subjectId);
  const policy = await policyFor(section.school_id, section.school_year_id, section.grade_level_id);
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE grade_records gr SET
         status = 'finalized', finalized_by = $4, finalized_at = now(), updated_by = $4
       FROM enrollments e
       WHERE e.id = gr.enrollment_id
         AND e.section_id = $1 AND e.school_year_id = $2
         AND gr.subject_id = $3 AND gr.period = $5
         AND gr.status = 'submitted'
       RETURNING gr.id`,
      [section.id, section.school_year_id, subjectId, actor.id, period]
    );
    const final = await computeFinal(section, subjectId, section.school_year_id, policy, client);
    await client.query("COMMIT");
    await auditService.record({
      userId: actor.id,
      districtId: actor.districtId,
      ipAddress: meta && meta.ip,
      action: "grades.finalize",
      entityType: "grade_records",
      entityId: section.id,
      details: {
        sectionId: Number(section.id),
        subjectId,
        period,
        finalized: result.rowCount,
        finalsComputed: final.computed
      }
    });
    return {
      finalized: result.rowCount,
      finalsComputed: final.computed,
      missingFinals: final.missing.length,
      policy
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function correctGrade(actor, payload, meta) {
  assertCan(actor, "grades", "edit");
  const reason = requireString(payload.reason, "Correction reason", { min: 5, max: 500 });
  const section = await sectionForActor(actor, payload.sectionId);
  if (actor.role !== "system_admin" && actor.role !== "district_admin" && actor.role !== "school_head") {
    throw new HttpError(
      403,
      "Only the school head or an administrator may correct a finalized grade.",
      "GRADE_CORRECTION_FORBIDDEN"
    );
  }
  const subjectId = requireIdParam(payload.subjectId, "Subject");
  const period = requireEnum(payload.period, "Grading period", PERIODS);
  const enrollmentId = requireIdParam(payload.enrollmentId, "Enrollment");
  const grade = readGrade(payload.grade, "Grade");
  if (grade === null) {
    fail("A corrected grade is required.");
  }
  const existing = await query(
    `SELECT gr.* FROM grade_records gr
     JOIN enrollments e ON e.id = gr.enrollment_id
     WHERE gr.enrollment_id = $1 AND gr.subject_id = $2 AND gr.period = $3
       AND e.section_id = $4`,
    [enrollmentId, subjectId, period, section.id]
  );
  if (!existing.rows[0] || existing.rows[0].status !== "finalized") {
    throw new HttpError(409, "Only a finalized grade can be corrected here.", "GRADE_NOT_FINALIZED");
  }
  await query(
    `UPDATE grade_records SET grade = $1, remarks = $2, updated_by = $3, finalized_by = $3,
       finalized_at = now()
     WHERE id = $4`,
    [grade, optionalString(payload.remarks, "Remarks", { max: 255 }), actor.id, existing.rows[0].id]
  );
  const recompute = await query(
    `SELECT gr.period, gr.grade, gr.status FROM grade_records gr
     WHERE gr.enrollment_id = $1 AND gr.subject_id = $2 AND gr.period IN ('q1','q2','q3','q4')`,
    [enrollmentId, subjectId]
  );
  const byPeriod = new Map(recompute.rows.map((row) => [row.period, row]));
  const policy = await policyFor(section.school_id, section.school_year_id, section.grade_level_id);
  if (PERIODS.every((p) => byPeriod.get(p) && byPeriod.get(p).status === "finalized")) {
    const finalGrade =
      policy.finalFormula === "weighted"
        ? PERIODS.reduce(
            (sum, p, index) => sum + Number(byPeriod.get(p).grade) * Number(policy.quarterWeights[index] || 0.25),
            0
          )
        : PERIODS.reduce((sum, p) => sum + Number(byPeriod.get(p).grade), 0) / PERIODS.length;
    await query(
      `INSERT INTO grade_records
         (enrollment_id, subject_id, school_year_id, period, grade, status, finalized_by, finalized_at)
       VALUES ($1, $2, $3, 'final', $4, 'finalized', $5, now())
       ON CONFLICT (enrollment_id, subject_id, period) DO UPDATE SET
         grade = EXCLUDED.grade, status = 'finalized', finalized_by = EXCLUDED.finalized_by,
         finalized_at = now(), updated_at = now()`,
      [
        enrollmentId,
        subjectId,
        section.school_year_id,
        roundGrade(finalGrade),
        actor.id
      ]
    );
  }
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: "grades.correction",
    entityType: "grade_record",
    entityId: existing.rows[0].id,
    details: {
      learnerEnrollmentId: enrollmentId,
      subjectId,
      period,
      from: Number(existing.rows[0].grade),
      to: grade,
      reason
    }
  });
  return { corrected: true };
}

async function getPolicy(actor, options) {
  assertCan(actor, "grades", "access");
  const school = await resolveSchool(actor, options.schoolId);
  const year = await resolveSchoolYear(options.schoolYearId);
  const policy = await policyFor(
    school.id,
    year.id,
    options.gradeLevelId ? Number(options.gradeLevelId) : null
  );
  return {
    schoolId: Number(school.id),
    schoolName: school.school_name,
    schoolYearId: Number(year.id),
    schoolYearName: year.name,
    ...policy
  };
}

async function savePolicy(actor, payload, meta) {
  assertCan(actor, "grades", "edit");
  const school = await resolveSchool(actor, payload.schoolId);
  const year = await resolveSchoolYear(payload.schoolYearId);
  const gradeLevelId = payload.gradeLevelId ? requireIdParam(payload.gradeLevelId, "Grade level") : null;
  const passingGrade = readGrade(payload.passingGrade, "Passing grade");
  if (passingGrade === null) {
    fail("Passing grade is required.");
  }
  const finalFormula = requireEnum(payload.finalFormula || "average", "Final formula", ["average", "weighted"]);
  let weights = [0.25, 0.25, 0.25, 0.25];
  if (finalFormula === "weighted") {
    if (!Array.isArray(payload.quarterWeights) || payload.quarterWeights.length !== 4) {
      fail("Provide four quarter weights for a weighted final grade.");
    }
    weights = payload.quarterWeights.map((value) => {
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || number > 1) {
        fail("Quarter weights must be between 0 and 1.");
      }
      return Math.round(number * 1000) / 1000;
    });
    const total = weights.reduce((sum, value) => sum + value, 0);
    if (Math.abs(total - 1) > 0.001) {
      fail("Quarter weights must add up to 1.");
    }
  }
  const existing = await query(
    `SELECT id FROM grading_policies
     WHERE school_id = $1 AND school_year_id = $2
       AND (grade_level_id = $3 OR ($3::bigint IS NULL AND grade_level_id IS NULL))`,
    [school.id, year.id, gradeLevelId]
  );
  let id;
  if (existing.rows[0]) {
    id = existing.rows[0].id;
    await query(
      `UPDATE grading_policies SET passing_grade = $1, final_formula = $2,
         quarter_weights = $3, notes = $4, updated_at = now()
       WHERE id = $5`,
      [
        passingGrade,
        finalFormula,
        weights,
        optionalString(payload.notes, "Notes", { max: 2000 }),
        id
      ]
    );
  } else {
    const inserted = await query(
      `INSERT INTO grading_policies
         (school_id, school_year_id, grade_level_id, passing_grade, final_formula,
          quarter_weights, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        school.id,
        year.id,
        gradeLevelId,
        passingGrade,
        finalFormula,
        weights,
        optionalString(payload.notes, "Notes", { max: 2000 }),
        actor.id
      ]
    );
    id = inserted.rows[0].id;
  }
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: "grades.policy",
    entityType: "grading_policy",
    entityId: id,
    details: { schoolId: Number(school.id), passingGrade, finalFormula, weights }
  });
  return getPolicy(actor, {
    schoolId: school.id,
    schoolYearId: year.id,
    gradeLevelId: gradeLevelId || undefined
  });
}

async function promotionRows(actor, options) {
  assertCan(actor, "grades", "access");
  const section = await sectionForActor(actor, options.sectionId);
  const year = await resolveSchoolYear(options.schoolYearId || section.school_year_id);
  const subjects = await subjectsForSection(section);
  const learners = await rosterRows(section, year.id);
  const decisions = await query(
    "SELECT * FROM promotion_decisions WHERE school_year_id = $1 AND section_id = $2",
    [year.id, section.id]
  );
  const decisionMap = new Map(decisions.rows.map((row) => [String(row.enrollment_id), row]));
  const finals = await query(
    `SELECT gr.enrollment_id, gr.subject_id, gr.grade, gr.status, sub.name AS subject_name
     FROM grade_records gr
     JOIN enrollments e ON e.id = gr.enrollment_id
     JOIN subjects sub ON sub.id = gr.subject_id
     WHERE e.section_id = $1 AND e.school_year_id = $2 AND gr.period = 'final'`,
    [section.id, year.id]
  );
  const finalsByEnrollment = new Map();
  finals.rows.forEach((row) => {
    const key = String(row.enrollment_id);
    if (!finalsByEnrollment.has(key)) {
      finalsByEnrollment.set(key, []);
    }
    finalsByEnrollment.get(key).push(row);
  });
  return learners.map((learner) => {
    const grades = finalsByEnrollment.get(String(learner.enrollment_id)) || [];
    const finalized = grades.filter((row) => row.status === "finalized");
    const bySubject = new Map(finalized.map((row) => [String(row.subject_id), row]));
    const missingSubjects = subjects
      .filter((subject) => !bySubject.has(String(subject.id)))
      .map((subject) => subject.name);
    const average = finalized.length
      ? roundGrade(
          finalized.reduce((sum, row) => sum + Number(row.grade), 0) / finalized.length
        )
      : null;
    const decision = decisionMap.get(String(learner.enrollment_id));
    return {
      enrollmentId: Number(learner.enrollment_id),
      learnerId: Number(learner.learner_id),
      lrn: learner.lrn,
      fullName: [learner.first_name, learner.middle_name, learner.last_name, learner.extension_name]
        .filter(Boolean)
        .join(" "),
      generalAverage: average,
      subjectCount: finalized.length,
      expectedSubjects: subjects.length,
      missingSubjects,
      finalGrades: finalized.map((row) => ({
        subjectId: Number(row.subject_id),
        subjectName: row.subject_name,
        grade: Number(row.grade)
      })),
      decision: decision
        ? {
            id: Number(decision.id),
            decision: decision.decision,
            workflowStatus: decision.workflow_status,
            adviserRemarks: decision.adviser_remarks,
            headRemarks: decision.head_remarks,
            approvedAt: decision.approved_at,
            finalizedAt: decision.finalized_at
          }
        : null
    };
  });
}

async function computePromotion(actor, options, meta) {
  assertCan(actor, "grades", "edit");
  const section = await sectionForActor(actor, options.sectionId);
  const year = await resolveSchoolYear(options.schoolYearId || section.school_year_id);
  const rows = await promotionRows(actor, { sectionId: section.id, schoolYearId: year.id });
  const policy = await policyFor(section.school_id, year.id, section.grade_level_id);
  let recommended = 0;
  for (const row of rows) {
    if (row.missingSubjects.length) {
      continue;
    }
    const failing = row.finalGrades.filter((grade) => grade.grade < policy.passingGrade).length;
    const decision = failing === 0 ? "promoted" : "retained";
    const existing = await query(
      "SELECT workflow_status FROM promotion_decisions WHERE enrollment_id = $1",
      [row.enrollmentId]
    );
    if (existing.rows[0] && ["approved", "finalized"].includes(existing.rows[0].workflow_status)) {
      continue;
    }
    await query(
      `INSERT INTO promotion_decisions
         (enrollment_id, learner_id, school_id, school_year_id, grade_level_id, section_id,
          general_average, decision, workflow_status, recommended_by, recommended_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'recommended', $9, now(), $9)
       ON CONFLICT (enrollment_id) DO UPDATE SET
         general_average = EXCLUDED.general_average,
         decision = EXCLUDED.decision,
         workflow_status = 'recommended',
         recommended_by = EXCLUDED.recommended_by,
         recommended_at = now(),
         updated_at = now()`,
      [
        row.enrollmentId,
        row.learnerId,
        section.school_id,
        year.id,
        section.grade_level_id,
        section.id,
        row.generalAverage,
        decision,
        actor.id
      ]
    );
    recommended += 1;
  }
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: "promotion.recommend",
    entityType: "promotion_decisions",
    entityId: section.id,
    details: { sectionId: Number(section.id), recommended, policy: policy.passingGrade }
  });
  return {
    policy,
    recommended,
    rows: await promotionRows(actor, { sectionId: section.id, schoolYearId: year.id })
  };
}

async function savePromotionDecision(actor, id, payload, meta) {
  assertCan(actor, "grades", "edit");
  const existing = await query(
    `SELECT pd.*, sec.school_id AS section_school_id FROM promotion_decisions pd
     LEFT JOIN sections sec ON sec.id = pd.section_id WHERE pd.id = $1`,
    [id]
  );
  const decision = existing.rows[0];
  if (!decision) {
    throw new HttpError(404, "Promotion decision not found.", "PROMOTION_NOT_FOUND");
  }
  await resolveSchool(actor, decision.school_id);
  if (decision.workflow_status === "finalized") {
    throw new HttpError(409, "This promotion decision is finalized and locked.", "PROMOTION_LOCKED");
  }
  const outcome = payload.decision
    ? requireEnum(payload.decision, "Promotion decision", DECISIONS)
    : decision.decision;
  if (outcome === "pending") {
    fail("Choose a promotion outcome before approval.", { field: "decision" });
  }
  const workflow = payload.workflowStatus
    ? requireEnum(payload.workflowStatus, "Workflow status", WORKFLOW)
    : "approved";
  if (workflow === "approved" && !["school_head", "district_admin", "system_admin"].includes(actor.role)) {
    throw new HttpError(403, "Only the school head or an administrator may approve promotion decisions.", "PROMOTION_FORBIDDEN");
  }
  if (workflow === "finalized" && !["school_head", "district_admin", "system_admin"].includes(actor.role)) {
    throw new HttpError(403, "Only the school head or an administrator may finalize promotion decisions.", "PROMOTION_FORBIDDEN");
  }
  await query(
    `UPDATE promotion_decisions SET
       decision = $1,
       workflow_status = $2,
       adviser_remarks = COALESCE($3, adviser_remarks),
       head_remarks = COALESCE($4, head_remarks),
       approved_by = CASE WHEN $2 IN ('approved', 'finalized') THEN $5 ELSE approved_by END,
       approved_at = CASE WHEN $2 IN ('approved', 'finalized') THEN now() ELSE approved_at END,
       finalized_at = CASE WHEN $2 = 'finalized' THEN now() ELSE finalized_at END,
       updated_at = now()
     WHERE id = $6`,
    [
      outcome,
      workflow,
      optionalString(payload.adviserRemarks, "Adviser remarks", { max: 2000 }),
      optionalString(payload.headRemarks, "School head remarks", { max: 2000 }),
      actor.id,
      id
    ]
  );
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: "promotion.decide",
    entityType: "promotion_decision",
    entityId: id,
    details: { decision: outcome, workflowStatus: workflow }
  });
  return { id: Number(id), decision: outcome, workflowStatus: workflow };
}

/* -------------------------------------------------------------------------- */
/* Learner academic history (profile tabs)                                    */
/* -------------------------------------------------------------------------- */

async function learnerGrades(actor, learnerId, options = {}) {
  assertCan(actor, "grades", "access");
  const learner = await assertLearnerVisible(actor, learnerId);
  const params = [learner.id];
  let yearFilter = "";
  if (options.schoolYearId) {
    params.push(options.schoolYearId);
    yearFilter = ` AND e.school_year_id = $${params.length}`;
  }
  const enrollments = await query(
    `SELECT e.id, e.school_year_id, e.grade_level_id, e.section_id, e.status,
            y.name AS school_year_name, y.starts_on, gl.name AS grade_level_name,
            sec.name AS section_name, pd.decision, pd.workflow_status, pd.general_average
     FROM enrollments e
     JOIN school_years y ON y.id = e.school_year_id
     JOIN grade_levels gl ON gl.id = e.grade_level_id
     LEFT JOIN sections sec ON sec.id = e.section_id
     LEFT JOIN promotion_decisions pd ON pd.enrollment_id = e.id
     WHERE e.learner_id = $1 ${yearFilter}
     ORDER BY y.starts_on DESC, gl.sort_order DESC`,
    params
  );
  const grades = await query(
    `SELECT gr.*, sub.name AS subject_name, sub.code AS subject_code, e.school_year_id
     FROM grade_records gr
     JOIN enrollments e ON e.id = gr.enrollment_id
     JOIN subjects sub ON sub.id = gr.subject_id
     WHERE e.learner_id = $1 ${yearFilter}
     ORDER BY sub.name ASC, gr.period ASC`,
    params
  );
  const byEnrollment = new Map();
  grades.rows.forEach((row) => {
    const key = String(row.enrollment_id);
    if (!byEnrollment.has(key)) byEnrollment.set(key, []);
    byEnrollment.get(key).push(row);
  });
  const REPORT_STATUS = { draft: "Draft", submitted: "Submitted", approved: "Approved", issued: "Issued" };
  const cards = await query(
    `SELECT rc.enrollment_id, rc.status, rc.version, rc.general_average, rc.issued_on
     FROM report_cards rc WHERE rc.learner_id = $1`,
    [learner.id]
  );
  const cardMap = new Map(cards.rows.map((row) => [String(row.enrollment_id), row]));
  return {
    learner: {
      id: Number(learner.id),
      lrn: learner.lrn,
      fullName: [learner.last_name, learner.first_name, learner.middle_name, learner.extension_name]
        .filter(Boolean)
        .join(" ")
    },
    enrollments: enrollments.rows.map((row) => {
      const rows = byEnrollment.get(String(row.id)) || [];
      const subjectMap = new Map();
      rows.forEach((grade) => {
        const key = String(grade.subject_id);
        if (!subjectMap.has(key)) {
          subjectMap.set(key, {
            subjectId: Number(grade.subject_id),
            subjectName: grade.subject_name,
            subjectCode: grade.subject_code,
            q1: null,
            q2: null,
            q3: null,
            q4: null,
            final: null,
            status: null
          });
        }
        const subject = subjectMap.get(key);
        if (grade.period === "final") {
          subject.final = Number(grade.grade);
          subject.status = grade.status;
        } else {
          subject[grade.period] = Number(grade.grade);
        }
      });
      const card = cardMap.get(String(row.id));
      const finalized = rows.filter((grade) => grade.period === "final" && grade.status === "finalized");
      const average = finalized.length
        ? roundGrade(finalized.reduce((sum, grade) => sum + Number(grade.grade), 0) / finalized.length)
        : null;
      return {
        enrollmentId: Number(row.id),
        schoolYearId: Number(row.school_year_id),
        schoolYearName: row.school_year_name,
        gradeLevelName: row.grade_level_name,
        sectionName: row.section_name,
        enrollmentStatus: row.status,
        generalAverage: row.general_average === null ? average : Number(row.general_average),
        decision: row.decision,
        workflowStatus: row.workflow_status,
        subjects: Array.from(subjectMap.values()),
        reportCard: card
          ? {
              status: card.status,
              statusLabel: REPORT_STATUS[card.status] || card.status,
              version: Number(card.version),
              issuedOn: card.issued_on ? String(card.issued_on).slice(0, 10) : null
            }
          : null
      };
    })
  };
}

/* -------------------------------------------------------------------------- */
/* Report cards                                                               */
/* -------------------------------------------------------------------------- */

async function reportCardData(enrollmentId, runner = { query }) {
  const enrollment = await (runner || { query }).query(
    `SELECT e.*, l.lrn, l.last_name, l.first_name, l.middle_name, l.extension_name, l.sex, l.birth_date,
            gl.name AS grade_level_name, sec.name AS section_name, y.name AS school_year_name,
            s.school_name, s.school_code, d.district_name,
            COALESCE(e.adviser_id, sec.adviser_id) AS effective_adviser_id,
            adv.full_name AS adviser_name
     FROM enrollments e
     JOIN learners l ON l.id = e.learner_id
     JOIN grade_levels gl ON gl.id = e.grade_level_id
     LEFT JOIN sections sec ON sec.id = e.section_id
     JOIN school_years y ON y.id = e.school_year_id
     JOIN schools s ON s.id = e.school_id
     JOIN districts d ON d.id = s.district_id
     LEFT JOIN users adv ON adv.id = COALESCE(e.adviser_id, sec.adviser_id)
     WHERE e.id = $1`,
    [enrollmentId]
  );
  const row = enrollment.rows[0];
  if (!row) {
    return null;
  }
  const gradeRows = await (runner || { query }).query(
    `SELECT gr.subject_id, gr.period, gr.grade, gr.status, gr.class_record_id, gr.source
     FROM grade_records gr WHERE gr.enrollment_id = $1`,
    [enrollmentId]
  );
  const offered = await (runner || { query }).query(
    `SELECT sub.id, sub.code, sub.name
     FROM subjects sub
     WHERE sub.school_id = $1
       AND (sub.grade_level_id = $2 OR sub.grade_level_id IS NULL)
     ORDER BY sub.name ASC, sub.code ASC`,
    [row.school_id, row.grade_level_id]
  );
  const gradeIndex = new Map();
  gradeRows.rows.forEach((grade) => {
    gradeIndex.set(`${grade.subject_id}:${grade.period}`, grade);
  });
  const subjectMap = new Map();
  offered.rows.forEach((subject) => {
    subjectMap.set(Number(subject.id), {
      subjectId: Number(subject.id),
      subjectName: subject.name,
      code: subject.code
    });
  });
  gradeRows.rows.forEach((grade) => {
    const subjectId = Number(grade.subject_id);
    if (!subjectMap.has(subjectId)) {
      subjectMap.set(subjectId, {
        subjectId,
        subjectName: `Subject ${subjectId}`,
        code: ""
      });
    }
  });
  const subjects = Array.from(subjectMap.values()).map((subject) => {
    const quarterRows = {};
    const quarterStatuses = {};
    PERIODS.forEach((period) => {
      const record = gradeIndex.get(`${subject.subjectId}:${period}`);
      quarterRows[period] =
        record && record.grade !== null && record.grade !== undefined ? Number(record.grade) : null;
      quarterStatuses[period] = record ? record.status : "missing";
    });
    const finalRecord = gradeIndex.get(`${subject.subjectId}:final`);
    const finalGrade =
      finalRecord && finalRecord.grade !== null && finalRecord.grade !== undefined
        ? Number(finalRecord.grade)
        : null;
    const finalStatus = finalRecord ? finalRecord.status : "missing";
    const quarterComplete = PERIODS.every(
      (period) => quarterStatuses[period] === "finalized" || quarterStatuses[period] === "accepted"
    );
    return {
      ...subject,
      q1: quarterRows.q1,
      q2: quarterRows.q2,
      q3: quarterRows.q3,
      q4: quarterRows.q4,
      quarters: quarterRows,
      quarterStatuses,
      quarterComplete,
      final: finalGrade,
      status: finalStatus,
      eligible: finalStatus === "finalized" && finalGrade !== null
    };
  });
  const eligibleSubjects = subjects.filter((subject) => subject.eligible);
  const complete = subjects.length > 0 && eligibleSubjects.length === subjects.length;
  const average = complete
    ? roundGrade(
        eligibleSubjects.reduce((sum, subject) => sum + Number(subject.final), 0) /
          eligibleSubjects.length
      )
    : null;
  const finalized = eligibleSubjects;
  const attendance = await (runner || { query }).query(
    `SELECT status, COUNT(*)::int AS count FROM attendance_records
     WHERE enrollment_id = $1 GROUP BY status`,
    [enrollmentId]
  );
  const attendanceCounts = { present: 0, absent: 0, tardy: 0, excused: 0, half_day: 0 };
  attendance.rows.forEach((a) => {
    attendanceCounts[a.status] = Number(a.count);
  });
  const promotion = await (runner || { query }).query(
    "SELECT * FROM promotion_decisions WHERE enrollment_id = $1",
    [enrollmentId]
  );
  return {
    enrollment: {
      id: Number(row.id),
      learnerId: Number(row.learner_id),
      lrn: row.lrn,
      learnerName: [row.first_name, row.middle_name, row.last_name, row.extension_name]
        .filter(Boolean)
        .join(" "),
      lastName: row.last_name,
      firstName: row.first_name,
      middleName: row.middle_name,
      sex: row.sex,
      birthDate: String(row.birth_date).slice(0, 10),
      age: calculateAge(row.birth_date),
      schoolId: Number(row.school_id),
      schoolName: row.school_name,
      schoolCode: row.school_code,
      districtName: row.district_name,
      schoolYearId: Number(row.school_year_id),
      schoolYearName: row.school_year_name,
      gradeLevelName: row.grade_level_name,
      sectionId: row.section_id ? Number(row.section_id) : null,
      sectionName: row.section_name,
      adviserId: row.effective_adviser_id ? Number(row.effective_adviser_id) : null,
      adviserName: row.adviser_name
    },
    subjects,
    generalAverage: average,
    complete,
    missingSubjects: subjects
      .filter((subject) => !subject.eligible)
      .map((subject) => ({
        subjectId: subject.subjectId,
        subjectName: subject.subjectName,
        status: subject.status
      })),
    attendance: attendanceCounts,
    promotion: promotion.rows[0]
      ? {
          decision: promotion.rows[0].decision,
          workflowStatus: promotion.rows[0].workflow_status,
          generalAverage:
            promotion.rows[0].general_average === null ? null : Number(promotion.rows[0].general_average)
        }
      : null,
    missingFinals: !complete
  };
}

async function listReportCards(actor, filters) {
  assertCan(actor, "grades", "access");
  const params = [];
  const conditions = ["1 = 1"];
  const scope = schoolScopeSql(actor, "s", params, filters.schoolId);
  if (scope) {
    conditions.push(scope);
  }
  if (filters.schoolYearId) {
    params.push(filters.schoolYearId);
    conditions.push(`rc.school_year_id = $${params.length}`);
  }
  if (filters.sectionId) {
    params.push(filters.sectionId);
    conditions.push(`rc.section_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`rc.status = $${params.length}`);
  }
  const result = await query(
    `SELECT rc.*, l.lrn, l.last_name, l.first_name, l.middle_name,
            gl.name AS grade_level_name, sec.name AS section_name,
            y.name AS school_year_name, s.school_name,
            adv.full_name AS adviser_name
     FROM report_cards rc
     JOIN learners l ON l.id = rc.learner_id
     JOIN enrollments e ON e.id = rc.enrollment_id
     JOIN grade_levels gl ON gl.id = e.grade_level_id
     LEFT JOIN sections sec ON sec.id = rc.section_id
     JOIN school_years y ON y.id = rc.school_year_id
     JOIN schools s ON s.id = rc.school_id
     LEFT JOIN users adv ON adv.id = rc.adviser_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY l.last_name ASC, l.first_name ASC`,
    params
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    learnerId: Number(row.learner_id),
    enrollmentId: Number(row.enrollment_id),
    lrn: row.lrn,
    learnerName: [row.first_name, row.middle_name, row.last_name].filter(Boolean).join(" "),
    gradeLevelName: row.grade_level_name,
    sectionName: row.section_name,
    schoolName: row.school_name,
    schoolYearName: row.school_year_name,
    adviserName: row.adviser_name,
    generalAverage: row.general_average === null ? null : Number(row.general_average),
    status: row.status,
    version: Number(row.version),
    promotionStatus: row.promotion_status,
    issuedOn: row.issued_on ? String(row.issued_on).slice(0, 10) : null,
    approvedAt: row.approved_at
  }));
}

async function generateReportCards(actor, payload, meta) {
  assertCan(actor, "grades", "add");
  const section = await sectionForActor(actor, payload.sectionId);
  const year = await resolveSchoolYear(payload.schoolYearId || section.school_year_id);
  const learners = await rosterRows(section, year.id);
  let generated = 0;
  const missing = [];
  for (const learner of learners) {
    const data = await reportCardData(learner.enrollment_id);
    if (!data) {
      continue;
    }
    if (data.missingFinals) {
      missing.push(data.enrollment.lrn);
    }
    const existing = await query("SELECT * FROM report_cards WHERE enrollment_id = $1", [
      learner.enrollment_id
    ]);
    if (existing.rows[0] && ["approved", "issued"].includes(existing.rows[0].status)) {
      continue;
    }
    const status = data.missingFinals ? "draft" : existing.rows[0] ? existing.rows[0].status : "draft";
    await query(
      `INSERT INTO report_cards
         (learner_id, enrollment_id, school_id, school_year_id, section_id, adviser_id,
          general_average, days_present, days_absent, days_tardy, promotion_status, status,
          remarks, prepared_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (enrollment_id) DO UPDATE SET
         general_average = EXCLUDED.general_average,
         days_present = EXCLUDED.days_present,
         days_absent = EXCLUDED.days_absent,
         days_tardy = EXCLUDED.days_tardy,
         promotion_status = EXCLUDED.promotion_status,
         status = EXCLUDED.status,
         updated_at = now()`,
      [
        data.enrollment.learnerId,
        data.enrollment.id,
        data.enrollment.schoolId,
        data.enrollment.schoolYearId,
        data.enrollment.sectionId,
        data.enrollment.adviserId,
        data.generalAverage,
        data.attendance.present + data.attendance.tardy + data.attendance.half_day,
        data.attendance.absent,
        data.attendance.tardy,
        data.promotion ? data.promotion.decision : null,
        status,
        optionalString(payload.remarks, "Remarks", { max: 2000 }),
        actor.id
      ]
    );
    generated += 1;
  }
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: "report_cards.generate",
    entityType: "report_cards",
    entityId: section.id,
    details: { sectionId: Number(section.id), generated, missing: missing.length }
  });
  return {
    generated,
    missing,
    items: await listReportCards(actor, { sectionId: section.id, schoolYearId: year.id })
  };
}

async function getReportCard(actor, id) {
  assertCan(actor, "grades", "access");
  const result = await query("SELECT * FROM report_cards WHERE id = $1", [id]);
  if (!result.rows[0]) {
    throw new HttpError(404, "Report card not found.", "REPORT_CARD_NOT_FOUND");
  }
  await resolveSchool(actor, result.rows[0].school_id);
  const data = await reportCardData(result.rows[0].enrollment_id);
  return {
    card: {
      id: Number(result.rows[0].id),
      status: result.rows[0].status,
      version: Number(result.rows[0].version),
      generalAverage:
        result.rows[0].general_average === null ? null : Number(result.rows[0].general_average),
      issuedOn: result.rows[0].issued_on ? String(result.rows[0].issued_on).slice(0, 10) : null,
      approvedAt: result.rows[0].approved_at,
      remarks: result.rows[0].remarks
    },
    ...data
  };
}

async function setReportCardStatus(actor, id, action, payload, meta) {
  assertCan(actor, "grades", "edit");
  const result = await query("SELECT * FROM report_cards WHERE id = $1", [id]);
  const card = result.rows[0];
  if (!card) {
    throw new HttpError(404, "Report card not found.", "REPORT_CARD_NOT_FOUND");
  }
  await resolveSchool(actor, card.school_id);
  const snapshots = {
    submit: { from: "draft", to: "submitted" },
    approve: { from: "submitted", to: "approved" },
    issue: { from: "approved", to: "issued" },
    reissue: { from: "issued", to: "issued" }
  };
  const transition = snapshots[action];
  if (!transition) {
    fail("Unsupported report card action.");
  }
  if (action === "reissue") {
    if (card.status !== "issued") {
      throw new HttpError(409, "Only an issued report card can be reissued.", "REPORT_CARD_STATE");
    }
    if (!payload.reason) {
      fail("A reason is required for a reissue.", { field: "reason" });
    }
  } else if (card.status !== transition.from) {
    throw new HttpError(
      409,
      `The report card must be ${transition.from} before it can be ${transition.to}.`,
      "REPORT_CARD_STATE"
    );
  }
  const data = await reportCardData(card.enrollment_id);
  if (!data || data.missingFinals) {
    throw new HttpError(
      409,
      "The report card cannot be issued until every subject has a finalized grade.",
      "REPORT_CARD_INCOMPLETE"
    );
  }
  const version = action === "reissue" ? Number(card.version) + 1 : Number(card.version);
  if (action === "reissue") {
    await query(
      `INSERT INTO report_card_revisions (report_card_id, version, snapshot, reason, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, card.version, JSON.stringify(data), payload.reason, actor.id]
    );
  }
  const issuedOn = action === "issue" || action === "reissue" ? new Date().toISOString().slice(0, 10) : card.issued_on;
  await query(
    `UPDATE report_cards SET status = $1, version = $2,
       approved_by = CASE WHEN $1 IN ('approved', 'issued') THEN $3 ELSE approved_by END,
       approved_at = CASE WHEN $1 IN ('approved', 'issued') THEN now() ELSE approved_at END,
       issued_on = $4, remarks = COALESCE($5, remarks), updated_at = now()
     WHERE id = $6`,
    [
      transition.to,
      version,
      actor.id,
      issuedOn,
      optionalString(payload.remarks || payload.reason, "Remarks", { max: 2000 }),
      id
    ]
  );
  if (action === "issue" || action === "reissue") {
    await query(
      `INSERT INTO report_card_revisions (report_card_id, version, snapshot, reason, created_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (report_card_id, version) DO NOTHING`,
      [id, version, JSON.stringify(data), action === "reissue" ? payload.reason : "Issued", actor.id]
    );
  }
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: `report_cards.${action}`,
    entityType: "report_card",
    entityId: id,
    details: { from: card.status, to: transition.to, version }
  });
  return { id: Number(id), status: transition.to, version };
}

module.exports = {
  PERIODS,
  ALL_PERIODS,
  DECISIONS,
  WORKFLOW,
  readGrade,
  subjectsForSection,
  rosterRows,
  policyFor,
  gradeEntry,
  saveGrades,
  submitGrades,
  finalizeGrades,
  computeFinal,
  correctGrade,
  getPolicy,
  savePolicy,
  promotionRows,
  computePromotion,
  savePromotionDecision,
  learnerGrades,
  reportCardData,
  listReportCards,
  generateReportCards,
  getReportCard,
  setReportCardStatus
};
