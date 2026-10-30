"use strict";

// Non-destructive upgrade for administrator-managed grade level options.
//
// Applies database/schema-grade-level-options.sql. It creates the catalog
// used by the grade level dropdown and copies every distinct grade level
// name already used by a school into it. Existing grade_levels, sections,
// enrollments, and all other records are untouched. Safe to run repeatedly.

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
      path.join(__dirname, "..", "database", "schema-grade-level-options.sql"),
      "utf8"
    );
    console.log("Applying grade level options schema...");
    await client.query(sql);

    // A database with no existing grade levels has nothing to backfill. Seed
    // the standard Philippine K-12 levels so the administrator can edit them
    // instead of starting from an empty dropdown.
    const existing = await client.query(
      "SELECT COUNT(*)::int AS count FROM grade_level_options"
    );
    if (existing.rows[0].count === 0) {
      console.log("Catalogue is empty; seeding Kindergarten to Grade 12...");
      await client.query(`
        INSERT INTO grade_level_options (name, sort_order)
        VALUES
          ('Kindergarten', 0),
          ('Grade 1', 1), ('Grade 2', 2), ('Grade 3', 3), ('Grade 4', 4),
          ('Grade 5', 5), ('Grade 6', 6), ('Grade 7', 7), ('Grade 8', 8),
          ('Grade 9', 9), ('Grade 10', 10), ('Grade 11', 11), ('Grade 12', 12)
        ON CONFLICT DO NOTHING
      `);
    }

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM grade_levels)::int AS grade_levels,
        (SELECT COUNT(*) FROM grade_level_options)::int AS options,
        (SELECT COUNT(*) FROM grade_level_options WHERE is_active)::int AS active_options
    `);
    const row = counts.rows[0];
    console.log(
      `Grade level options ready: ${row.options} options (${row.active_options} active), ${row.grade_levels} school grade levels preserved.`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Grade level options migration failed:", error.message);
  process.exit(1);
});
