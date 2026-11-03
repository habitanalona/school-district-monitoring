"use strict";

// Security Firewall API. Every route requires an authenticated SuperAdmin
// session (requireSuperAdmin). Unauthenticated/unauthorized attempts are
// recorded by the middleware itself.

const express = require("express");
const { query, runSecurityWrite } = require("../config/database");
const { requireSuperAdmin } = require("../middleware/superAdminMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");
const superAdminService = require("../services/security/superAdminService");
const firewallService = require("../services/security/firewallService");
const securityAudit = require("../services/security/securityAuditService");
const securityEvents = require("../services/security/securityEventService");
const incidentService = require("../services/security/incidentService");
const codeIntegrityService = require("../services/security/codeIntegrityService");
const uploadSecurityService = require("../services/security/uploadSecurityService");
const backupService = require("../services/security/backupService");
const recoveryService = require("../services/security/recoveryService");
const monitoringWorker = require("../services/security/monitoringWorker");
const guardState = require("../services/security/guardState");

const router = express.Router();

const { ensureCsrfToken } = require("../middleware/csrfMiddleware");

router.get("/csrf", (req, res) => {
  res.json({ csrfToken: ensureCsrfToken(req) });
});

function asInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// Session / authentication
// ---------------------------------------------------------------------------
router.get("/session", (req, res) => {
  res.json({
    authenticated: Boolean(req.superadmin),
    superadmin: req.superadmin || null,
    maintenanceMode: guardState.getSwitch("maintenance_mode")
  });
});

router.post("/auth/login", asyncHandler(async (req, res) => {
  const { username, password, totpToken } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required.", code: "FIELDS_REQUIRED" });
  }
  const account = await superAdminService.login({
    username,
    password,
    totpToken,
    ipAddress: req.ip
  });
  req.session.superadminId = account.id;
  res.json({ superadmin: account });
}));

router.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie(require("../config/env").sessionName);
    res.json({ ok: true });
  });
});

router.post("/auth/change-password", requireSuperAdmin, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  await superAdminService.changePassword({
    id: req.superadmin.id,
    currentPassword,
    newPassword,
    actor: req.superadmin,
    ipAddress: req.ip
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Overview dashboard
// ---------------------------------------------------------------------------
router.get("/overview", requireSuperAdmin, asyncHandler(async (req, res) => {
  const [switches, stats, incidents, worker, health] = await Promise.all([
    firewallService.getStates(),
    securityEvents.stats({ hours: 24 }),
    incidentService.countsByStatus(),
    Promise.resolve(monitoringWorker.status()),
    runSecurityWrite(() =>
      query(
        `SELECT DISTINCT ON (check_name) check_name, status, latency_ms, message, created_at
         FROM system_health_records ORDER BY check_name, created_at DESC`
      )
    )
  ]);
  const lastBackup = await runSecurityWrite(() =>
    query("SELECT * FROM backup_records WHERE status = 'verified' ORDER BY verified_at DESC LIMIT 1")
  );
  const lastIntegrity = await runSecurityWrite(() =>
    query("SELECT MAX(last_verified_at) AS at FROM code_integrity_records")
  );
  const lastScan = await runSecurityWrite(() =>
    query("SELECT MAX(created_at) AS at FROM security_events WHERE category = 'code'")
  );
  const pendingAlerts = await runSecurityWrite(() =>
    query("SELECT COUNT(*)::int AS total FROM security_alerts WHERE is_read = FALSE")
  );

  res.json({
    switches: switches.reduce((map, row) => {
      map[row.key] = {
        enabled: row.enabled,
        policyNote: row.policy_note,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by_name
      };
      return map;
    }, {}),
    stats,
    incidents: incidents.reduce((map, row) => {
      map[row.status] = row.total;
      return map;
    }, {}),
    worker,
    health: health.rows,
    lastVerifiedBackup: lastBackup.rows[0] || null,
    lastIntegrityVerification: lastIntegrity.rows[0].at,
    lastSecurityScan: lastScan.rows[0].at,
    pendingAlerts: pendingAlerts.rows[0].total
  });
}));

// ---------------------------------------------------------------------------
// Firewall control center
// ---------------------------------------------------------------------------
router.get("/switches", requireSuperAdmin, asyncHandler(async (req, res) => {
  const [states, history] = await Promise.all([
    firewallService.getStates(),
    firewallService.getHistory({ limit: 50 })
  ]);
  res.json({ switches: states, history });
}));

router.post("/switches/:key", requireSuperAdmin, asyncHandler(async (req, res) => {
  const { enabled, reason } = req.body || {};
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be a boolean.", code: "FIELDS_REQUIRED" });
  }
  const result = await firewallService.setSwitch({
    key: req.params.key,
    enabled,
    actor: req.superadmin,
    reason,
    ipAddress: req.ip
  });
  res.json(result);
}));

router.get("/switches/history", requireSuperAdmin, asyncHandler(async (req, res) => {
  const history = await firewallService.getHistory({ key: req.query.key || null, limit: asInt(req.query.limit, 100) });
  res.json({ history });
}));

// Approved maintenance sessions (audit trail for authorized switch-OFF work).
router.get("/maintenance-sessions", requireSuperAdmin, asyncHandler(async (req, res) => {
  const rows = await runSecurityWrite(() =>
    query("SELECT * FROM approved_maintenance_sessions ORDER BY created_at DESC LIMIT 100")
  );
  res.json({ sessions: rows.rows });
}));

router.post("/maintenance-sessions", requireSuperAdmin, asyncHandler(async (req, res) => {
  const { purpose, scope, switchKey, activeUntil } = req.body || {};
  if (!purpose || !switchKey) {
    return res.status(400).json({ error: "purpose and switchKey are required.", code: "FIELDS_REQUIRED" });
  }
  const rows = await runSecurityWrite(() =>
    query(
      `INSERT INTO approved_maintenance_sessions (purpose, scope, approved_by, approved_by_name, switch_key, active_until)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [String(purpose).slice(0, 300), String(scope || "").slice(0, 200), req.superadmin.id, req.superadmin.username, switchKey, activeUntil || null]
    )
  );
  await securityAudit.record({
    actor: req.superadmin,
    action: "MAINTENANCE_SESSION_APPROVED",
    targetType: "approved_maintenance_session",
    targetId: rows.rows[0].id,
    details: { purpose, switchKey },
    ipAddress: req.ip
  });
  res.json({ session: rows.rows[0] });
}));

// ---------------------------------------------------------------------------
// Events, live stream, alerts
// ---------------------------------------------------------------------------
router.get("/events", requireSuperAdmin, asyncHandler(async (req, res) => {
  const data = await securityEvents.listEvents({
    page: asInt(req.query.page, 1),
    pageSize: Math.min(asInt(req.query.pageSize, 50), 200),
    severity: req.query.severity || "",
    category: req.query.category || "",
    action: req.query.action || "",
    ip: req.query.ip || "",
    search: req.query.search || ""
  });
  res.json(data);
}));

router.get("/events/timeline", requireSuperAdmin, asyncHandler(async (req, res) => {
  const timeline = await securityEvents.timeline({ hours: asInt(req.query.hours, 24) });
  res.json({ timeline });
}));

router.get("/events/stream", requireSuperAdmin, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(`event: hello\ndata: {"ok":true}\n\n`);
  const unsubscribe = securityEvents.subscribe((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25000);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

router.get("/alerts", requireSuperAdmin, asyncHandler(async (req, res) => {
  const rows = await runSecurityWrite(() =>
    query("SELECT * FROM security_alerts ORDER BY created_at DESC LIMIT 100")
  );
  res.json({ alerts: rows.rows });
}));

router.post("/alerts/:id/read", requireSuperAdmin, asyncHandler(async (req, res) => {
  await runSecurityWrite(() =>
    query("UPDATE security_alerts SET is_read = TRUE, read_by = $1, read_at = now() WHERE id = $2", [
      req.superadmin.id,
      req.params.id
    ])
  );
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Database protection monitor
// ---------------------------------------------------------------------------
router.get("/database-activity", requireSuperAdmin, asyncHandler(async (req, res) => {
  const page = asInt(req.query.page, 1);
  const pageSize = Math.min(asInt(req.query.pageSize, 50), 200);
  const decision = req.query.decision || "";
  const count = await runSecurityWrite(() =>
    query(
      `SELECT COUNT(*)::int AS total FROM database_activity_logs WHERE ($1 = '' OR decision = $1)`,
      [decision]
    )
  );
  const data = await runSecurityWrite(() =>
    query(
      `SELECT * FROM database_activity_logs
       WHERE ($1 = '' OR decision = $1)
       ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [decision, pageSize, (page - 1) * pageSize]
    )
  );
  const aggregates = await runSecurityWrite(() =>
    query(
      `SELECT decision, operation, COUNT(*)::int AS total
       FROM database_activity_logs GROUP BY decision, operation ORDER BY total DESC`
    )
  );
  res.json({ logs: data.rows, total: count.rows[0].total, page, pageSize, aggregates: aggregates.rows });
}));

router.get("/database-health", requireSuperAdmin, asyncHandler(async (req, res) => {
  const hours = asInt(req.query.hours, 24);
  const health = await runSecurityWrite(() =>
    query(
      `SELECT status, COUNT(*)::int AS probes, AVG(latency_ms)::int AS avg_latency, MAX(created_at) AS last_at
       FROM system_health_records
       WHERE check_name = 'database' AND created_at >= now() - ($1 || ' hours')::interval
       GROUP BY status`,
      [String(hours)]
    )
  );
  const history = await runSecurityWrite(() =>
    query(
      `SELECT to_char(created_at, 'YYYY-MM-DD HH24:MI') AS bucket, AVG(latency_ms)::int AS avg_latency
       FROM system_health_records
       WHERE check_name = 'database' AND created_at >= now() - ($1 || ' hours')::interval
       GROUP BY bucket ORDER BY bucket`,
      [String(hours)]
    )
  );
  const rejected = await runSecurityWrite(() =>
    query("SELECT COUNT(*)::int AS total FROM database_activity_logs WHERE decision = 'rejected'")
  );
  const transactions = await runSecurityWrite(() =>
    query("SELECT COUNT(*)::int AS total FROM database_activity_logs WHERE decision = 'allowed'")
  );
  res.json({
    probes: health.rows,
    history: history.rows,
    rejectedOperations: rejected.rows[0].total,
    recordedOperations: transactions.rows[0].total,
    guardState: {
      switches: guardState.getSnapshot(),
      degraded: guardState.state.degraded,
      initialized: guardState.state.initialized
    }
  });
}));

// ---------------------------------------------------------------------------
// Code integrity monitor
// ---------------------------------------------------------------------------
router.get("/code-integrity", requireSuperAdmin, asyncHandler(async (req, res) => {
  const baseline = await codeIntegrityService.getBaseline();
  const records = await codeIntegrityService.records({ status: req.query.status || null });
  res.json({ baseline: baseline ? { createdAt: baseline.created_at, files: Object.keys(baseline.content.files || {}).length } : null, records });
}));

router.post("/code-integrity/baseline", requireSuperAdmin, asyncHandler(async (req, res) => {
  const result = await codeIntegrityService.createBaseline(req.superadmin);
  await securityAudit.record({
    actor: req.superadmin,
    action: "CODE_BASELINE_CREATED",
    targetType: "security_baseline",
    targetId: "code-tree",
    details: result,
    ipAddress: req.ip
  });
  res.json(result);
}));

router.post("/code-integrity/verify", requireSuperAdmin, asyncHandler(async (req, res) => {
  const report = await codeIntegrityService.verify({ source: "security" });
  await securityAudit.record({
    actor: req.superadmin,
    action: "CODE_INTEGRITY_VERIFIED",
    targetType: "security_baseline",
    targetId: "code-tree",
    details: { status: report.status, changes: report.changes.length },
    ipAddress: req.ip
  });
  res.json(report);
}));

// ---------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------
router.get("/incidents", requireSuperAdmin, asyncHandler(async (req, res) => {
  const data = await incidentService.list({
    status: req.query.status || "",
    severity: req.query.severity || "",
    page: asInt(req.query.page, 1),
    pageSize: Math.min(asInt(req.query.pageSize, 50), 200)
  });
  res.json(data);
}));

router.get("/incidents/:id", requireSuperAdmin, asyncHandler(async (req, res) => {
  const incident = await incidentService.get(req.params.id);
  if (!incident) {
    return res.status(404).json({ error: "Incident not found.", code: "NOT_FOUND" });
  }
  const events = await runSecurityWrite(() =>
    query("SELECT * FROM security_events WHERE incident_id = $1 ORDER BY created_at DESC LIMIT 50", [incident.id])
  );
  res.json({ incident, events: events.rows });
}));

router.post("/incidents/:id/status", requireSuperAdmin, asyncHandler(async (req, res) => {
  const { status, resolution } = req.body || {};
  const incident = await incidentService.transition({
    id: req.params.id,
    to: status,
    actor: req.superadmin,
    resolution,
    ipAddress: req.ip
  });
  res.json({ incident });
}));

router.post("/incidents/:id/assign", requireSuperAdmin, asyncHandler(async (req, res) => {
  const { assigneeId } = req.body || {};
  const incident = await incidentService.assign({ id: req.params.id, assigneeId, actor: req.superadmin, ipAddress: req.ip });
  res.json({ incident });
}));

// ---------------------------------------------------------------------------
// Upload security monitor
// ---------------------------------------------------------------------------
router.get("/uploads", requireSuperAdmin, asyncHandler(async (req, res) => {
  const data = await uploadSecurityService.listLogs({
    page: asInt(req.query.page, 1),
    pageSize: Math.min(asInt(req.query.pageSize, 50), 200),
    result: req.query.result || "",
    search: req.query.search || ""
  });
  res.json(data);
}));

// ---------------------------------------------------------------------------
// Audit logs
// ---------------------------------------------------------------------------
router.get("/audit-logs", requireSuperAdmin, asyncHandler(async (req, res) => {
  const data = await securityAudit.list({
    page: asInt(req.query.page, 1),
    pageSize: Math.min(asInt(req.query.pageSize, 50), 200),
    action: req.query.action || "",
    actor: req.query.actor || "",
    search: req.query.search || ""
  });
  res.json(data);
}));

router.get("/audit-logs/verify", requireSuperAdmin, asyncHandler(async (req, res) => {
  const result = await securityAudit.verifyChain();
  await securityAudit.record({
    actor: req.superadmin,
    action: "AUDIT_CHAIN_VERIFIED",
    targetType: "security_audit_logs",
    details: result,
    ipAddress: req.ip
  });
  res.json(result);
}));

router.get("/audit-logs/export", requireSuperAdmin, asyncHandler(async (req, res) => {
  const rows = await runSecurityWrite(() =>
    query("SELECT * FROM security_audit_logs ORDER BY occurred_at DESC LIMIT 10000")
  );
  const header = "event_id,occurred_at,actor_name,action,target_type,target_id,ip_address\n";
  const escape = (value) => `"${String(value === null || value === undefined ? "" : value).replace(/"/g, '""')}"`;
  const body = rows.rows
    .map((row) =>
      [row.event_id, row.occurred_at, row.actor_name, row.action, row.target_type, row.target_id, row.ip_address]
        .map(escape)
        .join(",")
    )
    .join("\n");
  await securityAudit.record({
    actor: req.superadmin,
    action: "AUDIT_LOG_EXPORTED",
    targetType: "security_audit_logs",
    details: { rows: rows.rows.length, format: "csv" },
    ipAddress: req.ip
  });
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", 'attachment; filename="security-audit-logs.csv"');
  res.send(header + body);
}));

// ---------------------------------------------------------------------------
// System / application health
// ---------------------------------------------------------------------------
router.get("/health", requireSuperAdmin, asyncHandler(async (req, res) => {
  const hours = asInt(req.query.hours, 24);
  const history = await runSecurityWrite(() =>
    query(
      `SELECT check_name, status, COUNT(*)::int AS probes, AVG(latency_ms)::int AS avg_latency, MAX(created_at) AS last_at
       FROM system_health_records
       WHERE created_at >= now() - ($1 || ' hours')::interval
       GROUP BY check_name, status ORDER BY check_name`,
      [String(hours)]
    )
  );
  const timeline = await runSecurityWrite(() =>
    query(
      `SELECT check_name, to_char(created_at, 'YYYY-MM-DD HH24:MI') AS bucket,
              AVG(latency_ms)::int AS avg_latency, MODE() WITHIN GROUP (ORDER BY status) AS dominant_status
       FROM system_health_records
       WHERE check_name IN ('database', 'security_worker') AND created_at >= now() - ($1 || ' hours')::interval
       GROUP BY check_name, bucket ORDER BY bucket`,
      [String(hours)]
    )
  );
  res.json({ probes: history.rows, timeline: timeline.rows, worker: monitoringWorker.status() });
}));

// ---------------------------------------------------------------------------
// Backups and recovery
// ---------------------------------------------------------------------------
router.get("/backups", requireSuperAdmin, asyncHandler(async (req, res) => {
  res.json({ backups: await backupService.listBackups(), backupDir: backupService.BACKUP_DIR });
}));

router.post("/backups", requireSuperAdmin, asyncHandler(async (req, res) => {
  const { label, note } = req.body || {};
  if (!label || String(label).trim().length < 3) {
    return res.status(400).json({ error: "A backup label (3+ characters) is required.", code: "FIELDS_REQUIRED" });
  }
  const backup = await backupService.createBackup({ label: String(label).slice(0, 120), actor: req.superadmin, note });
  res.json({ backup });
}));

router.post("/backups/:id/verify", requireSuperAdmin, asyncHandler(async (req, res) => {
  const result = await backupService.verifyBackup(req.params.id, req.superadmin);
  res.json(result);
}));

router.post("/backups/:id/restore", requireSuperAdmin, asyncHandler(async (req, res) => {
  const { confirmation, currentPassword } = req.body || {};
  const result = await backupService.restoreBackup({
    id: req.params.id,
    actor: req.superadmin,
    confirmation,
    currentPassword
  });
  res.json(result);
}));

router.get("/recovery", requireSuperAdmin, asyncHandler(async (req, res) => {
  res.json({ sessions: await recoveryService.listSessions(), flow: recoveryService.FLOW });
}));

router.post("/recovery", requireSuperAdmin, asyncHandler(async (req, res) => {
  const { triggerEvent, incidentId, affectedNotes } = req.body || {};
  const session = await recoveryService.createSession({
    actor: req.superadmin,
    triggerEvent: triggerEvent || "manual",
    incidentId: incidentId || null,
    affectedNotes: affectedNotes || null
  });
  res.json({ session });
}));

router.get("/recovery/:id", requireSuperAdmin, asyncHandler(async (req, res) => {
  const session = await recoveryService.getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: "Recovery session not found.", code: "NOT_FOUND" });
  }
  res.json({ session });
}));

router.post("/recovery/:id/advance", requireSuperAdmin, asyncHandler(async (req, res) => {
  const { to, backupId, message } = req.body || {};
  const session = await recoveryService.advance({ id: req.params.id, actor: req.superadmin, to, backupId: backupId || null, message });
  res.json({ session });
}));

router.post("/recovery/:id/integrity-check", requireSuperAdmin, asyncHandler(async (req, res) => {
  const result = await recoveryService.runIntegrityChecks({ id: req.params.id, actor: req.superadmin });
  res.json(result);
}));

router.post("/recovery/:id/reactivate", requireSuperAdmin, asyncHandler(async (req, res) => {
  const session = await recoveryService.reactivate({ id: req.params.id, actor: req.superadmin });
  res.json({ session });
}));

router.post("/recovery/:id/abort", requireSuperAdmin, asyncHandler(async (req, res) => {
  const { reason } = req.body || {};
  const session = await recoveryService.abort({ id: req.params.id, actor: req.superadmin, reason });
  res.json({ session });
}));

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
router.get("/config", requireSuperAdmin, asyncHandler(async (req, res) => {
  const retention = await runSecurityWrite(() =>
    query("SELECT pg_size_pretty(pg_total_relation_size('security_events')) AS events_size")
  );
  res.json({
    intervals: monitoringWorker.status().intervals,
    retentionDays: monitoringWorker.status().retentionDays,
    backupDir: backupService.BACKUP_DIR,
    alertEmailConfigured: Boolean(process.env.SECURITY_ALERT_EMAIL),
    eventsTableSize: retention.rows[0].events_size
  });
}));

// ---------------------------------------------------------------------------
// SuperAdmin account management
// ---------------------------------------------------------------------------
router.get("/accounts", requireSuperAdmin, asyncHandler(async (req, res) => {
  res.json({ accounts: await superAdminService.listAccounts() });
}));

router.post("/accounts", requireSuperAdmin, asyncHandler(async (req, res) => {
  const { username, password, fullName, email } = req.body || {};
  const result = await superAdminService.createAccount({
    username,
    password,
    fullName,
    email,
    actor: req.superadmin
  });
  res.json({ account: result.account, totpSecret: result.totpSecret });
}));

router.post("/accounts/:id/active", requireSuperAdmin, asyncHandler(async (req, res) => {
  const { isActive } = req.body || {};
  if (typeof isActive !== "boolean") {
    return res.status(400).json({ error: "isActive must be a boolean.", code: "FIELDS_REQUIRED" });
  }
  res.json(await superAdminService.setActive({ id: req.params.id, isActive, actor: req.superadmin, ipAddress: req.ip }));
}));

router.post("/accounts/:id/reset-totp", requireSuperAdmin, asyncHandler(async (req, res) => {
  res.json(await superAdminService.resetTotp({ id: req.params.id, actor: req.superadmin, ipAddress: req.ip }));
}));

module.exports = router;
