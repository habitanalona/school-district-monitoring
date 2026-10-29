"use strict";

const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const {
  requireIdParam,
  requireString,
  optionalString,
  requireEnum,
  requireInteger,
  fail
} = require("../utils/validators");
const {
  assertCan,
  canDo,
  resolveSchool,
  resolveSchoolYear,
  schoolScopeSql
} = require("../utils/formsAccess");
const formDataService = require("./formDataService");
const formRenderer = require("./formRenderer");
const auditService = require("./auditService");

const STATUSES = [
  "draft",
  "in_progress",
  "ready_for_validation",
  "validation_failed",
  "submitted",
  "returned",
  "approved",
  "finalized"
];

const STATUS_LABEL = {
  draft: "Draft",
  in_progress: "In Progress",
  ready_for_validation: "Ready for Validation",
  validation_failed: "Validation Failed",
  submitted: "Submitted",
  returned: "Returned for Correction",
  approved: "Approved",
  finalized: "Finalized"
};

const REVIEW_ACTIONS = ["submit", "return", "approve", "reject", "finalize"];

const REVIEW_ROLES = ["system_admin", "district_admin", "psds", "school_head"];
const FINALIZE_ROLES = ["system_admin", "district_admin"];

const ORIENTATIONS = ["portrait", "landscape"];
const PAPER_SIZES = ["A4", "Letter", "Legal", "Folio"];

function formCode(value) {
  return formDataService.definitionFor(value).code;
}

function listDefinitions() {
  return formDataService.FORM_DEFINITIONS.map((definition) => ({
    code: definition.code,
    title: definition.title,
    purpose: definition.purpose,
    description: definition.description,
    module: definition.module,
    restricted: Boolean(definition.restricted),
    requiresSection: definition.requiresSection,
    usesMonth: definition.month,
    usesLearner: definition.learner,
    orientation: definition.orientation,
    paperSize: definition.paperSize
  }));
}

function monthOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const text = String(value).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) {
    fail("Reporting month must use the YYYY-MM format.", { field: "month" });
  }
  return text;
}

function formatDate(value) {
  return value ? String(value).slice(0, 10) : null;
}

function serializeSubmission(row) {
  if (!row) return null;
  const validation = row.validation || {};
  return {
    id: Number(row.id),
    formCode: row.form_code,
    formTitle: formDataService.FORM_MAP[row.form_code]
      ? formDataService.FORM_MAP[row.form_code].title
      : row.form_code.toUpperCase(),
    schoolId: Number(row.school_id),
    schoolName: row.school_name || null,
    districtName: row.district_name || null,
    schoolYearId: Number(row.school_year_id),
    schoolYearName: row.school_year_name || null,
    gradeLevelId: row.grade_level_id ? Number(row.grade_level_id) : null,
    gradeLevelName: row.grade_level_name || null,
    sectionId: row.section_id ? Number(row.section_id) : null,
    sectionName: row.section_name || null,
    learnerId: row.learner_id ? Number(row.learner_id) : null,
    learnerName: row.learner_lrn
      ? [row.learner_first_name, row.learner_middle_name, row.learner_last_name, row.learner_extension_name]
          .filter(Boolean)
          .join(" ")
      : null,
    learnerLrn: row.learner_lrn || null,
    period: row.period || null,
    status: row.status,
    statusLabel: STATUS_LABEL[row.status] || row.status,
    completeness: Number(row.completeness || 0),
    validation: {
      complete: Boolean(validation.complete),
      completeness: Number(validation.completeness || row.completeness || 0),
      checked: Number(validation.checked || 0),
      errorCount: Array.isArray(validation.errors) ? validation.errors.length : 0,
      warningCount: Array.isArray(validation.warnings) ? validation.warnings.length : 0,
      errors: Array.isArray(validation.errors) ? validation.errors : [],
      warnings: Array.isArray(validation.warnings) ? validation.warnings : [],
      generatedAt: validation.generatedAt || null
    },
    generatedAt: row.generated_at,
    generatedBy: row.generated_by ? Number(row.generated_by) : null,
    generatedByName: row.generated_by_name || null,
    submittedAt: row.submitted_at,
    submittedBy: row.submitted_by ? Number(row.submitted_by) : null,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by ? Number(row.reviewed_by) : null,
    reviewedByName: row.reviewed_by_name || null,
    reviewNotes: row.review_notes || null,
    version: Number(row.version || 1),
    hasSnapshot: Boolean(row.snapshot),
    updatedAt: row.updated_at
  };
}

const SUBMISSION_SELECT = `
  SELECT fs.*, s.school_name, d.district_name, y.name AS school_year_name,
         gl.name AS grade_level_name, sec.name AS section_name,
         l.lrn AS learner_lrn, l.last_name AS learner_last_name,
         l.first_name AS learner_first_name, l.middle_name AS learner_middle_name,
         l.extension_name AS learner_extension_name,
         gb.full_name AS generated_by_name, rb.full_name AS reviewed_by_name
  FROM form_submissions fs
  JOIN schools s ON s.id = fs.school_id
  JOIN districts d ON d.id = s.district_id
  JOIN school_years y ON y.id = fs.school_year_id
  LEFT JOIN grade_levels gl ON gl.id = fs.grade_level_id
  LEFT JOIN sections sec ON sec.id = fs.section_id
  LEFT JOIN learners l ON l.id = fs.learner_id
  LEFT JOIN users gb ON gb.id = fs.generated_by
  LEFT JOIN users rb ON rb.id = fs.reviewed_by`;

async function assertFormModule(actor, code, action = "access") {
  const definition = formDataService.definitionFor(code);
  if (definition.restricted) {
    assertCan(actor, "health", "access", "You do not have access to health and nutrition records.");
  }
  if (definition.module) {
    assertCan(
      actor,
      definition.module,
      action,
      `You do not have access to the source records required for ${definition.code.toUpperCase()}.`
    );
  }
}

async function findSubmission(actor, id) {
  assertCan(actor, "school_forms", "access");
  const result = await query(`${SUBMISSION_SELECT} WHERE fs.id = $1`, [id]);
  const row = result.rows[0];
  if (!row) {
    throw new HttpError(404, "Form submission not found.", "SUBMISSION_NOT_FOUND");
  }
  await resolveSchool(actor, row.school_id);
  await assertFormModule(actor, row.form_code, "access");
  return row;
}

async function listCards(actor, filters = {}) {
  assertCan(actor, "school_forms", "access");
  const school = await resolveSchool(actor, filters.schoolId);
  const year = await resolveSchoolYear(filters.schoolYearId);
  const month = monthOrNull(filters.month);
  const submissions = await query(
    `${SUBMISSION_SELECT}
     WHERE fs.school_id = $1 AND fs.school_year_id = $2
       AND ($3::text IS NULL OR fs.period = $3 OR fs.period IS NULL)
     ORDER BY fs.updated_at DESC`,
    [school.id, year.id, month]
  );
  const latest = new Map();
  const learnerOnly = new Map();
  submissions.rows.forEach((row) => {
    const key = row.form_code;
    const bucket = row.learner_id ? learnerOnly : latest;
    const existing = bucket.get(key);
    if (!existing) {
      bucket.set(key, row);
      return;
    }
    const matches = month ? row.period === month : true;
    const existingMatches = month ? existing.period === month : true;
    if (matches && !existingMatches) {
      bucket.set(key, row);
    }
  });
  // A learner-scoped card (SF 9/SF 10) should not stand in for the whole
  // school-year form card. Only use it when no section or school-wide
  // submission exists for that form.
  learnerOnly.forEach((row, key) => {
    if (!latest.has(key)) {
      latest.set(key, row);
    }
  });
  const deadlines = await listDeadlines(actor, {
    schoolYearId: year.id,
    schoolId: school.id,
    month
  });
  const deadlineMap = new Map();
  deadlines.forEach((deadline) => {
    const key = `${deadline.formCode}:${deadline.period || ""}`;
    if (!deadlineMap.has(key) || deadlineMap.get(key).dueDate > deadline.dueDate) {
      deadlineMap.set(key, deadline);
    }
  });
  const cards = formDataService.FORM_DEFINITIONS.map((definition) => {
    const submission = latest.get(definition.code);
    const deadline =
      deadlineMap.get(`${definition.code}:${month || ""}`) ||
      deadlineMap.get(`${definition.code}:`) ||
      null;
    return {
      code: definition.code,
      title: definition.title,
      purpose: definition.purpose,
      description: definition.description,
      module: definition.module,
      restricted: Boolean(definition.restricted),
      requiresSection: definition.requiresSection,
      usesMonth: definition.month,
      usesLearner: definition.learner,
      submission: serializeSubmission(submission),
      deadline,
      overdue: Boolean(
        deadline &&
          deadline.overdue &&
          (!submission || !["approved", "finalized"].includes(submission.status))
      )
    };
  });
  return {
    school: { id: Number(school.id), name: school.school_name, districtName: school.district_name },
    schoolYear: { id: Number(year.id), name: year.name },
    month,
    cards
  };
}

async function generate(actor, code, params = {}, meta = {}) {
  assertCan(actor, "school_forms", "add");
  const definition = formDataService.definitionFor(code);
  await assertFormModule(actor, definition.code, "access");
  const { data, ctx } = await formDataService.buildForm(actor, definition.code, params);
  const scope = {
    formCode: definition.code,
    schoolId: Number(ctx.school.id),
    schoolYearId: Number(ctx.year.id),
    gradeLevelId: ctx.gradeLevel ? Number(ctx.gradeLevel.id) : null,
    sectionId: ctx.section ? Number(ctx.section.id) : null,
    learnerId: ctx.learner ? Number(ctx.learner.id) : null,
    period: ctx.month || null
  };
  const existing = await query(
    `${SUBMISSION_SELECT}
     WHERE fs.form_code = $1 AND fs.school_id = $2 AND fs.school_year_id = $3
       AND COALESCE(fs.grade_level_id, 0) = COALESCE($4::bigint, 0)
       AND COALESCE(fs.section_id, 0) = COALESCE($5::bigint, 0)
       AND COALESCE(fs.learner_id, 0) = COALESCE($6::bigint, 0)
       AND COALESCE(fs.period, '') = COALESCE($7, '')`,
    [
      scope.formCode,
      scope.schoolId,
      scope.schoolYearId,
      scope.gradeLevelId,
      scope.sectionId,
      scope.learnerId,
      scope.period
    ]
  );
  const current = existing.rows[0];
  if (current && ["approved", "finalized"].includes(current.status)) {
    throw new HttpError(
      409,
      "This form has been approved and is locked. Use the correction workflow to generate a new version.",
      "SUBMISSION_LOCKED"
    );
  }
  const status = data.validation.errors.length
    ? "validation_failed"
    : data.completeness >= 100
      ? "ready_for_validation"
      : "in_progress";
  const version = current ? Number(current.version) + 1 : 1;
  const client = await getClient();
  let submissionId;
  try {
    await client.query("BEGIN");
    if (current) {
      const updated = await client.query(
        `UPDATE form_submissions SET
           status = $1,
           completeness = $2,
           validation = $3::jsonb,
           snapshot = $4::jsonb,
           learner_id = $5,
           template_id = $6,
           generated_at = now(),
           generated_by = $7,
           submitted_by = NULL,
           submitted_at = NULL,
           reviewed_by = NULL,
           reviewed_at = NULL,
           review_notes = NULL,
           version = $8,
           updated_at = now()
         WHERE id = $9
         RETURNING id`,
        [
          status,
          data.completeness,
          JSON.stringify(data.validation),
          JSON.stringify(data),
          scope.learnerId,
          ctx.template.id,
          actor.id,
          version,
          current.id
        ]
      );
      submissionId = updated.rows[0].id;
    } else {
      const inserted = await client.query(
        `INSERT INTO form_submissions
           (form_code, school_id, school_year_id, grade_level_id, section_id, learner_id,
            period, status, completeness, validation, snapshot, template_id,
            generated_at, generated_by, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12,
                 now(), $13, $14)
         RETURNING id`,
        [
          scope.formCode,
          scope.schoolId,
          scope.schoolYearId,
          scope.gradeLevelId,
          scope.sectionId,
          scope.learnerId,
          scope.period,
          status,
          data.completeness,
          JSON.stringify(data.validation),
          JSON.stringify(data),
          ctx.template.id,
          actor.id,
          version
        ]
      );
      submissionId = inserted.rows[0].id;
    }
    await client.query(
      `INSERT INTO form_reviews (submission_id, action, comments, actor_id)
       VALUES ($1, 'generated', $2, $3)`,
      [
        submissionId,
        `Generated version ${version}. ${data.validation.errors.length} error(s), ${data.validation.warnings.length} warning(s).`,
        actor.id
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta.ip,
    action: "school_form.generate",
    entityType: "form_submission",
    entityId: submissionId,
    details: {
      formCode: scope.formCode,
      schoolId: scope.schoolId,
      schoolYearId: scope.schoolYearId,
      sectionId: scope.sectionId,
      learnerId: scope.learnerId,
      period: scope.period,
      status,
      completeness: data.completeness,
      version
    }
  });
  const saved = await query(`${SUBMISSION_SELECT} WHERE fs.id = $1`, [submissionId]);
  return {
    submission: serializeSubmission(saved.rows[0]),
    data
  };
}

async function listSubmissions(actor, filters = {}) {
  assertCan(actor, "school_forms", "access");
  const params = [];
  const conditions = ["1 = 1"];
  const scope = schoolScopeSql(actor, "s", params, filters.schoolId);
  if (scope) conditions.push(scope);
  if (filters.formCode) {
    params.push(formCode(filters.formCode));
    conditions.push(`fs.form_code = $${params.length}`);
  }
  if (filters.schoolYearId) {
    params.push(filters.schoolYearId);
    conditions.push(`fs.school_year_id = $${params.length}`);
  }
  if (filters.learnerId) {
    params.push(filters.learnerId);
    conditions.push(`fs.learner_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(requireEnum(filters.status, "Status", STATUSES));
    conditions.push(`fs.status = $${params.length}`);
  }
  if (filters.period) {
    params.push(monthOrNull(filters.period));
    conditions.push(`fs.period = $${params.length}`);
  }
  const result = await query(
    `${SUBMISSION_SELECT}
     WHERE ${conditions.join(" AND ")}
     ORDER BY fs.updated_at DESC
     LIMIT 500`,
    params
  );
  const rows = [];
  for (const row of result.rows) {
    if (row.form_code === "sf8" && !canDo(actor, "health", "access")) continue;
    rows.push(serializeSubmission(row));
  }
  return rows;
}

async function getSubmission(actor, id) {
  const row = await findSubmission(actor, id);
  const reviews = await query(
    `SELECT fr.*, u.full_name AS actor_name FROM form_reviews fr
     LEFT JOIN users u ON u.id = fr.actor_id
     WHERE fr.submission_id = $1 ORDER BY fr.created_at ASC, fr.id ASC`,
    [id]
  );
  return {
    submission: serializeSubmission(row),
    snapshot: row.snapshot,
    reviews: reviews.rows.map((review) => ({
      id: Number(review.id),
      action: review.action,
      comments: review.comments,
      actorId: review.actor_id ? Number(review.actor_id) : null,
      actorName: review.actor_name,
      createdAt: review.created_at
    }))
  };
}

async function review(actor, id, action, payload = {}, meta = {}) {
  assertCan(actor, "school_forms", "edit");
  if (!REVIEW_ACTIONS.includes(action)) {
    throw new HttpError(400, "Unknown review action.", "INVALID_ACTION");
  }
  const row = await findSubmission(actor, id);
  const comments = optionalString(payload.comments, "Comments", { max: 2000 });
  const ACTION_ROW = {
    submit: "submitted",
    return: "returned",
    approve: "approved",
    reject: "rejected",
    finalize: "finalized"
  };
  const actionRow = ACTION_ROW[action];
  let status;
  if (action === "submit") {
    if (!["draft", "in_progress", "ready_for_validation", "validation_failed", "returned"].includes(row.status)) {
      throw new HttpError(409, `A ${row.status} form cannot be submitted again.`, "INVALID_TRANSITION");
    }
    const validation = row.validation || {};
    if (Array.isArray(validation.errors) && validation.errors.length) {
      throw new HttpError(
        409,
        "Resolve all validation errors before submitting this form.",
        "VALIDATION_FAILED"
      );
    }
    status = "submitted";
  } else if (action === "return" || action === "reject") {
    if (!REVIEW_ROLES.includes(actor.role)) {
      throw new HttpError(403, "Only authorized reviewers may return a submission.", "REVIEW_FORBIDDEN");
    }
    if (row.status !== "submitted") {
      throw new HttpError(409, "Only submitted forms can be returned for correction.", "INVALID_TRANSITION");
    }
    if (!comments) {
      fail("Provide comments explaining what must be corrected.", { field: "comments" });
    }
    status = "returned";
  } else if (action === "approve") {
    if (!REVIEW_ROLES.includes(actor.role)) {
      throw new HttpError(403, "Only authorized reviewers may approve a submission.", "REVIEW_FORBIDDEN");
    }
    if (row.status !== "submitted") {
      throw new HttpError(409, "Only submitted forms can be approved.", "INVALID_TRANSITION");
    }
    status = "approved";
  } else if (action === "finalize") {
    if (!FINALIZE_ROLES.includes(actor.role)) {
      throw new HttpError(403, "Only district administrators may finalize submissions.", "REVIEW_FORBIDDEN");
    }
    if (row.status !== "approved") {
      throw new HttpError(409, "Only approved forms can be finalized.", "INVALID_TRANSITION");
    }
    status = "finalized";
  }
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE form_submissions SET
         status = $1::text,
         submitted_by = CASE WHEN $1::text = 'submitted' THEN $2 ELSE submitted_by END,
         submitted_at = CASE WHEN $1::text = 'submitted' THEN now() ELSE submitted_at END,
         reviewed_by = CASE WHEN $1::text IN ('approved', 'returned', 'finalized') THEN $2 ELSE reviewed_by END,
         reviewed_at = CASE WHEN $1::text IN ('approved', 'returned', 'finalized') THEN now() ELSE reviewed_at END,
         review_notes = CASE WHEN $1::text IN ('approved', 'returned', 'finalized') THEN $3 ELSE review_notes END,
         updated_at = now()
       WHERE id = $4`,
      [status, actor.id, comments, id]
    );
    await client.query(
      `INSERT INTO form_reviews (submission_id, action, comments, actor_id)
       VALUES ($1, $2, $3, $4)`,
      [id, actionRow, comments, actor.id]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta.ip,
    action: `school_form.${actionRow}`,
    entityType: "form_submission",
    entityId: id,
    details: { formCode: row.form_code, schoolId: Number(row.school_id), from: row.status, to: status }
  });
  const saved = await query(`${SUBMISSION_SELECT} WHERE fs.id = $1`, [id]);
  return serializeSubmission(saved.rows[0]);
}

async function renderSubmission(actor, id, format = "html") {
  const row = await findSubmission(actor, id);
  if (!row.snapshot) {
    throw new HttpError(409, "This submission has no generated snapshot. Generate the form first.", "NO_SNAPSHOT");
  }
  const data = row.snapshot;
  data.status = row.status;
  data.statusLabel = STATUS_LABEL[row.status] || row.status;
  data.submission = {
    id: Number(row.id),
    version: Number(row.version),
    generatedAt: row.generated_at,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at
  };
  const options = {
    orientation: data.template ? data.template.orientation : "portrait",
    paperSize: data.template ? data.template.paperSize : "A4"
  };
  if (format === "pdf") {
    const buffer = await formRenderer.renderPdfBuffer(data, options);
    return {
      buffer,
      filename: `${row.form_code.toUpperCase()}-${row.school_name.replace(/[^a-z0-9]+/gi, "-")}-${row.school_year_name.replace(/[^a-z0-9]+/gi, "-")}-v${row.version}.pdf`,
      submission: serializeSubmission(row)
    };
  }
  return { html: formRenderer.renderHtml(data, options), submission: serializeSubmission(row) };
}

async function previewForm(actor, code, params = {}) {
  const definition = formDataService.definitionFor(code);
  await assertFormModule(actor, definition.code, "access");
  const { data } = await formDataService.buildForm(actor, definition.code, params);
  return { html: formRenderer.renderHtml(data, {
    orientation: data.template.orientation,
    paperSize: data.template.paperSize
  }), data };
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                  */
/* -------------------------------------------------------------------------- */

async function listTemplates(actor, filters = {}) {
  assertCan(actor, "school_forms", "access");
  const params = [];
  let where = "1 = 1";
  if (filters.formCode) {
    params.push(formCode(filters.formCode));
    where += ` AND form_code = $${params.length}`;
  }
  const result = await query(
    `SELECT * FROM form_templates WHERE ${where} ORDER BY form_code ASC, is_active DESC, created_at DESC`,
    params
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    formCode: row.form_code,
    name: row.name,
    version: row.version,
    orientation: row.orientation,
    paperSize: row.paper_size,
    isActive: row.is_active,
    isOfficial: row.is_official,
    sourceNote: row.source_note,
    config: row.config || {},
    createdAt: row.created_at
  }));
}

async function saveTemplate(actor, payload = {}) {
  if (!["system_admin", "district_admin"].includes(actor.role)) {
    throw new HttpError(403, "Only administrators may manage form templates.", "TEMPLATE_FORBIDDEN");
  }
  assertCan(actor, "school_forms", "edit");
  const code = formCode(payload.formCode);
  const name = requireString(payload.name, "Template name", { min: 3, max: 160 });
  const version = requireString(payload.version || "custom-1", "Template version", { min: 1, max: 32 });
  const orientation = requireEnum(payload.orientation || "portrait", "Orientation", ORIENTATIONS);
  const paperSize = requireEnum(payload.paperSize || "A4", "Paper size", PAPER_SIZES);
  const isOfficial = Boolean(payload.isOfficial);
  const sourceNote = optionalString(payload.sourceNote, "Source note", { max: 2000 });
  if (isOfficial && !sourceNote) {
    fail("Record the official source for a template before marking it official.", { field: "sourceNote" });
  }
  const client = await getClient();
  let id;
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO form_templates
         (form_code, name, version, orientation, paper_size, is_active, is_official, source_note, config, created_by)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8::jsonb, $9)
       RETURNING id`,
      [
        code,
        name,
        version,
        orientation,
        paperSize,
        isOfficial,
        sourceNote || "Custom system layout supplied by the school or district.",
        JSON.stringify(payload.config || {}),
        actor.id
      ]
    );
    id = inserted.rows[0].id;
    await client.query(
      "UPDATE form_templates SET is_active = FALSE, updated_at = now() WHERE form_code = $1 AND id <> $2 AND is_active = TRUE",
      [code, id]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new HttpError(409, "A template with that version already exists for this form.", "TEMPLATE_EXISTS");
    }
    throw error;
  } finally {
    client.release();
  }
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "school_form.template",
    entityType: "form_template",
    entityId: id,
    details: { formCode: code, version, isOfficial }
  });
  return listTemplates(actor, { formCode: code });
}

async function activateTemplate(actor, id) {
  if (!["system_admin", "district_admin"].includes(actor.role)) {
    throw new HttpError(403, "Only administrators may activate form templates.", "TEMPLATE_FORBIDDEN");
  }
  assertCan(actor, "school_forms", "edit");
  const result = await query("SELECT * FROM form_templates WHERE id = $1", [id]);
  const template = result.rows[0];
  if (!template) {
    throw new HttpError(404, "Template not found.", "TEMPLATE_NOT_FOUND");
  }
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE form_templates SET is_active = FALSE, updated_at = now() WHERE form_code = $1 AND is_active = TRUE",
      [template.form_code]
    );
    await client.query("UPDATE form_templates SET is_active = TRUE, updated_at = now() WHERE id = $1", [id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "school_form.template_activate",
    entityType: "form_template",
    entityId: id,
    details: { formCode: template.form_code }
  });
  return listTemplates(actor, { formCode: template.form_code });
}

/* -------------------------------------------------------------------------- */
/* Deadlines                                                                  */
/* -------------------------------------------------------------------------- */

async function listDeadlines(actor, filters = {}) {
  assertCan(actor, "school_forms", "access");
  const params = [];
  const conditions = ["1 = 1"];
  if (filters.schoolYearId) {
    params.push(filters.schoolYearId);
    conditions.push(`fd.school_year_id = $${params.length}`);
  }
  if (filters.formCode) {
    params.push(formCode(filters.formCode));
    conditions.push(`fd.form_code = $${params.length}`);
  }
  if (filters.schoolId) {
    const school = await resolveSchool(actor, filters.schoolId);
    params.push(school.id);
    const schoolParam = params.length;
    params.push(school.district_id);
    conditions.push(
      `(fd.school_id = $${schoolParam} OR (fd.school_id IS NULL AND fd.district_id = $${params.length}) OR (fd.school_id IS NULL AND fd.district_id IS NULL))`
    );
  } else {
    const scope = schoolScopeSql(actor, "s", params, null);
    if (scope) {
      conditions.push(`(fd.school_id IS NULL OR fd.school_id IN (SELECT s.id FROM schools s WHERE ${scope}))`);
    }
  }
  const result = await query(
    `SELECT fd.*, s.school_name, d.district_name, y.name AS school_year_name
     FROM form_deadlines fd
     LEFT JOIN schools s ON s.id = fd.school_id
     LEFT JOIN districts d ON d.id = fd.district_id
     LEFT JOIN school_years y ON y.id = fd.school_year_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY fd.due_date ASC`,
    params
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    formCode: row.form_code,
    formTitle: formDataService.FORM_MAP[row.form_code]
      ? formDataService.FORM_MAP[row.form_code].title
      : row.form_code.toUpperCase(),
    schoolId: row.school_id ? Number(row.school_id) : null,
    schoolName: row.school_name,
    districtId: row.district_id ? Number(row.district_id) : null,
    districtName: row.district_name,
    schoolYearId: Number(row.school_year_id),
    schoolYearName: row.school_year_name,
    period: row.period || null,
    title: row.title,
    dueDate: formatDate(row.due_date),
    overdue: new Date(`${formatDate(row.due_date)}T23:59:59`) < new Date()
  }));
}

async function saveDeadline(actor, payload = {}) {
  if (!["system_admin", "district_admin", "psds"].includes(actor.role)) {
    throw new HttpError(403, "Only district personnel may set reporting deadlines.", "DEADLINE_FORBIDDEN");
  }
  assertCan(actor, "school_forms", "edit");
  const year = await resolveSchoolYear(payload.schoolYearId);
  const code = formCode(payload.formCode);
  const title = requireString(payload.title, "Deadline title", { min: 3, max: 160 });
  const dueDate = requireString(payload.dueDate, "Due date", { min: 10, max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    fail("Due date must use the YYYY-MM-DD format.", { field: "dueDate" });
  }
  const period = monthOrNull(payload.period);
  let schoolId = null;
  let districtId = null;
  if (payload.schoolId) {
    const school = await resolveSchool(actor, payload.schoolId);
    schoolId = Number(school.id);
    districtId = Number(school.district_id);
  } else if (payload.districtId) {
    const district = await query("SELECT * FROM districts WHERE id = $1", [payload.districtId]);
    if (!district.rows[0]) {
      throw new HttpError(404, "District not found.", "DISTRICT_NOT_FOUND");
    }
    districtId = Number(payload.districtId);
  }
  if (payload.id) {
    const existing = await query("SELECT * FROM form_deadlines WHERE id = $1", [payload.id]);
    if (!existing.rows[0]) {
      throw new HttpError(404, "Deadline not found.", "DEADLINE_NOT_FOUND");
    }
    await query(
      `UPDATE form_deadlines SET
         district_id = $1, school_id = $2, school_year_id = $3, form_code = $4,
         period = $5, title = $6, due_date = $7, updated_at = now()
       WHERE id = $8`,
      [districtId, schoolId, year.id, code, period, title, dueDate, payload.id]
    );
    return listDeadlines(actor, { schoolYearId: year.id, formCode: code });
  }
  const inserted = await query(
    `INSERT INTO form_deadlines
       (district_id, school_id, school_year_id, form_code, period, title, due_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [districtId, schoolId, year.id, code, period, title, dueDate, actor.id]
  );
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "school_form.deadline",
    entityType: "form_deadline",
    entityId: inserted.rows[0].id,
    details: { formCode: code, schoolYearId: Number(year.id), dueDate }
  });
  return listDeadlines(actor, { schoolYearId: year.id, formCode: code });
}

async function deleteDeadline(actor, id) {
  if (!["system_admin", "district_admin", "psds"].includes(actor.role)) {
    throw new HttpError(403, "Only district personnel may remove reporting deadlines.", "DEADLINE_FORBIDDEN");
  }
  assertCan(actor, "school_forms", "edit");
  const existing = await query("SELECT * FROM form_deadlines WHERE id = $1", [id]);
  if (!existing.rows[0]) {
    throw new HttpError(404, "Deadline not found.", "DEADLINE_NOT_FOUND");
  }
  await query("DELETE FROM form_deadlines WHERE id = $1", [id]);
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "school_form.deadline_delete",
    entityType: "form_deadline",
    entityId: id,
    details: { formCode: existing.rows[0].form_code }
  });
  return { deleted: true };
}

/* -------------------------------------------------------------------------- */
/* District monitoring                                                        */
/* -------------------------------------------------------------------------- */

async function monitoring(actor, filters = {}) {
  assertCan(actor, "monitoring", "access");
  const year = await resolveSchoolYear(filters.schoolYearId);
  const params = [year.id];
  const conditions = ["fs.school_year_id = $1"];
  const scope = schoolScopeSql(actor, "s", params, filters.schoolId);
  if (scope) conditions.push(scope);
  if (filters.districtId && actor.role === "system_admin") {
    params.push(filters.districtId);
    conditions.push(`s.district_id = $${params.length}`);
  }
  const schoolParams = [];
  const schoolConditions = ["1 = 1"];
  const schoolScope = schoolScopeSql(actor, "s", schoolParams, filters.schoolId);
  if (schoolScope) schoolConditions.push(schoolScope);
  if (filters.districtId && actor.role === "system_admin") {
    schoolParams.push(filters.districtId);
    schoolConditions.push(`s.district_id = $${schoolParams.length}`);
  }
  const schools = await query(
    `SELECT s.id, s.school_name, s.school_code, s.district_id, d.district_name
     FROM schools s JOIN districts d ON d.id = s.district_id
     WHERE ${schoolConditions.join(" AND ")} AND s.status = 'active' AND s.archived_at IS NULL
     ORDER BY d.district_name ASC, s.school_name ASC`,
    schoolParams
  );
  const submissions = await query(
    `SELECT DISTINCT ON (fs.school_id, fs.form_code)
            fs.*, s.school_name, d.district_name
     FROM form_submissions fs
     JOIN schools s ON s.id = fs.school_id
     JOIN districts d ON d.id = s.district_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY fs.school_id, fs.form_code, fs.updated_at DESC`,
    params
  );
  const deadlines = await query(
    `SELECT fd.* FROM form_deadlines fd
     WHERE fd.school_year_id = $1
       AND (fd.school_id IS NULL OR fd.school_id IN (SELECT s.id FROM schools s WHERE ${
         schoolScope ? schoolScope.replace(/\$(\d+)/g, (m, i) => `$${Number(i) + 1}`) : "1 = 1"
       }))
     ORDER BY fd.due_date ASC`,
    [year.id, ...schoolParams]
  );
  const deadlineByForm = new Map();
  deadlines.rows.forEach((row) => {
    const key = `${row.school_id || "district"}:${row.form_code}:${row.period || ""}`;
    deadlineByForm.set(key, row);
  });
  const bySchool = new Map();
  submissions.rows.forEach((row) => {
    if (!bySchool.has(String(row.school_id))) bySchool.set(String(row.school_id), []);
    bySchool.get(String(row.school_id)).push(row);
  });
  const today = new Date();
  const schoolRows = schools.rows.map((school) => {
    const rows = bySchool.get(String(school.id)) || [];
    const counts = { approved: 0, submitted: 0, returned: 0, failed: 0, draft: 0 };
    rows.forEach((row) => {
      if (["approved", "finalized"].includes(row.status)) counts.approved += 1;
      else if (row.status === "submitted") counts.submitted += 1;
      else if (row.status === "returned") counts.returned += 1;
      else if (row.status === "validation_failed") counts.failed += 1;
      else counts.draft += 1;
    });
    let overdue = 0;
    rows.forEach((row) => {
      if (["approved", "finalized"].includes(row.status)) return;
      const deadline =
        deadlineByForm.get(`${school.id}:${row.form_code}:${row.period || ""}`) ||
        deadlineByForm.get(`district:${row.form_code}:${row.period || ""}`) ||
        deadlineByForm.get(`district:${row.form_code}:`);
      if (deadline && new Date(`${formatDate(deadline.due_date)}T23:59:59`) < today) {
        overdue += 1;
      }
    });
    return {
      schoolId: Number(school.id),
      schoolName: school.school_name,
      schoolCode: school.school_code,
      districtId: Number(school.district_id),
      districtName: school.district_name,
      formsGenerated: rows.length,
      approved: counts.approved,
      submitted: counts.submitted,
      returned: counts.returned,
      validationFailed: counts.failed,
      draft: counts.draft,
      missing: Math.max(formDataService.FORM_DEFINITIONS.length - rows.length, 0),
      overdue,
      completion: Math.round((counts.approved / formDataService.FORM_DEFINITIONS.length) * 1000) / 10
    };
  });
  const totals = schoolRows.reduce(
    (accumulator, row) => {
      accumulator.schools += 1;
      accumulator.formsGenerated += row.formsGenerated;
      accumulator.approved += row.approved;
      accumulator.submitted += row.submitted;
      accumulator.returned += row.returned;
      accumulator.validationFailed += row.validationFailed;
      accumulator.overdue += row.overdue;
      return accumulator;
    },
    { schools: 0, formsGenerated: 0, approved: 0, submitted: 0, returned: 0, validationFailed: 0, overdue: 0 }
  );
  return {
    schoolYear: { id: Number(year.id), name: year.name },
    totals: {
      ...totals,
      expected: schoolRows.length * formDataService.FORM_DEFINITIONS.length
    },
    schools: schoolRows,
    deadlines: deadlines.rows.map((row) => ({
      id: Number(row.id),
      formCode: row.form_code,
      schoolId: row.school_id ? Number(row.school_id) : null,
      districtId: row.district_id ? Number(row.district_id) : null,
      period: row.period || null,
      title: row.title,
      dueDate: formatDate(row.due_date)
    }))
  };
}

async function discrepancies(actor, filters = {}) {
  assertCan(actor, "monitoring", "access");
  const params = [];
  const conditions = [
    "(fs.status IN ('validation_failed', 'returned') OR fs.completeness < 100)"
  ];
  const scope = schoolScopeSql(actor, "s", params, filters.schoolId);
  if (scope) conditions.push(scope);
  if (filters.schoolYearId) {
    params.push(filters.schoolYearId);
    conditions.push(`fs.school_year_id = $${params.length}`);
  }
  const result = await query(
    `${SUBMISSION_SELECT}
     WHERE ${conditions.join(" AND ")}
     ORDER BY fs.updated_at DESC
     LIMIT 300`,
    params
  );
  return result.rows
    .filter((row) => canDo(actor, "health", "access") || row.form_code !== "sf8")
    .map((row) => {
      const submission = serializeSubmission(row);
      return {
        id: submission.id,
        formCode: submission.formCode,
        formTitle: submission.formTitle,
        schoolName: submission.schoolName,
        districtName: submission.districtName,
        schoolYearName: submission.schoolYearName,
        gradeLevelName: submission.gradeLevelName,
        sectionName: submission.sectionName,
        period: submission.period,
        status: submission.status,
        statusLabel: submission.statusLabel,
        completeness: submission.completeness,
        errorCount: submission.validation.errorCount,
        warningCount: submission.validation.warningCount,
        reviewNotes: submission.reviewNotes,
        updatedAt: submission.updatedAt,
        errors: submission.validation.errors,
        warnings: submission.validation.warnings
      };
    });
}

async function auditTrail(actor, filters = {}) {
  assertCan(actor, "monitoring", "access");
  const params = [];
  const conditions = ["1 = 1"];
  const scope = schoolScopeSql(actor, "s", params, filters.schoolId);
  if (scope) conditions.push(scope);
  if (filters.schoolYearId) {
    params.push(filters.schoolYearId);
    conditions.push(`fs.school_year_id = $${params.length}`);
  }
  if (filters.submissionId) {
    params.push(filters.submissionId);
    conditions.push(`fr.submission_id = $${params.length}`);
  }
  const result = await query(
    `SELECT fr.*, fs.form_code, fs.school_id, s.school_name, fs.school_year_id,
            u.full_name AS actor_name, u.role AS actor_role
     FROM form_reviews fr
     JOIN form_submissions fs ON fs.id = fr.submission_id
     JOIN schools s ON s.id = fs.school_id
     JOIN districts d ON d.id = s.district_id
     LEFT JOIN users u ON u.id = fr.actor_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY fr.created_at DESC
     LIMIT 300`,
    params
  );
  return result.rows
    .filter((row) => canDo(actor, "health", "access") || row.form_code !== "sf8")
    .map((row) => ({
      id: Number(row.id),
      submissionId: Number(row.submission_id),
      formCode: row.form_code,
      schoolId: Number(row.school_id),
      schoolName: row.school_name,
      schoolYearId: Number(row.school_year_id),
      action: row.action,
      comments: row.comments,
      actorId: row.actor_id ? Number(row.actor_id) : null,
      actorName: row.actor_name,
      actorRole: row.actor_role,
      createdAt: row.created_at
    }));
}

module.exports = {
  STATUSES,
  STATUS_LABEL,
  REVIEW_ACTIONS,
  listDefinitions,
  listCards,
  generate,
  listSubmissions,
  getSubmission,
  review,
  renderSubmission,
  previewForm,
  listTemplates,
  saveTemplate,
  activateTemplate,
  listDeadlines,
  saveDeadline,
  deleteDeadline,
  monitoring,
  discrepancies,
  auditTrail
};
