"use strict";

const userService = require("../services/userService");
const {
  fail,
  requireString,
  requireEmail,
  requireUsername,
  requirePassword,
  requireEnum,
  optionalEnum,
  requireInteger,
  optionalString,
  parsePagination,
  parseSort,
  parseDirection,
  requireIdParam,
  ROLES
} = require("../utils/validators");

function actorFrom(req) {
  return { ...req.user, ipAddress: req.ip || null };
}

function parseStatusFilter(value) {
  if (!value) {
    return "";
  }
  if (value === "active") {
    return "true";
  }
  if (value === "inactive") {
    return "false";
  }
  fail("Status must be active or inactive.", { field: "status" });
  return "";
}

function districtValue(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requireInteger(value, "District", { min: 1 });
}

function schoolValue(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requireInteger(value, "School", { min: 1 });
}

function optionalPassword(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return requirePassword(value, "Password");
}

function requireBoolean(value, field) {
  if (typeof value !== "boolean") {
    fail(`${field} must be true or false.`, { field });
  }
  return value;
}

async function list(req, res) {
  const pagination = parsePagination(req.query);
  const result = await userService.listUsers({
    actor: req.user,
    search: optionalString(req.query.search, "Search", { max: 100 }) || "",
    role: optionalEnum(req.query.role, "Role", ROLES) || "",
    status: parseStatusFilter(req.query.status),
    sort: parseSort(req.query.sort, Object.keys(userService.SORT_COLUMNS), "name"),
    direction: parseDirection(req.query.direction),
    page: pagination.page,
    pageSize: pagination.pageSize
  });

  res.json({
    data: result.users,
    pagination: {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / result.pageSize))
    }
  });
}

async function create(req, res) {
  const user = await userService.createUser(actorFrom(req), {
    fullName: requireString(req.body.fullName, "Full name", { min: 2, max: 160 }),
    username: requireUsername(req.body.username),
    email: requireEmail(req.body.email),
    password: requirePassword(req.body.password),
    role: requireEnum(req.body.role, "Role", ROLES),
    districtId: districtValue(req.body.districtId),
    schoolId: schoolValue(req.body.schoolId),
    isActive: req.body.isActive === undefined ? true : requireBoolean(req.body.isActive, "Active status")
  });
  res.status(201).json({ data: user });
}

async function update(req, res) {
  const user = await userService.updateUser(actorFrom(req), requireIdParam(req.params.id, "User ID"), {
    fullName: requireString(req.body.fullName, "Full name", { min: 2, max: 160 }),
    email: requireEmail(req.body.email),
    role: requireEnum(req.body.role, "Role", ROLES),
    districtId: districtValue(req.body.districtId),
    schoolId: schoolValue(req.body.schoolId),
    isActive: requireBoolean(req.body.isActive, "Active status"),
    password: optionalPassword(req.body.password)
  });
  res.json({ data: user });
}

async function updateStatus(req, res) {
  const user = await userService.setUserStatus(
    actorFrom(req),
    requireIdParam(req.params.id, "User ID"),
    requireBoolean(req.body.isActive, "Active status")
  );
  res.json({ data: user });
}

module.exports = { list, create, update, updateStatus };
