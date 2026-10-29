"use strict";

const reportCardService = require("../services/reportCardService");
const { requireIdParam } = require("../utils/validators");

function actorFrom(req) {
  return { ...req.user, ipAddress: req.ip || null };
}

function optionalId(value, field) {
  return value === undefined || value === null || value === "" ? null : requireIdParam(value, field);
}

function sendFile(res, result) {
  const disposition = result.type === "pdf" || result.type === "csv" ? "inline" : "inline";
  res.setHeader("Content-Disposition", `${disposition}; filename="${result.filename}"`);
  res.setHeader("Cache-Control", "no-store");
  if (result.type === "pdf") {
    res.type("application/pdf").send(result.buffer);
    return;
  }
  if (result.type === "csv") {
    res.type("text/csv; charset=utf-8").send(result.csv);
    return;
  }
  res.type("html").send(result.html);
}

async function list(req, res) {
  res.json({
    data: await reportCardService.list(actorFrom(req), {
      schoolId: optionalId(req.query.schoolId, "School"),
      schoolYearId: optionalId(req.query.schoolYearId, "School year"),
      sectionId: optionalId(req.query.sectionId, "Section"),
      gradeLevelId: optionalId(req.query.gradeLevelId, "Grade level"),
      status: req.query.status || "",
      search: req.query.search || ""
    })
  });
}

async function generate(req, res) {
  res.json({
    data: await reportCardService.generate(actorFrom(req), req.body, { ip: req.ip })
  });
}

async function detail(req, res) {
  res.json({
    data: await reportCardService.detail(
      actorFrom(req),
      requireIdParam(req.params.id, "Report card")
    )
  });
}

async function finalize(req, res) {
  res.json({
    data: await reportCardService.finalize(
      actorFrom(req),
      requireIdParam(req.params.id, "Report card"),
      req.body,
      { ip: req.ip }
    )
  });
}

async function reopen(req, res) {
  res.json({
    data: await reportCardService.reopen(
      actorFrom(req),
      requireIdParam(req.params.id, "Report card"),
      req.body,
      { ip: req.ip }
    )
  });
}

async function render(req, res) {
  sendFile(
    res,
    await reportCardService.render(
      actorFrom(req),
      requireIdParam(req.params.id, "Report card"),
      req.query.format || "pdf"
    )
  );
}

async function batch(req, res) {
  const filters = {
    sectionId: req.query.sectionId,
    schoolYearId: optionalId(req.query.schoolYearId, "School year")
  };
  if (!filters.sectionId) {
    res.status(400).json({ error: "A section is required for batch printing.", code: "SECTION_REQUIRED" });
    return;
  }
  filters.sectionId = requireIdParam(filters.sectionId, "Section");
  sendFile(
    res,
    await reportCardService.batch(actorFrom(req), filters, req.query.format || "pdf")
  );
}

async function exportCsv(req, res) {
  const result = await reportCardService.exportCsv(actorFrom(req), {
    schoolId: optionalId(req.query.schoolId, "School"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    sectionId: optionalId(req.query.sectionId, "Section"),
    gradeLevelId: optionalId(req.query.gradeLevelId, "Grade level"),
    status: req.query.status || "",
    search: req.query.search || ""
  });
  res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
  res.setHeader("Cache-Control", "no-store");
  res.type("text/csv; charset=utf-8").send(result.csv);
}

module.exports = {
  list,
  generate,
  detail,
  finalize,
  reopen,
  render,
  batch,
  exportCsv
};
