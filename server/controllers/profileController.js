"use strict";

const authService = require("../services/authService");
const auditService = require("../services/auditService");
const { requireString, requireEmail, requirePassword } = require("../utils/validators");

async function update(req, res) {
  const user = await authService.updateProfile(req.user.id, {
    fullName: requireString(req.body.fullName, "Full name", { min: 2, max: 160 }),
    email: requireEmail(req.body.email)
  });

  await auditService.recordForRequest(req, {
    action: "profile.updated",
    entityType: "user",
    entityId: req.user.id,
    details: { full_name: user.fullName }
  });

  res.json({ data: user });
}

async function changePassword(req, res) {
  const currentPassword = requireString(req.body.currentPassword, "Current password", {
    min: 1,
    max: 128
  });
  const newPassword = requirePassword(req.body.newPassword, "New password");

  await authService.changePassword(req.user.id, currentPassword, newPassword, req.sessionID);

  await auditService.recordForRequest(req, {
    action: "profile.password_changed",
    entityType: "user",
    entityId: req.user.id,
    details: {}
  });

  res.json({ data: { message: "Your password has been updated." } });
}

module.exports = { update, changePassword };
