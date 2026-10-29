"use strict";

const schoolFormsService = require("../services/schoolFormsService");
const { requireIdParam } = require("../utils/validators");

function actorFrom(req) {
  return { ...req.user, ipAddress: req.ip || null };
}

function optionalId(value, field) {
  return value === undefined || value === null || value === "" ? null : requireIdParam(value, field);
}

async function definitions(req, res) {
  res.json({
    data: schoolFormsService.listDefinitions()
  });
}

async function cards(req, res) {
  const data = await schoolFormsService.listCards(actorFrom(req), {
    schoolId: optionalId(req.query.schoolId, "School"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    month: req.query.month || null
  });
  res.json({ data });
}

async function preview(req, res) {
  const data = await schoolFormsService.previewForm(actorFrom(req), req.params.code, {
    schoolId: optionalId(req.query.schoolId, "School"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    gradeLevelId: optionalId(req.query.gradeLevelId, "Grade level"),
    sectionId: optionalId(req.query.sectionId, "Section"),
    learnerId: optionalId(req.query.learnerId, "Learner"),
    month: req.query.month || req.query.period || null
  });
  res.json({ data });
}

async function generate(req, res) {
  const data = await schoolFormsService.generate(
    actorFrom(req),
    req.params.code,
    {
      schoolId: optionalId(req.body.schoolId, "School"),
      schoolYearId: optionalId(req.body.schoolYearId, "School year"),
      gradeLevelId: optionalId(req.body.gradeLevelId, "Grade level"),
      sectionId: optionalId(req.body.sectionId, "Section"),
      learnerId: optionalId(req.body.learnerId, "Learner"),
      month: req.body.month || req.body.period || null
    },
    { ip: req.ip }
  );
  res.status(201).json({ data });
}

async function submissions(req, res) {
  const data = await schoolFormsService.listSubmissions(actorFrom(req), {
    schoolId: optionalId(req.query.schoolId, "School"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    learnerId: optionalId(req.query.learnerId, "Learner"),
    formCode: req.query.formCode || null,
    status: req.query.status || null,
    period: req.query.period || null
  });
  res.json({ data });
}

async function submission(req, res) {
  const data = await schoolFormsService.getSubmission(
    actorFrom(req),
    requireIdParam(req.params.id, "Submission")
  );
  res.json({ data });
}

async function review(req, res) {
  const data = await schoolFormsService.review(
    actorFrom(req),
    requireIdParam(req.params.id, "Submission"),
    req.params.action,
    req.body,
    { ip: req.ip }
  );
  res.json({ data });
}

async function render(req, res) {
  const format = req.query.format === "pdf" ? "pdf" : "html";
  const result = await schoolFormsService.renderSubmission(
    actorFrom(req),
    requireIdParam(req.params.id, "Submission"),
    format
  );
  if (format === "pdf") {
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store"
    });
    return res.send(result.buffer);
  }
  res.json({ data: { html: result.html, submission: result.submission } });
}

async function templates(req, res) {
  const data = await schoolFormsService.listTemplates(actorFrom(req), {
    formCode: req.query.formCode || null
  });
  res.json({ data });
}

async function saveTemplate(req, res) {
  res.status(201).json({
    data: await schoolFormsService.saveTemplate(actorFrom(req), req.body)
  });
}

async function activateTemplate(req, res) {
  res.json({
    data: await schoolFormsService.activateTemplate(
      actorFrom(req),
      requireIdParam(req.params.id, "Template")
    )
  });
}

async function deadlines(req, res) {
  const data = await schoolFormsService.listDeadlines(actorFrom(req), {
    schoolId: optionalId(req.query.schoolId, "School"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    formCode: req.query.formCode || null
  });
  res.json({ data });
}

async function saveDeadline(req, res) {
  res.status(201).json({
    data: await schoolFormsService.saveDeadline(actorFrom(req), req.body)
  });
}

async function removeDeadline(req, res) {
  res.json({
    data: await schoolFormsService.deleteDeadline(
      actorFrom(req),
      requireIdParam(req.params.id, "Deadline")
    )
  });
}

module.exports = {
  definitions,
  cards,
  preview,
  generate,
  submissions,
  submission,
  review,
  render,
  templates,
  saveTemplate,
  activateTemplate,
  deadlines,
  saveDeadline,
  removeDeadline
};
