"use strict";

const dashboardService = require("../services/dashboardService");
const { resolveScope } = require("../utils/scope");
const { optionalPeriod } = require("../utils/validators");

function scopeFrom(req) {
  return resolveScope(req.user, req.query.districtId);
}

function periodFrom(req) {
  return optionalPeriod(req.query.period);
}

async function summary(req, res) {
  const districtId = scopeFrom(req);
  const period = await dashboardService.getSummary(districtId, periodFrom(req));
  res.json({ data: { ...period, districtId } });
}

async function enrollment(req, res) {
  const districtId = scopeFrom(req);
  const schools = await dashboardService.getEnrollment(districtId);
  res.json({ data: { schools } });
}

async function performance(req, res) {
  const districtId = scopeFrom(req);
  const schools = await dashboardService.getPerformance(districtId);
  res.json({ data: { schools } });
}

async function reportStatus(req, res) {
  const districtId = scopeFrom(req);
  const status = await dashboardService.getReportStatus(districtId, periodFrom(req));
  res.json({ data: { ...status, districtId } });
}

async function recentActivity(req, res) {
  const districtId = scopeFrom(req);
  const activities = await dashboardService.getRecentActivity(districtId, 8);
  res.json({ data: { activities } });
}

module.exports = { summary, enrollment, performance, reportStatus, recentActivity };
