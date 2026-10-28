"use strict";

const config = require("../config/env");
const authService = require("../services/authService");
const registrationService = require("../services/registrationService");
const districtService = require("../services/districtService");
const auditService = require("../services/auditService");
const { ensureCsrfToken } = require("../middleware/csrfMiddleware");
const { HttpError } = require("../utils/httpError");
const { permissionsFor } = require("../utils/permissions");
const { createCsrfToken } = require("../utils/tokens");
const {
  requireString,
  requirePassword,
  requireEmail,
  requireUsername,
  requireEnum,
  requireInteger
} = require("../utils/validators");
const { roleLabel, SELF_REGISTER_ROLES } = require("../utils/roles");

const REMEMBER_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_AGE = 8 * 60 * 60 * 1000;

function regenerateSession(req, user, remember) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        return reject(error);
      }
      req.session.userId = user.id;
      req.session.csrfToken = createCsrfToken();
      req.session.cookie.maxAge = remember ? REMEMBER_MAX_AGE : DEFAULT_MAX_AGE;
      req.session.save((saveError) => {
        if (saveError) {
          return reject(saveError);
        }
        return resolve();
      });
    });
  });
}

async function csrf(req, res) {
  res.json({ data: { csrfToken: ensureCsrfToken(req) } });
}

async function login(req, res) {
  const identifier = requireString(req.body.identifier, "Email or username", { min: 1, max: 160 });
  const password = requireString(req.body.password, "Password", { min: 1, max: 128 });
  const remember = Boolean(req.body.remember);
  const result = await authService.authenticate(identifier, password);
  const user = result.user;
  const ipAddress = req.ip || null;

  if (result.outcome === "pending") {
    throw new HttpError(
      403,
      `Your account is waiting for confirmation by your ${roleLabel(result.approverRole)}. You can sign in after it is confirmed.`,
      "ACCOUNT_PENDING"
    );
  }
  if (result.outcome === "rejected") {
    throw new HttpError(
      403,
      "Your registration was not confirmed. Contact your school or district office for assistance.",
      "ACCOUNT_REJECTED"
    );
  }
  if (result.outcome === "inactive") {
    throw new HttpError(
      403,
      "This account is not currently active. Contact your district administrator.",
      "ACCOUNT_INACTIVE"
    );
  }

  if (!user) {
    await auditService.record({
      action: "user.login_failed",
      entityType: "auth",
      details: { identifier },
      ipAddress
    });
    throw new HttpError(401, "Invalid email/username or password.", "INVALID_CREDENTIALS");
  }

  await regenerateSession(req, user, remember);
  await auditService.record({
    userId: user.id,
    action: "user.login",
    entityType: "user",
    entityId: user.id,
    districtId: user.districtId,
    details: { username: user.username },
    ipAddress
  });

  res.json({
    data: {
      user,
      permissions: permissionsFor(user),
      csrfToken: req.session.csrfToken
    }
  });
}

async function logout(req, res) {
  await auditService.recordForRequest(req, {
    action: "user.logout",
    entityType: "user",
    entityId: req.user.id,
    details: { username: req.user.username }
  });

  req.session.destroy((error) => {
    if (error) {
      console.error("Session destroy failed:", error.message);
    }
    res.clearCookie(config.sessionName);
    res.json({ data: { message: "You have been signed out." } });
  });
}

async function me(req, res) {
  const districts = await districtService.listForUser(req.user);
  res.json({
    data: {
      user: req.user,
      permissions: permissionsFor(req.user),
      districts,
      csrfToken: ensureCsrfToken(req)
    }
  });
}

async function forgotPassword(req, res) {
  const identifier = requireString(req.body.identifier, "Email or username", { min: 1, max: 160 });
  const reset = await authService.createPasswordReset(identifier);
  const generic = "If an account matches those details, a password reset link has been created.";
  let devResetUrl = null;

  if (reset) {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    devResetUrl = `${baseUrl}/reset-password.html?token=${encodeURIComponent(reset.token)}`;
    await auditService.record({
      userId: reset.user.id,
      action: "user.password_reset_requested",
      entityType: "user",
      entityId: reset.user.id,
      districtId: reset.user.districtId,
      details: {},
      ipAddress: req.ip || null
    });

    if (!config.isProduction) {
      console.log(`Password reset link (development only): ${devResetUrl}`);
    }
  }

  res.json({
    data: {
      message: generic,
      devResetUrl: config.isProduction ? null : devResetUrl
    }
  });
}

async function resetPassword(req, res) {
  const token = requireString(req.body.token, "Reset token", { min: 64, max: 64 });
  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw new HttpError(400, "This password reset link is invalid or has expired.", "RESET_INVALID");
  }
  const password = requirePassword(req.body.password, "New password");
  const result = await authService.resetPassword(token, password);

  await auditService.record({
    userId: result.userId,
    action: "user.password_reset",
    entityType: "user",
    entityId: result.userId,
    districtId: result.districtId,
    details: {},
    ipAddress: req.ip || null
  });

  if (req.session) {
    req.session.destroy(() => {});
  }
  res.clearCookie(config.sessionName);
  res.json({
    data: {
      message: "Your password has been reset. Sign in with your new password.",
      csrfToken: null
    }
  });
}

async function registrationOptions(req, res) {
  const options = await registrationService.registrationOptions();
  res.json({ data: options });
}

async function register(req, res) {
  const role = requireEnum(req.body.role, "Role", SELF_REGISTER_ROLES);
  const districtId = requireInteger(req.body.districtId, "District", { min: 1 });
  const schoolId =
    req.body.schoolId === undefined || req.body.schoolId === null || req.body.schoolId === ""
      ? null
      : requireInteger(req.body.schoolId, "School", { min: 1 });

  const result = await registrationService.register({
    fullName: requireString(req.body.fullName, "Full name", { min: 2, max: 160 }),
    username: requireUsername(req.body.username),
    email: requireEmail(req.body.email),
    password: requirePassword(req.body.password),
    role,
    districtId,
    schoolId,
    ipAddress: req.ip || null
  });

  res.status(201).json({ data: result });
}

module.exports = {
  csrf,
  login,
  logout,
  me,
  forgotPassword,
  resetPassword,
  registrationOptions,
  register
};
