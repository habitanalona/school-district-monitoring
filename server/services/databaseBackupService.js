"use strict";

// Plain-SQL database backup for the system administrator.
//
// pg_dump is executed with an argument array and libpq environment variables,
// so the connection string (and its password) never appears in the process list
// or in logs. The dump is written to a private temporary file, streamed by the
// controller, and deleted when the response closes.

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const config = require("../config/env");
const { HttpError } = require("../utils/httpError");

const TIMEOUT_MS = 10 * 60 * 1000;
// One dump at a time across the whole system; concurrent pg_dump runs would
// compete for database resources and produce near-identical files.
let activeUserId = null;

function connectionEnv() {
  const url = new URL(config.databaseUrl);
  const database = decodeURIComponent(url.pathname.replace(/^\//, "")) || "postgres";
  const env = {
    PGCONNECT_TIMEOUT: "15",
    PGHOST: decodeURIComponent(url.hostname),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database
  };
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode) {
    env.PGSSLMODE = sslmode;
  } else if (config.databaseSsl) {
    env.PGSSLMODE = "require";
  }
  return { database, env };
}

function timestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

function safeName(value) {
  return String(value || "database").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
}

function begin(userId) {
  if (activeUserId !== null) {
    throw new HttpError(
      409,
      "A backup is already being generated. Wait for the current download to finish.",
      "BACKUP_IN_PROGRESS"
    );
  }
  activeUserId = userId;
}

function end(userId) {
  if (activeUserId !== null && String(activeUserId) === String(userId)) {
    activeUserId = null;
  }
}

function remove(filePath) {
  if (!filePath) {
    return;
  }
  fs.promises.unlink(filePath).catch(() => {});
}

async function createDump() {
  const { database, env } = connectionEnv();
  const fileName = `database_backup_${safeName(database)}_${timestamp()}.sql`;
  const filePath = path.join(os.tmpdir(), `sdms-db-backup-${crypto.randomBytes(8).toString("hex")}.sql`);

  try {
    await new Promise((resolve, reject) => {
      execFile(
        "pg_dump",
        ["--format=plain", "--no-owner", "--no-privileges", "--file", filePath],
        { env: { ...process.env, ...env }, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
        (error) => {
          if (error) {
            const failure = new HttpError(
              500,
              "The backup could not be generated. Verify that pg_dump is installed and the database is reachable.",
              "BACKUP_FAILED"
            );
            failure.cause = error;
            return reject(failure);
          }
          resolve();
        }
      );
    });

    const stat = await fs.promises.stat(filePath);
    return { filePath, fileName, sizeBytes: stat.size, database };
  } catch (error) {
    remove(filePath);
    console.error("Database backup failed:", error.message);
    throw error;
  }
}

module.exports = { createDump, begin, end, remove };
