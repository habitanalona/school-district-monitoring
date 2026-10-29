"use strict";

const permissionService = require("../services/permissionService");
const { query } = require("../config/database");
const { MODULE_DEFINITIONS } = require("../utils/permissionModules");
const { ROLE_DEFINITIONS } = require("../utils/roles");
const {
  optionalString,
  optionalEnum,
  requireInteger,
  requireIdParam,
  parsePagination,
  ROLES
} = require("../utils/validators");

function readStatus(value) {
  if (!value || value === "all") {
    return "";
  }
  if (value === "active") {
    return "true";
  }
  if (value === "inactive") {
    return "false";
  }
  return "";
}

async function catalog(req, res) {
  const schools = await query(
    `SELECT s.id, s.school_name, s.school_code, s.district_id, d.district_name
     FROM schools s
     JOIN districts d ON d.id = s.district_id
     ORDER BY d.district_name ASC, s.school_name ASC`
  );

  res.json({
    data: {
      modules: MODULE_DEFINITIONS.map((definition) => ({
        key: definition.key,
        label: definition.label,
        description: definition.description,
        group: definition.group,
        actions: definition.actions,
        grantRoles: definition.grantRoles,
        defaults: definition.defaults
      })),
      roles: ROLE_DEFINITIONS.map((definition) => ({
        value: definition.value,
        label: definition.label,
        short: definition.short,
        fullLabel: definition.fullLabel || definition.label
      })),
      schools: schools.rows.map((row) => ({
        id: Number(row.id),
        name: row.school_name,
        code: row.school_code,
        districtId: Number(row.district_id),
        districtName: row.district_name
      }))
    }
  });
}

async function listUsers(req, res) {
  const pagination = parsePagination(req.query);
  const schoolId = req.query.schoolId
    ? requireInteger(req.query.schoolId, "School", { min: 1 })
    : null;
  const result = await permissionService.listUsersForRights({
    search: optionalString(req.query.search, "Search", { max: 100 }) || "",
    role: optionalEnum(req.query.role, "Role", ROLES) || "",
    schoolId,
    status: readStatus(req.query.status),
    page: pagination.page,
    pageSize: pagination.pageSize
  });
  res.json({
    data: result.users,
    summary: result.summary,
    pagination: {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / result.pageSize))
    }
  });
}

async function detail(req, res) {
  const detail = await permissionService.getUserDetail(requireIdParam(req.params.id, "User ID"));
  res.json({ data: detail });
}

async function save(req, res) {
  const detail = await permissionService.saveUserPermissions(
    req.user,
    requireIdParam(req.params.id, "User ID"),
    req.body.permissions,
    req.ip || null
  );
  res.json({ data: detail });
}

async function history(req, res) {
  const rows = await permissionService.permissionHistory(
    requireIdParam(req.params.id, "User ID"),
    30
  );
  res.json({ data: rows });
}

module.exports = { catalog, listUsers, detail, save, history };
