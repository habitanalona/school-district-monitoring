"use strict";

// Non-destructive upgrade for the Class Record -> Class Adviser -> SF 9
// workflow.
//
// Applies database/schema-classrecords.sql. The script only creates new
// tables/columns, reuses existing learners, enrollments, sections, subjects,
// assignments, grade records, and report cards, and is safe to re-run.
// Assessment weights are not invented: the built-in template starts
// unconfigured until a school administrator enters the verified values.

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
      path.join(__dirname, "..", "database", "schema-classrecords.sql"),
      "utf8"
    );
    console.log("Applying class record and SF 9 workflow schema...");
    await client.query(sql);

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM class_records)::int AS class_records,
        (SELECT COUNT(*) FROM class_record_templates)::int AS templates,
        (SELECT COUNT(*) FROM report_cards)::int AS report_cards,
        (SELECT COUNT(*) FROM learners)::int AS learners,
        (SELECT COUNT(*) FROM enrollments)::int AS enrollments
    `);
    const row = counts.rows[0];
    console.log(
      `Class record schema ready: ${row.templates} templates, ${row.class_records} class records, ` +
        `${row.report_cards} report cards, ${row.learners} learners, ${row.enrollments} enrollments.`
    );
    console.log(
      "Next: configure the class record template weights, then restart the server so the new permission modules are synchronised."
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Class record migration failed:", error.message);
  process.exit(1);
});
