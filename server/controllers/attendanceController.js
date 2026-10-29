"use strict";

const attendanceService = require("../services/attendanceService");
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

module.exports = { sheet, saveSheet, month, summary, learner, calendar, saveCalendar, deleteCalendar };
