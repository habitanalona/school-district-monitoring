"use strict";

// Non-destructive upgrade for structured names and multi-role accounts.
//
// Applies database/schema-user-roles.sql. It adds nullable name-part columns,
// creates user_roles, and copies each account's existing users.role into it.
// Existing names, accounts, and credentials are untouched. Safe to run
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
      path.join(__dirname, "..", "database", "schema-user-roles.sql"),
      "utf8"
    );
    console.log("Applying structured name and multi-role schema...");
    await client.query(sql);

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM users)::int AS users,
        (SELECT COUNT(*) FROM user_roles)::int AS role_assignments,
        (SELECT COUNT(*) FROM users WHERE first_name IS NOT NULL)::int AS structured_names
    `);
    const row = counts.rows[0];
    console.log(
      `Accounts ready: ${row.users} users, ${row.role_assignments} role assignments, ${row.structured_names} structured names.`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("User role migration failed:", error.message);
  process.exit(1);
});
