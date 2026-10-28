"use strict";

const { HttpError } = require("./httpError");
const { ROLES } = require("./roles");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const PERIOD_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;
const PHONE_PATTERN = /^[0-9+()\-\s.]+$/;

const SCHOOL_TYPES = ["Elementary School", "High School", "Integrated School", "Senior High School"];
const SCHOOL_STATUSES = ["active", "inactive", "archived"];
const REPORT_TYPES = ["Monthly Enrollment", "Performance Review", "Compliance"];
const REPORT_STATUSES = ["pending", "submitted", "late", "reviewed"];
const ANNOUNCEMENT_STATUSES = ["draft", "published", "archived"];

function fail(message, details) {
  throw new HttpError(400, message, "VALIDATION_ERROR", details);
}

function requireString(value, field, options = {}) {
  const { min = 1, max = 255 } = options;
  if (typeof value !== "string" || !value.trim()) {
    fail(`${field} is required.`, { field });
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    fail(`${field} must be between ${min} and ${max} characters.`, { field });
  }
  return trimmed;
}

function optionalString(value, field, options = {}) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requireString(value, field, options);
}

function requireEmail(value, field = "Email") {
  const email = requireString(value, field, { max: 160 }).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    fail(`Enter a valid ${field.toLowerCase()}.`, { field });
  }
  return email;
}

function optionalEmail(value, field = "Contact email") {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requireEmail(value, field);
}

function optionalPhone(value, field = "Contact phone") {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const phone = requireString(value, field, { max: 32 });
  if (!PHONE_PATTERN.test(phone)) {
    fail(`${field} may only contain numbers, spaces, and + ( ) - . characters.`, { field });
  }
  return phone;
}

function requireUsername(value) {
  const username = requireString(value, "Username", { min: 3, max: 64 });
  if (!USERNAME_PATTERN.test(username)) {
    fail("Username may only contain letters, numbers, dots, underscores, and hyphens.", { field: "username" });
  }
  return username;
}

function requirePassword(value, field = "Password") {
  if (typeof value !== "string" || value.length < 10 || value.length > 128) {
    fail(`${field} must be between 10 and 128 characters.`, { field });
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    fail(`${field} must include at least one letter and one number.`, { field });
  }
  return value;
}

function requireEnum(value, field, allowed) {
  const normalized = typeof value === "string" ? value.trim() : value;
  if (!allowed.includes(normalized)) {
    fail(`${field} must be one of: ${allowed.join(", ")}.`, { field, allowed });
  }
  return normalized;
}

function optionalEnum(value, field, allowed) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requireEnum(value, field, allowed);
}

function requireInteger(value, field, options = {}) {
  const { min = 0, max = Number.MAX_SAFE_INTEGER } = options;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    fail(`${field} must be a whole number between ${min} and ${max}.`, { field });
  }
  return number;
}

function optionalNumber(value, field, options = {}) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const number = Number(value);
  const { min = 0, max = Number.MAX_SAFE_INTEGER } = options;
  if (!Number.isFinite(number) || number < min || number > max) {
    fail(`${field} must be a number between ${min} and ${max}.`, { field });
  }
  return Math.round(number * 100) / 100;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (value === true || value === "true" || value === 1 || value === "1") {
    return true;
  }
  if (value === false || value === "false" || value === 0 || value === "0") {
    return false;
  }
  fail("Boolean value is invalid.");
}

function requirePeriod(value, field = "Reporting period") {
  const period = requireString(value, field, { min: 7, max: 7 });
  if (!PERIOD_PATTERN.test(period)) {
    fail(`${field} must use the YYYY-MM format.`, { field });
  }
  return period;
}

function optionalPeriod(value, field = "Reporting period") {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requirePeriod(value, field);
}

function parsePagination(query) {
  const page = query.page === undefined ? 1 : requireInteger(query.page, "Page", { min: 1, max: 100000 });
  const pageSize = query.pageSize === undefined ? 10 : requireInteger(query.pageSize, "Page size", { min: 1, max: 100 });
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function parseSort(value, allowed, fallback) {
  if (!value || !allowed.includes(value)) {
    return fallback;
  }
  return value;
}

function parseDirection(value, fallback = "asc") {
  if (!value) {
    return fallback;
  }
  const normalized = String(value).toLowerCase();
  return normalized === "desc" ? "desc" : "asc";
}

function requireIdParam(value, field = "ID") {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    fail(`${field} is invalid.`, { field });
  }
  return id;
}

function requireIp(value) {
  if (!value) {
    return null;
  }
  return String(value).replace(/^::ffff:/, "").slice(0, 64);
}

module.exports = {
  EMAIL_PATTERN,
  ROLES,
  SCHOOL_TYPES,
  SCHOOL_STATUSES,
  REPORT_TYPES,
  REPORT_STATUSES,
  ANNOUNCEMENT_STATUSES,
  fail,
  requireString,
  optionalString,
  requireEmail,
  optionalEmail,
  optionalPhone,
  requireUsername,
  requirePassword,
  requireEnum,
  optionalEnum,
  requireInteger,
  optionalNumber,
  parseBoolean,
  requirePeriod,
  optionalPeriod,
  parsePagination,
  parseSort,
  parseDirection,
  requireIdParam,
  requireIp
};
