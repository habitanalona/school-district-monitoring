"use strict";

// Non-destructive upgrade for PSDS school-targeted announcements.
//
// Applies database/schema-announcement-targets.sql. Existing announcements
// keep their district-wide reach until a notice is explicitly narrowed to
// specific schools. Safe to run repeatedly.

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
      path.join(__dirname, "..", "database", "schema-announcement-targets.sql"),
      "utf8"
    );
    console.log("Applying announcement school-targeting schema...");
    await client.query(sql);

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM announcements)::int AS announcements,
        (SELECT COUNT(*) FROM announcement_schools)::int AS targeted_schools
    `);
    const row = counts.rows[0];
    console.log(
      `Announcement targeting ready: ${row.announcements} announcements, ${row.targeted_schools} school links preserved.`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Announcement targeting migration failed:", error.message);
  process.exit(1);
});
