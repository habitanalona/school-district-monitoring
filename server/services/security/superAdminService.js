"use strict";

// SuperAdmin identity service. Separate table, separate session key, bcrypt
// password hashing, TOTP MFA, lockout, and full audit coverage. There is no
// code path that lets an ordinary users-table admin create or promote a
// SuperAdmin; provisioning happens via the bootstrap CLI (first account) or an
// authenticated SuperAdmin (subsequent accounts).

const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { query, runSecurityWrite } = require("../../config/database");
const { generateSecret, verifyTotp } = require("../../utils/totp");
const securityAudit = require("./securityAuditService");
const securityEvents = require("./securityEventService");

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MINUTES = 15;
const PASSWORD_RULE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{12,128}$/;

function publicAccount(row) {
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    email: row.email,
    totpEnabled: row.totp_enabled,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at
  };
}

async function findByUsername(username) {
  const result = await runSecurityWrite(() =>
    query("SELECT * FROM superadmin_users WHERE username = $1", [String(username || "").trim().toLowerCase()])
  );
  return result.rows[0] || null;
}

async function findById(id) {
  const result = await runSecurityWrite(() =>
    query("SELECT * FROM superadmin_users WHERE id = $1", [id])
  );
  return result.rows[0] || null;
}

// Only active accounts close bootstrap. Deactivated accounts (for example the
// fixture left behind by the automated security suite) cannot sign in and must
// not block first provisioning on a fresh deployment.
async function countSuperAdmins() {
  const result = await runSecurityWrite(() =>
    query("SELECT COUNT(*)::int AS total FROM superadmin_users WHERE is_active = TRUE")
  );
  return result.rows[0].total;
}

function validatePasswordStrength(password) {
  if (!PASSWORD_RULE.test(String(password || ""))) {
    const error = new Error(
      "SuperAdmin passwords must be 12-128 characters and include uppercase, lowercase, a digit, and a symbol."
    );
    error.status = 400;
    error.code = "WEAK_PASSWORD";
    throw error;
  }
}

// First account: requires the one-time SECURITY_BOOTSTRAP_TOKEN and an empty
// superadmin_users table. Prints the TOTP secret once.
async function bootstrap({ token, username, password, fullName, email = null }) {
  const expected = process.env.SECURITY_BOOTSTRAP_TOKEN || "";
  if (!expected || expected.length < 16) {
    const error = new Error("Set SECURITY_BOOTSTRAP_TOKEN (16+ chars) in .env before bootstrapping.");
    error.status = 500;
    error.code = "BOOTSTRAP_TOKEN_NOT_CONFIGURED";
    throw error;
  }
  if (!crypto.timingSafeEqual(Buffer.from(String(token || "").padEnd(expected.length).slice(0, expected.length)), Buffer.from(expected))) {
    const error = new Error("Invalid bootstrap token.");
    error.status = 403;
    error.code = "BOOTSTRAP_TOKEN_INVALID";
    throw error;
  }
  if ((await countSuperAdmins()) > 0) {
    const error = new Error("Bootstrap is closed: an active SuperAdmin already exists. Use the account management console.");
    error.status = 409;
    error.code = "BOOTSTRAP_CLOSED";
    throw error;
  }
  return createAccount({ username, password, fullName, email, actor: null, bootstrap: true });
}

async function createAccount({ username, password, fullName, email = null, actor, bootstrap = false }) {
  const normalized = String(username || "").trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{3,32}$/.test(normalized)) {
    const error = new Error("Username must be 4-33 characters: lowercase letters, digits, dot, underscore, or dash.");
    error.status = 400;
    error.code = "INVALID_USERNAME";
    throw error;
  }
  validatePasswordStrength(password);

  const existing = await findByUsername(normalized);
  if (existing) {
    const error = new Error("That SuperAdmin username is already taken.");
    error.status = 409;
    error.code = "USERNAME_TAKEN";
    throw error;
  }

  const passwordHash = await bcrypt.hash(String(password), 12);
  const totpSecret = generateSecret();

  const inserted = await runSecurityWrite(() =>
    query(
      `INSERT INTO superadmin_users (username, full_name, email, password_hash, totp_secret, totp_enabled)
       VALUES ($1, $2, $3, $4, $5, TRUE)
       RETURNING *`,
      [normalized, String(fullName || "").trim() || normalized, email, passwordHash, totpSecret]
    )
  );
  const row = inserted.rows[0];

  await securityAudit.record({
    actor,
    action: bootstrap ? "SUPERADMIN_BOOTSTRAPPED" : "SUPERADMIN_CREATED",
    targetType: "superadmin_user",
    targetId: row.id,
    details: { username: row.username }
  });
  await securityEvents.record({
    severity: "high",
    category: "firewall",
    action: bootstrap ? "SUPERADMIN_BOOTSTRAPPED" : "SUPERADMIN_CREATED",
    description: `SuperAdmin account "${row.username}" was ${bootstrap ? "bootstrapped" : "created"}.`,
    username: row.username,
    isSuperadmin: true,
    firewallDecision: "allowed"
  });

  return { account: publicAccount(row), totpSecret };
}

async function login({ username, password, totpToken, ipAddress }) {
  const account = await findByUsername(username);
  const genericError = new Error("Invalid credentials.");
  genericError.status = 401;
  genericError.code = "SUPERADMIN_AUTH_FAILED";

  if (!account || !account.is_active) {
    await securityEvents.record({
      severity: "medium",
      category: "auth",
      action: "SUPERADMIN_LOGIN_FAILED",
      description: `SuperAdmin sign-in failed for "${String(username || "").slice(0, 40)}".`,
      ipAddress
    });
    throw genericError;
  }

  if (account.locked_until && new Date(account.locked_until) > new Date()) {
    const error = new Error("This SuperAdmin account is temporarily locked. Try again later.");
    error.status = 423;
    error.code = "SUPERADMIN_LOCKED";
    throw error;
  }

  const passwordOk = await bcrypt.compare(String(password || ""), account.password_hash);
  if (!passwordOk) {
    await runSecurityWrite(() =>
      query(
        `UPDATE superadmin_users
         SET failed_logins = failed_logins + 1,
             locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + ($3 || ' minutes')::interval ELSE locked_until END
         WHERE id = $1`,
        [account.id, LOCKOUT_THRESHOLD, String(LOCKOUT_MINUTES)]
      )
    );
    await securityEvents.record({
      severity: "medium",
      category: "auth",
      action: "SUPERADMIN_LOGIN_FAILED",
      description: `Failed SuperAdmin password for "${account.username}".`,
      username: account.username,
      isSuperadmin: true,
      ipAddress
    });
    throw genericError;
  }

  if (account.totp_enabled) {
    if (!verifyTotp(account.totp_secret, totpToken)) {
      await securityEvents.record({
        severity: "medium",
        category: "auth",
        action: "SUPERADMIN_MFA_FAILED",
        description: `Invalid MFA code for SuperAdmin "${account.username}".`,
        username: account.username,
        isSuperadmin: true,
        ipAddress
      });
      const error = new Error("Invalid multi-factor code.");
      error.status = 401;
      error.code = "SUPERADMIN_MFA_INVALID";
      throw error;
    }
  }

  await runSecurityWrite(() =>
    query(
      "UPDATE superadmin_users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1",
      [account.id]
    )
  );
  await securityAudit.record({
    actor: { id: account.id, username: account.username },
    action: "SUPERADMIN_LOGIN",
    targetType: "superadmin_user",
    targetId: account.id,
    details: {},
    ipAddress
  });

  return {
    id: account.id,
    username: account.username,
    fullName: account.full_name,
    email: account.email
  };
}

async function listAccounts() {
  const result = await runSecurityWrite(() =>
    query(
      `SELECT id, username, full_name, email, totp_enabled, is_active, last_login_at, created_at
       FROM superadmin_users ORDER BY created_at ASC`
    )
  );
  return result.rows.map(publicAccount);
}

async function setActive({ id, isActive, actor, ipAddress }) {
  const target = await findById(id);
  if (!target) {
    const error = new Error("SuperAdmin account not found.");
    error.status = 404;
    throw error;
  }
  if (actor && actor.id === id && !isActive) {
    const error = new Error("You cannot deactivate your own SuperAdmin account.");
    error.status = 400;
    error.code = "SELF_DEACTIVATION_BLOCKED";
    throw error;
  }
  await runSecurityWrite(() =>
    query("UPDATE superadmin_users SET is_active = $1, updated_at = now() WHERE id = $2", [Boolean(isActive), id])
  );
  await securityAudit.record({
    actor,
    action: isActive ? "SUPERADMIN_ACTIVATED" : "SUPERADMIN_DEACTIVATED",
    targetType: "superadmin_user",
    targetId: id,
    details: { username: target.username },
    ipAddress
  });
  return { id, isActive: Boolean(isActive) };
}

async function resetTotp({ id, actor, ipAddress }) {
  const target = await findById(id);
  if (!target) {
    const error = new Error("SuperAdmin account not found.");
    error.status = 404;
    throw error;
  }
  const secret = generateSecret();
  await runSecurityWrite(() =>
    query("UPDATE superadmin_users SET totp_secret = $1, totp_enabled = TRUE, updated_at = now() WHERE id = $2", [
      secret,
      id
    ])
  );
  await securityAudit.record({
    actor,
    action: "SUPERADMIN_TOTP_RESET",
    targetType: "superadmin_user",
    targetId: id,
    details: { username: target.username },
    ipAddress
  });
  return { id, totpSecret: secret };
}

async function changePassword({ id, currentPassword, newPassword, actor, ipAddress }) {
  const target = await findById(id);
  if (!target) {
    const error = new Error("SuperAdmin account not found.");
    error.status = 404;
    throw error;
  }
  if (!(await bcrypt.compare(String(currentPassword || ""), target.password_hash))) {
    const error = new Error("Current password is incorrect.");
    error.status = 400;
    error.code = "CURRENT_PASSWORD_INVALID";
    throw error;
  }
  validatePasswordStrength(newPassword);
  const hash = await bcrypt.hash(String(newPassword), 12);
  await runSecurityWrite(() =>
    query("UPDATE superadmin_users SET password_hash = $1, failed_logins = 0, updated_at = now() WHERE id = $2", [
      hash,
      id
    ])
  );
  await securityAudit.record({
    actor,
    action: "SUPERADMIN_PASSWORD_CHANGED",
    targetType: "superadmin_user",
    targetId: id,
    details: { username: target.username },
    ipAddress
  });
  return { id };
}

module.exports = {
  bootstrap,
  createAccount,
  login,
  listAccounts,
  setActive,
  resetTotp,
  changePassword,
  findById,
  countSuperAdmins
};
