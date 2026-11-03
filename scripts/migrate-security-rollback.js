"use strict";

// Rollback for the Security Firewall module. Drops ONLY the module's own
// tables. It never touches any pre-existing SDMS table. Data in the security
// tables is destroyed — export audit logs first if retention is required.

require("dotenv").config();

const { Client } = require("pg");

const MODULE_TABLES = [
  "approved_maintenance_sessions",
  "recovery_sessions",
  "backup_records",
  "security_alerts",
  "system_health_records",
  "file_upload_security_logs",
  "security_baselines",
  "code_integrity_records",
  "database_activity_logs",
  "security_audit_logs",
  "security_incidents",
  "security_events",
  "firewall_control_history",
  "firewall_settings",
  "superadmin_users"
];

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is missing. Configure it in .env before rolling back.");
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    console.log("Dropping Security Firewall module tables...");
    for (const table of MODULE_TABLES) {
      await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
      console.log(`  dropped ${table}`);
    }
    console.log("Rollback complete. No pre-existing SDMS table was modified.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Security rollback failed:", error.message);
  process.exit(1);
});
