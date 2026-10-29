"use strict";

const PDFDocument = require("pdfkit");
const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const { requireIdParam, requireString, optionalString, fail } = require("../utils/validators");
const {
  assertCan,
  canDo,
  resolveSchool,
  sectionForActor,
  resolveSchoolYear,
  schoolScopeSql
} = require("../utils/formsAccess");
const gradeService = require("./gradeService");
const formRenderer = require("./formRenderer");
const auditService = require("./auditService");

const STATUS_LABEL = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  issued: "Issued",
  finalized: "Finalized",
  reopened: "Reopened"
};

const DECISION_LABEL = {
  pending: "Pending",
  promoted: "Promoted",
  retained: "Retained",
  conditional: "Conditionally promoted",
  completed: "Completed",
  other: "Other"
};

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function canFinalize(actor) {
  return canDo(actor, "report_cards", "edit");
}

async function loadCard(actor, id) {
  const result = await query("SELECT * FROM report_cards WHERE id = $1", [id]);
  const card = result.rows[0];
  if (!card) {
    throw new HttpError(404, "Report card not found.", "REPORT_CARD_NOT_FOUND");
  }
  await resolveSchool(actor, card.school_id);
  return card;
}

function cardSummary(card, data) {
  return {
    id: Number(card.id),
    learnerId: Number(card.learner_id),
    enrollmentId: Number(card.enrollment_id),
    lrn: data.enrollment.lrn,
    learnerName: data.enrollment.learnerName,
    gradeLevelName: data.enrollment.gradeLevelName,
    sectionId: data.enrollment.sectionId,
    sectionName: data.enrollment.sectionName,
    schoolName: data.enrollment.schoolName,
    schoolYearName: data.enrollment.schoolYearName,
    adviserName: data.enrollment.adviserName,
    generalAverage:
      card.general_average === null ? data.generalAverage : Number(card.general_average),
    status: card.status,
    statusLabel: STATUS_LABEL[card.status] || card.status,
    version: Number(card.version),
    promotionStatus: data.promotion ? data.promotion.decision : null,
    issuedOn: card.issued_on ? String(card.issued_on).slice(0, 10) : null,
    finalizedAt: card.finalized_at,
    reopenedAt: card.reopened_at,
    reopenReason: card.reopen_reason,
    complete: data.complete,
    subjectCount: data.subjects.length,
    eligibleSubjects: data.subjects.filter((subject) => subject.eligible).length,
    missingSubjects: data.missingSubjects,
    remarks: card.remarks
  };
}

async function list(actor, filters = {}) {
  assertCan(actor, "report_cards", "access");
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
  if (filters.gradeLevelId) {
    params.push(filters.gradeLevelId);
    conditions.push(`e.grade_level_id = $${params.length}`);
  }
  if (filters.status && STATUS_LABEL[filters.status]) {
    params.push(filters.status);
    conditions.push(`rc.status = $${params.length}`);
  }
  if (actor.role === "learner") {
    params.push(actor.id);
    conditions.push(`rc.learner_id IN (SELECT id FROM learners WHERE user_id = $${params.length})`);
  } else if (actor.role === "adviser") {
    params.push(actor.id);
    conditions.push(
      `(rc.adviser_id = $${params.length}
        OR EXISTS (SELECT 1 FROM sections sec WHERE sec.id = rc.section_id AND sec.adviser_id = $${params.length}))`
    );
  } else if (actor.role === "teacher") {
    params.push(actor.id);
    conditions.push(
      `EXISTS (SELECT 1 FROM teacher_assignments ta
               WHERE ta.section_id = rc.section_id AND ta.teacher_id = $${params.length})`
    );
  }
  if (filters.search) {
    params.push(`%${String(filters.search).trim()}%`);
    conditions.push(
      `(l.last_name ILIKE $${params.length} OR l.first_name ILIKE $${params.length} OR l.lrn ILIKE $${params.length})`
    );
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
     ORDER BY l.last_name ASC, l.first_name ASC, l.id ASC`,
    params
  );
  const items = [];
  for (const row of result.rows) {
    const data = await gradeService.reportCardData(row.enrollment_id);
    if (data) {
      items.push(cardSummary(row, data));
    }
  }
  return {
    items,
    canFinalize: canFinalize(actor),
    totals: {
      total: items.length,
      finalized: items.filter((item) => item.status === "finalized").length,
      ready: items.filter((item) => item.complete && item.status !== "finalized").length,
      incomplete: items.filter((item) => !item.complete).length
    }
  };
}

async function generate(actor, payload, meta) {
  assertCan(actor, "report_cards", "add");
  const section = await sectionForActor(actor, payload.sectionId);
  const year = await resolveSchoolYear(payload.schoolYearId || section.school_year_id);
  if (Number(section.school_year_id) !== Number(year.id)) {
    throw new HttpError(409, "That section belongs to a different school year.", "SECTION_YEAR_MISMATCH");
  }
  const learners = await query(
    `SELECT e.id AS enrollment_id
     FROM enrollments e JOIN learners l ON l.id = e.learner_id
     WHERE e.section_id = $1 AND e.school_year_id = $2
       AND l.archived_at IS NULL
       AND e.status NOT IN ('transferred_out', 'archived')
     ORDER BY l.last_name ASC, l.first_name ASC`,
    [section.id, year.id]
  );
  let generated = 0;
  const incomplete = [];
  const locked = [];
  for (const learner of learners.rows) {
    const data = await gradeService.reportCardData(learner.enrollment_id);
    if (!data) {
      continue;
    }
    if (!data.complete) {
      incomplete.push({
        lrn: data.enrollment.lrn,
        learnerName: data.enrollment.learnerName,
        missingSubjects: data.missingSubjects
      });
    }
    const existing = await query("SELECT * FROM report_cards WHERE enrollment_id = $1", [
      learner.enrollment_id
    ]);
    if (existing.rows[0] && existing.rows[0].status === "finalized") {
      locked.push(data.enrollment.lrn);
      continue;
    }
    const status = existing.rows[0] ? existing.rows[0].status : "draft";
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
         updated_at = now()
       WHERE report_cards.status <> 'finalized'`,
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
    details: {
      sectionId: Number(section.id),
      generated,
      incomplete: incomplete.length,
      locked: locked.length
    }
  });
  return {
    generated,
    incomplete,
    locked,
    ...(await list(actor, { sectionId: section.id, schoolYearId: year.id }))
  };
}

async function detail(actor, id) {
  assertCan(actor, "report_cards", "access");
  const card = await loadCard(actor, id);
  const live = await gradeService.reportCardData(card.enrollment_id);
  if (!live) {
    throw new HttpError(404, "The enrollment for this report card no longer exists.", "ENROLLMENT_NOT_FOUND");
  }
  const frozen = card.status === "finalized" && card.snapshot ? card.snapshot : null;
  const data = frozen || live;
  const revisions = await query(
    `SELECT r.id, r.version, r.reason, r.created_at, u.full_name AS created_by_name
     FROM report_card_revisions r
     LEFT JOIN users u ON u.id = r.created_by
     WHERE r.report_card_id = $1
     ORDER BY r.version DESC, r.id DESC`,
    [id]
  );
  return {
    card: {
      ...cardSummary(card, live),
      snapshotVersion: frozen ? Number(card.version) : null,
      frozen: Boolean(frozen),
      finalizedBy: card.finalized_by ? Number(card.finalized_by) : null,
      finalizedAt: card.finalized_at,
      reopenedBy: card.reopened_by ? Number(card.reopened_by) : null,
      reopenedAt: card.reopened_at,
      reopenReason: card.reopen_reason
    },
    data,
    latest: live,
    revisions: revisions.rows.map((row) => ({
      id: Number(row.id),
      version: Number(row.version),
      reason: row.reason,
      createdAt: row.created_at,
      createdByName: row.created_by_name
    })),
    can: {
      finalize: canFinalize(actor) && card.status !== "finalized",
      reopen: canFinalize(actor) && card.status === "finalized",
      print: true
    }
  };
}

async function finalize(actor, id, payload, meta) {
  assertCan(actor, "report_cards", "edit");
  const card = await loadCard(actor, id);
  if (card.status === "finalized") {
    throw new HttpError(
      409,
      "This report card is already finalized. Reopen it with a reason before making changes.",
      "REPORT_CARD_LOCKED"
    );
  }
  const data = await gradeService.reportCardData(card.enrollment_id);
  if (!data) {
    throw new HttpError(404, "The enrollment for this report card no longer exists.", "ENROLLMENT_NOT_FOUND");
  }
  if (!data.complete) {
    const error = new HttpError(
      409,
      "Every offered subject needs a finalized final grade before the report card can be finalized.",
      "REPORT_CARD_INCOMPLETE"
    );
    error.details = { missingSubjects: data.missingSubjects };
    throw error;
  }
  const warnings = [];
  if (!data.promotion) {
    warnings.push("No promotion decision is recorded for this learner.");
  } else if (!["approved", "finalized"].includes(data.promotion.workflowStatus)) {
    warnings.push(
      `The promotion decision is ${data.promotion.workflowStatus}; confirm it before issuing the card.`
    );
  }
  const version = Number(card.version) + 1;
  const snapshot = {
    ...data,
    reportCard: {
      id: Number(card.id),
      status: "finalized",
      version,
      finalizedAt: new Date().toISOString(),
      finalizedBy: Number(actor.id),
      warnings
    }
  };
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO report_card_revisions (report_card_id, version, snapshot, reason, created_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id,
        version,
        JSON.stringify(snapshot),
        optionalString(payload.reason || payload.remarks, "Finalization note", { max: 1000 }) ||
          "Finalized",
        actor.id
      ]
    );
    await client.query(
      `UPDATE report_cards SET
         status = 'finalized', version = $1, snapshot = $2,
         general_average = $3, days_present = $4, days_absent = $5, days_tardy = $6,
         finalized_by = $7, finalized_at = now(),
         issued_on = COALESCE(issued_on, CURRENT_DATE),
         remarks = COALESCE($8, remarks), updated_at = now()
       WHERE id = $9`,
      [
        version,
        JSON.stringify(snapshot),
        data.generalAverage,
        data.attendance.present + data.attendance.tardy + data.attendance.half_day,
        data.attendance.absent,
        data.attendance.tardy,
        actor.id,
        optionalString(payload.remarks, "Remarks", { max: 2000 }),
        id
      ]
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
    action: "report_cards.finalize",
    entityType: "report_card",
    entityId: id,
    details: {
      version,
      generalAverage: data.generalAverage,
      subjects: data.subjects.length,
      warnings
    }
  });
  return { id: Number(id), status: "finalized", version, warnings, detail: await detail(actor, id) };
}

async function reopen(actor, id, payload, meta) {
  assertCan(actor, "report_cards", "edit");
  const card = await loadCard(actor, id);
  if (card.status !== "finalized") {
    throw new HttpError(409, "Only a finalized report card can be reopened.", "REPORT_CARD_STATE");
  }
  const reason = requireString(payload.reason, "Reopen reason", { min: 5, max: 1000 });
  await query(
    `UPDATE report_cards SET
       status = 'reopened', reopened_by = $1, reopened_at = now(), reopen_reason = $2,
       updated_at = now()
     WHERE id = $3`,
    [actor.id, reason, id]
  );
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    ipAddress: meta && meta.ip,
    action: "report_cards.reopen",
    entityType: "report_card",
    entityId: id,
    details: { version: Number(card.version), reason }
  });
  return { id: Number(id), status: "reopened", detail: await detail(actor, id) };
}

async function schoolFor(card) {
  const result = await query(
    `SELECT s.*, d.district_name, d.district_code
     FROM schools s JOIN districts d ON d.id = s.district_id
     WHERE s.id = $1`,
    [card.school_id]
  );
  return result.rows[0];
}

function buildRenderData(card, data, school) {
  const enrollment = data.enrollment;
  const gradeRows = data.subjects.map((subject, index) => ({
    index: index + 1,
    subject: subject.subjectName,
    q1: subject.q1 === null ? "" : subject.q1,
    q2: subject.q2 === null ? "" : subject.q2,
    q3: subject.q3 === null ? "" : subject.q3,
    q4: subject.q4 === null ? "" : subject.q4,
    final: subject.final === null ? "" : subject.final,
    status: subject.eligible ? "finalized" : subject.status
  }));
  const promotion = data.promotion
    ? DECISION_LABEL[data.promotion.decision] || data.promotion.decision
    : "Not yet decided";
  return {
    code: "sf9",
    title: "Learner Progress Report Card",
    purpose: "Quarterly grades, final grades, and promotion status",
    description:
      "System-generated layout. It is not an official DepEd template unless the school has verified and adopted one.",
    isOfficial: false,
    template: {
      id: card.template_id || null,
      name: "System report card layout",
      orientation: "portrait",
      paperSize: "A4"
    },
    sourceNote:
      "Layout generated by the School District Monitoring System from finalized class record grades.",
    generatedAt: new Date().toISOString(),
    scope: {
      school: {
        id: Number(school.id),
        name: school.school_name,
        code: school.school_code,
        address: school.address,
        type: school.school_type,
        head: school.school_head
      },
      district: {
        id: Number(school.district_id),
        name: school.district_name,
        code: school.district_code
      },
      schoolYear: { id: enrollment.schoolYearId, name: enrollment.schoolYearName },
      gradeLevel: { id: null, name: enrollment.gradeLevelName },
      section: {
        id: enrollment.sectionId,
        name: enrollment.sectionName,
        adviser: enrollment.adviserName
      },
      learner: { id: enrollment.learnerId, name: enrollment.learnerName, lrn: enrollment.lrn }
    },
    summary: [
      { label: "Learner", value: enrollment.learnerName },
      { label: "LRN", value: enrollment.lrn },
      {
        label: "Grade / Section",
        value: [enrollment.gradeLevelName, enrollment.sectionName].filter(Boolean).join(" / ")
      },
      { label: "School Year", value: enrollment.schoolYearName },
      { label: "General Average", value: data.generalAverage === null ? "\u2014" : data.generalAverage },
      { label: "Promotion", value: promotion },
      { label: "Report Card Status", value: STATUS_LABEL[card.status] || card.status },
      { label: "Version", value: Number(card.version) }
    ],
    tables: [
      {
        key: "grades",
        title: "Subject Grades",
        columns: [
          { key: "index", label: "No.", width: 5, align: "center" },
          { key: "subject", label: "Learning Area / Subject", width: 38 },
          { key: "q1", label: "Q1", width: 8, align: "center" },
          { key: "q2", label: "Q2", width: 8, align: "center" },
          { key: "q3", label: "Q3", width: 8, align: "center" },
          { key: "q4", label: "Q4", width: 8, align: "center" },
          { key: "final", label: "Final", width: 8, align: "center" },
          { key: "status", label: "Status", width: 10 }
        ],
        rows: gradeRows,
        emptyText: "No subject records are available for this learner."
      },
      {
        key: "attendance",
        title: "Attendance",
        columns: [
          { key: "metric", label: "Metric", width: 40 },
          { key: "value", label: "Value", width: 20, align: "center" }
        ],
        rows: [
          { metric: "Days present", value: data.attendance.present },
          { metric: "Days absent", value: data.attendance.absent },
          { metric: "Days tardy", value: data.attendance.tardy },
          { metric: "Excused", value: data.attendance.excused },
          { metric: "Half day", value: data.attendance.half_day }
        ],
        emptyText: "No attendance records."
      }
    ],
    signatures: [
      { name: enrollment.adviserName || "", label: "Class Adviser" },
      { name: school.school_head || "", label: "School Head" },
      { name: "", label: "Parent / Guardian Signature" }
    ],
    notes: [
      "Blank quarters indicate grades that were not recorded. They are never filled in or replaced with zero.",
      "A finalized report card is stored as an immutable snapshot; later roster or configuration changes do not alter the printed card.",
      "This is a system layout. It must not be presented as an official DepEd template unless the school has verified and adopted it."
    ],
    validation: {
      complete: data.complete,
      errors: data.missingSubjects.map((subject) => ({
        message: `${subject.subjectName} has no finalized final grade (${subject.status}).`,
        source: { type: "subject", label: subject.subjectName }
      })),
      warnings:
        data.promotion && ["approved", "finalized"].includes(data.promotion.workflowStatus)
          ? []
          : [
              {
                message: data.promotion
                  ? `The promotion decision is ${data.promotion.workflowStatus}.`
                  : "No promotion decision is recorded."
              }
            ]
    }
  };
}

async function prepareRender(actor, id) {
  assertCan(actor, "report_cards", "access");
  const card = await loadCard(actor, id);
  const live = await gradeService.reportCardData(card.enrollment_id);
  if (!live) {
    throw new HttpError(404, "The enrollment for this report card no longer exists.", "ENROLLMENT_NOT_FOUND");
  }
  const data = card.status === "finalized" && card.snapshot ? card.snapshot : live;
  const school = await schoolFor(card);
  return { card, data, school };
}

async function render(actor, id, format) {
  const { card, data, school } = await prepareRender(actor, id);
  const renderData = buildRenderData(card, data, school);
  if (String(format || "html").toLowerCase() === "pdf") {
    const buffer = await formRenderer.renderPdfBuffer(renderData, { status: card.status });
    const name = `SF9-${data.enrollment.lrn || card.id}-v${card.version}.pdf`;
    return { type: "pdf", buffer, filename: name };
  }
  return {
    type: "html",
    html: formRenderer.renderHtml(renderData, { status: card.status }),
    filename: `SF9-${data.enrollment.lrn || card.id}-v${card.version}.html`
  };
}

async function batch(actor, filters, format) {
  assertCan(actor, "report_cards", "access");
  const section = await sectionForActor(actor, filters.sectionId);
  const year = await resolveSchoolYear(filters.schoolYearId || section.school_year_id);
  const cards = await query(
    `SELECT rc.* FROM report_cards rc
     JOIN learners l ON l.id = rc.learner_id
     WHERE rc.section_id = $1 AND rc.school_year_id = $2
     ORDER BY l.last_name ASC, l.first_name ASC`,
    [section.id, year.id]
  );
  if (!cards.rows.length) {
    throw new HttpError(
      409,
      "No report cards exist for this section yet. Generate the cards first.",
      "REPORT_CARDS_EMPTY"
    );
  }
  const prepared = [];
  for (const card of cards.rows) {
    const live = await gradeService.reportCardData(card.enrollment_id);
    if (!live) {
      continue;
    }
    const data = card.status === "finalized" && card.snapshot ? card.snapshot : live;
    const school = await schoolFor(card);
    prepared.push({ card, data, renderData: buildRenderData(card, data, school) });
  }
  if (String(format || "pdf").toLowerCase() === "html") {
    const pages = prepared.map((entry) =>
      formRenderer.renderHtml(entry.renderData, { status: entry.card.status })
    );
    const first = pages[0];
    const headEnd = first.indexOf("<body>");
    const head = headEnd > -1 ? first.slice(0, headEnd) : "";
    const bodies = pages.map((page) => {
      const start = page.indexOf("<body>") + 6;
      const end = page.indexOf("</body>");
      return page.slice(start, end > -1 ? end : page.length);
    });
    return {
      type: "html",
      html:
        head +
        '<body><style>.batch-card{page-break-after:always}.batch-card:last-child{page-break-after:auto}</style>' +
        bodies
          .map((body) => `<div class="batch-card">${body}</div>`)
          .join("") +
        "</body></html>",
      filename: `SF9-batch-${section.name}.html`
    };
  }
  return {
    type: "pdf",
    buffer: await renderBatchPdf(prepared),
    filename: `SF9-batch-${section.name}.pdf`
  };
}

function renderBatchPdf(entries) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margins: { top: 36, bottom: 40, left: 34, right: 34 },
        bufferPages: true,
        info: {
          Title: "Learner Progress Report Cards (SF 9) - System layout",
          Author: "School District Monitoring System"
        }
      });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
      const pageWidth = doc.page.width;
      const left = doc.page.margins.left;
      const contentWidth = pageWidth - left - doc.page.margins.right;

      entries.forEach((entry, index) => {
        if (index > 0) {
          doc.addPage();
        }
        const { card, data, renderData } = entry;
        const school = renderData.scope.school;
        const district = renderData.scope.district;
        doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(11);
        doc.text(school.name || "", left, doc.y, { width: contentWidth });
        doc.font("Helvetica").fontSize(8).fillColor("#475569");
        doc.text(
          `${district.name || ""}${school.code ? ` \u2022 School ID ${school.code}` : ""}`,
          { width: contentWidth }
        );
        doc.moveDown(0.6);
        doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(13);
        doc.text("Learner Progress Report Card (SF 9)", { width: contentWidth, align: "center" });
        doc.font("Helvetica").fontSize(7).fillColor("#64748b");
        doc.text(
          `System layout \u2022 ${STATUS_LABEL[card.status] || card.status} \u2022 Version ${card.version}`,
          { width: contentWidth, align: "center" }
        );
        doc.moveDown(0.6);

        const info = [
          ["Learner", data.enrollment.learnerName, "LRN", data.enrollment.lrn],
          [
            "Grade / Section",
            [data.enrollment.gradeLevelName, data.enrollment.sectionName].filter(Boolean).join(" / "),
            "School Year",
            data.enrollment.schoolYearName
          ],
          [
            "General Average",
            data.generalAverage === null ? "\u2014" : String(data.generalAverage),
            "Promotion",
            data.promotion
              ? DECISION_LABEL[data.promotion.decision] || data.promotion.decision
              : "Not yet decided"
          ]
        ];
        const half = contentWidth / 2;
        info.forEach((row) => {
          const y = doc.y;
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#475569").text(row[0], left, y, {
            width: half * 0.42
          });
          doc.font("Helvetica").fontSize(8).fillColor("#0f172a").text(row[1] || "", left + half * 0.4, y, {
            width: half * 0.6 - 6
          });
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#475569").text(row[2], left + half, y, {
            width: half * 0.42
          });
          doc.font("Helvetica").fontSize(8).fillColor("#0f172a").text(row[3] || "", left + half + half * 0.4, y, {
            width: half * 0.6 - 6
          });
          doc.y = y + 14;
        });
        doc.moveDown(0.5);

        const columns = [
          { key: "index", label: "No.", width: 5, align: "center" },
          { key: "subject", label: "Learning Area / Subject", width: 39 },
          { key: "q1", label: "Q1", width: 8, align: "center" },
          { key: "q2", label: "Q2", width: 8, align: "center" },
          { key: "q3", label: "Q3", width: 8, align: "center" },
          { key: "q4", label: "Q4", width: 8, align: "center" },
          { key: "final", label: "Final", width: 8, align: "center" },
          { key: "status", label: "Status", width: 10 }
        ];
        const widths = columns.map((column) => (contentWidth * column.width) / 100);
        let y = doc.y;
        const rowHeight = 16;
        doc.rect(left, y, contentWidth, rowHeight).fill("#e2e8f0");
        columns.forEach((column, columnIndex) => {
          const x = left + widths.slice(0, columnIndex).reduce((sum, width) => sum + width, 0);
          doc
            .fillColor("#0f172a")
            .font("Helvetica-Bold")
            .fontSize(7)
            .text(column.label, x + 3, y + 4, {
              width: widths[columnIndex] - 6,
              align: column.align || "left"
            });
        });
        y += rowHeight;
        data.subjects.forEach((subject, subjectIndex) => {
          if (y > doc.page.height - 150) {
            return;
          }
          if (subjectIndex % 2 === 1) {
            doc.rect(left, y, contentWidth, rowHeight).fill("#f8fafc");
          }
          const values = {
            index: subjectIndex + 1,
            subject: subject.subjectName,
            q1: subject.q1 === null ? "" : subject.q1,
            q2: subject.q2 === null ? "" : subject.q2,
            q3: subject.q3 === null ? "" : subject.q3,
            q4: subject.q4 === null ? "" : subject.q4,
            final: subject.final === null ? "" : subject.final,
            status: subject.eligible ? "finalized" : subject.status
          };
          columns.forEach((column, columnIndex) => {
            const x = left + widths.slice(0, columnIndex).reduce((sum, width) => sum + width, 0);
            doc
              .fillColor("#0f172a")
              .font("Helvetica")
              .fontSize(7.5)
              .text(String(values[column.key] === null ? "" : values[column.key]), x + 3, y + 4, {
                width: widths[columnIndex] - 6,
                align: column.align || "left",
                lineBreak: false
              });
          });
          y += rowHeight;
        });
        doc.y = y + 8;

        const attendance = data.attendance;
        doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#475569");
        doc.text(
          `Attendance \u2014 present ${attendance.present}, absent ${attendance.absent}, tardy ${attendance.tardy}, excused ${attendance.excused}, half day ${attendance.half_day}`,
          left,
          doc.y,
          { width: contentWidth }
        );
        doc.moveDown(0.8);
        doc.font("Helvetica").fontSize(7).fillColor("#64748b");
        doc.text(
          "Blank quarters indicate grades that were not recorded; they are never replaced with zero. This is a system layout, not an official DepEd template unless verified by the school.",
          { width: contentWidth }
        );
        doc.moveDown(1.2);

        const signatureWidth = contentWidth / 3;
        const signatureY = Math.min(doc.y, doc.page.height - 90);
        [
          [data.enrollment.adviserName || "", "Class Adviser"],
          [school.head || "", "School Head"],
          ["", "Parent / Guardian Signature"]
        ].forEach(([name, label], signatureIndex) => {
          const x = left + signatureIndex * signatureWidth;
          doc
            .moveTo(x + 8, signatureY + 22)
            .lineTo(x + signatureWidth - 8, signatureY + 22)
            .strokeColor("#0f172a")
            .stroke();
          doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#0f172a").text(name, x + 8, signatureY + 25, {
            width: signatureWidth - 16,
            align: "center"
          });
          doc.font("Helvetica").fontSize(6.5).fillColor("#475569").text(label, x + 8, signatureY + 34, {
            width: signatureWidth - 16,
            align: "center"
          });
        });
      });

      const range = doc.bufferedPageRange();
      for (let index = 0; index < range.count; index += 1) {
        doc.switchToPage(range.start + index);
        doc.fontSize(7).fillColor("#64748b").font("Helvetica");
        doc.text(
          "SF 9 \u2022 System layout \u2022 Generated " +
            new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" }),
          left,
          doc.page.height - 24,
          { width: contentWidth - 80, lineBreak: false }
        );
        doc.text(`Page ${index + 1} of ${range.count}`, left + contentWidth - 80, doc.page.height - 24, {
          width: 80,
          align: "right",
          lineBreak: false
        });
      }
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function exportCsv(actor, filters) {
  const listing = await list(actor, filters);
  if (!listing.items.length) {
    throw new HttpError(409, "No report cards are available to export.", "REPORT_CARDS_EMPTY");
  }
  const details = [];
  const subjectColumns = new Map();
  for (const item of listing.items) {
    const data = await gradeService.reportCardData(item.enrollmentId);
    if (!data) {
      continue;
    }
    data.subjects.forEach((subject) => {
      const key = subject.code || `subject-${subject.subjectId}`;
      if (!subjectColumns.has(key)) {
        subjectColumns.set(key, subject.subjectName);
      }
    });
    details.push({ item, data });
  }
  const subjectKeys = Array.from(subjectColumns.keys());
  const header = [
    "LRN",
    "Learner",
    "Grade Level",
    "Section",
    "School Year",
    ...subjectKeys.flatMap((key) => [`${key} Q1`, `${key} Q2`, `${key} Q3`, `${key} Q4`, `${key} Final`]),
    "General Average",
    "Promotion",
    "Report Card Status",
    "Version",
    "Finalized At"
  ];
  const lines = [header.map(csvCell).join(",")];
  details.forEach(({ item, data }) => {
    const byCode = new Map(data.subjects.map((subject) => [subject.code || `subject-${subject.subjectId}`, subject]));
    const row = [
      item.lrn,
      item.learnerName,
      item.gradeLevelName,
      item.sectionName,
      item.schoolYearName,
      ...subjectKeys.flatMap((key) => {
        const subject = byCode.get(key);
        if (!subject) {
          return ["", "", "", "", ""];
        }
        return [
          subject.q1 === null ? "" : subject.q1,
          subject.q2 === null ? "" : subject.q2,
          subject.q3 === null ? "" : subject.q3,
          subject.q4 === null ? "" : subject.q4,
          subject.final === null ? "" : subject.final
        ];
      }),
      data.generalAverage === null ? "" : data.generalAverage,
      data.promotion
        ? DECISION_LABEL[data.promotion.decision] || data.promotion.decision
        : "",
      STATUS_LABEL[item.status] || item.status,
      item.version,
      item.finalizedAt ? new Date(item.finalizedAt).toISOString() : ""
    ];
    lines.push(row.map(csvCell).join(","));
  });
  return {
    csv: "\ufeff" + lines.join("\r\n"),
    filename: `SF9-report-cards-${new Date().toISOString().slice(0, 10)}.csv`
  };
}

module.exports = {
  STATUS_LABEL,
  list,
  generate,
  detail,
  finalize,
  reopen,
  render,
  batch,
  exportCsv
};
