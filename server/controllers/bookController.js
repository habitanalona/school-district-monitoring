"use strict";

const bookService = require("../services/bookService");
const { requireIdParam, parsePagination, parseBoolean } = require("../utils/validators");

function actorFrom(req) {
  return { ...req.user, ipAddress: req.ip || null };
}

function optionalId(value, field) {
  return value === undefined || value === null || value === "" ? null : requireIdParam(value, field);
}

function filters(req) {
  const pagination = parsePagination(req.query);
  return {
    schoolId: optionalId(req.query.schoolId, "School"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    subjectId: optionalId(req.query.subjectId, "Subject"),
    gradeLevelId: optionalId(req.query.gradeLevelId, "Grade level"),
    learnerId: optionalId(req.query.learnerId, "Learner"),
    sectionId: optionalId(req.query.sectionId, "Section"),
    status: req.query.status || "",
    search: (req.query.search || "").trim(),
    outstandingOnly: parseBoolean(req.query.outstandingOnly, false),
    page: pagination.page,
    pageSize: pagination.pageSize
  };
}

async function catalog(req, res) {
  res.json({ data: await bookService.listCatalog(actorFrom(req), filters(req)) });
}

async function createCatalog(req, res) {
  res.status(201).json({ data: await bookService.createCatalog(actorFrom(req), req.body) });
}

async function updateCatalog(req, res) {
  res.json({
    data: await bookService.updateCatalog(
      actorFrom(req),
      requireIdParam(req.params.id, "Book"),
      req.body
    )
  });
}

async function archiveCatalog(req, res) {
  res.json({
    data: await bookService.archiveCatalog(actorFrom(req), requireIdParam(req.params.id, "Book"))
  });
}

async function issuances(req, res) {
  res.json({ data: await bookService.listIssuances(actorFrom(req), filters(req)) });
}

async function issue(req, res) {
  res.status(201).json({ data: await bookService.issueBooks(actorFrom(req), req.body) });
}

async function returnBooks(req, res) {
  res.status(201).json({
    data: await bookService.returnBooks(
      actorFrom(req),
      requireIdParam(req.params.id, "Issuance"),
      req.body
    )
  });
}

async function history(req, res) {
  res.json({
    data: await bookService.issuanceHistory(
      actorFrom(req),
      requireIdParam(req.params.id, "Issuance")
    )
  });
}

async function summary(req, res) {
  res.json({ data: await bookService.summary(actorFrom(req), filters(req)) });
}

module.exports = {
  catalog,
  createCatalog,
  updateCatalog,
  archiveCatalog,
  issuances,
  issue,
  returnBooks,
  history,
  summary
};
