"use strict";

// Non-destructive upgrade for administrator-managed subject options.
//
// Applies database/schema-subject-options.sql. It creates the catalog used by
// the subject dropdown, copies every distinct subject name already used by a
// school into it, and adds the Kindergarten to Grade 12 starter catalogue
// without overwriting existing entries. Existing subjects, teacher
// assignments, schedules, and all other records are untouched. Safe to run
// repeatedly.

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
      path.join(__dirname, "..", "database", "schema-subject-options.sql"),
      "utf8"
    );
    console.log("Applying subject options schema...");
    await client.query(sql);

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM subjects)::int AS subjects,
        (SELECT COUNT(*) FROM subject_options)::int AS options,
        (SELECT COUNT(*) FROM subject_options WHERE is_active)::int AS active_options
    `);
    const row = counts.rows[0];
    console.log(
      `Subject options ready: ${row.options} options (${row.active_options} active), ${row.subjects} school subjects preserved.`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Subject options migration failed:", error.message);
  process.exit(1);
});
