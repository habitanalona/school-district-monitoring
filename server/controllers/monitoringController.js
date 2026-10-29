"use strict";

const schoolFormsService = require("../services/schoolFormsService");
const { requireIdParam } = require("../utils/validators");

function actorFrom(req) {
  return { ...req.user, ipAddress: req.ip || null };
}

function optionalId(value, field) {
  return value === undefined || value === null || value === "" ? null : requireIdParam(value, field);
}

async function summary(req, res) {
  const data = await schoolFormsService.monitoring(actorFrom(req), {
    schoolId: optionalId(req.query.schoolId, "School"),
    districtId: optionalId(req.query.districtId, "District"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year")
  });
  res.json({ data });
}

async function discrepancies(req, res) {
  const data = await schoolFormsService.discrepancies(actorFrom(req), {
    schoolId: optionalId(req.query.schoolId, "School"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year")
  });
  res.json({ data });
}

async function auditTrail(req, res) {
  const data = await schoolFormsService.auditTrail(actorFrom(req), {
    schoolId: optionalId(req.query.schoolId, "School"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    submissionId: optionalId(req.query.submissionId, "Submission")
  });
  res.json({ data });
}

module.exports = { summary, discrepancies, auditTrail };
