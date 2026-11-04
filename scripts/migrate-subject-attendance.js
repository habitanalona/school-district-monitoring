"use strict";

// Non-destructive upgrade for subject-period attendance.
//
// Adds academic terms, configurable class periods, subject-level attendance,
// adviser-validated daily attendance, correction requests, and summary
// snapshots. No existing attendance row, school year, section, or form is
// modified or removed. Safe to run repeatedly.

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
      path.join(__dirname, "..", "database", "schema-subject-attendance.sql"),
      "utf8"
    );
    console.log("Applying subject attendance and academic term schema...");
    await client.query(sql);

    // The three-term calendar required for SY 2026-2027 (DepEd Order No. 009,
    // s. 2026) is a property of that school year only. Later years keep the
    // four-quarter model until an administrator changes it.
    await client.query(
      `UPDATE school_years SET term_model = 'three_term'
       WHERE name = '2026-2027' AND term_model <> 'three_term'`
    );

    const result = await client.query(
      `SELECT
         (SELECT COUNT(*) FROM school_terms)::int AS terms,
         (SELECT COUNT(*) FROM class_periods)::int AS periods,
         (SELECT COUNT(*) FROM subject_attendance)::int AS subject_records,
         (SELECT COUNT(*) FROM adviser_attendance)::int AS adviser_records,
         (SELECT COUNT(*) FROM school_years WHERE term_model = 'three_term')::int AS three_term_years`
    );
    const row = result.rows[0];
    console.log(
      `Subject attendance schema ready: ${row.terms} term(s), ${row.periods} period(s), ` +
        `${row.subject_records} subject record(s), ${row.adviser_records} validated day(s), ` +
        `${row.three_term_years} three-term school year(s).`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Subject attendance migration failed:", error.message);
  process.exit(1);
});
