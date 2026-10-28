"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", "..", ".env") });

function readInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

// Connection strings are routinely pasted with the "DATABASE_URL=" prefix,
// surrounding quotes, a trailing line break, or invisible characters from a
// dashboard. None of those are part of the URL, so strip them before pg sees
// the value. The password itself must stay untouched.
function normalizeDatabaseUrl(raw) {
  let value = String(raw || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
  value = value.replace(/^DATABASE_URL\s*=\s*/i, "");
  const quoted = value.match(/^(["'])([\s\S]*)\1$/);
  if (quoted) {
    value = quoted[2].trim();
  }
  return value;
}

// pg only reports "Invalid URL". Explain the usual causes instead, without
// echoing the credentials.
function databaseUrlProblem(value) {
  if (!value) {
    return "DATABASE_URL is required. Copy .env.example to .env and configure PostgreSQL.";
  }
  if (/\s/.test(value)) {
    return "DATABASE_URL contains whitespace or a line break. Paste the connection string as one unbroken line.";
  }
  if (!/^postgres(ql)?:\/\//i.test(value)) {
    return 'DATABASE_URL must start with "postgresql://". Set the value to the connection string itself, not a DB_HOST/DB_USER/DB_PASSWORD combination.';
  }
  const authority = value.slice(value.indexOf("://") + 3).split(/[/?#]/)[0];
  if (!authority || authority.startsWith(":") || authority.startsWith("@")) {
    return 'DATABASE_URL is missing its host. The string must look like postgresql://user:password@host:5432/database.';
  }
  if ((authority.match(/@/g) || []).length > 1) {
    return 'The password in DATABASE_URL contains a raw "@" (or the host is malformed). URL-encode special characters: @ becomes %40, / becomes %2F, : becomes %3A, # becomes %23, ? becomes %3F.';
  }
  const hostPart = authority.slice(authority.indexOf("@") + 1);
  if (authority.includes("@") && (!hostPart || hostPart.startsWith(":") || hostPart.startsWith("/"))) {
    return 'DATABASE_URL is missing its host. The string must look like postgresql://user:password@host:5432/database.';
  }
  try {
    const parsed = new URL(value);
    if (!parsed.hostname) {
      return 'DATABASE_URL is missing its host. The string must look like postgresql://user:password@host:5432/database.';
    }
  } catch (error) {
    return "DATABASE_URL is not a valid URL. Copy the connection string again from your database provider and URL-encode special characters in the password.";
  }
  return "";
}

const nodeEnv = process.env.NODE_ENV || "development";
const sessionSecret = process.env.SESSION_SECRET || "";
const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);
const databaseUrlError = databaseUrlProblem(databaseUrl);

if (databaseUrlError) {
  throw new Error(databaseUrlError);
}
if (sessionSecret.length < 32) {
  throw new Error("SESSION_SECRET must be at least 32 characters long.");
}

const config = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  isTest: nodeEnv === "test",
  port: readInteger(process.env.PORT, 3000),
  databaseUrl,
  databaseSsl: process.env.DATABASE_SSL === "true",
  sessionSecret,
  sessionName: process.env.SESSION_NAME || "sdms.sid",
  trustProxy: process.env.TRUST_PROXY === "1",
  corsOrigin: process.env.CORS_ORIGIN || "",
  appName: process.env.APP_NAME || "School District Monitoring System",
  appVersion: process.env.APP_VERSION || "1.0.0",
  resetTokenMinutes: readInteger(process.env.RESET_TOKEN_MINUTES, 60)
};

module.exports = config;
