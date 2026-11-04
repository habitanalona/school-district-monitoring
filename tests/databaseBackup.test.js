"use strict";

// Run with NODE_ENV=test before the app (and its session store) is loaded.
process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const request = require("supertest");
const bcrypt = require("bcrypt");

const app = require("../server/app");
const { pool } = require("../server/config/database");
const databaseBackupService = require("../server/services/databaseBackupService");

const ADMIN = { username: "tst.backupadmin", email: "tst.backupadmin@example.test" };
const NON_ADMIN = { username: "tst.backupdistrict", email: "tst.backupdistrict@example.test" };
const PASSWORD = "BackupTest1234";

let admin = null;
let nonAdmin = null;

async function cleanup() {
  await pool.query(
    "DELETE FROM audit_logs WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)",
    ["tst.backup%"]
  );
  await pool.query("DELETE FROM users WHERE username LIKE $1", ["tst.backup%"]);
}

async function fetchCsrf(agent) {
  const response = await agent.get("/api/auth/csrf");
  assert.equal(response.status, 200);
  assert.ok(response.body.data.csrfToken);
  return response.body.data.csrfToken;
}

async function login(credentials) {
  const agent = request.agent(app);
  const token = await fetchCsrf(agent);
  const response = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", token)
    .send({ identifier: credentials.username, password: credentials.password });
  assert.equal(
    response.status,
    200,
    `login for ${credentials.username} should succeed: ${JSON.stringify(response.body)}`
  );
  return {
    agent,
    csrfToken: response.body.data.csrfToken || token,
    user: response.body.data.user
  };
}

async function createAccount({ username, email, role, districtId = null }) {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await pool.query(
    `INSERT INTO users (full_name, username, email, password_hash, role, district_id, is_active, approval_status)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, 'active')
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, is_active = TRUE, approval_status = 'active'`,
    [`Backup Test ${role}`, username, email, passwordHash, role, districtId]
  );
}

function tempBackupFiles() {
  return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith("sdms-db-backup-"));
}

before(async () => {
  await cleanup();
  const district = await pool.query("SELECT id FROM districts WHERE district_code = 'NVD' LIMIT 1");
  assert.ok(district.rows[0], "the seeded NVD district is required for the non-admin fixture");
  await createAccount({ ...ADMIN, role: "system_admin" });
  await createAccount({ ...NON_ADMIN, role: "district_admin", districtId: Number(district.rows[0].id) });
  admin = await login({ ...ADMIN, password: PASSWORD });
  nonAdmin = await login({ ...NON_ADMIN, password: PASSWORD });
});

after(async () => {
  await cleanup();
  await pool.end();
});

test("anonymous requests cannot reach the backup API or page", async () => {
  const agent = request.agent(app);
  const token = await fetchCsrf(agent);
  const post = await agent.post("/api/database-backup").set("X-CSRF-Token", token).send({});
  assert.equal(post.status, 401);
  assert.equal(post.body.code, "AUTH_REQUIRED");

  const page = await agent.get("/database-backup");
  assert.equal(page.status, 302);
  assert.match(page.headers.location, /index\.html/);
});

test("non-administrators are rejected by the API and the page", async () => {
  const post = await nonAdmin.agent
    .post("/api/database-backup")
    .set("X-CSRF-Token", nonAdmin.csrfToken)
    .send({});
  assert.equal(post.status, 403);
  assert.equal(post.body.code, "FORBIDDEN");

  const page = await nonAdmin.agent.get("/database-backup");
  assert.equal(page.status, 403);
});

test("state-changing backup requests require a CSRF token", async () => {
  const response = await admin.agent.post("/api/database-backup");
  assert.equal(response.status, 403);
  assert.equal(response.body.code, "CSRF_INVALID");
});

test("the administrator can open the backup page", async () => {
  const page = await admin.agent.get("/database-backup");
  assert.equal(page.status, 200);
  assert.match(page.text, /Generate &amp; Download Backup/);
  assert.match(page.text, /database_backup_/);
});

test("the administrator receives a restorable plain-SQL dump", async () => {
  const response = await admin.agent
    .post("/api/database-backup")
    .set("X-CSRF-Token", admin.csrfToken)
    .send({});

  const dump = response.text || "";
  assert.equal(response.status, 200, `download failed: ${JSON.stringify(response.body)}`);
  assert.match(response.headers["content-type"], /^text\/plain/);
  assert.match(
    response.headers["content-disposition"],
    /^attachment; filename="database_backup_[A-Za-z0-9_-]+_\d{4}-\d{2}-\d{2}_\d{6}\.sql"$/
  );
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.match(dump, /PostgreSQL database dump/);
  assert.match(dump, /CREATE TABLE public\.users/);
  assert.match(dump, /COPY public\.users/);
  assert.match(dump, /CREATE SEQUENCE public\./);
  assert.match(dump, /CREATE INDEX/);
  assert.match(dump, /ADD CONSTRAINT/);
  assert.match(dump, /PostgreSQL database dump complete/);

  const tables = await pool.query(
    "SELECT count(*)::int AS total FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
  );
  const created = (dump.match(/CREATE TABLE public\./g) || []).length;
  assert.equal(created, tables.rows[0].total, "the dump should contain every public table");

  const audit = await pool.query(
    `SELECT details FROM audit_logs
     WHERE action = 'database.backup_downloaded' AND user_id = $1
     ORDER BY id DESC LIMIT 1`,
    [admin.user.id]
  );
  assert.ok(audit.rows[0], "the download should be written to the audit trail");
  assert.ok(audit.rows[0].details.fileName);
  assert.ok(audit.rows[0].details.sizeBytes > 0);

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(tempBackupFiles(), [], "temporary dump files should be deleted after download");
});

test("only one backup can run at a time across the system", async () => {
  databaseBackupService.begin(nonAdmin.user.id);
  try {
    const response = await admin.agent
      .post("/api/database-backup")
      .set("X-CSRF-Token", admin.csrfToken)
      .send({});
    assert.equal(response.status, 409);
    assert.equal(response.body.code, "BACKUP_IN_PROGRESS");
  } finally {
    databaseBackupService.end(nonAdmin.user.id);
  }

  const retry = await admin.agent
    .post("/api/database-backup")
    .set("X-CSRF-Token", admin.csrfToken)
    .send({});
  assert.equal(retry.status, 200, "the lock should be released after the first download finishes");
});
