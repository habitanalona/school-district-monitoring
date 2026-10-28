"use strict";

const { query } = require("../config/database");
const { serializeNotification } = require("../utils/serializers");
const { HttpError } = require("../utils/httpError");

async function listForUser(userId) {
  const result = await query(
    `SELECT * FROM notifications
     WHERE user_id = $1
     ORDER BY is_read ASC, created_at DESC
     LIMIT 30`,
    [userId]
  );
  return result.rows.map(serializeNotification);
}

async function unreadCount(userId) {
  const result = await query(
    `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND is_read = FALSE`,
    [userId]
  );
  return result.rows[0].count;
}

async function markRead(userId, notificationId) {
  const result = await query(
    `UPDATE notifications SET is_read = TRUE
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [notificationId, userId]
  );
  if (!result.rows[0]) {
    throw new HttpError(404, "Notification not found.", "NOTIFICATION_NOT_FOUND");
  }
  return serializeNotification(result.rows[0]);
}

async function markAllRead(userId) {
  const result = await query(
    `UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE`,
    [userId]
  );
  return result.rowCount;
}

module.exports = { listForUser, unreadCount, markRead, markAllRead };
