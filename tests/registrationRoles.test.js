"use strict";

// Run with NODE_ENV=test before the app (and its session store) is loaded.
process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../server/app");
const { pool } = require("../server/config/database");
const permissionService = require("../server/services/permissionService");

const PASSWORD = "MultiRole1234";
const DEMO_HEAD = { username: "northhead", password: "Demo@2026" };

let northDistrictId = null;
let northSchoolId = null;
let multiUserId = null;

async function cleanupTestData() {
  await pool.query("DELETE FROM users WHERE username LIKE $1", ["tst.multi.%"]);
}

async function fetchCsrf(agent) {
  const response = await agent.get("/api/auth/csrf");
  assert.equal(response.status, 200, "csrf endpoint should return 200");
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
  return { agent, csrfToken: response.body.data.csrfToken || token };
}

async function register(body) {
  const agent = request.agent(app);
  const token = await fetchCsrf(agent);
  return agent
    .post("/api/auth/register")
    .set("X-CSRF-Token", token)
    .send({ districtId: northDistrictId, schoolId: northSchoolId, ...body });
}

before(async () => {
  const north = await pool.query(
    `SELECT s.id, s.district_id FROM schools s
     JOIN districts d ON d.id = s.district_id
     WHERE d.district_code = 'NVD' AND s.school_code = 'NES-001'`
  );
  assert.ok(north.rows[0], "the seeded NES-001 school is required for registration tests");
  northSchoolId = Number(north.rows[0].id);
  northDistrictId = Number(north.rows[0].district_id);

  await cleanupTestData();
});

after(async () => {
  await cleanupTestData();
  await pool.end();
});

test("registration stores structured names and every selected role", async () => {
  const response = await register({
    firstName: "Maria",
    middleName: "Santos",
    lastName: "Cruz",
    username: "tst.multi.roles",
    email: "tst.multi.roles@example.com",
    password: PASSWORD,
    roles: ["teacher", "adviser", "coordinator"]
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));

  const user = response.body.data.user;
  assert.equal(user.fullName, "Maria Santos Cruz");
  assert.equal(user.firstName, "Maria");
  assert.equal(user.middleName, "Santos");
  assert.equal(user.lastName, "Cruz");
  assert.equal(user.role, "coordinator", "the highest-ranked role becomes primary");
  assert.deepEqual(
    [...user.roles].sort(),
    ["adviser", "coordinator", "teacher"],
    "every selected role is returned"
  );
  assert.equal(response.body.data.approval.approverRole, "school_head");
  multiUserId = Number(user.id);

  const stored = await pool.query(
    "SELECT full_name, first_name, middle_name, last_name, role FROM users WHERE id = $1",
    [multiUserId]
  );
  assert.deepEqual(stored.rows[0], {
    full_name: "Maria Santos Cruz",
    first_name: "Maria",
    middle_name: "Santos",
    last_name: "Cruz",
    role: "coordinator"
  });

  const assigned = await pool.query(
    "SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role",
    [multiUserId]
  );
  assert.deepEqual(
    assigned.rows.map((row) => row.role),
    ["adviser", "coordinator", "teacher"]
  );
});

test("registration still accepts a middle name that is left blank", async () => {
  const response = await register({
    firstName: "Jose",
    middleName: "",
    lastName: "Rizal",
    username: "tst.multi.nomiddle",
    email: "tst.multi.nomiddle@example.com",
    password: PASSWORD,
    roles: ["teacher"]
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.data.user.fullName, "Jose Rizal");
  assert.equal(response.body.data.user.middleName, null);
});

test("registration rejects an empty or unknown role selection", async () => {
  const missing = await register({
    firstName: "Ana",
    lastName: "Reyes",
    username: "tst.multi.norole",
    email: "tst.multi.norole@example.com",
    password: PASSWORD,
    roles: []
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.code, "VALIDATION_ERROR");
  assert.equal(missing.body.details.field, "roles");

  const unknown = await register({
    firstName: "Ana",
    lastName: "Reyes",
    username: "tst.multi.badrole",
    email: "tst.multi.badrole@example.com",
    password: PASSWORD,
    roles: ["teacher", "system_admin"]
  });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.code, "VALIDATION_ERROR");
});

test("legacy fullName and single role payloads keep working", async () => {
  const response = await register({
    fullName: "Legacy Applicant",
    username: "tst.multi.legacy",
    email: "tst.multi.legacy@example.com",
    password: PASSWORD,
    role: "teacher"
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.data.user.fullName, "Legacy Applicant");
  assert.deepEqual(response.body.data.user.roles, ["teacher"]);
});

test("the school head approves the multi-role account and permissions are combined", async () => {
  assert.ok(multiUserId, "the multi-role registration test must run first");

  const head = await login(DEMO_HEAD);
  const approved = await head.agent
    .post(`/api/approvals/${multiUserId}/approve`)
    .set("X-CSRF-Token", head.csrfToken)
    .send({});
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.data.approvalStatus, "active");

  const stored = await pool.query(
    `SELECT u.id, u.role,
            COALESCE((SELECT array_agg(ur.role) FROM user_roles ur WHERE ur.user_id = u.id),
                     ARRAY[u.role]) AS roles
     FROM users u WHERE u.id = $1`,
    [multiUserId]
  );
  const matrix = await permissionService.effectivePermissions(stored.rows[0]);
  assert.equal(matrix.grade_submissions.edit, true, "adviser duty grants submission review");
  assert.equal(matrix.books.add, true, "coordinator duty grants book management");
  assert.equal(matrix.books.edit, true);

  const teacherOnly = await pool.query(
    `SELECT u.id, u.role,
            COALESCE((SELECT array_agg(ur.role) FROM user_roles ur WHERE ur.user_id = u.id),
                     ARRAY[u.role]) AS roles
     FROM users u WHERE u.username = 'tst.multi.nomiddle'`
  );
  const teacherMatrix = await permissionService.effectivePermissions(teacherOnly.rows[0]);
  assert.equal(teacherMatrix.grade_submissions.edit, false, "a plain teacher cannot review submissions");
  assert.equal(teacherMatrix.books.add, false, "a plain teacher does not manage books");
});
