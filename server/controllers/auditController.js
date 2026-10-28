"use strict";

const auditService = require("../services/auditService");
const { resolveScope } = require("../utils/scope");
const { optionalString, parsePagination } = require("../utils/validators");

async function list(req, res) {
  const pagination = parsePagination(req.query);
  const result = await auditService.listAuditLogs({
    districtScopeId: resolveScope(req.user, req.query.districtId),
    page: pagination.page,
    pageSize: pagination.pageSize,
    search: optionalString(req.query.search, "Search", { max: 100 }) || "",
    action: optionalString(req.query.action, "Action", { max: 80 }) || "",
    entityType: optionalString(req.query.entityType, "Entity type", { max: 48 }) || ""
  });

  res.json({
    data: result.logs,
    pagination: {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / result.pageSize))
    }
  });
}

module.exports = { list };
