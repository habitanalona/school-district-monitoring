"use strict";

const bcrypt = require("bcrypt");
const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const { serializeUser } = require("../utils/serializers");
const { BCRYPT_ROUNDS } = require("./authService");
const auditService = require("./auditService");
const {
  SELF_REGISTER_ROLES,
  SCHOOL_ROLES,
  ROLE_RANK,
  hasRole,
  primaryRoleFor,
  approverRoleFor,
  roleLabel,
  roleMeta
} = require("../utils/roles");

const USER_SELECT = `SELECT u.*, d.district_name, d.district_code, s.school_name, s.school_code,
         COALESCE(
           (SELECT array_agg(ur.role ORDER BY ur.role) FROM user_roles ur WHERE ur.user_id = u.id),
           ARRAY[u.role]
         ) AS roles
  FROM users u
  LEFT JOIN districts d ON d.id = u.district_id
  LEFT JOIN schools s ON s.id = u.school_id`;

function publicUserRow(row) {
  return serializeUser(row);
}

function findUserRow(id, runner = { query }) {
  return runner
    .query(`${USER_SELECT} WHERE u.id = $1`, [id])
    .then((result) => result.rows[0] || null);
}

async function registrationOptions() {
  const [districts, schools] = await Promise.all([
    query(
      `SELECT id, district_name, district_code
       FROM districts
       ORDER BY district_name ASC`
    ),
    query(
      `SELECT id, school_code, school_name, district_id
       FROM schools
       WHERE status = 'active'
       ORDER BY school_name ASC`
    )
  ]);

  return {
    roles: SELF_REGISTER_ROLES.map((value) => {
      const meta = roleMeta(value);
      return {
        value,
        label: meta.label,
        fullLabel: meta.fullLabel || meta.label,
        approverRole: meta.approverRole,
        approverLabel: roleLabel(meta.approverRole),
        needsSchool: meta.needsSchool,
        rank: ROLE_RANK[value] || 0
      };
    }),
    districts: districts.rows.map((row) => ({
      id: Number(row.id),
      name: row.district_name,
      code: row.district_code
    })),
    schools: schools.rows.map((row) => ({
      id: Number(row.id),
      code: row.school_code,
      name: row.school_name,
      districtId: Number(row.district_id)
    }))
  };
}

async function assertUniqueAccount(username, email) {
  const result = await query(
    `SELECT id, username, email FROM users
     WHERE lower(username) = lower($1) OR lower(email) = lower($2)`,
    [username, email]
  );
  const existing = result.rows[0];
  if (!existing) {
    return;
  }
  if (existing.username.toLowerCase() === username.toLowerCase()) {
    throw new HttpError(409, "That username is already in use.", "USERNAME_IN_USE");
  }
  throw new HttpError(409, "That email address is already in use.", "EMAIL_IN_USE");
}

async function validateDistrictSchool(districtId, schoolId, roles) {
  const district = await query(
    `SELECT id, district_name FROM districts WHERE id = $1`,
    [districtId]
  );
  if (!district.rows[0]) {
    throw new HttpError(400, "Select a valid school district.", "VALIDATION_ERROR", { field: "districtId" });
  }

  const schoolRequired = roles.some((role) => SCHOOL_ROLES.includes(role));
  if (!schoolRequired) {
    return { district: district.rows[0], school: null };
  }

  if (!schoolId) {
    throw new HttpError(400, "Select your school.", "VALIDATION_ERROR", { field: "schoolId" });
  }

  const school = await query(
    `SELECT id, school_name, school_code, district_id, status
     FROM schools WHERE id = $1`,
    [schoolId]
  );
  const record = school.rows[0];
  if (!record) {
    throw new HttpError(400, "Select a valid school.", "VALIDATION_ERROR", { field: "schoolId" });
  }
  if (Number(record.district_id) !== Number(districtId)) {
    throw new HttpError(400, "The selected school is not part of that district.", "VALIDATION_ERROR", {
      field: "schoolId"
    });
  }
  if (record.status !== "active") {
    throw new HttpError(400, "The selected school is not currently active.", "VALIDATION_ERROR", {
      field: "schoolId"
    });
  }
  return { district: district.rows[0], school: record };
}

function approverScopeSql(requiredRole, target) {
  if (requiredRole === "district_admin") {
    return {
      where: "role = 'district_admin' AND district_id = $1",
      params: [target.district_id]
    };
  }
  if (requiredRole === "psds") {
    return {
      where: "role = 'psds' AND district_id = $1",
      params: [target.district_id]
    };
  }
  if (requiredRole === "school_head" || requiredRole === "adviser") {
    return {
      where: `role = '${requiredRole}' AND school_id = $1`,
      params: [target.school_id]
    };
  }
  return null;
}

async function findApprovers(target, runner = { query }) {
  const requiredRole = approverRoleFor(target.role);
  const scope = requiredRole ? approverScopeSql(requiredRole, target) : null;
  if (!scope) {
    return [];
  }
  const result = await runner.query(
    `SELECT id, full_name, role
     FROM users
     WHERE ${scope.where}
       AND is_active = TRUE
       AND approval_status = 'active'
     ORDER BY id ASC`,
    scope.params
  );
  if (result.rows.length) {
    return result.rows;
  }
  if (requiredRole !== "district_admin") {
    const fallback = await runner.query(
      `SELECT id, full_name, role
       FROM users
       WHERE role = 'district_admin'
         AND district_id = $1
         AND is_active = TRUE
         AND approval_status = 'active'
       ORDER BY id ASC`,
      [target.district_id]
    );
    return fallback.rows;
  }
  return [];
}

async function hasActiveApprover(target, requiredRole) {
  const scope = approverScopeSql(requiredRole, target);
  if (!scope) {
    return false;
  }
  const result = await query(
    `SELECT 1 FROM users
     WHERE ${scope.where}
       AND is_active = TRUE
       AND approval_status = 'active'
     LIMIT 1`,
    scope.params
  );
  return Boolean(result.rows[0]);
}

async function notifyApprovers(client, target, approvers) {
  if (!approvers.length) {
    return;
  }
  const schoolName = target.school_name || target.school_code || "";
  const role = (Array.isArray(target.roles) && target.roles.length ? target.roles : [target.role])
    .map((value) => roleLabel(value))
    .join(", ");
  const message = `${target.full_name} registered as ${role}${schoolName ? ` at ${schoolName}` : ""} and is waiting for your confirmation.`;
  for (const approver of approvers) {
    await client.query(
      `INSERT INTO notifications (user_id, title, message)
       VALUES ($1, $2, $3)`,
      [approver.id, `New ${role} account awaiting confirmation`, message]
    );
  }
}

async function notifyUser(client, userId, title, message) {
  await client.query(
    `INSERT INTO notifications (user_id, title, message)
     VALUES ($1, $2, $3)`,
    [userId, title, message]
  );
}

async function register(payload) {
  const roles = Array.from(new Set(payload.roles || [payload.role])).filter(Boolean);
  const invalidRole = roles.find((role) => !SELF_REGISTER_ROLES.includes(role));
  if (!roles.length || invalidRole) {
    throw new HttpError(400, "That role cannot be self-registered.", "VALIDATION_ERROR", { field: "roles" });
  }

  // The highest role in the selection drives approval routing; every selected
  // role is stored so permissions are the union of the account's duties.
  const primaryRole = primaryRoleFor(roles);

  const { district, school } = await validateDistrictSchool(
    payload.districtId,
    payload.schoolId,
    roles
  );
  await assertUniqueAccount(payload.username, payload.email);

  const passwordHash = await bcrypt.hash(payload.password, BCRYPT_ROUNDS);
  const client = await getClient();

  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO users (
         full_name, first_name, middle_name, last_name, username, email,
         password_hash, role, district_id, school_id, is_active, approval_status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, FALSE, 'pending')
       RETURNING id`,
      [
        payload.fullName,
        payload.firstName || null,
        payload.middleName || null,
        payload.lastName || null,
        payload.username,
        payload.email,
        passwordHash,
        primaryRole,
        district.id,
        school ? school.id : null
      ]
    );
    const id = Number(inserted.rows[0].id);
    for (const role of roles) {
      await client.query(
        `INSERT INTO user_roles (user_id, role) VALUES ($1, $2)
         ON CONFLICT (user_id, role) DO NOTHING`,
        [id, role]
      );
    }

    const targetRow = await findUserRow(id, client);
    targetRow.district_name = district.district_name;
    if (school) {
      targetRow.school_name = school.school_name;
      targetRow.school_code = school.school_code;
    }

    const approvers = await findApprovers(targetRow, client);
    await notifyApprovers(client, targetRow, approvers);

    await auditService.record({
      client,
      userId: null,
      action: "user.registered",
      entityType: "user",
      entityId: id,
      districtId: district.id,
      ipAddress: payload.ipAddress || null,
      details: {
        username: payload.username,
        role: primaryRole,
        roles,
        school_code: school ? school.school_code : null,
        approver_role: approverRoleFor(primaryRole)
      }
    });

    await client.query("COMMIT");

    const approverRole = approverRoleFor(primaryRole);
    return {
      user: publicUserRow(targetRow),
      approval: {
        status: "pending",
        approverRole,
        approverLabel: roleLabel(approverRole),
        approverCount: approvers.length,
        message: `Your account was created and is waiting for confirmation by your ${roleLabel(approverRole)}.`
      }
    };
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

async function canApprove(actor, target) {
  if (!target || target.approval_status !== "pending") {
    return false;
  }
  if (hasRole(actor, "system_admin")) {
    return true;
  }

  const requiredRole = approverRoleFor(target.role);
  if (!requiredRole) {
    return false;
  }

  const sameDistrict =
    actor.districtId && Number(actor.districtId) === Number(target.district_id);
  const sameSchool =
    actor.schoolId && target.school_id && Number(actor.schoolId) === Number(target.school_id);

  if (hasRole(actor, requiredRole)) {
    if (requiredRole === "psds" || requiredRole === "district_admin") {
      return Boolean(sameDistrict);
    }
    return Boolean(sameSchool);
  }

  // If the immediate superior role has no active account, escalate to the district administrator.
  if (hasRole(actor, "district_admin") && sameDistrict) {
    return !(await hasActiveApprover(target, requiredRole));
  }
  return false;
}

function approvalScopeRole(actor) {
  return ["system_admin", "district_admin", "psds", "school_head", "adviser"].find((role) =>
    hasRole(actor, role)
  );
}

async function listPendingForActor(actor) {
  let where = "u.approval_status = 'pending'";
  const params = [];
  const scopeRole = approvalScopeRole(actor);

  if (scopeRole === "system_admin") {
    // All districts.
  } else if (scopeRole === "district_admin" || scopeRole === "psds") {
    params.push(actor.districtId);
    where += " AND u.district_id = $1";
  } else if (scopeRole === "school_head" || scopeRole === "adviser") {
    params.push(actor.schoolId);
    where += " AND u.school_id = $1";
  } else {
    throw new HttpError(403, "You do not have permission to review account registrations.", "FORBIDDEN");
  }

  const result = await query(
    `${USER_SELECT} WHERE ${where}
     ORDER BY u.created_at ASC, u.id ASC`,
    params
  );

  const approvals = [];
  for (const row of result.rows) {
    if (await canApprove(actor, row)) {
      approvals.push({
        ...serializeUser(row),
        approverRole: approverRoleFor(row.role),
        approverLabel: roleLabel(approverRoleFor(row.role))
      });
    }
  }

  return {
    approvals,
    pendingCount: approvals.length,
    approverRole: actor.role,
    approverLabel: roleLabel(actor.role)
  };
}

async function approve(actor, id) {
  const target = await findUserRow(id);
  if (!target) {
    throw new HttpError(404, "Registration not found.", "REGISTRATION_NOT_FOUND");
  }
  if (target.approval_status !== "pending") {
    throw new HttpError(409, "This registration has already been reviewed.", "REGISTRATION_REVIEWED");
  }
  if (!(await canApprove(actor, target))) {
    throw new HttpError(403, "You cannot confirm this registration.", "FORBIDDEN");
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE users SET
         approval_status = 'active',
         is_active = TRUE,
         approved_by = $1,
         approved_at = now(),
         rejection_note = NULL
       WHERE id = $2 AND approval_status = 'pending'
       RETURNING id`,
      [actor.id, id]
    );
    if (!updated.rows[0]) {
      throw new HttpError(409, "This registration has already been reviewed.", "REGISTRATION_REVIEWED");
    }
    await notifyUser(
      client,
      id,
      "Your account has been confirmed",
      "Your SDMS account is now active. Sign in to update your profile and access your records."
    );
    await auditService.record({
      client,
      userId: actor.id,
      action: "user.approved",
      entityType: "user",
      entityId: id,
      districtId: target.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        username: target.username,
        role: target.role,
        roles: target.roles || [target.role],
        school_code: target.school_code || null
      }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return serializeUser(await findUserRow(id));
}

async function reject(actor, id, note) {
  const target = await findUserRow(id);
  if (!target) {
    throw new HttpError(404, "Registration not found.", "REGISTRATION_NOT_FOUND");
  }
  if (target.approval_status !== "pending") {
    throw new HttpError(409, "This registration has already been reviewed.", "REGISTRATION_REVIEWED");
  }
  if (!(await canApprove(actor, target))) {
    throw new HttpError(403, "You cannot review this registration.", "FORBIDDEN");
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const updated = await client.query(
      `UPDATE users SET
         approval_status = 'rejected',
         is_active = FALSE,
         approved_by = $1,
         approved_at = now(),
         rejection_note = $2
       WHERE id = $3 AND approval_status = 'pending'
       RETURNING id`,
      [actor.id, note || null, id]
    );
    if (!updated.rows[0]) {
      throw new HttpError(409, "This registration has already been reviewed.", "REGISTRATION_REVIEWED");
    }
    await notifyUser(
      client,
      id,
      "Your registration was not confirmed",
      note
        ? `Your registration was not confirmed. Reason: ${note}`
        : "Your registration was not confirmed. Contact your school or district office for assistance."
    );
    await auditService.record({
      client,
      userId: actor.id,
      action: "user.rejected",
      entityType: "user",
      entityId: id,
      districtId: target.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        username: target.username,
        role: target.role,
        school_code: target.school_code || null,
        note: note || null
      }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return serializeUser(await findUserRow(id));
}

module.exports = {
  registrationOptions,
  register,
  listPendingForActor,
  approve,
  reject,
  canApprove,
  findApprovers
};
