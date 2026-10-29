"use strict";

const healthService = require("../services/healthService");
const { requireIdParam, requireEnum } = require("../utils/validators");

function actorFrom(req) {
  return { ...req.user, ipAddress: req.ip || null };
}

function optionalId(value, field) {
  return value === undefined || value === null || value === "" ? null : requireIdParam(value, field);
}

async function list(req, res) {
  res.json({
    data: await healthService.listMeasurements(actorFrom(req), {
      schoolId: optionalId(req.query.schoolId, "School"),
      schoolYearId: optionalId(req.query.schoolYearId, "School year"),
      sectionId: optionalId(req.query.sectionId, "Section"),
      learnerId: optionalId(req.query.learnerId, "Learner"),
      status: req.query.status
        ? requireEnum(req.query.status, "Nutritional status", healthService.NUTRITIONAL_STATUSES)
        : ""
    })
  });
}

async function create(req, res) {
  res.status(201).json({ data: await healthService.createMeasurement(actorFrom(req), req.body) });
}

async function detail(req, res) {
  res.json({
    data: await healthService.getMeasurement(
      actorFrom(req),
      requireIdParam(req.params.id, "Measurement")
    )
  });
}

async function update(req, res) {
  res.json({
    data: await healthService.updateMeasurement(
      actorFrom(req),
      requireIdParam(req.params.id, "Measurement"),
      req.body
    )
  });
}

async function trend(req, res) {
  res.json({
    data: await healthService.learnerTrend(
      actorFrom(req),
      requireIdParam(req.params.learnerId, "Learner"),
      { schoolYearId: optionalId(req.query.schoolYearId, "School year") }
    )
  });
}

async function summary(req, res) {
  res.json({
    data: await healthService.schoolSummary(actorFrom(req), {
      schoolId: optionalId(req.query.schoolId, "School"),
      schoolYearId: optionalId(req.query.schoolYearId, "School year")
    })
  });
}

module.exports = { list, create, detail, update, trend, summary };
