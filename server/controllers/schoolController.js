"use strict";

const schoolService = require("../services/schoolService");
const { resolveScope } = require("../utils/scope");
const {
  fail,
  requireString,
  requireEmail,
  optionalEmail,
  optionalPhone,
  requireEnum,
  optionalEnum,
  requireInteger,
  optionalNumber,
  optionalPeriod,
  optionalString,
  parsePagination,
  parseSort,
  parseDirection,
  requireIdParam,
  SCHOOL_TYPES,
  SCHOOL_STATUSES,
  REPORT_STATUSES
} = require("../utils/validators");

function actorFrom(req) {
  return { ...req.user, ipAddress: req.ip || null };
}

function parseStatus(value) {
  if (!value) {
    return "";
  }
  const allowed = [...SCHOOL_STATUSES, "all"];
  if (!allowed.includes(value)) {
    fail(`Status must be one of: ${allowed.join(", ")}.`, { field: "status" });
  }
  return value;
}

function readSchoolPayload(body, actor) {
  const code = requireString(body.schoolCode, "School code", { min: 3, max: 32 }).toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(code)) {
    fail("School code may only contain letters, numbers, and hyphens.", { field: "schoolCode" });
  }

  const districtId =
    actor.role === "system_admin"
      ? requireInteger(body.districtId, "District", { min: 1 })
      : actor.districtId;

  return {
    schoolCode: code,
    schoolName: requireString(body.schoolName, "School name", { min: 2, max: 200 }),
    schoolType: requireEnum(body.schoolType, "School type", SCHOOL_TYPES),
    address: requireString(body.address, "Address", { min: 5, max: 500 }),
    districtId,
    schoolHead: requireString(body.schoolHead, "School head", { min: 2, max: 160 }),
    contactEmail: optionalEmail(body.contactEmail),
    contactPhone: optionalPhone(body.contactPhone),
    studentCount: requireInteger(body.studentCount, "Student count", { min: 0, max: 1000000 }),
    teacherCount: requireInteger(body.teacherCount, "Teaching personnel count", { min: 0, max: 100000 }),
    performanceScore: optionalNumber(body.performanceScore, "Performance score", { min: 0, max: 100 }),
    status: requireEnum(body.status || "active", "School status", ["active", "inactive"])
  };
}

async function list(req, res) {
  const pagination = parsePagination(req.query);
  const period = optionalPeriod(req.query.period);
  const result = await schoolService.listSchools({
    districtScopeId: resolveScope(req.user, req.query.districtId),
    search: optionalString(req.query.search, "Search", { max: 100 }) || "",
    schoolType: optionalEnum(req.query.type, "School type", SCHOOL_TYPES) || "",
    status: parseStatus(req.query.status),
    reportStatus: optionalEnum(req.query.reportStatus, "Reporting status", REPORT_STATUSES) || "",
    period,
    sort: parseSort(req.query.sort, Object.keys(schoolService.SORT_COLUMNS), "name"),
    direction: parseDirection(req.query.direction),
    page: pagination.page,
    pageSize: pagination.pageSize
  });

  res.json({
    data: result.schools,
    pagination: {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / result.pageSize))
    }
  });
}

async function sidebar(req, res) {
  const result = await schoolService.sidebarSchools(
    resolveScope(req.user, req.query.districtId),
    optionalString(req.query.search, "Search", { max: 100 }) || ""
  );
  res.json({ data: result });
}

async function detail(req, res) {
  const school = await schoolService.getSchool(
    requireIdParam(req.params.id, "School ID"),
    resolveScope(req.user, req.query.districtId),
    optionalPeriod(req.query.period)
  );
  res.json({ data: school });
}

async function create(req, res) {
  const payload = readSchoolPayload(req.body, req.user);
  const school = await schoolService.createSchool(actorFrom(req), payload);
  res.status(201).json({ data: school });
}

async function update(req, res) {
  const payload = readSchoolPayload(req.body, req.user);
  const school = await schoolService.updateSchool(
    actorFrom(req),
    requireIdParam(req.params.id, "School ID"),
    payload
  );
  res.json({ data: school });
}

async function archive(req, res) {
  const school = await schoolService.archiveSchool(
    actorFrom(req),
    requireIdParam(req.params.id, "School ID")
  );
  res.json({ data: school });
}

async function restore(req, res) {
  const school = await schoolService.restoreSchool(
    actorFrom(req),
    requireIdParam(req.params.id, "School ID")
  );
  res.json({ data: school });
}

module.exports = { list, sidebar, detail, create, update, archive, restore };
