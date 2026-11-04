"use strict";

// Non-destructive upgrade for school logos.
//
// Adds the nullable schools.school_logo reference column. Existing school
// records, relationships, and all other modules are left untouched. Safe to
// run repeatedly.

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
      path.join(__dirname, "..", "database", "schema-school-logos.sql"),
      "utf8"
    );
    console.log("Applying school logo schema...");
    await client.query(sql);

    const result = await client.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(school_logo)::int AS with_logo
       FROM schools`
    );
    console.log(
      `School logo schema ready: ${result.rows[0].total} school(s), ${result.rows[0].with_logo} with a logo.`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("School logo migration failed:", error.message);
  process.exit(1);
});
