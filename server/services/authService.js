"use strict";

const bcrypt = require("bcrypt");
const config = require("../config/env");
const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const { createToken, hashToken } = require("../utils/tokens");
const { serializeUser } = require("../utils/serializers");
const { approverRoleFor } = require("../utils/roles");

const BCRYPT_ROUNDS = 12;
// Used only to keep failed sign-in timing consistent for unknown accounts.
const DUMMY_HASH = "$2b$12$LHFoA0ghkcobPlB8g1We7.JYePnr4lbw9lvidrPqt9MuD6Hxhqz8q";

async function findByIdentifier(identifier) {
  const result = await query(
    `SELECT u.*, d.district_name, d.district_code, s.school_name, s.school_code,
            (SELECT p.updated_at FROM user_photos p WHERE p.user_id = u.id) AS photo_updated_at
     FROM users u
     LEFT JOIN districts d ON d.id = u.district_id
     LEFT JOIN schools s ON s.id = u.school_id
     WHERE lower(u.username) = lower($1) OR lower(u.email) = lower($1)
     LIMIT 1`,
    [identifier]
  );
  return result.rows[0] || null;
}

async function authenticate(identifier, password) {
  const row = await findByIdentifier(identifier);
  const hash = row ? row.password_hash : DUMMY_HASH;
  const matches = await bcrypt.compare(password, hash).catch(() => false);

  if (!row || !matches) {
    return { outcome: "invalid", user: null };
  }
  if (row.approval_status === "pending") {
    return { outcome: "pending", user: null, approverRole: approverRoleFor(row.role) };
  }
  if (row.approval_status === "rejected") {
    return { outcome: "rejected", user: null, approverRole: approverRoleFor(row.role) };
  }
  if (!row.is_active) {
    return { outcome: "inactive", user: null };
  }

  const updated = await query(
    `UPDATE users SET last_login_at = now() WHERE id = $1
     RETURNING last_login_at`,
    [row.id]
  );
  row.last_login_at = updated.rows[0].last_login_at;
  return { outcome: "ok", user: serializeUser(row) };
}

async function createPasswordReset(identifier) {
  const row = await findByIdentifier(identifier);
  if (!row || !row.is_active || row.approval_status !== "active") {
    return null;
  }

  const rawToken = createToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + config.resetTokenMinutes * 60 * 1000);
  const client = await getClient();

  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM password_reset_tokens
       WHERE user_id = $1 AND (used_at IS NOT NULL OR expires_at <= now())`,
      [row.id]
    );
    await client.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [row.id, tokenHash, expiresAt]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return {
    user: { id: Number(row.id), districtId: row.district_id ? Number(row.district_id) : null },
    token: rawToken,
    expiresAt
  };
}

async function resetPassword(rawToken, newPassword) {
  const tokenHash = hashToken(rawToken);
  const lookup = await query(
    `SELECT t.id AS token_id, u.id AS user_id, u.district_id
     FROM password_reset_tokens t
     JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = $1
       AND t.used_at IS NULL
       AND t.expires_at > now()
       AND u.is_active = TRUE
       AND u.approval_status = 'active'
     LIMIT 1`,
    [tokenHash]
  );
  const record = lookup.rows[0];

  if (!record) {
    throw new HttpError(400, "This password reset link is invalid or has expired.", "RESET_INVALID");
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  const client = await getClient();

  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE users
       SET password_hash = $1, password_changed_at = now()
       WHERE id = $2`,
      [passwordHash, record.user_id]
    );
    await client.query(
      `UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL`,
      [record.user_id]
    );
    await client.query(`DELETE FROM "session" WHERE sess->>'userId' = $1`, [String(record.user_id)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return {
    userId: Number(record.user_id),
    districtId: record.district_id ? Number(record.district_id) : null
  };
}

async function updateProfile(userId, { fullName, email }) {
  try {
    const result = await query(
      `UPDATE users SET full_name = $1, email = $2 WHERE id = $3
       RETURNING *`,
      [fullName, email, userId]
    );
    if (!result.rows[0]) {
      throw new HttpError(404, "User account not found.", "USER_NOT_FOUND");
    }
    const districtResult = await query(
      `SELECT d.district_name, d.district_code, s.school_name, s.school_code,
              (SELECT p.updated_at FROM user_photos p WHERE p.user_id = u.id) AS photo_updated_at
       FROM users u
       LEFT JOIN districts d ON d.id = u.district_id
       LEFT JOIN schools s ON s.id = u.school_id
       WHERE u.id = $1`,
      [userId]
    );
    const row = { ...result.rows[0], ...districtResult.rows[0] };
    return serializeUser(row);
  } catch (error) {
    if (error.code === "23505") {
      throw new HttpError(409, "That email address is already in use.", "EMAIL_IN_USE");
    }
    throw error;
  }
}

async function changePassword(userId, currentPassword, newPassword, currentSessionId) {
  const result = await query(
    `SELECT id, password_hash FROM users
     WHERE id = $1 AND is_active = TRUE AND approval_status = 'active'`,
    [userId]
  );
  const row = result.rows[0];
  if (!row) {
    throw new HttpError(404, "User account not found.", "USER_NOT_FOUND");
  }

  const matches = await bcrypt.compare(currentPassword, row.password_hash).catch(() => false);
  if (!matches) {
    throw new HttpError(400, "Your current password is incorrect.", "INVALID_PASSWORD");
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await query(
    `UPDATE users SET password_hash = $1, password_changed_at = now() WHERE id = $2`,
    [passwordHash, userId]
  );
  await query(
    `DELETE FROM "session" WHERE sess->>'userId' = $1 AND sid <> $2`,
    [String(userId), currentSessionId || ""]
  );
}

module.exports = {
  BCRYPT_ROUNDS,
  findByIdentifier,
  authenticate,
  createPasswordReset,
  resetPassword,
  updateProfile,
  changePassword
};
