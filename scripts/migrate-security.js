"use strict";

// Applies database/schema-security.sql (idempotent, additive) and verifies the
// security module tables exist. Existing data and tables are never touched.
// Safe to run repeatedly. Rollback: scripts/migrate-security-rollback.js

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const EXPECTED_TABLES = [
  "superadmin_users",
  "firewall_settings",
  "firewall_control_history",
  "security_events",
  "security_incidents",
  "security_audit_logs",
  "database_activity_logs",
  "code_integrity_records",
  "security_baselines",
  "file_upload_security_logs",
  "system_health_records",
  "security_alerts",
  "backup_records",
  "recovery_sessions",
  "approved_maintenance_sessions"
];

// Columns added after the table first shipped; applied idempotently for
// databases migrated by an earlier version of this script.
const COLUMN_PATCHES = [
  "ALTER TABLE recovery_sessions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()",
  "ALTER TABLE code_integrity_records ALTER COLUMN size_bytes DROP NOT NULL"
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is missing. Configure it in .env before migrating.");
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const sql = fs.readFileSync(
      path.join(__dirname, "..", "database", "schema-security.sql"),
      "utf8"
    );
    console.log("Applying Security Firewall schema...");
    await client.query(sql);
    for (const patch of COLUMN_PATCHES) {
      await client.query(patch);
    }

    const result = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [EXPECTED_TABLES]
    );
    const found = new Set(result.rows.map((row) => row.table_name));
    const missing = EXPECTED_TABLES.filter((table) => !found.has(table));
    if (missing.length > 0) {
      console.error("Migration verification failed. Missing tables:", missing.join(", "));
      process.exit(1);
    }

    const switches = await client.query("SELECT key, enabled FROM firewall_settings ORDER BY key");
    console.log(`Security Firewall schema ready: ${found.size}/${EXPECTED_TABLES.length} tables verified.`);
    console.log("Master switches:", switches.rows.map((row) => `${row.key}=${row.enabled}`).join(", "));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Security migration failed:", error.message);
  process.exit(1);
});
