"use strict";

// Security Firewall module tests.
//
// These exercise the real enforcement paths (session auth, switch state,
// database write guard, maintenance middleware, integrity scanning, upload
// inspection, audit hash chain, monitoring worker) against the configured
// development database. A dedicated SuperAdmin fixture is created once and
// kept deactivated after the run; its password/MFA secret are reset on every
// run so no credential in this file is valid outside a test process.

process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcrypt");
const request = require("supertest");

const app = require("../server/app");
const { pool, query, runSecurityWrite } = require("../server/config/database");
const guardState = require("../server/services/security/guardState");
const securityEvents = require("../server/services/security/securityEventService");
const uploadSecurity = require("../server/services/security/uploadSecurityService");
const monitoringWorker = require("../server/services/security/monitoringWorker");
const superAdminService = require("../server/services/security/superAdminService");
const { generateSecret, totp } = require("../server/utils/totp");

const FIXTURE_USERNAME = "tst.security.superadmin";
const FIXTURE_PASSWORD = "Tst!SecurePass123";
const ORDINARY_USERNAME = "tst.security.admin";
const ORDINARY_EMAIL = "tst.security.admin@example.test";
const ORDINARY_PASSWORD = "Tst!OrdinaryPass123";
const SWITCH_KEYS = ["db_write_protection", "code_write_protection", "maintenance_mode", "security_lockdown"];
const SCRATCH_FILE = path.join(__dirname, "..", "client", "js", "tst-integrity-scratch.js");
const startedAt = new Date();

let superAgent = null;
let superCsrf = null;
let totpSecret = null;
let fixtureId = null;
const createdEventIds = [];

function guardContext(authenticated) {
  return { source: "application", authenticated, actor: authenticated ? "test-user" : "anonymous", ip: "127.0.0.1" };
}

async function expectGuardReject(promise, reason) {
  try {
    await promise;
    assert.fail("expected the database firewall to reject this statement");
  } catch (error) {
    assert.equal(error.code, "SECURITY_WRITE_REJECTED", error.stack);
    if (reason) {
      assert.equal(error.firewallReason, reason);
    }
  }
}

async function forceSwitchesOff() {
  await runSecurityWrite(() =>
    query("UPDATE firewall_settings SET enabled = FALSE, updated_at = now() WHERE enabled = TRUE")
  );
  SWITCH_KEYS.forEach((key) => guardState.setSwitch(key, false));
}

async function loginSystemAdmin() {
  const agent = request.agent(app);
  const csrfRes = await agent.get("/api/auth/csrf");
  const csrf = csrfRes.body.data.csrfToken;
  const res = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", csrf)
    .send({ identifier: ORDINARY_USERNAME, password: ORDINARY_PASSWORD });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { agent, csrf };
}

async function ensureOrdinaryAdmin() {
  const passwordHash = await bcrypt.hash(ORDINARY_PASSWORD, 12);
  await query(
    `INSERT INTO users (full_name, username, email, password_hash, role, is_active, approval_status)
     VALUES ('Automated Security Test Administrator', $1, $2, $3, 'system_admin', TRUE, 'active')
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, is_active = TRUE, approval_status = 'active'`,
    [ORDINARY_USERNAME, ORDINARY_EMAIL, passwordHash]
  );
}

async function loginSuperAdmin() {
  const agent = request.agent(app);
  const csrfRes = await agent.get("/api/security/csrf");
  assert.equal(csrfRes.status, 200);
  const csrf = csrfRes.body.csrfToken;
  const res = await agent
    .post("/api/security/auth/login")
    .set("X-CSRF-Token", csrf)
    .send({ username: FIXTURE_USERNAME, password: FIXTURE_PASSWORD, totpToken: totp(totpSecret) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { agent, csrf };
}

async function setSwitch(key, enabled, reason = "Automated verification run") {
  const res = await superAgent
    .post(`/api/security/switches/${key}`)
    .set("X-CSRF-Token", superCsrf)
    .send({ enabled, reason });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

before(async () => {
  await forceSwitchesOff();
  await ensureOrdinaryAdmin();

  const existing = await query("SELECT id, username FROM superadmin_users WHERE username = $1", [FIXTURE_USERNAME]);
  totpSecret = generateSecret();
  if (existing.rows.length > 0) {
    fixtureId = existing.rows[0].id;
    const passwordHash = await bcrypt.hash(FIXTURE_PASSWORD, 12);
    await runSecurityWrite(() =>
      query(
        `UPDATE superadmin_users
         SET password_hash = $1, totp_secret = $2, totp_enabled = TRUE, is_active = TRUE,
             failed_logins = 0, locked_until = NULL
         WHERE id = $3`,
        [passwordHash, totpSecret, fixtureId]
      )
    );
  } else {
    const created = await superAdminService.createAccount({
      username: FIXTURE_USERNAME,
      password: FIXTURE_PASSWORD,
      fullName: "Automated Security Fixture",
      actor: "security-test"
    });
    fixtureId = created.account.id;
    totpSecret = created.totpSecret;
  }

  const session = await loginSuperAdmin();
  superAgent = session.agent;
  superCsrf = session.csrf;
});

after(async () => {
  try {
    await forceSwitchesOff();
    if (fs.existsSync(SCRATCH_FILE)) {
      fs.unlinkSync(SCRATCH_FILE);
    }
    if (fixtureId) {
      await runSecurityWrite(() =>
        query("UPDATE superadmin_users SET is_active = FALSE WHERE id = $1", [fixtureId])
      );
    }
    await query("DELETE FROM users WHERE username = $1", [ORDINARY_USERNAME]);
    await runSecurityWrite(() =>
      query("DELETE FROM file_upload_security_logs WHERE original_name LIKE 'tst-%'")
    );
    if (createdEventIds.length > 0) {
      await runSecurityWrite(() =>
        query("DELETE FROM security_alerts WHERE source = ANY($1::text[])", [createdEventIds])
      );
      await runSecurityWrite(() =>
        query("DELETE FROM security_incidents WHERE source_event_id IN (SELECT id FROM security_events WHERE event_id = ANY($1::text[]))", [
          createdEventIds
        ])
      );
      await runSecurityWrite(() =>
        query("DELETE FROM security_events WHERE event_id = ANY($1::text[])", [createdEventIds])
      );
    }
    monitoringWorker.stop();
  } catch (error) {
    console.error("Security test cleanup failed:", error.message);
  }
});

test("SuperAdmin sign-in rejects bad passwords, bad MFA codes, and ordinary accounts", async () => {
  const agent = request.agent(app);
  const csrf = (await agent.get("/api/security/csrf")).body.csrfToken;

  const wrongPassword = await agent
    .post("/api/security/auth/login")
    .set("X-CSRF-Token", csrf)
    .send({ username: FIXTURE_USERNAME, password: "Wrong!Password123", totpToken: totp(totpSecret) });
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongPassword.body.code, "SUPERADMIN_AUTH_FAILED");

  const wrongTotp = await agent
    .post("/api/security/auth/login")
    .set("X-CSRF-Token", csrf)
    .send({ username: FIXTURE_USERNAME, password: FIXTURE_PASSWORD, totpToken: "000000" });
  assert.equal(wrongTotp.status, 401);
  assert.equal(wrongTotp.body.code, "SUPERADMIN_MFA_INVALID");

  const ordinary = await agent
    .post("/api/security/auth/login")
    .set("X-CSRF-Token", csrf)
    .send({ username: ORDINARY_USERNAME, password: ORDINARY_PASSWORD, totpToken: "123456" });
  assert.equal(ordinary.status, 401, "a system administrator must not exist as a SuperAdmin");

  // Reset the failed-login counter so the rest of the suite can authenticate.
  await runSecurityWrite(() =>
    query("UPDATE superadmin_users SET failed_logins = 0, locked_until = NULL WHERE id = $1", [fixtureId])
  );
});

test("Ordinary administrators and anonymous users cannot reach the security console API", async () => {
  const anonymous = await request(app).get("/api/security/overview");
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.code, "SUPERADMIN_REQUIRED");

  const systemAdmin = await loginSystemAdmin();
  const denied = await systemAdmin.agent.get("/api/security/accounts");
  assert.equal(denied.status, 403, "a signed-in non-SuperAdmin must be forbidden, not treated as anonymous");
  assert.equal(denied.body.code, "SUPERADMIN_REQUIRED");

  const page = await request(app).get("/security-firewall.html");
  assert.equal(page.status, 200, "the login shell must be reachable without a session");
});

test("The three master switches operate independently and demand a reason", async () => {
  const tooShort = await superAgent
    .post("/api/security/switches/db_write_protection")
    .set("X-CSRF-Token", superCsrf)
    .send({ enabled: true, reason: "no" });
  assert.equal(tooShort.status, 400);

  await setSwitch("db_write_protection", true);
  let states = await superAgent.get("/api/security/switches");
  let map = Object.fromEntries(states.body.switches.map((row) => [row.key, row.enabled]));
  assert.equal(map.db_write_protection, true);
  assert.equal(map.code_write_protection, false, "code protection must not follow database protection");
  assert.equal(map.maintenance_mode, false, "maintenance must not follow database protection");

  await setSwitch("db_write_protection", false);
  await setSwitch("code_write_protection", true);
  states = await superAgent.get("/api/security/switches");
  map = Object.fromEntries(states.body.switches.map((row) => [row.key, row.enabled]));
  assert.equal(map.code_write_protection, true);
  assert.equal(map.db_write_protection, false, "database protection must not follow code protection");
  assert.equal(map.maintenance_mode, false);

  await setSwitch("code_write_protection", false);
});

test("Database write protection blocks unauthenticated writes and always blocks schema or security-table writes", async () => {
  await setSwitch("db_write_protection", true);
  try {
    await expectGuardReject(
      query("INSERT INTO announcements (title, body) VALUES ('tst', 'tst')"),
      "ANONYMOUS_WRITE_BLOCKED"
    );

    await expectGuardReject(
      guardState.runWithContext(guardContext(true), () =>
        query("CREATE TABLE IF NOT EXISTS tst_firewall_probe (id integer)")
      ),
      "SCHEMA_CHANGES_REQUIRE_MIGRATION"
    );

    await expectGuardReject(
      guardState.runWithContext(guardContext(true), () =>
        query("DELETE FROM security_events WHERE id = -1")
      ),
      "SECURITY_TABLES_ACCESS_DENIED"
    );

    const allowed = await guardState.runWithContext(guardContext(true), () =>
      query("UPDATE announcements SET title = title WHERE id = -1")
    );
    assert.equal(allowed.rowCount, 0, "authenticated application writes should pass the guard");

    const read = await query("SELECT 1 AS ok");
    assert.equal(read.rows[0].ok, 1);

    const probe = await query("SELECT to_regclass('public.tst_firewall_probe') AS table_name");
    assert.equal(probe.rows[0].table_name, null, "blocked DDL must never reach PostgreSQL");
  } finally {
    await setSwitch("db_write_protection", false);
  }
});

test("Security lockdown freezes application writes while the security module keeps working", async () => {
  await setSwitch("security_lockdown", true);
  try {
    await expectGuardReject(
      guardState.runWithContext(guardContext(true), () =>
        query("UPDATE announcements SET title = title WHERE id = -1")
      ),
      "DB_FROZEN_SECURITY_LOCKDOWN"
    );

    const health = await superAgent.get("/api/security/overview");
    assert.equal(health.status, 200, "SuperAdmin monitoring must remain available during lockdown");
  } finally {
    await setSwitch("security_lockdown", false);
  }
});

test("Maintenance mode redirects ordinary users but keeps SuperAdmin and monitoring access", async () => {
  const systemAdmin = await loginSystemAdmin();
  await setSwitch("maintenance_mode", true);
  try {
    const page = await request(app).get("/dashboard.html").redirects(0);
    assert.equal(page.status, 302);
    assert.match(page.headers.location, /\/under-maintenance\.html$/);

    const notice = await request(app).get("/under-maintenance.html");
    assert.equal(notice.status, 200);

    const blocked = await systemAdmin.agent.get("/api/announcements");
    assert.equal(blocked.status, 503);
    assert.equal(blocked.body.code, "SERVICE_UNDER_MAINTENANCE");

    const blockedLogin = await request(app).post("/api/auth/login").send({ identifier: "x", password: "y" });
    assert.equal(blockedLogin.status, 503);

    const retained = await superAgent.get("/api/security/overview");
    assert.equal(retained.status, 200, "SuperAdmin must retain security access during maintenance");

    const worker = await superAgent.get("/api/security/health");
    assert.equal(worker.status, 200);
  } finally {
    await setSwitch("maintenance_mode", false);
  }
});

test("Code integrity baseline verification detects an unexpected file", async () => {
  const baseline = await superAgent.post("/api/security/code-integrity/baseline").set("X-CSRF-Token", superCsrf);
  assert.equal(baseline.status, 200, JSON.stringify(baseline.body));
  assert.ok(baseline.body.files > 0 || baseline.body.baseline, "baseline should hash the tree");

  fs.writeFileSync(SCRATCH_FILE, "// automated integrity probe\n", "utf8");
  try {
    const verify = await superAgent.post("/api/security/code-integrity/verify").set("X-CSRF-Token", superCsrf);
    assert.equal(verify.status, 200, JSON.stringify(verify.body));
    const changed = verify.body.changes.find((change) => change.filePath.replace(/\\/g, "/").endsWith("tst-integrity-scratch.js"));
    assert.ok(changed, "the unexpected file must be reported");
    assert.equal(changed.status, "added");

    const event = await query(
      `SELECT event_id, severity, action FROM security_events
       WHERE action IN ('CODE_INTEGRITY_CHANGE', 'UNAUTHORIZED_CODE_MODIFICATION')
         AND created_at >= $1
       ORDER BY id DESC LIMIT 1`,
      [startedAt]
    );
    assert.equal(event.rows.length, 1);
    assert.equal(event.rows[0].severity, "high");
    createdEventIds.push(event.rows[0].event_id);
  } finally {
    if (fs.existsSync(SCRATCH_FILE)) {
      fs.unlinkSync(SCRATCH_FILE);
    }
  }
});

test("Suspicious uploads are rejected and written to the upload security log", async () => {
  const result = await uploadSecurity.inspectAndLog({
    file: {
      originalname: "tst-malware.exe",
      mimetype: "application/octet-stream",
      buffer: Buffer.from("MZ\x90\x00fake executable", "binary"),
      size: 18
    },
    user: null,
    ip: "127.0.0.1",
    method: "POST",
    originalUrl: "/api/test-upload",
    get: () => "security-test-agent"
  });
  assert.ok(result);
  assert.equal(result.scanResult, "rejected");

  const logged = await query(
    `SELECT scan_result, rejection_reason FROM file_upload_security_logs
     WHERE original_name = 'tst-malware.exe' ORDER BY id DESC LIMIT 1`
  );
  assert.equal(logged.rows.length, 1);
  assert.equal(logged.rows[0].scan_result, "rejected");
});

test("Intrusion detection records SQL injection indicators without breaking normal replies", async () => {
  const response = await request(app)
    .get("/api/security/session")
    .query({ search: "1' OR '1'='1' --" });
  assert.equal(response.status, 200, "detection must not turn a read into an error");

  let event = { rows: [] };
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline && event.rows.length === 0) {
    event = await query(
      `SELECT event_id, severity FROM security_events
       WHERE action = 'SQLI_INDICATOR' AND created_at >= $1
       ORDER BY id DESC LIMIT 1`,
      [startedAt]
    );
    if (event.rows.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (event.rows.length === 0) {
    const recent = await query(
      `SELECT action, category, severity FROM security_events
       WHERE created_at >= $1 ORDER BY id DESC LIMIT 12`,
      [startedAt]
    );
    assert.fail(`the injection attempt should be recorded; recent events: ${JSON.stringify(recent.rows)}`);
  }
  createdEventIds.push(event.rows[0].event_id);
});

test("Critical events open incidents and alerts automatically", async () => {
  const event = await securityEvents.record({
    severity: "critical",
    category: "database",
    action: "UNAUTHORIZED_DB_DELETION_ATTEMPT",
    description: "Automated test: simulated unauthorized deletion attempt.",
    firewallDecision: "rejected"
  });
  createdEventIds.push(event.eventId);
  assert.ok(event.incidentId, "a critical event must open an incident");

  const incident = await query("SELECT reference, status, severity FROM security_incidents WHERE id = $1", [
    event.incidentId
  ]);
  assert.equal(incident.rows.length, 1);
  assert.equal(incident.rows[0].status, "new");
  assert.equal(incident.rows[0].severity, "critical");
  assert.match(incident.rows[0].reference, /^INC-\d{4}-\d{4}$/);

  const alert = await query("SELECT severity FROM security_alerts WHERE source = $1", [event.eventId]);
  assert.equal(alert.rows.length, 1);
  assert.equal(alert.rows[0].severity, "critical");
});

test("Incident lifecycle transitions are validated", async () => {
  const event = await securityEvents.record({
    severity: "critical",
    category: "code",
    action: "UNAUTHORIZED_CODE_MODIFICATION",
    description: "Automated test: simulated code modification.",
    firewallDecision: "rejected"
  });
  createdEventIds.push(event.eventId);

  const skip = await superAgent
    .post(`/api/security/incidents/${event.incidentId}/status`)
    .set("X-CSRF-Token", superCsrf)
    .send({ status: "resolved", note: "skipping steps" });
  assert.equal(skip.status, 409, "out-of-order transitions must be rejected");

  const valid = await superAgent
    .post(`/api/security/incidents/${event.incidentId}/status`)
    .set("X-CSRF-Token", superCsrf)
    .send({ status: "investigating", note: "analyst reviewing" });
  assert.equal(valid.status, 200, JSON.stringify(valid.body));
  assert.equal(valid.body.incident.status, "investigating");
});

test("The security audit trail is hash-chained and exportable only to SuperAdmin", async () => {
  const verify = await superAgent.get("/api/security/audit-logs/verify");
  assert.equal(verify.status, 200);
  assert.equal(verify.body.intact, true, "audit hash chain must be intact");

  const exported = await superAgent.get("/api/security/audit-logs/export");
  assert.equal(exported.status, 200);
  assert.match(exported.headers["content-type"], /text\/csv/);
  assert.match(exported.text.split("\n")[0], /^event_id,occurred_at,actor_name,action/);

  const systemAdmin = await loginSystemAdmin();
  const denied = await systemAdmin.agent.get("/api/security/audit-logs/export");
  assert.equal(denied.status, 403);
});

test("The database guard fails closed when switch state cannot be confirmed", async () => {
  const previous = guardState.state.degraded;
  guardState.state.degraded = true;
  try {
    await expectGuardReject(
      guardState.runWithContext(guardContext(true), () =>
        query("UPDATE announcements SET title = title WHERE id = -1")
      ),
      "GUARD_STATE_UNAVAILABLE"
    );
  } finally {
    guardState.state.degraded = previous;
  }
});

test("Monitoring continues without a browser and persists health probes", async () => {
  monitoringWorker.start();
  assert.equal(monitoringWorker.status().running, true);

  const deadline = Date.now() + 6000;
  let probes = 0;
  while (Date.now() < deadline) {
    const result = await query(
      `SELECT COUNT(*)::int AS total FROM system_health_records WHERE created_at >= $1`,
      [new Date(startedAt.getTime() - 1000)]
    );
    probes = result.rows[0].total;
    if (probes > 0) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(probes > 0, "the worker should record health probes without any HTTP client");
});

test("SuperAdmin cannot deactivate their own account", async () => {
  const accounts = await superAgent.get("/api/security/accounts");
  assert.equal(accounts.status, 200);
  const self = accounts.body.accounts.find((account) => account.id === fixtureId);
  assert.ok(self);

  const attempt = await superAgent
    .post(`/api/security/accounts/${fixtureId}/active`)
    .set("X-CSRF-Token", superCsrf)
    .send({ isActive: false });
  assert.equal(attempt.status, 400, JSON.stringify(attempt.body));
});

test("Existing modules keep working for ordinary users", async () => {
  const systemAdmin = await loginSystemAdmin();
  const summary = await systemAdmin.agent.get("/api/dashboard/summary");
  assert.equal(summary.status, 200, JSON.stringify(summary.body));

  const schools = await systemAdmin.agent.get("/api/schools?page=1&pageSize=5");
  assert.equal(schools.status, 200);

  const dashboard = await systemAdmin.agent.get("/dashboard.html");
  assert.equal(dashboard.status, 200);

  const me = await systemAdmin.agent.get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.data.superadmin, null, "ordinary sessions must not gain SuperAdmin rights");
});
