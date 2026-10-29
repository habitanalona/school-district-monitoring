"use strict";

const { can } = require("../services/permissionService");

function denyApi(res) {
  return res.status(403).json({
    error: "You do not have permission to perform this action.",
    code: "FORBIDDEN"
  });
}

// Guards an API route by module key and action. The permission matrix is
// reloaded from PostgreSQL on every authenticated request by loadUser, so
// revoking a right takes effect on the next request without a re-login.
function requireModule(moduleKey, action = "access") {
  return function moduleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        error: "Authentication required.",
        code: "AUTH_REQUIRED"
      });
    }
    if (!can(req.user.permissionMatrix, moduleKey, action)) {
      return denyApi(res);
    }
    return next();
  };
}

function requireAnyModule(moduleKeys, action = "access") {
  return function anyModuleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        error: "Authentication required.",
        code: "AUTH_REQUIRED"
      });
    }
    const allowed = moduleKeys.some((key) => can(req.user.permissionMatrix, key, action));
    if (!allowed) {
      return denyApi(res);
    }
    return next();
  };
}

function requirePageModule(moduleKey) {
  return function pageModuleGuard(req, res, next) {
    if (!req.user) {
      return res.redirect("/index.html");
    }
    if (!can(req.user.permissionMatrix, moduleKey, "access")) {
      return res.status(403).sendFile(require("path").join(__dirname, "..", "..", "client", "403.html"));
    }
    return next();
  };
}

module.exports = { requireModule, requireAnyModule, requirePageModule };
