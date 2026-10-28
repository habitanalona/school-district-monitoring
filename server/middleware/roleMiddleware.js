"use strict";

function requireRole(...roles) {
  return function roleGuard(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        error: "Authentication required.",
        code: "AUTH_REQUIRED"
      });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: "You do not have permission to perform this action.",
        code: "FORBIDDEN"
      });
    }
    return next();
  };
}

const requireAdmin = requireRole("system_admin", "district_admin");
const requireSystemAdmin = requireRole("system_admin");

module.exports = { requireRole, requireAdmin, requireSystemAdmin };
