"use strict";

// SuperAdmin session loading and enforcement. SuperAdmin identity lives in
// superadmin_users and is carried by req.session.superadminId — completely
// separate from the ordinary users session. Every unauthorized attempt to
// reach a security endpoint is recorded as a security event.

const superAdminService = require("../services/security/superAdminService");
const securityEvents = require("../services/security/securityEventService");

async function loadSuperAdmin(req, res, next) {
  if (!req.session || !req.session.superadminId) {
    return next();
  }
  try {
    const account = await superAdminService.findById(req.session.superadminId);
    if (!account || !account.is_active) {
      return req.session.destroy((error) => {
        if (error) {
          return next(error);
        }
        return next();
      });
    }
    req.superadmin = {
      id: account.id,
      username: account.username,
      fullName: account.full_name,
      email: account.email
    };
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireSuperAdmin(req, res, next) {
  if (req.superadmin) {
    return next();
  }
  // Attempts to touch firewall controls without authorization are recorded.
  securityEvents.record({
    severity: req.user ? "high" : "medium",
    category: "firewall",
    action: req.user ? "FIREWALL_UNAUTHORIZED_ATTEMPT" : "UNAUTHORIZED_SUPERADMIN_ACCESS",
    description: req.user
      ? `User "${req.user.username}" (${req.user.role}) attempted to access SuperAdmin security controls.`
      : "Unauthenticated request attempted to access SuperAdmin security controls.",
    username: req.user ? req.user.username : null,
    userRole: req.user ? req.user.role : null,
    ipAddress: req.ip,
    userAgent: req.get("user-agent") || null,
    requestMethod: req.method,
    endpoint: req.originalUrl,
    firewallDecision: "rejected"
  });
  return res.status(req.user ? 403 : 401).json({
    error: "SuperAdmin authentication required.",
    code: "SUPERADMIN_REQUIRED"
  });
}

module.exports = { loadSuperAdmin, requireSuperAdmin };
