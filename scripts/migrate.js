"use strict";

// Non-destructive upgrade for an existing database.
//
// `npm run db:init` rebuilds the schema and reloads the demonstration data, so
// it must never be run against live records. This script only adds what the
// rights module needs (columns, constraints, permission tables, indexes) and
// synchronises the catalogue and role defaults. No user, school, learner, or
// audit row is removed, and every statement is idempotent so the command can be
// re-run safely.

const { pool } = require("../server/config/database");
const { ensurePermissionCatalog } = require("../server/services/permissionService");

async function main() {
  const client = await pool.connect();
  let committed = false;

  try {
    await client.query("BEGIN");

    // Accounts were originally limited to three roles and had no school scope.
    // Both are additive changes, so existing rows keep their values.
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id BIGINT REFERENCES schools(id) ON DELETE RESTRICT
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status VARCHAR(16) NOT NULL DEFAULT 'active'
    `);
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL
    `);
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS rejection_note TEXT");

    await client.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check");
    await client.query(`
      ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
        role IN (
          'system_admin', 'district_admin', 'psds', 'school_head',
          'teacher', 'coordinator', 'nt', 'adviser', 'learner', 'staff'
        )
      )
    `);

    await client.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_approval_status_check");
    await client.query(`
      ALTER TABLE users ADD CONSTRAINT users_approval_status_check
        CHECK (approval_status IN ('pending', 'active', 'rejected'))
    `);

    await client.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_school_required");
    await client.query(`
      ALTER TABLE users ADD CONSTRAINT users_school_required CHECK (
        role NOT IN ('school_head', 'teacher', 'coordinator', 'nt', 'adviser', 'learner')
        OR school_id IS NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS permission_modules (
        module_key VARCHAR(48) PRIMARY KEY,
        label VARCHAR(120) NOT NULL,
        description TEXT,
        group_label VARCHAR(80) NOT NULL DEFAULT 'General',
        sort_order INTEGER NOT NULL DEFAULT 0,
        actions VARCHAR(32)[] NOT NULL DEFAULT ARRAY['access']::varchar[]
          CHECK (actions <@ ARRAY['access', 'add', 'edit', 'delete']::varchar[]),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role VARCHAR(32) NOT NULL,
        module_key VARCHAR(48) NOT NULL REFERENCES permission_modules(module_key) ON DELETE CASCADE,
        can_access BOOLEAN NOT NULL DEFAULT FALSE,
        can_add BOOLEAN NOT NULL DEFAULT FALSE,
        can_edit BOOLEAN NOT NULL DEFAULT FALSE,
        can_delete BOOLEAN NOT NULL DEFAULT FALSE,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (role, module_key),
        CONSTRAINT role_permissions_access_check
          CHECK (can_access OR NOT (can_add OR can_edit OR can_delete))
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_permissions (
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        module_key VARCHAR(48) NOT NULL REFERENCES permission_modules(module_key) ON DELETE CASCADE,
        can_access BOOLEAN NOT NULL DEFAULT FALSE,
        can_add BOOLEAN NOT NULL DEFAULT FALSE,
        can_edit BOOLEAN NOT NULL DEFAULT FALSE,
        can_delete BOOLEAN NOT NULL DEFAULT FALSE,
        granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, module_key),
        CONSTRAINT user_permissions_access_check
          CHECK (can_access OR NOT (can_add OR can_edit OR can_delete))
      )
    `);

    await client.query("CREATE INDEX IF NOT EXISTS user_permissions_user_idx ON user_permissions (user_id)");
    await client.query("CREATE INDEX IF NOT EXISTS user_permissions_granted_by_idx ON user_permissions (granted_by)");
    await client.query("CREATE INDEX IF NOT EXISTS role_permissions_role_idx ON role_permissions (role)");
    await client.query("CREATE INDEX IF NOT EXISTS users_school_idx ON users (school_id)");
    await client.query("CREATE INDEX IF NOT EXISTS users_approval_idx ON users (approval_status)");

    console.log("Synchronising permission catalog and role defaults...");
    await ensurePermissionCatalog(client);

    await client.query("COMMIT");
    committed = true;

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM permission_modules)::int AS modules,
        (SELECT COUNT(*) FROM role_permissions)::int AS role_defaults,
        (SELECT COUNT(*) FROM user_permissions)::int AS overrides,
        (SELECT COUNT(*) FROM users)::int AS users
    `);
    const row = counts.rows[0];
    console.log(
      `Migration complete: ${row.modules} modules, ${row.role_defaults} role defaults, ` +
        `${row.overrides} per-user overrides preserved across ${row.users} accounts.`
    );
  } catch (error) {
    if (!committed) {
      await client.query("ROLLBACK").catch(() => {});
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Migration failed:", error.message);
  process.exit(1);
});
