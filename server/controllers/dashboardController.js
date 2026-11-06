"use strict";

const dashboardService = require("../services/dashboardService");
const { resolveScope, schoolScopeFor, workspaceFor } = require("../utils/scope");
const { optionalPeriod } = require("../utils/validators");

function scopeFrom(req) {
  return {
    districtId: resolveScope(req.user, req.query.districtId),
    schoolId: schoolScopeFor(req.user, req.query.schoolId),
    workspace: workspaceFor(req.user),
    userId: req.user.id
  };
}

function periodFrom(req) {
  return optionalPeriod(req.query.period);
}

async function summary(req, res) {
  const scope = scopeFrom(req);
  const period = await dashboardService.getSummary(scope, periodFrom(req));
  res.json({ data: { ...period, districtId: scope.districtId, schoolId: scope.schoolId } });
}

async function enrollment(req, res) {
  const scope = scopeFrom(req);
  const schools = await dashboardService.getEnrollment(scope);
  res.json({ data: { schools } });
}

async function performance(req, res) {
  const scope = scopeFrom(req);
  const schools = await dashboardService.getPerformance(scope);
  res.json({ data: { schools } });
}

async function reportStatus(req, res) {
  const scope = scopeFrom(req);
  const status = await dashboardService.getReportStatus(scope, periodFrom(req));
  res.json({
    data: { ...status, districtId: scope.districtId, schoolId: scope.schoolId }
  });
}

async function recentActivity(req, res) {
  const scope = scopeFrom(req);
  const activities = await dashboardService.getRecentActivity(scope, 8);
  res.json({ data: { activities } });
}

module.exports = { summary, enrollment, performance, reportStatus, recentActivity };
