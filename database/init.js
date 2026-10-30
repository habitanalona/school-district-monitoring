"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { ensurePermissionCatalog } = require("../server/services/permissionService");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is missing. Copy .env.example to .env and configure PostgreSQL first.");
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
    console.log("Applying database schema...");
    await client.query(schema);

    const formsSchema = fs.readFileSync(path.join(__dirname, "schema-forms.sql"), "utf8");
    console.log("Applying School Forms 1-10 schema...");
    await client.query(formsSchema);

    const classRecordSchema = fs.readFileSync(
      path.join(__dirname, "schema-classrecords.sql"),
      "utf8"
    );
    console.log("Applying Class Record and SF 9 workflow schema...");
    await client.query(classRecordSchema);

    const districtImportSchema = fs.readFileSync(
      path.join(__dirname, "schema-districts.sql"),
      "utf8"
    );
    console.log("Applying secure district import schema...");
    await client.query(districtImportSchema);

    const schoolImportSchema = fs.readFileSync(
      path.join(__dirname, "schema-school-imports.sql"),
      "utf8"
    );
    console.log("Applying secure school import schema...");
    await client.query(schoolImportSchema);

    const personnelImportSchema = fs.readFileSync(
      path.join(__dirname, "schema-personnel-imports.sql"),
      "utf8"
    );
    console.log("Applying secure staff import schema...");
    await client.query(personnelImportSchema);

    const learnerImportSchema = fs.readFileSync(
      path.join(__dirname, "schema-learner-imports.sql"),
      "utf8"
    );
    console.log("Applying secure learner import schema...");
    await client.query(learnerImportSchema);

    const gradeLevelOptionsSchema = fs.readFileSync(
      path.join(__dirname, "schema-grade-level-options.sql"),
      "utf8"
    );
    console.log("Applying administrator-managed grade level options...");
    await client.query(gradeLevelOptionsSchema);

    const subjectOptionsSchema = fs.readFileSync(
      path.join(__dirname, "schema-subject-options.sql"),
      "utf8"
    );
    console.log("Applying administrator-managed subject options...");
    await client.query(subjectOptionsSchema);

    const seed = fs.readFileSync(path.join(__dirname, "seed.sql"), "utf8");
    console.log("Loading demonstration data...");
    await client.query(seed);

    console.log("Synchronising permission catalog and role defaults...");
    await ensurePermissionCatalog(client);

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM districts)::int AS districts,
        (SELECT COUNT(*) FROM users)::int AS users,
        (SELECT COUNT(*) FROM schools)::int AS schools,
        (SELECT COUNT(*) FROM school_reports)::int AS reports
    `);
    const row = counts.rows[0];
    console.log(
      `Database ready: ${row.districts} districts, ${row.schools} schools, ${row.reports} reports, ${row.users} users.`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Database initialization failed:", error.message);
  process.exit(1);
});
