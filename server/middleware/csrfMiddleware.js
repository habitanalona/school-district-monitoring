"use strict";

const { HttpError } = require("../utils/httpError");
const { createCsrfToken, safeEqual } = require("../utils/tokens");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = createCsrfToken();
  }
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) {
    return next();
  }

  const submitted = req.get("x-csrf-token") || (req.body && req.body._csrf);
  const expected = req.session && req.session.csrfToken;

  if (!submitted || !expected || !safeEqual(String(submitted), String(expected))) {
    return next(
      new HttpError(403, "Your security token is invalid or expired. Refresh the page and try again.", "CSRF_INVALID")
    );
  }

  return next();
}

module.exports = { ensureCsrfToken, csrfProtection };
