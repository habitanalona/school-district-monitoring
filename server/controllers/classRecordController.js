"use strict";

const classRecordService = require("../services/classRecordService");
const { requireIdParam } = require("../utils/validators");

function actorFrom(req) {
  return { ...req.user, ipAddress: req.ip || null };
}

function optionalId(value, field) {
  return value === undefined || value === null || value === "" ? null : requireIdParam(value, field);
}

async function dashboard(req, res) {
  res.json({
    data: await classRecordService.teacherDashboard(actorFrom(req), {
      schoolYearId: optionalId(req.query.schoolYearId, "School year"),
      schoolId: optionalId(req.query.schoolId, "School"),
      sectionId: optionalId(req.query.sectionId, "Section"),
      subjectId: optionalId(req.query.subjectId, "Subject"),
      search: req.query.search || ""
    })
  });
}

async function initialize(req, res) {
  res.status(201).json({
    data: await classRecordService.initializeRecord(actorFrom(req), req.body, { ip: req.ip })
  });
}

async function detail(req, res) {
  res.json({
    data: await classRecordService.recordDetail(
      actorFrom(req),
      requireIdParam(req.params.id, "Class record")
    )
  });
}

async function saveAssessment(req, res) {
  res.json({
    data: await classRecordService.saveAssessment(
      actorFrom(req),
      requireIdParam(req.params.id, "Class record"),
      req.body,
      { ip: req.ip }
    )
  });
}

async function archiveAssessment(req, res) {
  res.json({
    data: await classRecordService.archiveAssessment(
      actorFrom(req),
      requireIdParam(req.params.id, "Class record"),
      requireIdParam(req.params.assessmentId, "Assessment"),
      { ip: req.ip }
    )
  });
}

async function saveScores(req, res) {
  res.json({
    data: await classRecordService.saveScores(
      actorFrom(req),
      requireIdParam(req.params.id, "Class record"),
      req.body,
      { ip: req.ip }
    )
  });
}

async function submit(req, res) {
  res.json({
    data: await classRecordService.submitRecord(
      actorFrom(req),
      requireIdParam(req.params.id, "Class record"),
      req.body,
      { ip: req.ip }
    )
  });
}

async function submission(req, res) {
  res.json({
    data: await classRecordService.submissionDetail(
      actorFrom(req),
      requireIdParam(req.params.id, "Grade submission")
    )
  });
}

async function returnForCorrection(req, res) {
  res.json({
    data: await classRecordService.returnSubmission(
      actorFrom(req),
      requireIdParam(req.params.id, "Grade submission"),
      req.body,
      { ip: req.ip }
    )
  });
}

async function accept(req, res) {
  res.json({
    data: await classRecordService.acceptSubmission(
      actorFrom(req),
      requireIdParam(req.params.id, "Grade submission"),
      req.body,
      { ip: req.ip }
    )
  });
}

async function adviserOverview(req, res) {
  res.json({
    data: await classRecordService.adviserOverview(actorFrom(req), {
      schoolYearId: optionalId(req.query.schoolYearId, "School year"),
      schoolId: optionalId(req.query.schoolId, "School"),
      sectionId: optionalId(req.query.sectionId, "Section"),
      search: req.query.search || ""
    })
  });
}

async function consolidation(req, res) {
  res.json({
    data: await classRecordService.consolidation(actorFrom(req), {
      sectionId: requireIdParam(req.query.sectionId, "Section"),
      schoolYearId: optionalId(req.query.schoolYearId, "School year")
    })
  });
}

async function templates(req, res) {
  res.json({
    data: await classRecordService.listTemplates(actorFrom(req), {
      schoolId: optionalId(req.query.schoolId, "School"),
      gradeLevelId: optionalId(req.query.gradeLevelId, "Grade level"),
      subjectId: optionalId(req.query.subjectId, "Subject")
    })
  });
}

async function saveTemplate(req, res) {
  res.json({
    data: await classRecordService.saveTemplate(actorFrom(req), req.body, { ip: req.ip })
  });
}

module.exports = {
  dashboard,
  initialize,
  detail,
  saveAssessment,
  archiveAssessment,
  saveScores,
  submit,
  submission,
  returnForCorrection,
  accept,
  adviserOverview,
  consolidation,
  templates,
  saveTemplate
};
