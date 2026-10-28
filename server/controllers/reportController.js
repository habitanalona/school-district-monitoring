"use strict";

const reportService = require("../services/reportService");
const dashboardService = require("../services/dashboardService");
const { resolveScope } = require("../utils/scope");
const {
  requireInteger,
  optionalString,
  requireEnum,
  optionalEnum,
  optionalPeriod,
  requirePeriod,
  parsePagination,
  requireIdParam,
  REPORT_TYPES,
  REPORT_STATUSES
} = require("../utils/validators");

function actorFrom(req) {
  return { ...req.user, ipAddress: req.ip || null };
}

function readReportPayload(body) {
  return {
    schoolId: requireInteger(body.schoolId, "School", { min: 1 }),
    reportingPeriod: requirePeriod(body.reportingPeriod),
    reportType: requireEnum(body.reportType, "Report type", REPORT_TYPES),
    submissionStatus: requireEnum(body.submissionStatus, "Submission status", REPORT_STATUSES),
    remarks: optionalString(body.remarks, "Remarks", { max: 2000 })
  };
}

async function list(req, res) {
  const pagination = parsePagination(req.query);
  const schoolId = req.query.schoolId
    ? requireInteger(req.query.schoolId, "School", { min: 1 })
    : null;
  const result = await reportService.listReports({
    districtScopeId: resolveScope(req.user, req.query.districtId),
    period: optionalPeriod(req.query.period) || "",
    status: optionalEnum(req.query.status, "Submission status", REPORT_STATUSES) || "",
    reportType: optionalEnum(req.query.type, "Report type", REPORT_TYPES) || "",
    search: optionalString(req.query.search, "Search", { max: 100 }) || "",
    schoolId,
    page: pagination.page,
    pageSize: pagination.pageSize
  });

  res.json({
    data: result.reports,
    pagination: {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / result.pageSize))
    }
  });
}

async function summary(req, res) {
  const districtScopeId = resolveScope(req.user, req.query.districtId);
  const period =
    optionalPeriod(req.query.period) ||
    (await dashboardService.resolvePeriod(districtScopeId, null));
  const data = await reportService.getReportSummary(districtScopeId, period);
  res.json({ data });
}

async function detail(req, res) {
  const report = await reportService.getReport(
    requireIdParam(req.params.id, "Report ID"),
    resolveScope(req.user, req.query.districtId)
  );
  res.json({ data: report });
}

async function create(req, res) {
  const report = await reportService.createReport(actorFrom(req), readReportPayload(req.body));
  res.status(201).json({ data: report });
}

async function update(req, res) {
  const payload = readReportPayload(req.body);
  const report = await reportService.updateReport(
    actorFrom(req),
    requireIdParam(req.params.id, "Report ID"),
    payload
  );
  res.json({ data: report });
}

module.exports = { list, summary, detail, create, update };
