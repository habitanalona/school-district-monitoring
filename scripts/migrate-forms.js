"use strict";

// Non-destructive upgrade for an existing database.
//
// Applies database/schema-forms.sql, which only creates the School Forms 1-10
// tables, indexes, triggers, and built-in template registry entries. Existing
// learners, enrollments, users, and school records are untouched. Every
// statement is idempotent, so this command can be re-run safely.

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
    const sql = fs.readFileSync(path.join(__dirname, "..", "database", "schema-forms.sql"), "utf8");
    console.log("Applying School Forms 1-10 schema...");
    await client.query(sql);

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM form_templates)::int AS templates,
        (SELECT COUNT(*) FROM learners)::int AS learners,
        (SELECT COUNT(*) FROM enrollments)::int AS enrollments,
        (SELECT COUNT(*) FROM school_years)::int AS school_years
    `);
    const row = counts.rows[0];
    console.log(
      `School Forms schema ready: ${row.templates} templates, ${row.learners} learners, ` +
        `${row.enrollments} enrollments across ${row.school_years} school years.`
    );
    console.log("Next: restart the server so the new permission modules are synchronised.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("School Forms migration failed:", error.message);
  process.exit(1);
});
