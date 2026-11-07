"use strict";

// Non-destructive upgrade for class-adviser learner enrollment.
//
// Grants the adviser role the learner add/edit/delete actions so the class
// adviser can enroll and remove learners in the section they advise. Every
// write is still pinned to the adviser's own advisory section by the learner
// service, and bulk import, promotion, and learner documents stay with school
// record keepers. Existing role and user overrides are left untouched; this
// only raises the adviser role row for the learners module. Safe to run
// repeatedly.

require("dotenv").config();

const { Client } = require("pg");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is missing. Configure it in .env before migrating.");
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const modules = await client.query(
      `SELECT module_key FROM permission_modules WHERE module_key = 'learners'`
    );
    if (!modules.rows[0]) {
      throw new Error("The learners permission module is missing. Start the application once first.");
    }

    console.log("Granting class-adviser learner enrollment rights...");
    const result = await client.query(
      `INSERT INTO role_permissions (
         role, module_key, can_access, can_add, can_edit, can_delete, updated_at
       ) VALUES ('adviser', 'learners', TRUE, TRUE, TRUE, TRUE, now())
       ON CONFLICT (role, module_key) DO UPDATE SET
         can_access = TRUE,
         can_add = TRUE,
         can_edit = TRUE,
         can_delete = TRUE,
         updated_at = now()
       RETURNING role, module_key, can_access, can_add, can_edit, can_delete`
    );
    const row = result.rows[0];
    console.log(
      `Adviser learner rights ready: access=${row.can_access} add=${row.can_add} edit=${row.can_edit} delete=${row.can_delete}.`
    );

    const overrides = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM user_permissions up
       JOIN users u ON u.id = up.user_id
       WHERE up.module_key = 'learners'
         AND (u.role = 'adviser' OR EXISTS (
           SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = 'adviser'
         ))`
    );
    console.log(
      `Existing adviser user overrides preserved: ${overrides.rows[0].total}.`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Class-adviser enrollment migration failed:", error.message);
  process.exit(1);
});
