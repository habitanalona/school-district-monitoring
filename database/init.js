"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { ensurePermissionCatalog } = require("../server/services/permissionService");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is missing. Copy .env.example to .env and configure PostgreSQL first.");
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    console.log("Applying database schema...");
    await client.query(schema);

    const seed = fs.readFileSync(path.join(__dirname, "seed.sql"), "utf8");
    console.log("Loading demonstration data...");
    await client.query(seed);

    console.log("Synchronising permission catalog and role defaults...");
    await ensurePermissionCatalog(client);

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM districts)::int AS districts,
        (SELECT COUNT(*) FROM users)::int AS users,
        (SELECT COUNT(*) FROM schools)::int AS schools,
        (SELECT COUNT(*) FROM school_reports)::int AS reports
    `);
    const row = counts.rows[0];
    console.log(
      `Database ready: ${row.districts} districts, ${row.schools} schools, ${row.reports} reports, ${row.users} users.`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Database initialization failed:", error.message);
  process.exit(1);
});
