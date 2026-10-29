"use strict";

const learnerReportService = require("../services/learnerReportService");
const { assertCanViewReports } = require("../utils/learnerAccess");
const { requireInteger } = require("../utils/validators");

function optionalId(value) {
  if (value === undefined || value === null || value === "" || value === 0 || value === "0") {
    return null;
  }
  return requireInteger(value, "Filter", { min: 1 });
}

function optionalSearch(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return String(value).trim().slice(0, 100);
}

async function list(req, res) {
  assertCanViewReports(req.user);
  res.json({
    data: Object.entries(learnerReportService.REPORT_DEFINITIONS).map(([type, definition]) => ({
      type,
      label: definition.label,
      scope: definition.scope,
      downloadUrl: `/api/learner-reports/${type}.csv`
    }))
  });
}

async function download(req, res) {
  assertCanViewReports(req.user);
  const report = await learnerReportService.buildReport(req.user, req.params.type, {
    schoolId: optionalId(req.query.schoolId),
    schoolYearId: optionalId(req.query.schoolYearId),
    gradeLevelId: optionalId(req.query.gradeLevelId),
    sectionId: optionalId(req.query.sectionId),
    learnerId: optionalId(req.query.learnerId),
    search: optionalSearch(req.query.search)
  });

  const asciiName = report.filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(report.filename)}`
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.send(report.csv);
}

module.exports = { list, download };
