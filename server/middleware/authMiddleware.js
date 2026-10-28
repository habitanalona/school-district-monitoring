"use strict";

const config = require("../config/env");
const { query } = require("../config/database");
const { serializeUser } = require("../utils/serializers");

async function loadUser(req, res, next) {
  if (!req.session || !req.session.userId) {
    return next();
  }

  try {
    const result = await query(
      `SELECT u.*, d.district_name, d.district_code, s.school_name, s.school_code,
              (SELECT p.updated_at FROM user_photos p WHERE p.user_id = u.id) AS photo_updated_at
       FROM users u
       LEFT JOIN districts d ON d.id = u.district_id
       LEFT JOIN schools s ON s.id = u.school_id
       WHERE u.id = $1`,
      [req.session.userId]
    );
    const row = result.rows[0];

    if (!row || !row.is_active || row.approval_status !== "active") {
      return req.session.destroy((error) => {
        if (error) {
          return next(error);
        }
        res.clearCookie(config.sessionName);
        return next();
      });
    }

    req.user = serializeUser(row);
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: "Authentication required.",
      code: "AUTH_REQUIRED"
    });
  }
  return next();
}

function requirePageAuth(req, res, next) {
  if (!req.user) {
    const nextPath = encodeURIComponent(req.originalUrl || "/dashboard.html");
    return res.redirect(`/index.html?next=${nextPath}`);
  }
  return next();
}

module.exports = { loadUser, requireAuth, requirePageAuth };
