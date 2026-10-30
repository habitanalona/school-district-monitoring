"use strict";

// Non-destructive upgrade for the secure district bulk import.
//
// Applies database/schema-districts.sql. It only creates the short-lived
// import-batch table used to hold a server-validated preview between the
// confirmation and commit steps. The existing districts table, its rows, and
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
      path.join(__dirname, "..", "database", "schema-districts.sql"),
      "utf8"
    );
    console.log("Applying district import schema...");
    await client.query(sql);

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM districts)::int AS districts,
        (SELECT COUNT(*) FROM district_import_batches)::int AS batches
    `);
    const row = counts.rows[0];
    console.log(
      `District import schema ready: ${row.districts} districts, ${row.batches} import batches.`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("District import migration failed:", error.message);
  process.exit(1);
});
