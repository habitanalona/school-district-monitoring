"use strict";

const notificationService = require("../services/notificationService");
const { requireIdParam } = require("../utils/validators");

async function list(req, res) {
  const [notifications, unreadCount] = await Promise.all([
    notificationService.listForUser(req.user.id),
    notificationService.unreadCount(req.user.id)
  ]);
  res.json({ data: { notifications, unreadCount } });
}

async function markRead(req, res) {
  const notification = await notificationService.markRead(
    req.user.id,
    requireIdParam(req.params.id, "Notification ID")
  );
  res.json({ data: notification });
}

async function markAllRead(req, res) {
  const updated = await notificationService.markAllRead(req.user.id);
  res.json({ data: { updated } });
}

module.exports = { list, markRead, markAllRead };
