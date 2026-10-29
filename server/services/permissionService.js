"use strict";

const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const { serializeUser } = require("../utils/serializers");
const auditService = require("./auditService");
const {
  MODULE_DEFINITIONS,
  MODULE_MAP,
  ACTIONS,
  ALL_ROLES,
  defaultsForRole,
  sanitizeRow
} = require("../utils/permissionModules");

const USER_PERMISSION_SELECT = `SELECT m.module_key, m.label, m.description, m.group_label,
         m.sort_order, m.actions,
         rp.can_access AS role_access, rp.can_add AS role_add,
         rp.can_edit AS role_edit, rp.can_delete AS role_delete,
         up.can_access AS user_access, up.can_add AS user_add,
         up.can_edit AS user_edit, up.can_delete AS user_delete,
         up.updated_at AS user_updated_at, up.granted_by,
         gu.full_name AS granted_by_name
  FROM permission_modules m
  LEFT JOIN role_permissions rp
    ON rp.module_key = m.module_key AND rp.role = $1
  LEFT JOIN user_permissions up
    ON up.module_key = m.module_key AND up.user_id = $2
  LEFT JOIN users gu ON gu.id = up.granted_by
  ORDER BY m.sort_order ASC, m.module_key ASC`;

function emptyMatrix() {
  return MODULE_DEFINITIONS.reduce((accumulator, definition) => {
    accumulator[definition.key] = {
      access: false,
      add: false,
      edit: false,
      delete: false
    };
    return accumulator;
  }, {});
}

function normalizeMatrixInput(raw) {
  const matrix = emptyMatrix();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new HttpError(400, "Permissions must be an object keyed by module.", "VALIDATION_ERROR", {
      field: "permissions"
    });
  }
  const suppliedKeys = Object.keys(raw);
  suppliedKeys.forEach((key) => {
    if (!MODULE_MAP[key]) {
      throw new HttpError(400, `Unknown permission module: ${key}.`, "VALIDATION_ERROR", {
        field: "permissions"
      });
    }
  });
  MODULE_DEFINITIONS.forEach((definition) => {
    const entry = raw[definition.key] || {};
    const normalized = { access: false, add: false, edit: false, delete: false };
    ["access", "add", "edit", "delete"].forEach((action) => {
      if (!definition.actions.includes(action)) {
        return;
      }
      if (entry[action] !== undefined && typeof entry[action] !== "boolean") {
        throw new HttpError(400, `${definition.label}: ${action} must be true or false.`, "VALIDATION_ERROR", {
          field: "permissions"
        });
      }
      normalized[action] = Boolean(entry[action]);
    });
    if (!normalized.access) {
      normalized.add = false;
      normalized.edit = false;
      normalized.delete = false;
    }
    matrix[definition.key] = normalized;
  });
  return matrix;
}

function matrixFromRows(rows, { forceAll = false } = {}) {
  const matrix = emptyMatrix();
  rows.forEach((row) => {
    if (!MODULE_MAP[row.module_key]) {
      return;
    }
    const hasOverride = row.user_access !== null && row.user_access !== undefined;
    const base = hasOverride
      ? sanitizeRow({
          can_access: row.user_access,
          can_add: row.user_add,
          can_edit: row.user_edit,
          can_delete: row.user_delete
        })
      : sanitizeRow({
          can_access: row.role_access,
          can_add: row.role_add,
          can_edit: row.role_edit,
          can_delete: row.role_delete
        });
    matrix[row.module_key] = base || { access: false, add: false, edit: false, delete: false };
  });
  if (forceAll) {
    MODULE_DEFINITIONS.forEach((definition) => {
      matrix[definition.key] = { access: true, add: true, edit: true, delete: true };
    });
  }
  return matrix;
}

function applyActionSupport(matrix) {
  MODULE_DEFINITIONS.forEach((definition) => {
    const entry = matrix[definition.key] || { access: false, add: false, edit: false, delete: false };
    if (!definition.actions.includes("add")) {
      entry.add = false;
    }
    if (!definition.actions.includes("edit")) {
      entry.edit = false;
    }
    if (!definition.actions.includes("delete")) {
      entry.delete = false;
    }
    if (!definition.actions.includes("access")) {
      entry.access = false;
    }
    if (!entry.access) {
      entry.add = false;
      entry.edit = false;
      entry.delete = false;
    }
    matrix[definition.key] = entry;
  });
  return matrix;
}

async function ensurePermissionCatalog(runner = null) {
  const db = runner || { query };
  let index = 0;
  for (const definition of MODULE_DEFINITIONS) {
    index += 1;
    await db.query(
      `INSERT INTO permission_modules
         (module_key, label, description, group_label, sort_order, actions)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (module_key) DO UPDATE SET
         label = EXCLUDED.label,
         description = EXCLUDED.description,
         group_label = EXCLUDED.group_label,
         sort_order = EXCLUDED.sort_order,
         actions = EXCLUDED.actions,
         updated_at = now()`,
      [
        definition.key,
        definition.label,
        definition.description,
        definition.group,
        index * 10,
        definition.actions
      ]
    );
  }

  for (const definition of MODULE_DEFINITIONS) {
    for (const role of ALL_ROLES) {
      const defaults = defaultsForRole(role)[definition.key];
      await db.query(
        `INSERT INTO role_permissions
           (role, module_key, can_access, can_add, can_edit, can_delete)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (role, module_key) DO NOTHING`,
        [
          role,
          definition.key,
          defaults.access,
          defaults.add,
          defaults.edit,
          defaults.delete
        ]
      );
    }
  }
}

async function effectivePermissions(user) {
  if (!user) {
    return emptyMatrix();
  }
  if (user.role === "system_admin") {
    return applyActionSupport(
      MODULE_DEFINITIONS.reduce((accumulator, definition) => {
        accumulator[definition.key] = { access: true, add: true, edit: true, delete: true };
        return accumulator;
      }, {})
    );
  }
  const result = await query(USER_PERMISSION_SELECT, [user.role, user.id]);
  return applyActionSupport(matrixFromRows(result.rows));
}

function can(matrix, moduleKey, action = "access") {
  if (!matrix || !matrix[moduleKey]) {
    return false;
  }
  const entry = matrix[moduleKey];
  if (action === "access") {
    return Boolean(entry.access);
  }
  return Boolean(entry.access && entry[action]);
}

async function assertModule(actor, moduleKey, action = "access") {
  if (!actor) {
    throw new HttpError(401, "Authentication required.", "AUTH_REQUIRED");
  }
  const matrix = actor.permissionMatrix || (await effectivePermissions(actor));
  if (!can(matrix, moduleKey, action)) {
    throw new HttpError(
      403,
      "You do not have permission to perform this action.",
      "FORBIDDEN"
    );
  }
}

async function getUserDetail(userId) {
  const userResult = await query(
    `SELECT u.*, d.district_name, d.district_code, s.school_name, s.school_code,
            (SELECT p.updated_at FROM user_photos p WHERE p.user_id = u.id) AS photo_updated_at
     FROM users u
     LEFT JOIN districts d ON d.id = u.district_id
     LEFT JOIN schools s ON s.id = u.school_id
     WHERE u.id = $1`,
    [userId]
  );
  const row = userResult.rows[0];
  if (!row) {
    throw new HttpError(404, "User account not found.", "USER_NOT_FOUND");
  }

  const rows = (await query(USER_PERMISSION_SELECT, [row.role, row.id])).rows;
  const effective = applyActionSupport(matrixFromRows(rows));
  const roleDefaults = defaultsForRole(row.role);
  const overrides = {};
  rows.forEach((entry) => {
    if (entry.user_access !== null && entry.user_access !== undefined) {
      overrides[entry.module_key] = {
        access: Boolean(entry.user_access),
        add: Boolean(entry.user_add),
        edit: Boolean(entry.user_edit),
        delete: Boolean(entry.user_delete),
        updatedAt: entry.user_updated_at,
        grantedBy: entry.granted_by ? Number(entry.granted_by) : null,
        grantedByName: entry.granted_by_name || null
      };
    }
  });

  const lastChange = await query(
    `SELECT a.created_at, a.action, a.details, u.full_name AS actor_name
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.action = 'user.permissions_updated' AND a.entity_id = $1
     ORDER BY a.created_at DESC
     LIMIT 1`,
    [String(row.id)]
  );

  return {
    user: serializeUser({ ...row, permissionMatrix: effective }),
    roleDefaults,
    overrides,
    permissions: effective,
    lastChange: lastChange.rows[0]
      ? {
          at: lastChange.rows[0].created_at,
          actorName: lastChange.rows[0].actor_name,
          details: lastChange.rows[0].details
        }
      : null
  };
}

async function saveUserPermissions(actor, targetUserId, rawPermissions, ipAddress) {
  if (!actor || actor.role !== "system_admin") {
    throw new HttpError(403, "Only the system administrator can change user rights.", "FORBIDDEN");
  }
  if (Number(actor.id) === Number(targetUserId)) {
    throw new HttpError(
      403,
      "You cannot change your own permissions. Ask another system administrator to review them.",
      "SELF_PERMISSION_CHANGE"
    );
  }

  const targetResult = await query(
    `SELECT id, role, full_name, username FROM users WHERE id = $1`,
    [targetUserId]
  );
  const target = targetResult.rows[0];
  if (!target) {
    throw new HttpError(404, "User account not found.", "USER_NOT_FOUND");
  }
  if (target.role === "system_admin") {
    throw new HttpError(
      403,
      "System administrator permissions are fixed and cannot be revoked.",
      "SYSTEM_ADMIN_IMMUTABLE"
    );
  }

  const next = normalizeMatrixInput(rawPermissions);

  MODULE_DEFINITIONS.forEach((definition) => {
    ACTIONS.forEach((action) => {
      if (!next[definition.key][action]) {
        return;
      }
      const allowed = (definition.grantRoles[action] || []).includes(target.role);
      if (!allowed) {
        throw new HttpError(
          403,
          `${definition.label}: ${action} rights cannot be granted to the ${target.role} role.`,
          "PERMISSION_NOT_GRANTABLE"
        );
      }
    });
  });

  const before = await getUserDetail(targetUserId);
  const previous = before.permissions;
  const changes = [];
  MODULE_DEFINITIONS.forEach((definition) => {
    const previousEntry = previous[definition.key] || {};
    const nextEntry = next[definition.key];
    ACTIONS.forEach((action) => {
      if (Boolean(previousEntry[action]) !== Boolean(nextEntry[action])) {
        changes.push({
          module: definition.key,
          label: definition.label,
          action,
          from: Boolean(previousEntry[action]),
          to: Boolean(nextEntry[action])
        });
      }
    });
  });

  if (!changes.length) {
    return getUserDetail(targetUserId);
  }

  // Only differences from the role defaults are stored. A user who follows
  // the role policy keeps no override row, so later role policy changes flow
  // through; an explicit exception is persisted until it is cleared again.
  const roleDefaults = defaultsForRole(target.role);
  const client = await getClient();
  try {
    await client.query("BEGIN");
    for (const definition of MODULE_DEFINITIONS) {
      const entry = next[definition.key];
      const fallback = roleDefaults[definition.key];
      const matchesDefault =
        entry.access === fallback.access &&
        entry.add === fallback.add &&
        entry.edit === fallback.edit &&
        entry.delete === fallback.delete;

      if (matchesDefault) {
        await client.query(
          `DELETE FROM user_permissions WHERE user_id = $1 AND module_key = $2`,
          [target.id, definition.key]
        );
        continue;
      }

      await client.query(
        `INSERT INTO user_permissions
           (user_id, module_key, can_access, can_add, can_edit, can_delete, granted_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (user_id, module_key) DO UPDATE SET
           can_access = EXCLUDED.can_access,
           can_add = EXCLUDED.can_add,
           can_edit = EXCLUDED.can_edit,
           can_delete = EXCLUDED.can_delete,
           granted_by = EXCLUDED.granted_by,
           updated_at = now()`,
        [
          target.id,
          definition.key,
          entry.access,
          entry.add,
          entry.edit,
          entry.delete,
          actor.id
        ]
      );
    }
    await auditService.record({
      client,
      userId: actor.id,
      action: "user.permissions_updated",
      entityType: "user",
      entityId: target.id,
      districtId: actor.districtId || null,
      ipAddress: ipAddress || null,
      details: {
        target_username: target.username || null,
        target_role: target.role,
        changes
      }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return getUserDetail(targetUserId);
}

async function listUsersForRights({ search = "", role = "", schoolId = null, status = "", page = 1, pageSize = 20 }) {
  const where = [
    "($1 = '' OR u.full_name ILIKE $1 OR u.username ILIKE $1 OR u.email ILIKE $1 OR s.school_name ILIKE $1)",
    "($2 = '' OR u.role = $2)",
    "($3::bigint IS NULL OR u.school_id = $3)",
    "($4 = '' OR u.is_active = $4::boolean)"
  ].join(" AND ");
  const params = [search ? `%${search}%` : "", role, schoolId, status];

  const countResult = await query(
    `SELECT COUNT(*)::int AS total
     FROM users u
     LEFT JOIN schools s ON s.id = u.school_id
     WHERE ${where}`,
    params
  );
  const result = await query(
    `SELECT u.*, d.district_name, d.district_code, s.school_name, s.school_code,
            (SELECT COUNT(*)::int FROM user_permissions up WHERE up.user_id = u.id) AS override_count,
            (SELECT max(up.updated_at) FROM user_permissions up WHERE up.user_id = u.id) AS permissions_updated_at
     FROM users u
     LEFT JOIN districts d ON d.id = u.district_id
     LEFT JOIN schools s ON s.id = u.school_id
     WHERE ${where}
     ORDER BY u.full_name ASC, u.id ASC
     LIMIT $5 OFFSET $6`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  const summaryResult = await query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE is_active)::int AS active,
            (SELECT COUNT(DISTINCT user_id) FROM user_permissions)::int AS custom
     FROM users`
  );

  return {
    users: result.rows.map((row) => ({
      ...serializeUser(row),
      overrideCount: row.override_count,
      permissionsUpdatedAt: row.permissions_updated_at
    })),
    total: countResult.rows[0].total,
    page,
    pageSize,
    summary: summaryResult.rows[0]
  };
}

async function permissionHistory(userId, limit = 20) {
  const result = await query(
    `SELECT a.id, a.action, a.details, a.created_at, a.ip_address,
            u.full_name AS actor_name, u.username AS actor_username
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.action = 'user.permissions_updated' AND a.entity_id = $1
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT $2`,
    [String(userId), limit]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    action: row.action,
    actorName: row.actor_name,
    actorUsername: row.actor_username,
    createdAt: row.created_at,
    ipAddress: row.ip_address,
    changes: (row.details && row.details.changes) || []
  }));
}

async function permissionSummaryFor(userId) {
  const result = await query(
    `SELECT module_key, can_access, can_add, can_edit, can_delete, updated_at
     FROM user_permissions WHERE user_id = $1`,
    [userId]
  );
  return result.rows;
}

module.exports = {
  ensurePermissionCatalog,
  effectivePermissions,
  assertModule,
  can,
  getUserDetail,
  saveUserPermissions,
  listUsersForRights,
  permissionHistory,
  permissionSummaryFor,
  normalizeMatrixInput
};
