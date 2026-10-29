"use strict";

// Subject teacher class records, assessment scores, quarterly computation, and
// the grade submission/review workflow that feeds the class adviser's SF 9
// consolidation.
//
// The service deliberately keeps raw assessment scores separate from computed
// quarterly grades and from the snapshot submitted to the adviser. A missing
// score is never converted to zero, and no submission is accepted while any
// required score or component weight is missing.

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
  schoolScopeSql,
  isSystemAdmin
} = require("../utils/formsAccess");
const auditService = require("./auditService");
const gradeService = require("./gradeService");

const PERIODS = ["q1", "q2", "q3", "q4"];
const PERIOD_LABEL = {
  q1: "First Quarter",
  q2: "Second Quarter",
  q3: "Third Quarter",
  q4: "Fourth Quarter"
};
const ROUNDING = ["nearest_whole", "two_decimals", "floor"];
const COMPONENT_DEFAULT_LABELS = {
  ww: "Written Work",
  pt: "Performance Tasks",
  qa: "Quarterly Assessment"
};
const SUBMISSION_STATUS = ["draft", "submitted", "under_review", "returned", "accepted", "finalized"];
const SCHOOL_REVIEW_ROLES = ["system_admin", "district_admin", "school_head"];
const CONFIG_ROLES = ["system_admin", "district_admin", "school_head"];

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function numeric(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeConfig(raw) {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch (error) {
      value = {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    value = {};
  }
  const components = Array.isArray(value.components)
    ? value.components
        .filter((entry) => entry && entry.key)
        .map((entry) => ({
          key: String(entry.key).trim().toLowerCase().slice(0, 24),
          label:
            String(entry.label || COMPONENT_DEFAULT_LABELS[entry.key] || entry.key).slice(0, 80),
          weight: numeric(entry.weight)
        }))
    : Object.keys(COMPONENT_DEFAULT_LABELS).map((key) => ({
        key,
        label: COMPONENT_DEFAULT_LABELS[key],
        weight: null
      }));
  const rounding = ROUNDING.includes(value.rounding) ? value.rounding : "two_decimals";
  const transmutation =
    value.transmutation && typeof value.transmutation === "object"
      ? {
          mode: ["none", "table"].includes(value.transmutation.mode)
            ? value.transmutation.mode
            : "none",
          rows: Array.isArray(value.transmutation.rows)
            ? value.transmutation.rows
                .map((row) => ({
                  min: numeric(row.min),
                  max: numeric(row.max),
                  grade: numeric(row.grade)
                }))
                .filter(
                  (row) =>
                    row.min !== null &&
                    row.max !== null &&
                    row.grade !== null &&
                    row.max >= row.min
                )
            : []
        }
      : { mode: "none", rows: [] };
  return {
    components,
    rounding,
    transmutation,
    note: typeof value.note === "string" ? value.note.slice(0, 500) : ""
  };
}

function configIssues(config) {
  const issues = [];
  if (!config.components.length) {
    issues.push("No assessment components are configured for this class record.");
    return issues;
  }
  const keys = new Set();
  config.components.forEach((component) => {
    if (!component.key || !/^[a-z0-9_]+$/.test(component.key)) {
      issues.push("Every assessment component needs a simple key (letters, numbers, underscore).");
    }
    if (keys.has(component.key)) {
      issues.push(`The component key "${component.key}" is repeated.`);
    }
    keys.add(component.key);
    if (component.weight === null) {
      issues.push(`The ${component.label} weight is not configured.`);
    } else if (component.weight < 0 || component.weight > 1) {
      issues.push(`The ${component.label} weight must be between 0 and 1.`);
    }
  });
  if (config.components.every((component) => component.weight !== null)) {
    const total = config.components.reduce((sum, component) => sum + Number(component.weight), 0);
    if (Math.abs(total - 1) > 0.001) {
      issues.push(`Assessment weights total ${round2(total)}; they must total 1.00.`);
    }
  }
  if (config.transmutation.mode === "table") {
    if (!config.transmutation.rows.length) {
      issues.push("A transmutation table is selected but no ranges are configured.");
    } else {
      const sorted = config.transmutation.rows
        .slice()
        .sort((left, right) => left.min - right.min);
      for (let index = 1; index < sorted.length; index += 1) {
        if (sorted[index].min <= sorted[index - 1].max) {
          issues.push("Transmutation table ranges overlap.");
          break;
        }
      }
    }
  }
  return issues;
}

function applyRounding(value, mode) {
  if (value === null) {
    return null;
  }
  if (mode === "floor") {
    return Math.floor(value);
  }
  if (mode === "nearest_whole") {
    return Math.round(value);
  }
  return round2(value);
}

function transmute(initial, config) {
  if (initial === null) {
    return { grade: null, error: null };
  }
  if (config.transmutation.mode !== "table") {
    return { grade: applyRounding(initial, config.rounding), error: null };
  }
  const match = config.transmutation.rows.find(
    (row) => initial >= row.min && initial <= row.max
  );
  if (!match) {
    return {
      grade: null,
      error: `No transmutation range covers an initial grade of ${round2(initial)}.`
    };
  }
  return { grade: round2(match.grade), error: null };
}

async function recordRoster(section, yearId, runner = { query }) {
  const result = await runner.query(
    `SELECT e.id AS enrollment_id, e.learner_id, e.status AS enrollment_status,
            l.lrn, l.last_name, l.first_name, l.middle_name, l.extension_name, l.sex
     FROM enrollments e
     JOIN learners l ON l.id = e.learner_id
     WHERE e.section_id = $1 AND e.school_year_id = $2
       AND l.archived_at IS NULL
       AND e.status NOT IN ('transferred_out', 'archived')
     ORDER BY l.last_name ASC, l.first_name ASC, l.id ASC`,
    [section.id, yearId]
  );
  return result.rows.map((row) => ({
    enrollmentId: Number(row.enrollment_id),
    learnerId: Number(row.learner_id),
    lrn: row.lrn,
    fullName: [row.first_name, row.middle_name, row.last_name, row.extension_name]
      .filter(Boolean)
      .join(" "),
    lastName: row.last_name,
    firstName: row.first_name,
    middleName: row.middle_name,
    sex: row.sex,
    enrollmentStatus: row.enrollment_status
  }));
}

async function resolveTemplate(section, subjectId, schoolId, runner = { query }) {
  const result = await runner.query(
    `SELECT t.*, cv.name AS curriculum_version_name, cv.is_verified AS curriculum_verified,
            c.name AS curriculum_name, c.code AS curriculum_code
     FROM class_record_templates t
     LEFT JOIN curriculum_versions cv ON cv.id = t.curriculum_version_id
     LEFT JOIN curricula c ON c.id = cv.curriculum_id
     WHERE t.is_active
       AND (t.school_id = $1 OR t.school_id IS NULL)
       AND (t.grade_level_id = $2 OR t.grade_level_id IS NULL)
       AND (t.subject_id = $3 OR t.subject_id IS NULL)
     ORDER BY
       (t.school_id IS NULL) ASC,
       (t.subject_id IS NULL) ASC,
       (t.grade_level_id IS NULL) ASC,
       (t.curriculum_version_id IS NULL) ASC,
       t.id DESC
     LIMIT 1`,
    [schoolId, section.grade_level_id, subjectId]
  );
  return result.rows[0] || null;
}

function serializeTemplate(row) {
  if (!row) {
    return null;
  }
  const config = normalizeConfig(row.config);
  const issues = configIssues(config);
  return {
    id: Number(row.id),
    schoolId: row.school_id ? Number(row.school_id) : null,
    curriculumVersionId: row.curriculum_version_id ? Number(row.curriculum_version_id) : null,
    curriculumVersionName: row.curriculum_version_name || null,
    curriculumName: row.curriculum_name || null,
    curriculumVerified: Boolean(row.curriculum_verified),
    gradeLevelId: row.grade_level_id ? Number(row.grade_level_id) : null,
    subjectId: row.subject_id ? Number(row.subject_id) : null,
    name: row.name,
    version: row.version,
    isOfficial: Boolean(row.is_official),
    sourceNote: row.source_note,
    config,
    configured: issues.length === 0,
    issues
  };
}

async function loadRecord(actor, recordId, runner = { query }) {
  const result = await runner.query(
    `SELECT cr.*, sec.name AS section_name, sec.adviser_id, sec.grade_level_id,
            sec.room, gl.name AS grade_level_name, gl.sort_order,
            y.name AS school_year_name, y.is_current, y.starts_on, y.ends_on,
            sub.name AS subject_name, sub.code AS subject_code,
            sch.school_name, sch.school_code, sch.district_id,
            teacher.full_name AS teacher_name,
            adviser.full_name AS adviser_name,
            t.name AS template_name, t.version AS template_version,
            t.is_official AS template_official, t.source_note AS template_source,
            t.config AS template_config, t.curriculum_version_id AS template_curriculum_id,
            cv.name AS curriculum_version_name, cv.is_verified AS curriculum_verified,
            c.name AS curriculum_name, c.code AS curriculum_code
     FROM class_records cr
     JOIN sections sec ON sec.id = cr.section_id
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     JOIN school_years y ON y.id = cr.school_year_id
     JOIN subjects sub ON sub.id = cr.subject_id
     JOIN schools sch ON sch.id = cr.school_id
     LEFT JOIN users teacher ON teacher.id = cr.teacher_id
     LEFT JOIN users adviser ON adviser.id = sec.adviser_id
     LEFT JOIN class_record_templates t ON t.id = cr.template_id
     LEFT JOIN curriculum_versions cv ON cv.id = cr.curriculum_version_id
     LEFT JOIN curricula c ON c.id = cv.curriculum_id
     WHERE cr.id = $1`,
    [recordId]
  );
  const record = result.rows[0];
  if (!record) {
    throw new HttpError(404, "Class record not found.", "CLASS_RECORD_NOT_FOUND");
  }
  assertRecordScope(actor, record);
  return record;
}

function assertRecordScope(actor, record) {
  if (isSystemAdmin(actor)) {
    return;
  }
  const districtWide = ["district_admin", "psds", "staff"].includes(actor.role);
  if (districtWide) {
    if (Number(actor.districtId) !== Number(record.district_id)) {
      throw new HttpError(403, "That class record is outside your district.", "SCHOOL_FORBIDDEN");
    }
    return;
  }
  if (Number(actor.schoolId) !== Number(record.school_id)) {
    throw new HttpError(403, "That class record is outside your school.", "SCHOOL_FORBIDDEN");
  }
  if (actor.role === "teacher" || actor.role === "adviser") {
    if (
      Number(record.teacher_id) !== Number(actor.id) &&
      Number(record.adviser_id) !== Number(actor.id)
    ) {
      throw new HttpError(
        403,
        "You can only open class records you own or advise.",
        "CLASS_RECORD_FORBIDDEN"
      );
    }
  }
}

function canManageScores(actor, record) {
  if (!canDo(actor, "class_records", "edit")) {
    return false;
  }
  if (["system_admin", "district_admin", "school_head"].includes(actor.role)) {
    return true;
  }
  return Number(record.teacher_id) === Number(actor.id);
}

function canReview(actor, record) {
  if (!canDo(actor, "grade_submissions", "edit")) {
    return false;
  }
  if (SCHOOL_REVIEW_ROLES.includes(actor.role)) {
    return true;
  }
  return Number(record.adviser_id) === Number(actor.id);
}

function canSubmit(actor, record) {
  if (!canDo(actor, "class_records", "add")) {
    return false;
  }
  if (SCHOOL_REVIEW_ROLES.includes(actor.role)) {
    return true;
  }
  return Number(record.teacher_id) === Number(actor.id);
}

async function assessmentsFor(recordId, runner = { query }) {
  const result = await runner.query(
    `SELECT * FROM class_record_assessments
     WHERE class_record_id = $1 AND is_active
     ORDER BY period ASC, component_key ASC, sort_order ASC, id ASC`,
    [recordId]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    period: row.period,
    componentKey: row.component_key,
    title: row.title,
    maxScore: Number(row.max_score),
    assessmentDate: row.assessment_date ? String(row.assessment_date).slice(0, 10) : null,
    sortOrder: Number(row.sort_order)
  }));
}

async function scoresFor(recordId, runner = { query }) {
  const result = await runner.query(
    `SELECT assessment_id, enrollment_id, score
     FROM class_record_scores WHERE class_record_id = $1`,
    [recordId]
  );
  return result.rows.map((row) => ({
    assessmentId: Number(row.assessment_id),
    enrollmentId: Number(row.enrollment_id),
    score: row.score === null ? null : Number(row.score)
  }));
}

function computePeriod(config, assessments, scoreIndex, enrollmentId) {
  const components = [];
  const missing = [];
  let weighted = 0;
  let weightTotal = 0;
  let weightsReady = true;

  config.components.forEach((component) => {
    const componentAssessments = assessments.filter(
      (assessment) => assessment.componentKey === component.key
    );
    if (!componentAssessments.length) {
      if (component.weight !== null && component.weight > 0) {
        missing.push(`No ${component.label} assessment has been added for this quarter.`);
      }
      return;
    }
    let total = 0;
    let maximum = 0;
    const missingScores = [];
    componentAssessments.forEach((assessment) => {
      maximum += Number(assessment.maxScore);
      const score = scoreIndex.get(`${assessment.id}:${enrollmentId}`);
      if (score === null || score === undefined) {
        missingScores.push(assessment.title);
      } else {
        total += Number(score);
      }
    });
    const percentage = maximum > 0 ? round2((total / maximum) * 100) : null;
    components.push({
      key: component.key,
      label: component.label,
      weight: component.weight,
      total: round2(total),
      maximum: round2(maximum),
      percentage,
      missing: missingScores,
      assessmentCount: componentAssessments.length
    });
    if (missingScores.length) {
      missing.push(
        `${missingScores.length} ${component.label.toLowerCase()} score(s) have not been encoded.`
      );
    }
    if (component.weight === null) {
      weightsReady = false;
    } else if (percentage !== null) {
      weighted += percentage * Number(component.weight);
      weightTotal += Number(component.weight);
    }
  });

  // A quarterly grade is only produced when every configured component has a
  // complete set of encoded scores. Missing work is never renormalised into a
  // provisional grade that could be mistaken for a final one.
  const initial =
    weightsReady &&
    missing.length === 0 &&
    weightTotal > 0 &&
    components.some((component) => component.percentage !== null)
      ? round2(weighted / weightTotal)
      : null;
  const converted = transmute(initial, config);
  if (converted.error) {
    missing.push(converted.error);
  }
  const present = assessments.length > 0;
  return {
    available: present,
    complete: present && missing.length === 0 && initial !== null && converted.grade !== null,
    initialGrade: initial,
    quarterlyGrade: converted.grade,
    components,
    missing,
    weightsReady
  };
}

function computeRecord(config, assessments, scores, roster) {
  const scoreIndex = new Map();
  scores.forEach((score) => {
    if (score.score !== null) {
      scoreIndex.set(`${score.assessmentId}:${score.enrollmentId}`, Number(score.score));
    }
  });
  const periods = {};
  PERIODS.forEach((period) => {
    const periodAssessments = assessments.filter((assessment) => assessment.period === period);
    if (!periodAssessments.length) {
      periods[period] = {
        available: false,
        complete: false,
        issues: ["No assessments have been added for this quarter."],
        learners: {}
      };
      return;
    }
    const issues = [];
    periodAssessments.forEach((assessment) => {
      if (!config.components.some((component) => component.key === assessment.componentKey)) {
        issues.push(
          `The assessment "${assessment.title}" uses a component that is no longer in the template.`
        );
      }
    });
    const learners = {};
    roster.forEach((learner) => {
      learners[learner.enrollmentId] = computePeriod(
        config,
        periodAssessments,
        scoreIndex,
        learner.enrollmentId
      );
    });
    periods[period] = {
      available: true,
      complete:
        issues.length === 0 &&
        roster.length > 0 &&
        roster.every((learner) => learners[learner.enrollmentId].complete),
      issues,
      learners
    };
  });
  return { periods };
}

function serializeSubmission(row) {
  return {
    id: Number(row.id),
    classRecordId: Number(row.class_record_id),
    period: row.period,
    status: row.status,
    version: Number(row.version),
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewNotes: row.review_notes,
    teacherName: row.teacher_name || null,
    reviewerName: row.reviewer_name || null,
    itemCount: row.item_count === undefined ? undefined : Number(row.item_count)
  };
}

async function recordDetail(actor, recordId) {
  assertCan(actor, "class_records", "access");
  const record = await loadRecord(actor, recordId);
  const [roster, assessments, scores, submissionRows] = await Promise.all([
    recordRoster(
      { id: record.section_id, school_id: record.school_id },
      record.school_year_id
    ),
    assessmentsFor(record.id),
    scoresFor(record.id),
    query(
      `SELECT gs.*, u.full_name AS teacher_name, rev.full_name AS reviewer_name,
              (SELECT COUNT(*)::int FROM grade_submission_items gi WHERE gi.submission_id = gs.id) AS item_count
       FROM grade_submissions gs
       LEFT JOIN users u ON u.id = gs.submitted_by
       LEFT JOIN users rev ON rev.id = gs.reviewed_by
       WHERE gs.class_record_id = $1
       ORDER BY gs.period ASC`,
      [record.id]
    )
  ]);
  const template = serializeTemplate({
    id: record.template_id,
    school_id: null,
    curriculum_version_id: record.template_curriculum_id,
    curriculum_version_name: record.curriculum_version_name,
    curriculum_verified: record.curriculum_verified,
    curriculum_name: record.curriculum_name,
    grade_level_id: null,
    subject_id: null,
    name: record.template_name || "Unconfigured class record",
    version: record.template_version || "none",
    is_official: record.template_official,
    source_note: record.template_source,
    config: record.template_config || {}
  });
  const computation = computeRecord(template.config, assessments, scores, roster);
  return {
    record: {
      id: Number(record.id),
      assignmentId: record.assignment_id ? Number(record.assignment_id) : null,
      schoolId: Number(record.school_id),
      schoolName: record.school_name,
      schoolCode: record.school_code,
      districtId: Number(record.district_id),
      schoolYearId: Number(record.school_year_id),
      schoolYearName: record.school_year_name,
      gradeLevelId: Number(record.grade_level_id),
      gradeLevelName: record.grade_level_name,
      sectionId: Number(record.section_id),
      sectionName: record.section_name,
      subjectId: Number(record.subject_id),
      subjectName: record.subject_name,
      subjectCode: record.subject_code,
      teacherId: record.teacher_id ? Number(record.teacher_id) : null,
      teacherName: record.teacher_name,
      adviserId: record.adviser_id ? Number(record.adviser_id) : null,
      adviserName: record.adviser_name,
      status: record.status,
      createdAt: record.created_at,
      updatedAt: record.updated_at
    },
    template,
    roster,
    assessments,
    scores,
    computation,
    submissions: submissionRows.rows.map(serializeSubmission),
    can: {
      manageScores: canManageScores(actor, record),
      review: canReview(actor, record),
      submit: canSubmit(actor, record)
    }
  };
}

async function teacherDashboard(actor, filters) {
  assertCan(actor, "class_records", "access");
  const year = await resolveSchoolYear(filters.schoolYearId);
  const params = [year.id];
  const conditions = ["ta.school_year_id = $1"];
  const scope = schoolScopeSql(actor, "sch", params, filters.schoolId);
  if (scope) {
    conditions.push(scope);
  }
  if (actor.role === "teacher" || actor.role === "adviser") {
    params.push(actor.id);
    conditions.push(`ta.teacher_id = $${params.length}`);
  }
  if (filters.sectionId) {
    params.push(Number(filters.sectionId));
    conditions.push(`sec.id = $${params.length}`);
  }
  if (filters.subjectId) {
    params.push(Number(filters.subjectId));
    conditions.push(`sub.id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${String(filters.search).trim().toLowerCase()}%`);
    conditions.push(
      `(lower(sub.name) LIKE $${params.length} OR lower(sec.name) LIKE $${params.length} OR lower(u.full_name) LIKE $${params.length})`
    );
  }
  const result = await query(
    `SELECT ta.id AS assignment_id, ta.teacher_id,
            sec.id AS section_id, sec.name AS section_name, sec.room,
            gl.name AS grade_level_name, gl.sort_order,
            sub.id AS subject_id, sub.code AS subject_code, sub.name AS subject_name,
            sch.id AS school_id, sch.school_name, sch.school_code, sch.district_id,
            u.full_name AS teacher_name,
            (SELECT COUNT(*)::int FROM enrollments e
             WHERE e.section_id = sec.id AND e.school_year_id = $1
               AND e.status NOT IN ('transferred_out', 'archived')) AS learner_count,
            cr.id AS class_record_id, cr.status AS class_record_status
     FROM teacher_assignments ta
     JOIN sections sec ON sec.id = ta.section_id
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     JOIN subjects sub ON sub.id = ta.subject_id
     JOIN schools sch ON sch.id = ta.school_id
     LEFT JOIN users u ON u.id = ta.teacher_id
     LEFT JOIN class_records cr
       ON cr.school_year_id = ta.school_year_id AND cr.section_id = ta.section_id
      AND cr.subject_id = ta.subject_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY sch.school_name ASC, gl.sort_order ASC, sec.name ASC, sub.name ASC`,
    params
  );
  const recordIds = result.rows
    .map((row) => (row.class_record_id ? Number(row.class_record_id) : null))
    .filter(Boolean);
  let submissions = [];
  if (recordIds.length) {
    const sub = await query(
      `SELECT class_record_id, period, status, version, reviewed_at, review_notes
       FROM grade_submissions WHERE class_record_id = ANY($1::bigint[])`,
      [recordIds]
    );
    submissions = sub.rows;
  }
  const submissionMap = new Map();
  submissions.forEach((row) => {
    const key = `${row.class_record_id}:${row.period}`;
    submissionMap.set(key, row);
  });
  return {
    schoolYear: { id: Number(year.id), name: year.name, isCurrent: year.is_current },
    items: result.rows.map((row) => {
      const periods = {};
      PERIODS.forEach((period) => {
        const submission = submissionMap.get(`${row.class_record_id}:${period}`);
        periods[period] = submission
          ? { status: submission.status, version: Number(submission.version) }
          : { status: "not_started", version: 0 };
      });
      return {
        assignmentId: Number(row.assignment_id),
        teacherId: row.teacher_id ? Number(row.teacher_id) : null,
        teacherName: row.teacher_name,
        schoolId: Number(row.school_id),
        schoolName: row.school_name,
        schoolCode: row.school_code,
        sectionId: Number(row.section_id),
        sectionName: row.section_name,
        gradeLevelName: row.grade_level_name,
        subjectId: Number(row.subject_id),
        subjectCode: row.subject_code,
        subjectName: row.subject_name,
        learnerCount: Number(row.learner_count),
        classRecordId: row.class_record_id ? Number(row.class_record_id) : null,
        classRecordStatus: row.class_record_status || null,
        periods
      };
    })
  };
}

async function initializeRecord(actor, payload, meta) {
  assertCan(actor, "class_records", "add");
  const section = await sectionForActor(actor, payload.sectionId);
  const year = await resolveSchoolYear(payload.schoolYearId || section.school_year_id);
  if (Number(section.school_year_id) !== Number(year.id)) {
    throw new HttpError(409, "That section belongs to a different school year.", "SECTION_YEAR_MISMATCH");
  }
  const subjectId = requireIdParam(payload.subjectId, "Subject");
  const subject = await query(
    `SELECT * FROM subjects
     WHERE id = $1 AND school_id = $2 AND (grade_level_id = $3 OR grade_level_id IS NULL)`,
    [subjectId, section.school_id, section.grade_level_id]
  );
  if (!subject.rows[0]) {
    throw new HttpError(
      409,
      "That subject is not offered to this section's grade level.",
      "SUBJECT_SECTION_MISMATCH"
    );
  }
  const assignments = await query(
    `SELECT ta.*, u.full_name AS teacher_name
     FROM teacher_assignments ta
     LEFT JOIN users u ON u.id = ta.teacher_id
     WHERE ta.section_id = $1 AND ta.subject_id = $2 AND ta.school_year_id = $3
     ORDER BY ta.teacher_id NULLS LAST, ta.id ASC`,
    [section.id, subjectId, year.id]
  );
  let assignment = null;
  if (payload.assignmentId) {
    assignment = assignments.rows.find(
      (row) => Number(row.id) === Number(payload.assignmentId)
    );
    if (!assignment) {
      throw new HttpError(404, "That teaching assignment was not found.", "ASSIGNMENT_NOT_FOUND");
    }
  } else if (actor.role === "teacher" || actor.role === "adviser") {
    assignment = assignments.rows.find((row) => Number(row.teacher_id) === Number(actor.id));
  } else {
    assignment = assignments.rows.find((row) => row.teacher_id) || assignments.rows[0];
  }
  if (!assignment) {
    throw new HttpError(
      409,
      "Assign a subject teacher to this section and subject before opening a class record.",
      "TEACHING_ASSIGNMENT_REQUIRED"
    );
  }
  if (
    (actor.role === "teacher" || actor.role === "adviser") &&
    Number(assignment.teacher_id) !== Number(actor.id)
  ) {
    throw new HttpError(
      403,
      "You can only open a class record for your own teaching assignment.",
      "ASSIGNMENT_NOT_YOURS"
    );
  }
  if (Number(assignment.school_id) !== Number(section.school_id)) {
    throw new HttpError(409, "The teaching assignment belongs to another school.", "ASSIGNMENT_SCHOOL_MISMATCH");
  }
  const existing = await query(
    `SELECT id FROM class_records
     WHERE school_year_id = $1 AND section_id = $2 AND subject_id = $3`,
    [year.id, section.id, subjectId]
  );
  if (existing.rows[0]) {
    return recordDetail(actor, existing.rows[0].id);
  }
  const templateRow = await resolveTemplate(section, subjectId, section.school_id);
  if (!templateRow) {
    throw new HttpError(
      409,
      "No class record template is configured for this grade level and subject.",
      "CLASS_RECORD_TEMPLATE_MISSING"
    );
  }
  const inserted = await query(
    `INSERT INTO class_records
       (assignment_id, school_id, school_year_id, section_id, subject_id, teacher_id,
        template_id, curriculum_version_id, status, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $9)
     RETURNING id`,
    [
      assignment.id,
      section.school_id,
      year.id,
      section.id,
      subjectId,
      assignment.teacher_id || actor.id,
      templateRow.id,
      section.curriculum_version_id || templateRow.curriculum_version_id,
      actor.id
    ]
  );
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: "class_record.create",
    entityType: "class_record",
    entityId: inserted.rows[0].id,
    details: {
      schoolId: Number(section.school_id),
      sectionId: Number(section.id),
      subjectId,
      teacherId: Number(assignment.teacher_id),
      templateId: Number(templateRow.id)
    }
  });
  return recordDetail(actor, inserted.rows[0].id);
}

async function assertEditablePeriod(record, period, runner = { query }) {
  const result = await runner.query(
    "SELECT status FROM grade_submissions WHERE class_record_id = $1 AND period = $2",
    [record.id, period]
  );
  if (result.rows[0] && ["submitted", "under_review", "accepted", "finalized"].includes(result.rows[0].status)) {
    throw new HttpError(
      409,
      "This quarter is locked because it has been submitted. Return it for correction before editing.",
      "CLASS_RECORD_LOCKED"
    );
  }
}

async function saveAssessment(actor, recordId, payload, meta) {
  assertCan(actor, "class_records", "edit");
  const record = await loadRecord(actor, recordId);
  if (!canManageScores(actor, record)) {
    throw new HttpError(
      403,
      "Only the assigned subject teacher may change this class record's assessments.",
      "CLASS_RECORD_OWNER_ONLY"
    );
  }
  const template = serializeTemplate({
    id: record.template_id,
    school_id: null,
    name: record.template_name,
    version: record.template_version,
    is_official: record.template_official,
    source_note: record.template_source,
    config: record.template_config || {}
  });
  const period = requireEnum(payload.period, "Grading period", PERIODS);
  await assertEditablePeriod(record, period);
  const componentKey = requireString(payload.componentKey, "Assessment component", { max: 24 })
    .toLowerCase();
  if (!template.config.components.some((component) => component.key === componentKey)) {
    throw new HttpError(
      409,
      "That assessment component is not part of the class record template.",
      "COMPONENT_NOT_CONFIGURED"
    );
  }
  const title = requireString(payload.title, "Assessment title", { min: 2, max: 160 });
  const maxScore = Number(payload.maxScore);
  if (!Number.isFinite(maxScore) || maxScore <= 0 || maxScore > 10000) {
    fail("Maximum score must be greater than zero.", { field: "maxScore" });
  }
  const sortOrder = payload.sortOrder === undefined ? 0 : Number(payload.sortOrder);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999) {
    fail("Sort order must be a whole number between 0 and 999.", { field: "sortOrder" });
  }
  const assessmentDate = payload.assessmentDate || null;
  if (assessmentDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(assessmentDate))) {
    fail("Assessment date must use the YYYY-MM-DD format.", { field: "assessmentDate" });
  }
  let id = payload.id ? requireIdParam(payload.id, "Assessment") : null;
  if (id) {
    const existing = await query(
      "SELECT * FROM class_record_assessments WHERE id = $1 AND class_record_id = $2",
      [id, record.id]
    );
    if (!existing.rows[0]) {
      throw new HttpError(404, "Assessment not found.", "ASSESSMENT_NOT_FOUND");
    }
    if (Number(existing.rows[0].max_score) !== round2(maxScore)) {
      const high = await query(
        "SELECT MAX(score)::numeric AS score FROM class_record_scores WHERE assessment_id = $1",
        [id]
      );
      if (high.rows[0].score !== null && Number(high.rows[0].score) > maxScore) {
        throw new HttpError(
          409,
          "The new maximum is lower than a score already encoded for this assessment.",
          "MAX_SCORE_TOO_LOW"
        );
      }
    }
  }
  if (id) {
    await query(
      `UPDATE class_record_assessments
       SET period = $1, component_key = $2, title = $3, max_score = $4,
           assessment_date = $5, sort_order = $6, updated_by = $7
       WHERE id = $8 AND class_record_id = $9`,
      [period, componentKey, title, maxScore, assessmentDate, sortOrder, actor.id, id, record.id]
    );
  } else {
    const inserted = await query(
      `INSERT INTO class_record_assessments
         (class_record_id, period, component_key, title, max_score, assessment_date,
          sort_order, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING id`,
      [record.id, period, componentKey, title, maxScore, assessmentDate, sortOrder, actor.id]
    );
    id = inserted.rows[0].id;
  }
  await query(
    "UPDATE class_records SET status = CASE WHEN status = 'draft' THEN 'in_progress' ELSE status END, updated_by = $1 WHERE id = $2",
    [actor.id, record.id]
  );
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: payload.id ? "class_record.assessment_updated" : "class_record.assessment_created",
    entityType: "class_record_assessment",
    entityId: id,
    details: {
      classRecordId: Number(record.id),
      period,
      componentKey,
      title,
      maxScore: round2(maxScore)
    }
  });
  return recordDetail(actor, record.id);
}

async function archiveAssessment(actor, recordId, assessmentId, meta) {
  assertCan(actor, "class_records", "edit");
  const record = await loadRecord(actor, recordId);
  if (!canManageScores(actor, record)) {
    throw new HttpError(403, "Only the assigned subject teacher may archive this assessment.", "CLASS_RECORD_OWNER_ONLY");
  }
  const existing = await query(
    "SELECT * FROM class_record_assessments WHERE id = $1 AND class_record_id = $2",
    [assessmentId, record.id]
  );
  if (!existing.rows[0]) {
    throw new HttpError(404, "Assessment not found.", "ASSESSMENT_NOT_FOUND");
  }
  await assertEditablePeriod(record, existing.rows[0].period);
  await query(
    "UPDATE class_record_assessments SET is_active = FALSE, updated_by = $1 WHERE id = $2",
    [actor.id, assessmentId]
  );
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: "class_record.assessment_archived",
    entityType: "class_record_assessment",
    entityId: assessmentId,
    details: {
      classRecordId: Number(record.id),
      period: existing.rows[0].period,
      title: existing.rows[0].title
    }
  });
  return recordDetail(actor, record.id);
}

async function saveScores(actor, recordId, payload, meta) {
  assertCan(actor, "class_records", "edit");
  const record = await loadRecord(actor, recordId);
  if (!canManageScores(actor, record)) {
    throw new HttpError(
      403,
      "Only the assigned subject teacher may encode scores. Return the submission for correction instead.",
      "CLASS_RECORD_OWNER_ONLY"
    );
  }
  const period = requireEnum(payload.period, "Grading period", PERIODS);
  await assertEditablePeriod(record, period);
  if (!Array.isArray(payload.entries) || !payload.entries.length) {
    fail("Provide at least one score entry.", { field: "entries" });
  }
  const roster = await recordRoster(
    { id: record.section_id, school_id: record.school_id },
    record.school_year_id
  );
  const allowedEnrollments = new Set(roster.map((learner) => String(learner.enrollmentId)));
  const assessments = await query(
    `SELECT * FROM class_record_assessments
     WHERE class_record_id = $1 AND period = $2 AND is_active`,
    [record.id, period]
  );
  const assessmentMap = new Map(
    assessments.rows.map((row) => [Number(row.id), row])
  );
  const prepared = payload.entries.map((entry) => {
    const assessmentId = requireIdParam(entry.assessmentId, "Assessment");
    const assessment = assessmentMap.get(assessmentId);
    if (!assessment) {
      throw new HttpError(409, "An assessment does not belong to this class record and quarter.", "ASSESSMENT_SCOPE");
    }
    const enrollmentId = requireIdParam(entry.enrollmentId, "Enrollment");
    if (!allowedEnrollments.has(String(enrollmentId))) {
      throw new HttpError(409, "A learner is not enrolled in this section.", "SCORE_ROSTER_MISMATCH");
    }
    let score = null;
    if (entry.score !== null && entry.score !== undefined && entry.score !== "") {
      score = Number(entry.score);
      if (!Number.isFinite(score) || score < 0) {
        fail("Scores must be zero or greater, or blank for missing.", { field: "score" });
      }
      if (score > Number(assessment.max_score)) {
        fail(
          `A score cannot exceed the maximum of ${Number(assessment.max_score)} for ${assessment.title}.`,
          { field: "score" }
        );
      }
      score = round2(score);
    }
    return { assessmentId, enrollmentId, score };
  });

  const client = await getClient();
  let changed = 0;
  try {
    await client.query("BEGIN");
    for (const entry of prepared) {
      const learner = roster.find(
        (row) => Number(row.enrollmentId) === Number(entry.enrollmentId)
      );
      const existing = await client.query(
        `SELECT score FROM class_record_scores
         WHERE assessment_id = $1 AND enrollment_id = $2 FOR UPDATE`,
        [entry.assessmentId, entry.enrollmentId]
      );
      if (entry.score === null) {
        if (existing.rows[0]) {
          await client.query(
            "DELETE FROM class_record_scores WHERE assessment_id = $1 AND enrollment_id = $2",
            [entry.assessmentId, entry.enrollmentId]
          );
          changed += 1;
        }
        continue;
      }
      await client.query(
        `INSERT INTO class_record_scores
           (assessment_id, class_record_id, enrollment_id, learner_id, score, encoded_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         ON CONFLICT (assessment_id, enrollment_id) DO UPDATE SET
           score = EXCLUDED.score, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [
          entry.assessmentId,
          record.id,
          entry.enrollmentId,
          learner.learnerId,
          entry.score,
          actor.id
        ]
      );
      if (
        !existing.rows[0] ||
        existing.rows[0].score === null ||
        Number(existing.rows[0].score) !== entry.score
      ) {
        changed += 1;
      }
    }
    await client.query(
      `UPDATE class_records
       SET status = CASE WHEN status = 'draft' THEN 'in_progress' ELSE status END,
           updated_by = $1, updated_at = now()
       WHERE id = $2`,
      [actor.id, record.id]
    );
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
      action: "class_record.scores_saved",
      entityType: "class_record",
      entityId: record.id,
      details: {
        classRecordId: Number(record.id),
        period,
        changed,
        learnerCount: roster.length
      }
    });
  }
  return recordDetail(actor, record.id);
}

async function notify(userId, title, message) {
  if (!userId) {
    return;
  }
  await query(
    "INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)",
    [userId, title, message]
  );
}

async function submitRecord(actor, recordId, payload, meta) {
  assertCan(actor, "class_records", "add");
  const record = await loadRecord(actor, recordId);
  if (!canSubmit(actor, record)) {
    throw new HttpError(
      403,
      "Only the assigned subject teacher may submit this class record.",
      "CLASS_RECORD_OWNER_ONLY"
    );
  }
  const period = requireEnum(payload.period, "Grading period", PERIODS);
  const existingSubmission = await query(
    "SELECT * FROM grade_submissions WHERE class_record_id = $1 AND period = $2 FOR UPDATE",
    [record.id, period]
  );
  const current = existingSubmission.rows[0];
  if (current && ["submitted", "under_review", "accepted", "finalized"].includes(current.status)) {
    throw new HttpError(
      409,
      "That quarter is already submitted. It must be returned before it can be resubmitted.",
      "SUBMISSION_LOCKED"
    );
  }
  const templateRow = await query(
    `SELECT t.*, cv.name AS curriculum_version_name, cv.is_verified AS curriculum_verified,
            c.name AS curriculum_name
     FROM class_record_templates t
     LEFT JOIN curriculum_versions cv ON cv.id = t.curriculum_version_id
     LEFT JOIN curricula c ON c.id = cv.curriculum_id
     WHERE t.id = $1`,
    [record.template_id]
  );
  const template = serializeTemplate(templateRow.rows[0]);
  const [roster, assessments, scores] = await Promise.all([
    recordRoster({ id: record.section_id, school_id: record.school_id }, record.school_year_id),
    assessmentsFor(record.id),
    scoresFor(record.id)
  ]);
  if (!roster.length) {
    throw new HttpError(409, "This section has no enrolled learners to submit.", "EMPTY_ROSTER");
  }
  if (!assessments.some((assessment) => assessment.period === period)) {
    throw new HttpError(409, "Add assessments for this quarter before submitting.", "NO_ASSESSMENTS");
  }
  const computation = computeRecord(template.config, assessments, scores, roster);
  const periodComputation = computation.periods[period];
  const incomplete = roster
    .map((learner) => ({
      learner,
      result: periodComputation.learners[learner.enrollmentId]
    }))
    .filter((entry) => !entry.result || !entry.result.complete);
  const globalIssues = [...template.issues, ...(periodComputation.issues || [])];
  if (globalIssues.length || incomplete.length) {
    throw new HttpError(
      409,
      "The class record is incomplete. Resolve every missing score and configuration issue before submitting.",
      "CLASS_RECORD_INCOMPLETE",
      {
        configurationIssues: globalIssues,
        incompleteLearners: incomplete.map((entry) => ({
          learnerId: entry.learner.learnerId,
          lrn: entry.learner.lrn,
          fullName: entry.learner.fullName,
          missing: (entry.result && entry.result.missing) || ["No calculation"]
        }))
      }
    );
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    let submissionId;
    let version = 1;
    if (current) {
      version = Number(current.version) + 1;
      const updated = await client.query(
        `UPDATE grade_submissions SET
           status = 'submitted', version = $1, policy_snapshot = $2,
           submitted_by = $3, submitted_at = now(),
           reviewed_by = NULL, reviewed_at = NULL, review_notes = NULL,
           updated_at = now()
         WHERE id = $4 RETURNING id`,
        [version, JSON.stringify(template.config), actor.id, current.id]
      );
      submissionId = updated.rows[0].id;
      await client.query("DELETE FROM grade_submission_items WHERE submission_id = $1", [submissionId]);
    } else {
      const inserted = await client.query(
        `INSERT INTO grade_submissions
           (class_record_id, school_id, school_year_id, section_id, subject_id, teacher_id,
            adviser_id, period, status, version, policy_snapshot, submitted_by, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'submitted', 1, $9, $10, now())
         RETURNING id`,
        [
          record.id,
          record.school_id,
          record.school_year_id,
          record.section_id,
          record.subject_id,
          record.teacher_id,
          record.adviser_id,
          period,
          JSON.stringify(template.config),
          actor.id
        ]
      );
      submissionId = inserted.rows[0].id;
    }
    for (const learner of roster) {
      const result = periodComputation.learners[learner.enrollmentId];
      await client.query(
        `INSERT INTO grade_submission_items
           (submission_id, enrollment_id, learner_id, quarterly_grade, initial_grade, breakdown)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          submissionId,
          learner.enrollmentId,
          learner.learnerId,
          result.quarterlyGrade,
          result.initialGrade,
          JSON.stringify(result.components)
        ]
      );
      await client.query(
        `INSERT INTO class_record_grades
           (class_record_id, enrollment_id, learner_id, period, components,
            initial_grade, quarterly_grade, status, calculation, computed_at, computed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'submitted', $8, now(), $9)
         ON CONFLICT (class_record_id, enrollment_id, period) DO UPDATE SET
           components = EXCLUDED.components,
           initial_grade = EXCLUDED.initial_grade,
           quarterly_grade = EXCLUDED.quarterly_grade,
           status = 'submitted',
           calculation = EXCLUDED.calculation,
           computed_at = now(),
           computed_by = EXCLUDED.computed_by,
           updated_at = now()`,
        [
          record.id,
          learner.enrollmentId,
          learner.learnerId,
          period,
          JSON.stringify(result.components),
          result.initialGrade,
          result.quarterlyGrade,
          JSON.stringify({
            components: result.components,
            initialGrade: result.initialGrade,
            quarterlyGrade: result.quarterlyGrade,
            template: {
              id: template.id,
              version: template.version,
              rounding: template.config.rounding,
              transmutation: template.config.transmutation,
              components: template.config.components
            },
            submittedAt: new Date().toISOString()
          }),
          actor.id
        ]
      );
      await client.query(
        `INSERT INTO grade_records
           (enrollment_id, subject_id, school_year_id, period, grade, status,
            submitted_by, submitted_at, class_record_id, source, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, 'submitted', $6, now(), $7, 'class_record', $6, $6)
         ON CONFLICT (enrollment_id, subject_id, period) DO UPDATE SET
           grade = EXCLUDED.grade,
           status = 'submitted',
           submitted_by = EXCLUDED.submitted_by,
           submitted_at = now(),
           class_record_id = EXCLUDED.class_record_id,
           source = 'class_record',
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
         WHERE grade_records.status NOT IN ('finalized', 'accepted')`,
        [
          learner.enrollmentId,
          record.subject_id,
          record.school_year_id,
          period,
          result.quarterlyGrade,
          actor.id,
          record.id
        ]
      );
    }
    await client.query(
      `UPDATE class_records SET status = 'submitted', updated_by = $1, updated_at = now() WHERE id = $2`,
      [actor.id, record.id]
    );
    await client.query(
      `INSERT INTO grade_submission_reviews (submission_id, action, comments, actor_id)
       VALUES ($1, $2, $3, $4)`,
      [
        submissionId,
        version > 1 ? "resubmitted" : "submitted",
        optionalString(payload.notes, "Submission notes", { max: 1000 }),
        actor.id
      ]
    );
    await client.query("COMMIT");

    await auditService.record({
      userId: actor.id,
      districtId: actor.districtId,
      ipAddress: meta && meta.ip,
      action: version > 1 ? "grade_submission.resubmitted" : "grade_submission.submitted",
      entityType: "grade_submission",
      entityId: submissionId,
      details: {
        classRecordId: Number(record.id),
        sectionId: Number(record.section_id),
        subjectId: Number(record.subject_id),
        period,
        version,
        learners: roster.length
      }
    });
    await notify(
      record.adviser_id,
      "Quarterly grades submitted for review",
      `${record.teacher_name || "A subject teacher"} submitted ${record.subject_name} grades for ${record.section_name}, ${PERIOD_LABEL[period]}, ${record.school_year_name}. Review the submission in Adviser Consolidation.`
    );
    return recordDetail(actor, record.id);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function loadSubmission(actor, submissionId, runner = { query }) {
  const result = await runner.query(
    `SELECT gs.*, cr.teacher_id, cr.template_id, cr.assignment_id,
            sec.adviser_id, sec.name AS section_name, sec.grade_level_id,
            gl.name AS grade_level_name, sub.name AS subject_name, sub.code AS subject_code,
            sch.school_name, sch.district_id, y.name AS school_year_name,
            teacher.full_name AS teacher_name, adviser.full_name AS adviser_name
     FROM grade_submissions gs
     JOIN class_records cr ON cr.id = gs.class_record_id
     JOIN sections sec ON sec.id = gs.section_id
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     JOIN subjects sub ON sub.id = gs.subject_id
     JOIN schools sch ON sch.id = gs.school_id
     JOIN school_years y ON y.id = gs.school_year_id
     LEFT JOIN users teacher ON teacher.id = gs.teacher_id
     LEFT JOIN users adviser ON adviser.id = gs.adviser_id
     WHERE gs.id = $1`,
    [submissionId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new HttpError(404, "Grade submission not found.", "SUBMISSION_NOT_FOUND");
  }
  assertRecordScope(actor, {
    school_id: row.school_id,
    district_id: row.district_id,
    teacher_id: row.teacher_id,
    adviser_id: row.adviser_id
  });
  return row;
}

async function submissionDetail(actor, submissionId) {
  assertCan(actor, "grade_submissions", "access");
  const row = await loadSubmission(actor, submissionId);
  const canReviewRow = canReview(actor, row);
  const isOwner = Number(row.teacher_id) === Number(actor.id);
  if (!canReviewRow && !isOwner && !SCHOOL_REVIEW_ROLES.includes(actor.role)) {
    throw new HttpError(
      403,
      "Only the section adviser, school head, or an administrator may review this submission.",
      "SUBMISSION_FORBIDDEN"
    );
  }
  const [items, reviews] = await Promise.all([
    query(
      `SELECT gi.*, l.lrn, l.last_name, l.first_name, l.middle_name, l.extension_name
       FROM grade_submission_items gi
       JOIN learners l ON l.id = gi.learner_id
       WHERE gi.submission_id = $1
       ORDER BY l.last_name ASC, l.first_name ASC`,
      [submissionId]
    ),
    query(
      `SELECT gr.*, u.full_name AS actor_name
       FROM grade_submission_reviews gr
       LEFT JOIN users u ON u.id = gr.actor_id
       WHERE gr.submission_id = $1
       ORDER BY gr.created_at ASC, gr.id ASC`,
      [submissionId]
    )
  ]);
  return {
    submission: {
      ...serializeSubmission(row),
      sectionName: row.section_name,
      gradeLevelName: row.grade_level_name,
      subjectName: row.subject_name,
      subjectCode: row.subject_code,
      schoolName: row.school_name,
      schoolYearName: row.school_year_name,
      teacherName: row.teacher_name,
      adviserName: row.adviser_name,
      reviewNotes: row.review_notes
    },
    items: items.rows.map((item) => ({
      enrollmentId: Number(item.enrollment_id),
      learnerId: Number(item.learner_id),
      lrn: item.lrn,
      fullName: [item.first_name, item.middle_name, item.last_name, item.extension_name]
        .filter(Boolean)
        .join(" "),
      quarterlyGrade: item.quarterly_grade === null ? null : Number(item.quarterly_grade),
      initialGrade: item.initial_grade === null ? null : Number(item.initial_grade),
      breakdown: item.breakdown
    })),
    reviews: reviews.rows.map((review) => ({
      id: Number(review.id),
      action: review.action,
      comments: review.comments,
      actorName: review.actor_name,
      createdAt: review.created_at
    })),
    canReview: canReviewRow
  };
}

async function returnSubmission(actor, submissionId, payload, meta) {
  assertCan(actor, "grade_submissions", "edit");
  const row = await loadSubmission(actor, submissionId);
  if (!canReview(actor, row)) {
    throw new HttpError(
      403,
      "Only the section adviser, school head, or an authorized administrator may return a submission.",
      "SUBMISSION_REVIEW_FORBIDDEN"
    );
  }
  if (!["submitted", "under_review"].includes(row.status)) {
    throw new HttpError(
      409,
      "Only a submitted grade set can be returned for correction.",
      "SUBMISSION_STATE"
    );
  }
  const reason = requireString(payload.reason || payload.comments, "Return reason", {
    min: 5,
    max: 1000
  });
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE grade_submissions
       SET status = 'returned', reviewed_by = $1, reviewed_at = now(),
           review_notes = $2, updated_at = now()
       WHERE id = $3`,
      [actor.id, reason, submissionId]
    );
    await client.query(
      `UPDATE class_record_grades
       SET status = 'draft', updated_at = now()
       WHERE class_record_id = $1 AND period = $2 AND status = 'submitted'`,
      [row.class_record_id, row.period]
    );
    await client.query(
      `UPDATE grade_records
       SET status = 'draft', submitted_by = NULL, submitted_at = NULL,
           updated_by = $1, updated_at = now()
       WHERE class_record_id = $2 AND period = $3 AND status = 'submitted'`,
      [actor.id, row.class_record_id, row.period]
    );
    await client.query(
      `UPDATE class_records SET status = 'returned', updated_by = $1, updated_at = now()
       WHERE id = $2`,
      [actor.id, row.class_record_id]
    );
    await client.query(
      `INSERT INTO grade_submission_reviews (submission_id, action, comments, actor_id)
       VALUES ($1, 'returned', $2, $3)`,
      [submissionId, reason, actor.id]
    );
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
    action: "grade_submission.returned",
    entityType: "grade_submission",
    entityId: submissionId,
    details: {
      classRecordId: Number(row.class_record_id),
      period: row.period,
      reason
    }
  });
  await notify(
    row.teacher_id,
    "Quarterly grades returned for correction",
    `${row.subject_name} grades for ${row.section_name}, ${PERIOD_LABEL[row.period]}, were returned by ${actor.fullName}. Reason: ${reason}`,
  );
  return submissionDetail(actor, submissionId);
}

async function acceptSubmission(actor, submissionId, payload, meta) {
  assertCan(actor, "grade_submissions", "edit");
  const row = await loadSubmission(actor, submissionId);
  if (!canReview(actor, row)) {
    throw new HttpError(
      403,
      "Only the section adviser, school head, or an authorized administrator may accept a submission.",
      "SUBMISSION_REVIEW_FORBIDDEN"
    );
  }
  if (!["submitted", "under_review"].includes(row.status)) {
    throw new HttpError(
      409,
      "Only a submitted grade set can be accepted.",
      "SUBMISSION_STATE"
    );
  }
  const items = await query(
    `SELECT gi.* FROM grade_submission_items gi
     JOIN enrollments e ON e.id = gi.enrollment_id
     WHERE gi.submission_id = $1`,
    [submissionId]
  );
  const roster = await recordRoster(
    { id: row.section_id, school_id: row.school_id },
    row.school_year_id
  );
  if (items.rows.length !== roster.length) {
    throw new HttpError(
      409,
      "The submitted grade set does not cover every enrolled learner. Return it for correction.",
      "SUBMISSION_INCOMPLETE"
    );
  }
  const missing = items.rows.filter((item) => item.quarterly_grade === null);
  if (missing.length) {
    throw new HttpError(
      409,
      "The submitted grade set contains learners without a quarterly grade. Return it for correction.",
      "SUBMISSION_INCOMPLETE"
    );
  }
  const policy = await gradeService.policyFor(
    row.school_id,
    row.school_year_id,
    row.grade_level_id
  );
  const client = await getClient();
  let finals = null;
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE grade_submissions
       SET status = 'accepted', reviewed_by = $1, reviewed_at = now(),
           review_notes = $2, updated_at = now()
       WHERE id = $3`,
      [actor.id, optionalString(payload.comments, "Review comments", { max: 1000 }), submissionId]
    );
    await client.query(
      `UPDATE class_record_grades
       SET status = 'accepted', updated_at = now()
       WHERE class_record_id = $1 AND period = $2`,
      [row.class_record_id, row.period]
    );
    for (const item of items.rows) {
      await client.query(
        `UPDATE grade_records
         SET status = 'finalized', finalized_by = $1, finalized_at = now(),
             class_record_id = $2, source = 'class_record',
             updated_by = $1, updated_at = now()
         WHERE enrollment_id = $3 AND subject_id = $4 AND period = $5`,
        [actor.id, row.class_record_id, item.enrollment_id, row.subject_id, row.period]
      );
    }
    const accepted = await client.query(
      `SELECT COUNT(*)::int AS total FROM grade_submissions
       WHERE class_record_id = $1 AND status IN ('accepted', 'finalized')`,
      [row.class_record_id]
    );
    const allAccepted = Number(accepted.rows[0].total) === 4;
    await client.query(
      `UPDATE class_records SET status = $1, updated_by = $2, updated_at = now() WHERE id = $3`,
      [allAccepted ? "finalized" : "accepted", actor.id, row.class_record_id]
    );
    await client.query(
      `INSERT INTO grade_submission_reviews (submission_id, action, comments, actor_id)
       VALUES ($1, 'accepted', $2, $3)`,
      [submissionId, optionalString(payload.comments, "Review comments", { max: 1000 }), actor.id]
    );
    if (allAccepted) {
      finals = await gradeService.computeFinal(
        { id: row.section_id },
        row.subject_id,
        row.school_year_id,
        policy,
        client
      );
      await client.query(
        `UPDATE grade_submissions SET status = 'finalized' WHERE class_record_id = $1`,
        [row.class_record_id]
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
    action: "grade_submission.accepted",
    entityType: "grade_submission",
    entityId: submissionId,
    details: {
      classRecordId: Number(row.class_record_id),
      period: row.period,
      learners: items.rows.length,
      finalsComputed: finals ? finals.computed : 0
    }
  });
  await notify(
    row.teacher_id,
    "Quarterly grades accepted",
    `${row.subject_name} grades for ${row.section_name}, ${PERIOD_LABEL[row.period]}, were accepted by ${actor.fullName}.`
  );
  return submissionDetail(actor, submissionId);
}

async function adviserOverview(actor, filters) {
  assertCan(actor, "grade_submissions", "access");
  const year = await resolveSchoolYear(filters.schoolYearId);
  const params = [year.id];
  const conditions = ["sec.school_year_id = $1"];
  const scope = schoolScopeSql(actor, "sch", params, filters.schoolId);
  if (scope) {
    conditions.push(scope);
  }
  if (actor.role === "teacher" || actor.role === "adviser") {
    params.push(actor.id);
    conditions.push(`sec.adviser_id = $${params.length}`);
  }
  if (filters.sectionId) {
    params.push(Number(filters.sectionId));
    conditions.push(`sec.id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${String(filters.search).trim().toLowerCase()}%`);
    conditions.push(`(lower(sec.name) LIKE $${params.length} OR lower(gl.name) LIKE $${params.length})`);
  }
  const sections = await query(
    `SELECT sec.id, sec.name, sec.room, sec.adviser_id, sec.school_id, sec.grade_level_id,
            gl.name AS grade_level_name, gl.sort_order,
            sch.school_name, sch.school_code, sch.district_id,
            adv.full_name AS adviser_name,
            (SELECT COUNT(*)::int FROM enrollments e
             WHERE e.section_id = sec.id AND e.school_year_id = $1
               AND e.status NOT IN ('transferred_out', 'archived')) AS learner_count
     FROM sections sec
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     JOIN schools sch ON sch.id = sec.school_id
     LEFT JOIN users adv ON adv.id = sec.adviser_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY sch.school_name ASC, gl.sort_order ASC, sec.name ASC`,
    params
  );
  const sectionIds = sections.rows.map((row) => Number(row.id));
  let submissionRows = [];
  let cardRows = [];
  if (sectionIds.length) {
    const [subs, cards] = await Promise.all([
      query(
        `SELECT gs.id, gs.section_id, gs.class_record_id, gs.subject_id, gs.period, gs.status,
                gs.version, gs.reviewed_at, gs.review_notes,
                u.full_name AS teacher_name
         FROM grade_submissions gs
         LEFT JOIN users u ON u.id = gs.teacher_id
         WHERE gs.school_year_id = $1 AND gs.section_id = ANY($2::bigint[])`,
        [year.id, sectionIds]
      ),
      query(
        `SELECT rc.section_id, rc.status, rc.general_average, rc.version, rc.finalized_at
         FROM report_cards rc
         WHERE rc.school_year_id = $1 AND rc.section_id = ANY($2::bigint[])`,
        [year.id, sectionIds]
      )
    ]);
    submissionRows = subs.rows;
    cardRows = cards.rows;
  }
  const submissionsBySection = new Map();
  submissionRows.forEach((row) => {
    const key = String(row.section_id);
    if (!submissionsBySection.has(key)) submissionsBySection.set(key, []);
    submissionsBySection.get(key).push(row);
  });
  const cardsBySection = new Map();
  cardRows.forEach((row) => {
    const key = String(row.section_id);
    if (!cardsBySection.has(key)) cardsBySection.set(key, []);
    cardsBySection.get(key).push(row);
  });
  const result = [];
  for (const section of sections.rows) {
    const subjects = await query(
      `SELECT sub.id, sub.code, sub.name,
              ta.id AS assignment_id, ta.teacher_id, u.full_name AS teacher_name,
              cr.id AS class_record_id, cr.status AS class_record_status
       FROM subjects sub
       LEFT JOIN teacher_assignments ta
         ON ta.subject_id = sub.id AND ta.section_id = $1 AND ta.school_year_id = $2
       LEFT JOIN users u ON u.id = ta.teacher_id
       LEFT JOIN class_records cr
         ON cr.section_id = $1 AND cr.subject_id = sub.id AND cr.school_year_id = $2
       WHERE sub.school_id = $3 AND (sub.grade_level_id = $4 OR sub.grade_level_id IS NULL)
       ORDER BY sub.name ASC, sub.code ASC`,
      [section.id, year.id, section.school_id, section.grade_level_id]
    );
    const subs = submissionsBySection.get(String(section.id)) || [];
    const cards = cardsBySection.get(String(section.id)) || [];
    const matrix = (subjects.rows || []).map((subject) => {
      const periods = {};
      PERIODS.forEach((period) => {
        const submission = subs.find(
          (row) =>
            Number(row.subject_id) === Number(subject.id) && row.period === period
        );
        periods[period] = submission
          ? {
              status: submission.status,
              version: Number(submission.version),
              submissionId: Number(submission.id),
              reviewedAt: submission.reviewed_at,
              reviewNotes: submission.review_notes,
              teacherName: submission.teacher_name
            }
          : { status: "not_started", version: 0, submissionId: null };
      });
      return {
        subjectId: Number(subject.id),
        subjectCode: subject.code,
        subjectName: subject.name,
        teacherId: subject.teacher_id ? Number(subject.teacher_id) : null,
        teacherName: subject.teacher_name,
        classRecordId: subject.class_record_id ? Number(subject.class_record_id) : null,
        classRecordStatus: subject.class_record_status,
        periods
      };
    });
    result.push({
      section: {
        id: Number(section.id),
        name: section.name,
        room: section.room,
        gradeLevelId: Number(section.grade_level_id),
        gradeLevelName: section.grade_level_name,
        adviserId: section.adviser_id ? Number(section.adviser_id) : null,
        adviserName: section.adviser_name,
        schoolName: section.school_name,
        schoolCode: section.school_code,
        learnerCount: Number(section.learner_count)
      },
      subjects: matrix,
      reportCards: {
        total: cards.length,
        finalized: cards.filter((card) => ["finalized", "issued"].includes(card.status)).length,
        draft: cards.filter((card) => ["draft", "reopened", "submitted", "approved"].includes(card.status)).length
      }
    });
  }
  return {
    schoolYear: { id: Number(year.id), name: year.name, isCurrent: year.is_current },
    sections: result
  };
}

async function consolidation(actor, options) {
  assertCan(actor, "report_cards", "access");
  const section = await sectionForActor(actor, options.sectionId);
  const year = await resolveSchoolYear(options.schoolYearId || section.school_year_id);
  if (Number(section.school_year_id) !== Number(year.id)) {
    throw new HttpError(409, "That section belongs to a different school year.", "SECTION_YEAR_MISMATCH");
  }
  const [roster, subjects, grades, cards] = await Promise.all([
    recordRoster(section, year.id),
    query(
      `SELECT sub.id, sub.code, sub.name,
              ta.id AS assignment_id, ta.teacher_id, u.full_name AS teacher_name,
              cr.id AS class_record_id, cr.status AS class_record_status
       FROM subjects sub
       LEFT JOIN teacher_assignments ta
         ON ta.subject_id = sub.id AND ta.section_id = $1 AND ta.school_year_id = $2
       LEFT JOIN users u ON u.id = ta.teacher_id
       LEFT JOIN class_records cr
         ON cr.section_id = $1 AND cr.subject_id = sub.id AND cr.school_year_id = $2
       WHERE sub.school_id = $3 AND (sub.grade_level_id = $4 OR sub.grade_level_id IS NULL)
       ORDER BY sub.name ASC, sub.code ASC`,
      [section.id, year.id, section.school_id, section.grade_level_id]
    ),
    query(
      `SELECT gr.enrollment_id, gr.subject_id, gr.period, gr.grade, gr.status
       FROM grade_records gr
       JOIN enrollments e ON e.id = gr.enrollment_id
       WHERE e.section_id = $1 AND e.school_year_id = $2
         AND gr.period IN ('q1','q2','q3','q4','final')`,
      [section.id, year.id]
    ),
    query(
      `SELECT rc.* FROM report_cards rc
       WHERE rc.section_id = $1 AND rc.school_year_id = $2`,
      [section.id, year.id]
    )
  ]);
  const gradeIndex = new Map();
  grades.rows.forEach((row) => {
    gradeIndex.set(
      `${row.enrollment_id}:${row.subject_id}:${row.period}`,
      { grade: Number(row.grade), status: row.status }
    );
  });
  const cardIndex = new Map(cards.rows.map((row) => [String(row.enrollment_id), row]));
  const subjectRows = subjects.rows.map((subject) => ({
    subjectId: Number(subject.id),
    subjectCode: subject.code,
    subjectName: subject.name,
    teacherId: subject.teacher_id ? Number(subject.teacher_id) : null,
    teacherName: subject.teacher_name,
    classRecordId: subject.class_record_id ? Number(subject.class_record_id) : null,
    classRecordStatus: subject.class_record_status
  }));
  const learners = roster.map((learner) => {
    const subjectsOut = subjectRows.map((subject) => {
      const quarters = {};
      let accepted = 0;
      PERIODS.forEach((period) => {
        const row = gradeIndex.get(`${learner.enrollmentId}:${subject.subjectId}:${period}`);
        quarters[period] = row
          ? {
              grade: row.grade,
              status: row.status,
              accepted: ["finalized", "accepted"].includes(row.status)
            }
          : { grade: null, status: "missing", accepted: false };
        if (quarters[period].accepted) accepted += 1;
      });
      const final = gradeIndex.get(`${learner.enrollmentId}:${subject.subjectId}:final`);
      return {
        ...subject,
        quarters,
        acceptedQuarters: accepted,
        finalGrade: final ? final.grade : null,
        finalStatus: final ? final.status : "missing"
      };
    });
    const missingSubjects = subjectsOut
      .filter((subject) => subject.finalStatus !== "finalized")
      .map((subject) => subject.subjectName);
    const card = cardIndex.get(String(learner.enrollmentId));
    return {
      enrollmentId: learner.enrollmentId,
      learnerId: learner.learnerId,
      lrn: learner.lrn,
      fullName: learner.fullName,
      subjects: subjectsOut,
      missingSubjects,
      readyForReportCard: missingSubjects.length === 0,
      reportCard: card
        ? {
            id: Number(card.id),
            status: card.status,
            version: Number(card.version),
            generalAverage:
              card.general_average === null ? null : Number(card.general_average),
            finalizedAt: card.finalized_at
          }
        : null
    };
  });
  return {
    section: {
      id: Number(section.id),
      name: section.name,
      gradeLevelName: section.grade_level_name,
      schoolId: Number(section.school_id),
      schoolName: section.school_name,
      schoolYearId: Number(year.id),
      schoolYearName: year.name,
      adviserId: section.adviser_id ? Number(section.adviser_id) : null,
      adviserName: section.adviser_name
    },
    subjects: subjectRows,
    learners,
    summary: {
      learnerCount: learners.length,
      ready: learners.filter((learner) => learner.readyForReportCard).length,
      incomplete: learners.filter((learner) => !learner.readyForReportCard).length,
      reportCardsFinalized: cards.rows.filter((card) =>
        ["finalized", "issued"].includes(card.status)
      ).length
    }
  };
}

async function listTemplates(actor, filters) {
  assertCan(actor, "class_records", "access");
  const school = await resolveSchool(actor, filters.schoolId);
  const params = [school.id];
  const conditions = ["(t.school_id = $1 OR t.school_id IS NULL)"];
  if (filters.gradeLevelId) {
    params.push(Number(filters.gradeLevelId));
    conditions.push(`(t.grade_level_id = $${params.length} OR t.grade_level_id IS NULL)`);
  }
  if (filters.subjectId) {
    params.push(Number(filters.subjectId));
    conditions.push(`(t.subject_id = $${params.length} OR t.subject_id IS NULL)`);
  }
  const result = await query(
    `SELECT t.*, cv.name AS curriculum_version_name, cv.is_verified AS curriculum_verified,
            c.name AS curriculum_name, gl.name AS grade_level_name, sub.name AS subject_name
     FROM class_record_templates t
     LEFT JOIN curriculum_versions cv ON cv.id = t.curriculum_version_id
     LEFT JOIN curricula c ON c.id = cv.curriculum_id
     LEFT JOIN grade_levels gl ON gl.id = t.grade_level_id
     LEFT JOIN subjects sub ON sub.id = t.subject_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY (t.school_id IS NULL) ASC, t.name ASC, t.id ASC`,
    params
  );
  const curricula = await query(
    `SELECT c.id, c.code, c.name, cv.id AS version_id, cv.version_code,
            cv.name AS version_name, cv.is_verified, cv.source_note
     FROM curricula c
     JOIN curriculum_versions cv ON cv.curriculum_id = c.id AND cv.is_active
     WHERE c.is_active
     ORDER BY c.name ASC, cv.version_code ASC`
  );
  return {
    school: { id: Number(school.id), name: school.school_name, code: school.school_code },
    templates: result.rows.map((row) => ({
      ...serializeTemplate(row),
      gradeLevelName: row.grade_level_name,
      subjectName: row.subject_name
    })),
    curricula: curricula.rows.map((row) => ({
      curriculumId: Number(row.id),
      code: row.code,
      name: row.name,
      versionId: Number(row.version_id),
      versionCode: row.version_code,
      versionName: row.version_name,
      verified: Boolean(row.is_verified),
      sourceNote: row.source_note
    })),
    canEdit: canDo(actor, "class_record_templates", "edit") && CONFIG_ROLES.includes(actor.role)
  };
}

async function saveTemplate(actor, payload, meta) {
  assertCan(actor, "class_record_templates", "edit");
  if (!CONFIG_ROLES.includes(actor.role)) {
    throw new HttpError(
      403,
      "Only a school head, district administrator, or system administrator may configure class record weights.",
      "TEMPLATE_CONFIG_FORBIDDEN"
    );
  }
  const school = await resolveSchool(actor, payload.schoolId);
  const gradeLevelId = payload.gradeLevelId ? requireIdParam(payload.gradeLevelId, "Grade level") : null;
  const subjectId = payload.subjectId ? requireIdParam(payload.subjectId, "Subject") : null;
  if (gradeLevelId) {
    const check = await query(
      "SELECT 1 FROM grade_levels WHERE id = $1 AND school_id = $2",
      [gradeLevelId, school.id]
    );
    if (!check.rows[0]) {
      throw new HttpError(404, "Grade level not found in this school.", "GRADE_LEVEL_NOT_FOUND");
    }
  }
  if (subjectId) {
    const check = await query(
      "SELECT 1 FROM subjects WHERE id = $1 AND school_id = $2",
      [subjectId, school.id]
    );
    if (!check.rows[0]) {
      throw new HttpError(404, "Subject not found in this school.", "SUBJECT_NOT_FOUND");
    }
  }
  const config = normalizeConfig(payload.config);
  const issues = configIssues(config);
  if (issues.length) {
    throw new HttpError(
      400,
      "The class record configuration is incomplete.",
      "TEMPLATE_CONFIG_INVALID",
      { issues }
    );
  }
  const name = optionalString(payload.name, "Template name", { min: 2, max: 160 }) ||
    "School class record configuration";
  const sourceNote = requireString(payload.sourceNote, "Policy source note", { min: 5, max: 500 });
  const curriculumVersionId = payload.curriculumVersionId
    ? requireIdParam(payload.curriculumVersionId, "Curriculum version")
    : null;
  const existing = await query(
    `SELECT * FROM class_record_templates
     WHERE school_id = $1
       AND COALESCE(grade_level_id, 0) = COALESCE($2, 0)
       AND COALESCE(subject_id, 0) = COALESCE($3, 0)
       AND version = 'school-1'`,
    [school.id, gradeLevelId, subjectId]
  );
  let id;
  if (existing.rows[0]) {
    id = Number(existing.rows[0].id);
    await query(
      `UPDATE class_record_templates
       SET name = $1, source_note = $2, config = $3::jsonb,
           curriculum_version_id = COALESCE($4, curriculum_version_id),
           is_active = TRUE, updated_at = now()
       WHERE id = $5`,
      [name, sourceNote, JSON.stringify(config), curriculumVersionId, id]
    );
  } else {
    const inserted = await query(
      `INSERT INTO class_record_templates
         (school_id, curriculum_version_id, grade_level_id, subject_id, name, version,
          is_active, is_official, source_note, config, created_by)
       VALUES ($1, $2, $3, $4, $5, 'school-1', TRUE, FALSE, $6, $7::jsonb, $8)
       RETURNING id`,
      [
        school.id,
        curriculumVersionId,
        gradeLevelId,
        subjectId,
        name,
        sourceNote,
        JSON.stringify(config),
        actor.id
      ]
    );
    id = Number(inserted.rows[0].id);
  }
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: "class_record.template_configured",
    entityType: "class_record_template",
    entityId: id,
    details: {
      schoolId: Number(school.id),
      gradeLevelId,
      subjectId,
      sourceNote,
      components: config.components.map((component) => ({
        key: component.key,
        weight: component.weight
      }))
    }
  });
  return listTemplates(actor, {
    schoolId: school.id,
    gradeLevelId,
    subjectId
  });
}

module.exports = {
  PERIODS,
  PERIOD_LABEL,
  normalizeConfig,
  configIssues,
  teacherDashboard,
  initializeRecord,
  recordDetail,
  saveAssessment,
  archiveAssessment,
  saveScores,
  submitRecord,
  submissionDetail,
  returnSubmission,
  acceptSubmission,
  adviserOverview,
  consolidation,
  listTemplates,
  saveTemplate
};
