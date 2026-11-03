"use strict";

// Maintenance mode enforcement, applied server-side before page and API
// routes. When maintenance_mode is ON:
//   - authenticated non-SuperAdmin users are redirected to the Under
//     Maintenance page (HTML) or receive 503 SERVICE_UNDER_MAINTENANCE (API);
//   - sign-in is refused for ordinary accounts;
//   - SuperAdmin sessions keep access ONLY to the security console endpoints;
//   - security monitoring and auditing keep running (they live behind
//     /api/security and the worker, which this middleware never blocks).

const guardState = require("../services/security/guardState");

const SECURITY_PAGE = /^\/security-firewall(\.html)?$/;
const SECURITY_API = /^\/api\/security(\/|$)/;
const MAINTENANCE_PAGE = /^\/under-maintenance(\.html)?$/;
const AUTH_LOGIN = /^\/api\/auth\/(login|register|forgot-password|reset-password)/;
const AUTH_SESSION = /^\/api\/auth\/(session|logout)/;
const PUBLIC_PAGES = /^\/?(index|register|reset-password)?(\.html)?$/;

function maintenanceMode(req, res, next) {
  if (!guardState.getSwitch("maintenance_mode")) {
    return next();
  }
  if (req.session && req.session.superadminId) {
    return next();
  }

  const url = req.originalUrl || req.url || "";

  if (SECURITY_API.test(url) || MAINTENANCE_PAGE.test(url) || AUTH_SESSION.test(url)) {
    return next();
  }

  if (req.method === "GET" && (PUBLIC_PAGES.test(url) || !url.startsWith("/api"))) {
    if (url.startsWith("/api")) {
      return next();
    }
    if (SECURITY_PAGE.test(url)) {
      return next();
    }
    if (MAINTENANCE_PAGE.test(url) || PUBLIC_PAGES.test(url)) {
      return next();
    }
    // Any other HTML page: redirect to the maintenance notice. Static assets
    // (css/js/images) pass through so the notice page renders correctly.
    if (/\.(css|js|png|jpg|jpeg|webp|svg|ico|woff2?|txt|map)$/i.test(url)) {
      return next();
    }
    return res.redirect("/under-maintenance.html");
  }

  if (AUTH_LOGIN.test(url)) {
    return res.status(503).json({
      error: "The system is under maintenance. Please try again later.",
      code: "SERVICE_UNDER_MAINTENANCE"
    });
  }

  if (url.startsWith("/api")) {
    return res.status(503).json({
      error: "The system is under maintenance. Please try again later.",
      code: "SERVICE_UNDER_MAINTENANCE"
    });
  }

  return next();
}

module.exports = { maintenanceMode };
