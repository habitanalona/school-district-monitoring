"use strict";

const attendanceService = require("../services/attendanceService");
const subjectAttendanceService = require("../services/subjectAttendanceService");
const { requireIdParam } = require("../utils/validators");

function actorFrom(req) {
  return { ...req.user, ipAddress: req.ip || null };
}

function id(value, field) {
  return requireIdParam(value, field);
}

function optionalId(value, field) {
  return value === undefined || value === null || value === "" ? null : id(value, field);
}

async function sheet(req, res) {
  const data = await attendanceService.getSheet(actorFrom(req), {
    sectionId: id(req.query.sectionId, "Section"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    date: req.query.date
  });
  res.json({ data });
}

async function saveSheet(req, res) {
  const data = await attendanceService.saveSheet(actorFrom(req), req.body, { ip: req.ip });
  res.json({ data });
}

async function month(req, res) {
  const data = await attendanceService.monthSheet(actorFrom(req), {
    sectionId: id(req.query.sectionId, "Section"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    month: req.query.month
  });
  res.json({ data });
}

async function summary(req, res) {
  const data = await attendanceService.attendanceRate(actorFrom(req), {
    sectionId: id(req.query.sectionId, "Section"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    month: req.query.month
  });
  res.json({ data });
}

async function learner(req, res) {
  const data = await attendanceService.learnerHistory(
    actorFrom(req),
    id(req.params.learnerId, "Learner"),
    { schoolYearId: optionalId(req.query.schoolYearId, "School year") }
  );
  res.json({ data });
}

async function calendar(req, res) {
  const data = await attendanceService.listCalendar(actorFrom(req), {
    schoolId: optionalId(req.query.schoolId, "School"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    month: req.query.month
  });
  res.json({ data });
}

async function saveCalendar(req, res) {
  const data = await attendanceService.saveCalendarDay(actorFrom(req), req.body);
  res.status(201).json({ data });
}

async function deleteCalendar(req, res) {
  const data = await attendanceService.deleteCalendarDay(
    actorFrom(req),
    id(req.params.id, "Calendar day")
  );
  res.json({ data });
}

async function terms(req, res) {
  const data = await subjectAttendanceService.listTerms(actorFrom(req), {
    schoolId: optionalId(req.query.schoolId, "School"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year")
  });
  res.json({ data });
}

async function provisionTerms(req, res) {
  const data = await subjectAttendanceService.provisionTerms(actorFrom(req), req.body);
  res.status(201).json({ data });
}

async function saveTerms(req, res) {
  const data = await subjectAttendanceService.saveTerms(actorFrom(req), req.body);
  res.json({ data });
}

async function approveTerms(req, res) {
  const data = await subjectAttendanceService.approveTerms(actorFrom(req), req.body);
  res.json({ data });
}

async function periods(req, res) {
  const data = await subjectAttendanceService.listPeriods(actorFrom(req), {
    schoolId: optionalId(req.query.schoolId, "School"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    gradeLevelId: optionalId(req.query.gradeLevelId, "Grade level"),
    sectionId: optionalId(req.query.sectionId, "Section")
  });
  res.json({ data });
}

async function savePeriods(req, res) {
  const data = await subjectAttendanceService.savePeriods(actorFrom(req), req.body);
  res.json({ data });
}

async function deletePeriod(req, res) {
  const data = await subjectAttendanceService.deletePeriod(actorFrom(req), id(req.params.id, "Period"));
  res.json({ data });
}

async function teacherLoads(req, res) {
  const data = await subjectAttendanceService.teacherLoads(actorFrom(req), {
    schoolId: optionalId(req.query.schoolId, "School"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year")
  });
  res.json({ data });
}

async function sectionSubjects(req, res) {
  const data = await subjectAttendanceService.sectionSubjects(actorFrom(req), {
    sectionId: id(req.query.sectionId, "Section"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year")
  });
  res.json({ data });
}

async function subjectMatrix(req, res) {
  const data = await subjectAttendanceService.getMatrix(actorFrom(req), {
    sectionId: id(req.query.sectionId, "Section"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    subjectId: id(req.query.subjectId, "Subject"),
    assignmentId: optionalId(req.query.assignmentId, "Assignment"),
    date: req.query.date,
    mode: req.query.mode
  });
  res.json({ data });
}

async function saveSubjectMatrix(req, res) {
  const data = await subjectAttendanceService.saveMatrix(actorFrom(req), req.body, { ip: req.ip });
  res.json({ data });
}

async function reopenSubmission(req, res) {
  const data = await subjectAttendanceService.reopenSubmission(
    actorFrom(req),
    id(req.params.id, "Submission"),
    req.body
  );
  res.json({ data });
}

async function consolidation(req, res) {
  const data = await subjectAttendanceService.consolidation(actorFrom(req), {
    sectionId: id(req.query.sectionId, "Section"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    date: req.query.date
  });
  res.json({ data });
}

async function validateDay(req, res) {
  const data = await subjectAttendanceService.validateDay(actorFrom(req), req.body, { ip: req.ip });
  res.json({ data });
}

async function reopenValidation(req, res) {
  const data = await subjectAttendanceService.reopenValidation(actorFrom(req), req.body, {
    ip: req.ip
  });
  res.json({ data });
}

async function corrections(req, res) {
  const data = await subjectAttendanceService.listCorrections(actorFrom(req), {
    sectionId: id(req.query.sectionId, "Section"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    status: req.query.status
  });
  res.json({ data });
}

async function requestCorrection(req, res) {
  const data = await subjectAttendanceService.requestCorrection(actorFrom(req), req.body, {
    ip: req.ip
  });
  res.status(201).json({ data });
}

async function reviewCorrection(req, res) {
  const data = await subjectAttendanceService.reviewCorrection(
    actorFrom(req),
    id(req.params.id, "Correction"),
    req.body,
    { ip: req.ip }
  );
  res.json({ data });
}

async function termSummary(req, res) {
  const data = await subjectAttendanceService.termSummary(actorFrom(req), {
    sectionId: id(req.query.sectionId, "Section"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    termNo: req.query.termNo,
    date: req.query.date
  });
  res.json({ data });
}

module.exports = {
  sheet,
  saveSheet,
  month,
  summary,
  learner,
  calendar,
  saveCalendar,
  deleteCalendar,
  terms,
  provisionTerms,
  saveTerms,
  approveTerms,
  periods,
  savePeriods,
  deletePeriod,
  teacherLoads,
  sectionSubjects,
  subjectMatrix,
  saveSubjectMatrix,
  reopenSubmission,
  consolidation,
  validateDay,
  reopenValidation,
  corrections,
  requestCorrection,
  reviewCorrection,
  termSummary
};
