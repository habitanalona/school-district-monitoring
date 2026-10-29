"use strict";

const movementService = require("../services/movementService");
const { requireIdParam, requireEnum } = require("../utils/validators");

function actorFrom(req) {
  return { ...req.user, ipAddress: req.ip || null };
}

function optionalId(value, field) {
  return value === undefined || value === null || value === "" ? null : requireIdParam(value, field);
}

async function list(req, res) {
  const data = await movementService.listMovements(actorFrom(req), {
    schoolId: optionalId(req.query.schoolId, "School"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    learnerId: optionalId(req.query.learnerId, "Learner"),
    month: req.query.month || null,
    movementType: req.query.movementType
      ? requireEnum(req.query.movementType, "Movement type", movementService.MOVEMENT_TYPES)
      : "",
    status: req.query.status
      ? requireEnum(req.query.status, "Status", movementService.STATUSES)
      : "",
    search: (req.query.search || "").trim()
  });
  res.json({ data });
}

async function create(req, res) {
  res.status(201).json({ data: await movementService.createMovement(actorFrom(req), req.body) });
}

async function detail(req, res) {
  res.json({
    data: await movementService.getMovement(
      actorFrom(req),
      requireIdParam(req.params.id, "Movement")
    )
  });
}

async function decide(req, res) {
  res.json({
    data: await movementService.decideMovement(
      actorFrom(req),
      requireIdParam(req.params.id, "Movement"),
      req.params.decision,
      req.body
    )
  });
}

async function remove(req, res) {
  res.json({
    data: await movementService.deleteMovement(
      actorFrom(req),
      requireIdParam(req.params.id, "Movement")
    )
  });
}

module.exports = { list, create, detail, decide, remove };
