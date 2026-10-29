"use strict";

const gradeService = require("../services/gradeService");
const { requireIdParam, requireEnum } = require("../utils/validators");

function actorFrom(req) {
  return { ...req.user, ipAddress: req.ip || null };
}

function optionalId(value, field) {
  return value === undefined || value === null || value === "" ? null : requireIdParam(value, field);
}

async function entry(req, res) {
  res.json({
    data: await gradeService.gradeEntry(actorFrom(req), {
      sectionId: requireIdParam(req.query.sectionId, "Section"),
      schoolYearId: optionalId(req.query.schoolYearId, "School year"),
      subjectId: optionalId(req.query.subjectId, "Subject")
    })
  });
}

async function saveEntry(req, res) {
  res.json({ data: await gradeService.saveGrades(actorFrom(req), req.body, { ip: req.ip }) });
}

async function submit(req, res) {
  res.json({ data: await gradeService.submitGrades(actorFrom(req), req.body, { ip: req.ip }) });
}

async function finalize(req, res) {
  res.json({ data: await gradeService.finalizeGrades(actorFrom(req), req.body, { ip: req.ip }) });
}

async function correct(req, res) {
  res.json({ data: await gradeService.correctGrade(actorFrom(req), req.body, { ip: req.ip }) });
}

async function learner(req, res) {
  res.json({
    data: await gradeService.learnerGrades(
      actorFrom(req),
      requireIdParam(req.params.learnerId, "Learner"),
      { schoolYearId: optionalId(req.query.schoolYearId, "School year") }
    )
  });
}

async function policy(req, res) {  res.json({
    data: await gradeService.getPolicy(actorFrom(req), {
      schoolId: optionalId(req.query.schoolId, "School"),
      schoolYearId: optionalId(req.query.schoolYearId, "School year"),
      gradeLevelId: optionalId(req.query.gradeLevelId, "Grade level")
    })
  });
}

async function savePolicy(req, res) {
  res.json({ data: await gradeService.savePolicy(actorFrom(req), req.body, { ip: req.ip }) });
}

async function promotion(req, res) {
  res.json({
    data: await gradeService.promotionRows(actorFrom(req), {
      sectionId: requireIdParam(req.query.sectionId, "Section"),
      schoolYearId: optionalId(req.query.schoolYearId, "School year")
    })
  });
}

async function computePromotion(req, res) {
  res.json({
    data: await gradeService.computePromotion(actorFrom(req), req.body, { ip: req.ip })
  });
}

async function decidePromotion(req, res) {
  res.json({
    data: await gradeService.savePromotionDecision(
      actorFrom(req),
      requireIdParam(req.params.id, "Promotion decision"),
      req.body,
      { ip: req.ip }
    )
  });
}

async function reportCards(req, res) {
  res.json({
    data: await gradeService.listReportCards(actorFrom(req), {
      schoolId: optionalId(req.query.schoolId, "School"),
      schoolYearId: optionalId(req.query.schoolYearId, "School year"),
      sectionId: optionalId(req.query.sectionId, "Section"),
      status: req.query.status || ""
    })
  });
}

async function generateReportCards(req, res) {
  res.json({
    data: await gradeService.generateReportCards(actorFrom(req), req.body, { ip: req.ip })
  });
}

async function reportCard(req, res) {
  res.json({
    data: await gradeService.getReportCard(actorFrom(req), requireIdParam(req.params.id, "Report card"))
  });
}

async function reportCardAction(req, res) {
  const action = requireEnum(req.params.action, "Report card action", [
    "submit",
    "approve",
    "issue",
    "reissue"
  ]);
  res.json({
    data: await gradeService.setReportCardStatus(
      actorFrom(req),
      requireIdParam(req.params.id, "Report card"),
      action,
      req.body,
      { ip: req.ip }
    )
  });
}

module.exports = {
  entry,
  saveEntry,
  submit,
  finalize,
  correct,
  learner,
  policy,
  savePolicy,
  promotion,
  computePromotion,
  decidePromotion,
  reportCards,
  generateReportCards,
  reportCard,
  reportCardAction
};
