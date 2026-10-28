"use strict";

const registrationService = require("../services/registrationService");
const { requireIdParam, optionalString } = require("../utils/validators");

async function list(req, res) {
  const result = await registrationService.listPendingForActor(req.user);
  res.json({
    data: result.approvals,
    meta: {
      pendingCount: result.pendingCount,
      approverRole: result.approverRole,
      approverLabel: result.approverLabel
    }
  });
}

async function approve(req, res) {
  const user = await registrationService.approve(
    { ...req.user, ipAddress: req.ip || null },
    requireIdParam(req.params.id, "Registration ID")
  );
  res.json({ data: user });
}

async function reject(req, res) {
  const note = optionalString(req.body.note, "Reason", { max: 500 });
  const user = await registrationService.reject(
    { ...req.user, ipAddress: req.ip || null },
    requireIdParam(req.params.id, "Registration ID"),
    note
  );
  res.json({ data: user });
}

module.exports = { list, approve, reject };
