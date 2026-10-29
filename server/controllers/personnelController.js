"use strict";

const personnelService = require("../services/personnelService");
const { requireIdParam, parseBoolean, requireEnum } = require("../utils/validators");

function actorFrom(req) {
  return { ...req.user, ipAddress: req.ip || null };
}

function optionalId(value, field) {
  return value === undefined || value === null || value === "" ? null : requireIdParam(value, field);
}

async function list(req, res) {
  res.json({
    data: await personnelService.listPersonnel(actorFrom(req), {
      schoolId: optionalId(req.query.schoolId, "School"),
      search: (req.query.search || "").trim(),
      teaching:
        req.query.teaching === undefined || req.query.teaching === ""
          ? null
          : parseBoolean(req.query.teaching, true),
      employmentStatus: req.query.employmentStatus
        ? requireEnum(req.query.employmentStatus, "Employment status", personnelService.EMPLOYMENT_STATUSES)
        : ""
    })
  });
}

async function create(req, res) {
  res.status(201).json({ data: await personnelService.createProfile(actorFrom(req), req.body, { ip: req.ip }) });
}

async function detail(req, res) {
  res.json({
    data: await personnelService.getProfile(
      actorFrom(req),
      requireIdParam(req.params.id, "Personnel")
    )
  });
}

async function update(req, res) {
  res.json({
    data: await personnelService.updateProfile(
      actorFrom(req),
      requireIdParam(req.params.id, "Personnel"),
      req.body,
      { ip: req.ip }
    )
  });
}

async function archive(req, res) {
  res.json({
    data: await personnelService.archiveProfile(
      actorFrom(req),
      requireIdParam(req.params.id, "Personnel")
    )
  });
}

async function assignments(req, res) {
  res.json({
    data: await personnelService.assignmentSummary(actorFrom(req), {
      schoolId: optionalId(req.query.schoolId, "School"),
      schoolYearId: optionalId(req.query.schoolYearId, "School year")
    })
  });
}

async function summary(req, res) {
  res.json({
    data: await personnelService.summaryCounts(actorFrom(req), {
      schoolId: optionalId(req.query.schoolId, "School")
    })
  });
}

module.exports = { list, create, detail, update, archive, assignments, summary };
