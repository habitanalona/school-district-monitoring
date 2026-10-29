"use strict";

// Run with NODE_ENV=test before the app (and its session store) is loaded.
process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../server/app");
const { pool } = require("../server/config/database");

const PASSWORD = "Permission1234";
const HEAD_USERNAME = "prm.test.head";
const ADMIN_USERNAME = "prm.test.admin";
const SYSTEM = { username: "sysadmin", password: "Admin@2026" };
const DISTRICT_ADMIN = { username: "northadmin", password: "District@2026" };

let system = null;
let districtAdmin = null;
let head = null;
let headUser = null;
let headAdmin = null;
let secondAdmin = null;
let secondAdminUser = null;
let schoolId = null;
let districtId = null;
let learnerId = null;

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
  assert.equal(response.status, 200, `login for ${credentials.username} should succeed`);
  return {
    agent,
    csrfToken: response.body.data.csrfToken || token,
    user: response.body.data.user
  };
}

async function createAccount(systemSession, payload) {
  return systemSession.agent
    .post("/api/users")
    .set("X-CSRF-Token", systemSession.csrfToken)
    .send({
      fullName: payload.fullName,
      username: payload.username,
      email: `${payload.username}@example.com`,
      password: PASSWORD,
      role: payload.role,
      districtId: payload.districtId === undefined ? null : payload.districtId,
      schoolId: payload.schoolId === undefined ? null : payload.schoolId,
      isActive: true
    });
}

async function loadDetail(session, userId) {
  const response = await session.agent.get(`/api/user-rights/users/${userId}`);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.data;
}

function withPermissions(detail, mutate) {
  const permissions = JSON.parse(JSON.stringify(detail.permissions));
  mutate(permissions);
  return permissions;
}

async function savePermissions(session, userId, permissions) {
  return session.agent
    .put(`/api/user-rights/users/${userId}`)
    .set("X-CSRF-Token", session.csrfToken)
    .send({ permissions });
}

before(async () => {
  const target = await pool.query(
    `SELECT l.school_id, l.id AS learner_id, s.district_id
     FROM learners l
     JOIN schools s ON s.id = l.school_id
     WHERE l.school_id IS NOT NULL
     ORDER BY l.id
     LIMIT 1`
  );
  assert.ok(target.rows[0], "the database must be seeded before running tests (npm run db:init)");
  schoolId = Number(target.rows[0].school_id);
  districtId = Number(target.rows[0].district_id);
  learnerId = Number(target.rows[0].learner_id);

  await pool.query("DELETE FROM users WHERE username = ANY($1)", [[HEAD_USERNAME, ADMIN_USERNAME]]);
  await pool.query("DELETE FROM audit_logs WHERE details::text ILIKE $1", ["%prm.test.%"]);

  system = await login(SYSTEM);
  districtAdmin = await login(DISTRICT_ADMIN);

  const headCreate = await createAccount(system, {
    fullName: "Permission Test School Head",
    username: HEAD_USERNAME,
    role: "school_head",
    districtId,
    schoolId
  });
  assert.equal(headCreate.status, 201, JSON.stringify(headCreate.body));
  headUser = headCreate.body.data;

  const adminCreate = await createAccount(system, {
    fullName: "Permission Test Second Administrator",
    username: ADMIN_USERNAME,
    role: "system_admin"
  });
  assert.equal(adminCreate.status, 201, JSON.stringify(adminCreate.body));
  secondAdminUser = adminCreate.body.data;

  head = await login({ username: HEAD_USERNAME, password: PASSWORD });
  secondAdmin = await login({ username: ADMIN_USERNAME, password: PASSWORD });
});

after(async () => {
  await pool.query("DELETE FROM audit_logs WHERE details::text ILIKE $1", ["%prm.test.%"]);
  await pool.query("DELETE FROM user_permissions WHERE user_id = ANY($1)", [
    [Number(headUser.id), Number(secondAdminUser.id)]
  ]);
  await pool.query("DELETE FROM users WHERE username = ANY($1)", [[HEAD_USERNAME, ADMIN_USERNAME]]);
  await pool.end();
});

test("only the system administrator can open the user rights module", async () => {
  const deniedApi = await districtAdmin.agent.get("/api/user-rights/users");
  assert.equal(deniedApi.status, 403);
  assert.equal(deniedApi.body.code, "FORBIDDEN");

  const deniedPage = await districtAdmin.agent.get("/user-rights.html");
  assert.equal(deniedPage.status, 403);
  assert.match(deniedPage.text, /You do not have access to this page/);

  const deniedSave = await districtAdmin.agent
    .put(`/api/user-rights/users/${headUser.id}`)
    .set("X-CSRF-Token", districtAdmin.csrfToken)
    .send({ permissions: {} });
  assert.equal(deniedSave.status, 403);

  const page = await system.agent.get("/user-rights.html");
  assert.equal(page.status, 200);
  assert.match(page.text, /User rights and permissions/);

  const catalog = await system.agent.get("/api/user-rights/catalog");
  assert.equal(catalog.status, 200);
  assert.ok(catalog.body.data.modules.length >= 15);
  assert.ok(catalog.body.data.modules.every((module) => module.key && module.actions.length));
  assert.ok(catalog.body.data.schools.length >= 1);
});

test("the administrator can search and filter accounts and inspect role defaults", async () => {
  const search = await system.agent.get("/api/user-rights/users").query({ search: "prm.test.head" });
  assert.equal(search.status, 200);
  assert.equal(search.body.data.length, 1);
  assert.equal(search.body.data[0].username, HEAD_USERNAME);
  assert.ok(Number(search.body.data[0].id) === Number(headUser.id));
  assert.equal(search.body.summary.custom >= 0, true);

  const byRole = await system.agent
    .get("/api/user-rights/users")
    .query({ role: "system_admin", status: "active", schoolId: "" });
  assert.equal(byRole.status, 200);
  assert.ok(byRole.body.data.every((user) => user.role === "system_admin" && user.isActive));

  const bySchool = await system.agent
    .get("/api/user-rights/users")
    .query({ schoolId, role: "school_head" });
  assert.equal(bySchool.status, 200);
  assert.ok(bySchool.body.data.every((user) => Number(user.schoolId) === schoolId));

  const detail = await loadDetail(system, headUser.id);
  assert.equal(detail.user.username, HEAD_USERNAME);
  assert.equal(detail.user.role, "school_head");
  assert.equal(detail.permissions.learners.access, true);
  assert.equal(detail.permissions.learners.edit, true);
  assert.equal(detail.roleDefaults.learners.edit, true);
  assert.equal(detail.roleDefaults.user_rights.access, false);
});

test("overrides are normalised, persisted, audited, and enforced on the next request", async () => {
  const before = await loadDetail(system, headUser.id);
  assert.equal(Object.keys(before.overrides).length, 0);

  // Access cannot be left off while Add/Edit/Delete stay on.
  const revokeAccess = withPermissions(before, (permissions) => {
    permissions.learners.access = false;
    permissions.learners.add = true;
  });
  const saved = await savePermissions(system, headUser.id, revokeAccess);
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.data.permissions.learners, {
    access: false,
    add: false,
    edit: false,
    delete: false
  });
  assert.equal(Object.keys(saved.body.data.overrides).length, 1);

  // The head is still signed in from before the change; revocation is immediate.
  const blockedApi = await head.agent.get("/api/learners");
  assert.equal(blockedApi.status, 403);
  assert.equal(blockedApi.body.code, "FORBIDDEN");

  const blockedPage = await head.agent.get("/learners.html");
  assert.equal(blockedPage.status, 403);
  assert.match(blockedPage.text, /You do not have access to this page/);

  const otherPage = await head.agent.get("/dashboard.html");
  assert.equal(otherPage.status, 200);

  // Restore the inherited role policy; the override row is removed again.
  const restoreAccess = await savePermissions(
    system,
    headUser.id,
    withPermissions(before, () => {})
  );
  assert.equal(restoreAccess.status, 200);
  assert.equal(Object.keys(restoreAccess.body.data.overrides).length, 0);
  const afterRestore = await head.agent.get("/api/learners");
  assert.equal(afterRestore.status, 200);

  // An individual edit revocation blocks writes but keeps read access.
  const revokeEdit = withPermissions(restoreAccess.body.data, (permissions) => {
    permissions.learners.edit = false;
  });
  const editSaved = await savePermissions(system, headUser.id, revokeEdit);
  assert.equal(editSaved.status, 200);
  assert.equal(editSaved.body.data.permissions.learners.access, true);
  assert.equal(editSaved.body.data.permissions.learners.edit, false);
  assert.equal(editSaved.body.data.permissions.learners.add, true);

  const readStillWorks = await head.agent.get("/api/learners");
  assert.equal(readStillWorks.status, 200);

  const writeDenied = await head.agent
    .put(`/api/learners/${learnerId}`)
    .set("X-CSRF-Token", head.csrfToken)
    .send({});
  assert.equal(writeDenied.status, 403);
  assert.equal(writeDenied.body.code, "FORBIDDEN");

  // The revocation survives a fresh sign-in rather than living in a cached page.
  const reLogin = await login({ username: HEAD_USERNAME, password: PASSWORD });
  const me = await reLogin.agent.get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.data.permissions.modules.learners.edit, false);
  const reLoginWrite = await reLogin.agent
    .put(`/api/learners/${learnerId}`)
    .set("X-CSRF-Token", reLogin.csrfToken)
    .send({});
  assert.equal(reLoginWrite.status, 403);

  const history = await system.agent.get(`/api/user-rights/users/${headUser.id}/history`);
  assert.equal(history.status, 200);
  assert.ok(history.body.data.length >= 2);
  const latest = history.body.data[0];
  assert.equal(latest.action, "user.permissions_updated");
  assert.ok(latest.actorName);
  assert.ok(latest.changes.some((change) => change.module === "learners" && change.action === "edit"));

  const audit = await pool.query(
    `SELECT details FROM audit_logs
     WHERE action = 'user.permissions_updated' AND entity_id = $1
     ORDER BY id DESC LIMIT 1`,
    [String(headUser.id)]
  );
  assert.ok(audit.rows[0]);
  assert.equal(audit.rows[0].details.target_username, HEAD_USERNAME);
  assert.ok(Array.isArray(audit.rows[0].details.changes));

  // Restore the account so the demonstration data is unchanged.
  const finalRestore = await savePermissions(
    system,
    headUser.id,
    withPermissions(editSaved.body.data, (permissions) => {
      permissions.learners.edit = true;
    })
  );
  assert.equal(finalRestore.status, 200);
  assert.equal(Object.keys(finalRestore.body.data.overrides).length, 0);
});

test("self changes, escalation, unknown modules, and admin tampering are rejected", async () => {
  const selfAttempt = await savePermissions(system, system.user.id, {});
  assert.equal(selfAttempt.status, 403);
  assert.equal(selfAttempt.body.code, "SELF_PERMISSION_CHANGE");

  const detail = await loadDetail(system, headUser.id);
  const escalation = withPermissions(detail, (permissions) => {
    permissions.users.access = true;
    permissions.users.edit = true;
  });
  const escalationAttempt = await savePermissions(system, headUser.id, escalation);
  assert.equal(escalationAttempt.status, 403);
  assert.equal(escalationAttempt.body.code, "PERMISSION_NOT_GRANTABLE");

  const unknownModule = withPermissions(detail, (permissions) => {
    permissions.not_a_module = { access: true, add: true, edit: true, delete: true };
  });
  const unknownAttempt = await savePermissions(system, headUser.id, unknownModule);
  assert.equal(unknownAttempt.status, 400);

  const adminAttempt = await savePermissions(system, secondAdminUser.id, {
    learners: { access: false, add: false, edit: false, delete: false }
  });
  assert.equal(adminAttempt.status, 403);
  assert.equal(adminAttempt.body.code, "SYSTEM_ADMIN_IMMUTABLE");

  // The second administrator still has the fixed full matrix.
  const adminDetail = await loadDetail(system, secondAdminUser.id);
  assert.equal(adminDetail.permissions.user_rights.access, true);
  assert.equal(adminDetail.permissions.learners.delete, true);
  assert.equal(Object.keys(adminDetail.overrides).length, 0);
});

test("revoking a module hides its API from the account without affecting other modules", async () => {
  const before = await loadDetail(system, headUser.id);
  const revokeReports = withPermissions(before, (permissions) => {
    permissions.learner_reports.access = false;
  });
  const saved = await savePermissions(system, headUser.id, revokeReports);
  assert.equal(saved.status, 200);

  const reports = await head.agent.get("/api/learner-reports");
  assert.equal(reports.status, 403);
  const learners = await head.agent.get("/api/learners");
  assert.equal(learners.status, 200);

  const restore = await savePermissions(
    system,
    headUser.id,
    withPermissions(saved.body.data, (permissions) => {
      permissions.learner_reports.access = true;
    })
  );
  assert.equal(restore.status, 200);
  assert.equal(Object.keys(restore.body.data.overrides).length, 0);
});
