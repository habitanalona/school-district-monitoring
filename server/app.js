"use strict";

const path = require("path");
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const helmet = require("helmet");
const compression = require("compression");
const cors = require("cors");
const morgan = require("morgan");

const config = require("./config/env");
const { pool } = require("./config/database");
const { loadUser, requirePageAuth } = require("./middleware/authMiddleware");
const { csrfProtection } = require("./middleware/csrfMiddleware");
const { requirePageModule } = require("./middleware/permissionMiddleware");
const { apiLimiter } = require("./middleware/rateLimiters");
const { apiNotFound, errorHandler } = require("./middleware/errorHandler");

const authRoutes = require("./routes/authRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const schoolRoutes = require("./routes/schoolRoutes");
const reportRoutes = require("./routes/reportRoutes");
const userRoutes = require("./routes/userRoutes");
const announcementRoutes = require("./routes/announcementRoutes");
const auditRoutes = require("./routes/auditRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const profileRoutes = require("./routes/profileRoutes");
const districtRoutes = require("./routes/districtRoutes");
const approvalRoutes = require("./routes/approvalRoutes");
const learnerRoutes = require("./routes/learnerRoutes");
const academicRoutes = require("./routes/academicRoutes");
const activityRoutes = require("./routes/activityRoutes");
const learnerReportRoutes = require("./routes/learnerReportRoutes");
const userRightsRoutes = require("./routes/userRightsRoutes");

const CLIENT_DIR = path.join(__dirname, "..", "client");
// Each protected page maps to the permission module that owns it. Direct URL
// visits are checked on the server so hiding a navigation link is never the
// only line of defence.
const PAGE_MODULES = {
  dashboard: "dashboard",
  schools: "schools",
  districts: "districts",
  reports: "district_reports",
  users: "users",
  announcements: "announcements",
  "audit-logs": "audit_logs",
  approvals: "approvals",
  settings: "settings",
  profile: "settings",
  learners: "learners",
  learner: "learners",
  "school-years": "school_years",
  "grade-levels": "grade_levels",
  sections: "sections",
  teachers: "teachers",
  subjects: "subjects",
  activities: "activities",
  "learner-reports": "learner_reports",
  "user-rights": "user_rights"
};
const PROTECTED_PAGES = Object.keys(PAGE_MODULES);

const app = express();
app.disable("x-powered-by");

if (config.trustProxy) {
  app.set("trust proxy", 1);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: config.isProduction ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.isProduction
      ? { maxAge: 15552000, includeSubDomains: true }
      : false,
    referrerPolicy: { policy: "same-origin" }
  })
);

app.use(compression());
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

if (config.corsOrigin) {
  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "X-CSRF-Token"]
    })
  );
}

if (!config.isTest) {
  app.use(morgan(config.isProduction ? "combined" : "dev"));
}

const store = new pgSession({
  pool,
  tableName: "session",
  createTableIfMissing: false,
  pruneSessionInterval: 15 * 60
});

store.on("error", (error) => {
  console.error("Session store error:", error.message);
});

app.use(
  session({
    store,
    name: config.sessionName,
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    unset: "destroy",
    cookie: {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: "lax"
    }
  })
);

PROTECTED_PAGES.forEach((page) => {
  app.get([`/${page}`, `/${page}.html`], loadUser, requirePageAuth, requirePageModule(PAGE_MODULES[page]), (req, res) => {
    res.set("Cache-Control", "no-store");
    res.sendFile(path.join(CLIENT_DIR, `${page}.html`));
  });
});

app.get(["/", "/index.html"], loadUser, (req, res) => {
  if (req.user) {
    return res.redirect("/dashboard.html");
  }
  res.set("Cache-Control", "no-store");
  return res.sendFile(path.join(CLIENT_DIR, "index.html"));
});

app.use("/api", apiLimiter, (req, res, next) => {
  // Session-bound payloads (including the CSRF token) must never be served
  // from a cache after a deploy or sign-out.
  res.set("Cache-Control", "no-store");
  next();
}, csrfProtection, loadUser);
app.use("/api/auth", authRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/schools", schoolRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/users", userRoutes);
app.use("/api/announcements", announcementRoutes);
app.use("/api/audit-logs", auditRoutes);
app.use("/api/approvals", approvalRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/districts", districtRoutes);
app.use("/api/learners", learnerRoutes);
app.use("/api/academic", academicRoutes);
app.use("/api/activities", activityRoutes);
app.use("/api/learner-reports", learnerReportRoutes);
app.use("/api/user-rights", userRightsRoutes);
app.use("/api", apiNotFound);

app.use(
  express.static(CLIENT_DIR, {
    index: false,
    dotfiles: "deny",
    maxAge: config.isProduction ? "7d" : 0
  })
);

app.use((req, res) => {
  res.status(404).sendFile(path.join(CLIENT_DIR, "404.html"));
});

app.use(errorHandler);

module.exports = app;
