"use strict";

// Non-destructive upgrade for the secure learner profile bulk import.
//
// Applies database/schema-learner-imports.sql. It only creates the
// short-lived import-batch table used to hold a server-validated preview.
// Learner profiles, enrollments, and every other record are untouched.
// Safe to run repeatedly.

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
      path.join(__dirname, "..", "database", "schema-learner-imports.sql"),
      "utf8"
    );
    console.log("Applying learner import schema...");
    await client.query(sql);

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM learners)::int AS learners,
        (SELECT COUNT(*) FROM learner_import_batches)::int AS batches
    `);
    const row = counts.rows[0];
    console.log(
      `Learner import schema ready: ${row.learners} learners, ${row.batches} import batches.`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Learner import migration failed:", error.message);
  process.exit(1);
});
