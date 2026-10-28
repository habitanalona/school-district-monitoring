"use strict";

const bcrypt = require("bcrypt");
const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const { serializeUser } = require("../utils/serializers");
const { assertDistrictAccess } = require("../utils/scope");
const { requireDistrict } = require("./districtService");
const { BCRYPT_ROUNDS } = require("./authService");
const auditService = require("./auditService");
const { DISTRICT_MANAGED_ROLES, SCHOOL_ROLES } = require("../utils/roles");

const SORT_COLUMNS = {
  name: "u.full_name",
  email: "u.email",
  role: "u.role",
  district: "d.district_name",
  school: "s.school_name",
  status: "u.is_active",
  created: "u.created_at",
  lastLogin: "u.last_login_at"
};

async function listUsers({
  actor,
  search = "",
  role = "",
  status = "",
  sort = "name",
  direction = "asc",
  page = 1,
  pageSize = 10
}) {
  const districtScopeId = actor.role === "system_admin" ? null : actor.districtId;
  const where = [
    "($1::bigint IS NULL OR u.district_id = $1)",
    "($2 = '' OR u.full_name ILIKE $2 OR u.username ILIKE $2 OR u.email ILIKE $2 OR s.school_name ILIKE $2)",
    "($3 = '' OR u.role = $3)",
    "($4 = '' OR u.is_active = $4::boolean)",
    "($5 = FALSE OR u.role NOT IN ('system_admin', 'district_admin'))"
  ].join(" AND ");
  const params = [
    districtScopeId,
    search ? `%${search}%` : "",
    role,
    status,
    actor.role !== "system_admin"
  ];
  const sortColumn = SORT_COLUMNS[sort] || SORT_COLUMNS.name;
  const sortDirection = direction === "desc" ? "DESC" : "ASC";

  const countResult = await query(
    `SELECT COUNT(*)::int AS total
     FROM users u
     LEFT JOIN districts d ON d.id = u.district_id
     LEFT JOIN schools s ON s.id = u.school_id
     WHERE ${where}`,
    params
  );
  const dataResult = await query(
    `SELECT u.*, d.district_name, d.district_code, s.school_name, s.school_code,
            (SELECT p.updated_at FROM user_photos p WHERE p.user_id = u.id) AS photo_updated_at
     FROM users u
     LEFT JOIN districts d ON d.id = u.district_id
     LEFT JOIN schools s ON s.id = u.school_id
     WHERE ${where}
     ORDER BY ${sortColumn} ${sortDirection} NULLS LAST, u.id ASC
     LIMIT $6 OFFSET $7`,
    [...params, pageSize, (page - 1) * pageSize]
  );

  return {
    users: dataResult.rows.map(serializeUser),
    total: countResult.rows[0].total,
    page,
    pageSize
  };
}

async function findUserRow(id) {
  const result = await query(
    `SELECT u.*, d.district_name, d.district_code, s.school_name, s.school_code,
            (SELECT p.updated_at FROM user_photos p WHERE p.user_id = u.id) AS photo_updated_at
     FROM users u
     LEFT JOIN districts d ON d.id = u.district_id
     LEFT JOIN schools s ON s.id = u.school_id
     WHERE u.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

function assertCanManage(actor, target) {
  if (actor.role === "system_admin") {
    return;
  }
  if (
    Number(target.district_id) !== Number(actor.districtId) ||
    !DISTRICT_MANAGED_ROLES.includes(target.role)
  ) {
    throw new HttpError(
      403,
      "District administrators can only manage school and district personnel in their district.",
      "FORBIDDEN"
    );
  }
}

async function assertSchoolInDistrict(schoolId, districtId) {
  const result = await query(
    `SELECT id, school_name, school_code, district_id, status
     FROM schools WHERE id = $1`,
    [schoolId]
  );
  const school = result.rows[0];
  if (!school) {
    throw new HttpError(400, "Select a valid school.", "VALIDATION_ERROR", { field: "schoolId" });
  }
  if (Number(school.district_id) !== Number(districtId)) {
    throw new HttpError(400, "The selected school is not part of that district.", "VALIDATION_ERROR", {
      field: "schoolId"
    });
  }
  if (school.status !== "active") {
    throw new HttpError(400, "The selected school is not currently active.", "VALIDATION_ERROR", {
      field: "schoolId"
    });
  }
  return school;
}

async function assertUniqueUser(username, email, excludeId = null) {
  const result = await query(
    `SELECT id, username, email FROM users
     WHERE (lower(username) = lower($1) OR lower(email) = lower($2))
       AND ($3::bigint IS NULL OR id <> $3)`,
    [username, email, excludeId]
  );
  const existing = result.rows[0];
  if (existing) {
    if (existing.username.toLowerCase() === username.toLowerCase()) {
      throw new HttpError(409, "That username is already in use.", "USERNAME_IN_USE");
    }
    throw new HttpError(409, "That email address is already in use.", "EMAIL_IN_USE");
  }
}

async function assertLastSystemAdmin(target, nextRole, nextActive) {
  if (target.role !== "system_admin") {
    return;
  }
  const losingAdmin = nextRole !== "system_admin" || !nextActive;
  if (!losingAdmin) {
    return;
  }
  const result = await query(
    `SELECT COUNT(*)::int AS count FROM users WHERE role = 'system_admin' AND is_active = TRUE AND id <> $1`,
    [target.id]
  );
  if (result.rows[0].count === 0) {
    throw new HttpError(409, "At least one active system administrator must remain.", "LAST_SYSTEM_ADMIN");
  }
}

async function deleteUserSessions(userId, client = null) {
  const runner = client || { query };
  await runner.query(`DELETE FROM "session" WHERE sess->>'userId' = $1`, [String(userId)]);
}

async function resolveAssignment(actor, role, districtId, schoolId) {
  let resolvedDistrict = districtId;
  let resolvedSchool = schoolId;

  if (actor.role !== "system_admin") {
    if (!DISTRICT_MANAGED_ROLES.includes(role)) {
      throw new HttpError(
        403,
        "District administrators cannot assign that role.",
        "FORBIDDEN"
      );
    }
    resolvedDistrict = actor.districtId;
  }

  if (role === "system_admin") {
    return { districtId: null, schoolId: null };
  }

  if (!resolvedDistrict) {
    throw new HttpError(400, "District is required for this role.", "VALIDATION_ERROR", { field: "districtId" });
  }
  assertDistrictAccess(actor, resolvedDistrict);
  if (actor.role === "system_admin") {
    await requireDistrict(resolvedDistrict);
  }

  if (SCHOOL_ROLES.includes(role)) {
    if (!resolvedSchool) {
      throw new HttpError(400, "School is required for this role.", "VALIDATION_ERROR", { field: "schoolId" });
    }
    await assertSchoolInDistrict(resolvedSchool, resolvedDistrict);
  } else {
    resolvedSchool = null;
  }

  return { districtId: resolvedDistrict, schoolId: resolvedSchool };
}

async function createUser(actor, payload) {
  const assignment = await resolveAssignment(
    actor,
    payload.role,
    payload.districtId,
    payload.schoolId
  );

  await assertUniqueUser(payload.username, payload.email);
  const passwordHash = await bcrypt.hash(payload.password, BCRYPT_ROUNDS);
  const client = await getClient();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO users (
         full_name, username, email, password_hash, role, district_id, school_id,
         is_active, approval_status, approved_by, approved_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, now())
       RETURNING id`,
      [
        payload.fullName,
        payload.username,
        payload.email,
        passwordHash,
        payload.role,
        assignment.districtId,
        assignment.schoolId,
        payload.isActive,
        actor.id
      ]
    );
    const id = Number(result.rows[0].id);
    await auditService.record({
      client,
      userId: actor.id,
      action: "user.created",
      entityType: "user",
      entityId: id,
      districtId: assignment.districtId,
      ipAddress: actor.ipAddress || null,
      details: {
        username: payload.username,
        role: payload.role,
        school_id: assignment.schoolId
      }
    });
    await client.query("COMMIT");
    return serializeUser(await findUserRow(id));
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new HttpError(409, "That username or email address is already in use.", "USER_DUPLICATE");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function updateUser(actor, id, payload) {
  const target = await findUserRow(id);
  if (!target) {
    throw new HttpError(404, "User account not found.", "USER_NOT_FOUND");
  }
  assertCanManage(actor, target);

  const assignment = await resolveAssignment(
    actor,
    payload.role,
    payload.districtId,
    payload.schoolId
  );
  const role = payload.role;
  const isActive = payload.isActive;

  if (Number(target.id) === Number(actor.id)) {
    if (!isActive) {
      throw new HttpError(400, "You cannot deactivate your own account.", "SELF_DEACTIVATION");
    }
    if (role !== target.role) {
      throw new HttpError(400, "You cannot change your own role.", "SELF_ROLE_CHANGE");
    }
  }

  await assertLastSystemAdmin(target, role, isActive);
  await assertUniqueUser(target.username, payload.email, id);

  const client = await getClient();
  try {
    await client.query("BEGIN");
    let passwordHash = target.password_hash;
    if (payload.password) {
      passwordHash = await bcrypt.hash(payload.password, BCRYPT_ROUNDS);
    }
    await client.query(
      `UPDATE users SET
         full_name = $1,
         email = $2,
         password_hash = $3,
         password_changed_at = CASE WHEN $4::boolean THEN now() ELSE password_changed_at END,
         role = $5,
         district_id = $6,
         school_id = $7,
         is_active = $8
       WHERE id = $9`,
      [
        payload.fullName,
        payload.email,
        passwordHash,
        Boolean(payload.password),
        role,
        assignment.districtId,
        assignment.schoolId,
        isActive,
        id
      ]
    );

    if (payload.password || !isActive) {
      await deleteUserSessions(id, client);
    }

    await auditService.record({
      client,
      userId: actor.id,
      action: "user.updated",
      entityType: "user",
      entityId: id,
      districtId: assignment.districtId,
      ipAddress: actor.ipAddress || null,
      details: {
        username: target.username,
        role,
        school_id: assignment.schoolId,
        is_active: isActive,
        password_reset: Boolean(payload.password)
      }
    });
    await client.query("COMMIT");
    return serializeUser(await findUserRow(id));
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new HttpError(409, "That email address is already in use.", "EMAIL_IN_USE");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function setUserStatus(actor, id, isActive) {
  const target = await findUserRow(id);
  if (!target) {
    throw new HttpError(404, "User account not found.", "USER_NOT_FOUND");
  }
  assertCanManage(actor, target);

  if (Number(target.id) === Number(actor.id) && !isActive) {
    throw new HttpError(400, "You cannot deactivate your own account.", "SELF_DEACTIVATION");
  }
  if (isActive && target.approval_status !== "active") {
    throw new HttpError(
      409,
      "This account is still waiting for registration confirmation. Review it on the Account Approvals page.",
      "APPROVAL_REQUIRED"
    );
  }
  await assertLastSystemAdmin(target, target.role, isActive);

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE users SET is_active = $1 WHERE id = $2`, [isActive, id]);
    if (!isActive) {
      await deleteUserSessions(id, client);
    }
    await auditService.record({
      client,
      userId: actor.id,
      action: isActive ? "user.activated" : "user.deactivated",
      entityType: "user",
      entityId: id,
      districtId: target.district_id,
      ipAddress: actor.ipAddress || null,
      details: { username: target.username, school_id: target.school_id || null }
    });
    await client.query("COMMIT");
    return serializeUser(await findUserRow(id));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  SORT_COLUMNS,
  listUsers,
  createUser,
  updateUser,
  setUserStatus,
  findUserRow,
  assertCanManage
};
