"use strict";

// Non-destructive upgrade for the secure school bulk import.
//
// Applies database/schema-school-imports.sql. It only creates the short-lived
// import-batch table used to hold a server-validated preview between the
// confirmation and commit steps. The existing schools table, its rows, and
// every other record are untouched. Safe to run repeatedly.

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is missing. Configure it in .env before migrating.");
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const sql = fs.readFileSync(
      path.join(__dirname, "..", "database", "schema-school-imports.sql"),
      "utf8"
    );
    console.log("Applying school import schema...");
    await client.query(sql);

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM schools)::int AS schools,
        (SELECT COUNT(*) FROM school_import_batches)::int AS batches
    `);
    const row = counts.rows[0];
    console.log(
      `School import schema ready: ${row.schools} schools, ${row.batches} import batches.`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("School import migration failed:", error.message);
  process.exit(1);
});
