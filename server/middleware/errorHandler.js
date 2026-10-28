"use strict";

const config = require("../config/env");

function apiNotFound(req, res) {
  res.status(404).json({
    error: "The requested API endpoint does not exist.",
    code: "NOT_FOUND"
  });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  let status = error.status || 500;
  let code = error.code || "INTERNAL_ERROR";
  let message = error.message || "An unexpected error occurred.";
  let details = error.details;

  if (error.type === "entity.parse.failed") {
    status = 400;
    code = "INVALID_JSON";
    message = "Request body must contain valid JSON.";
    details = undefined;
  }

  if (error.code === "23505") {
    status = 409;
    code = "CONFLICT";
    message = "A record with those details already exists.";
    details = undefined;
  }

  if (error.code === "23503") {
    status = 409;
    code = "RELATED_RECORD";
    message = "This record is still referenced by other data and cannot be changed.";
    details = undefined;
  }

  if (status >= 500) {
    console.error("Unhandled server error:", error);
    if (config.isProduction) {
      message = "An unexpected server error occurred.";
      details = undefined;
    }
  }

  const payload = { error: message, code };
  if (details) {
    payload.details = details;
  }

  res.status(status).json(payload);
}

module.exports = { apiNotFound, errorHandler };
