"use strict";

const personnelImportService = require("../services/personnelImportService");
const { requireIdParam, requireString } = require("../utils/validators");
const { HttpError } = require("../utils/httpError");

async function preview(req, res) {
  const result = await personnelImportService.preview(req.user, req.files, req.ip || null);
  res.status(200).json({ data: result });
}

async function commit(req, res) {
  const id = requireIdParam(req.params.id, "Import batch");
  const token = requireString(req.body && req.body.token, "Import token", { min: 32, max: 128 });
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const result = await personnelImportService.commit(
    req.user,
    id,
    token,
    req.ip || null,
    baseUrl
  );
  res.set("Cache-Control", "no-store");
  res.json({ data: result });
}

async function template(req, res) {
  const buffer = personnelImportService.templateWorkbook();
  res.set({
    "Cache-Control": "no-store",
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": 'attachment; filename="staff-import-template.xlsx"',
    "X-Content-Type-Options": "nosniff"
  });
  res.send(buffer);
}

async function errorReport(req, res) {
  const id = requireIdParam(req.params.id, "Import batch");
  const report = await personnelImportService.errorReport(req.user, id);
  res.set({
    "Cache-Control": "no-store",
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${report.filename}"`,
    "X-Content-Type-Options": "nosniff"
  });
  res.send(report.buffer);
}

async function history(req, res) {
  const limit = req.query.limit ? Number(req.query.limit) : 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new HttpError(400, "Limit must be a whole number between 1 and 50.", "VALIDATION_ERROR");
  }
  const data = await personnelImportService.history(req.user, limit);
  res.json({ data });
}

module.exports = { preview, commit, template, errorReport, history };
