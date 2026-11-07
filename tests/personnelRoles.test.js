"use strict";

// A school head assigns the subject teacher, class adviser, and coordinator
// roles to the staff of their own school. The roles combine on one account:
// users.role keeps the highest-ranked role and user_roles keeps every role.

process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../server/app");
const { pool } = require("../server/config/database");

const RUN = `PRL${Date.now().toString(36).slice(-6)}`.toUpperCase();
const RUN_LOWER = RUN.toLowerCase();
const HEAD = { username: "northhead", password: "Demo@2026" };
const ADVISER = { username: "northadviser", password: "Demo@2026" };
const DUMMY_HASH = `$2b$12$${"x".repeat(53)}`;

let head = null;
let adviser = null;
let schoolId = null;
let districtId = null;
const createdUserIds = new Set();
const profileIds = new Set();

async function fetchCsrf(agent) {
  const response = await agent.get("/api/auth/csrf");
  assert.equal(response.status, 200);
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

function profilePayload(overrides) {
  return {
    schoolId,
    employeeNo: `${RUN}-001`,
    lastName: "Roles",
    firstName: "Rita",
    middleName: "",
    suffix: "",
    position: "Teacher",
    employmentType: "plantilla",
    employmentStatus: "active",
    isTeaching: true,
    specialization: "",
    qualifications: "",
    designation: "",
    contactNumber: "",
    email: "",
    dateHired: null,
    ...overrides
  };
}

async function createAccount(role, suffix) {
  const handle = `${RUN_LOWER}.${role}.${suffix}`;
  const result = await pool.query(
    `INSERT INTO users (
       full_name, username, email, password_hash, role, district_id, school_id,
       is_active, approval_status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 'active')
     RETURNING id`,
    [
      `Role Target ${role} ${suffix}`,
      handle,
      `${handle}@north.test`,
      DUMMY_HASH,
      role,
      districtId,
      schoolId
    ]
  );
  createdUserIds.add(Number(result.rows[0].id));
  return Number(result.rows[0].id);
}

async function storedRoles(userId) {
  const result = await pool.query(
    "SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role",
    [userId]
  );
  return result.rows.map((row) => row.role);
}

async function cleanup() {
  if (profileIds.size) {
    await pool.query("DELETE FROM personnel_profiles WHERE id = ANY($1::bigint[])", [
      Array.from(profileIds)
    ]);
  }
  if (createdUserIds.size) {
    const ids = Array.from(createdUserIds);
    await pool.query(
      `DELETE FROM audit_logs
        WHERE entity_id = ANY($1::text[])
          AND action IN ('personnel.roles_updated', 'personnel.create', 'personnel.update')`,
      [ids.map(String)]
    );
    await pool.query("DELETE FROM users WHERE id = ANY($1::bigint[])", [ids]);
  }
}

before(async () => {
  const school = await pool.query(
    `SELECT school_id, district_id FROM users
     WHERE username = 'northhead' AND school_id IS NOT NULL
     LIMIT 1`
  );
  assert.ok(school.rows[0], "the demo school head account must be seeded (npm run db:init)");
  schoolId = Number(school.rows[0].school_id);
  districtId = Number(school.rows[0].district_id);

  head = await login(HEAD);
  adviser = await login(ADVISER);
});

after(async () => {
  await cleanup();
  await pool.end();
});

test("a school head combines teacher, adviser, and coordinator on one account", async () => {
  const userId = await createAccount("teacher", "a");
  const response = await head.agent
    .post("/api/personnel")
    .set("X-CSRF-Token", head.csrfToken)
    .send(
      profilePayload({
        userId,
        roles: ["teacher", "adviser", "coordinator"]
      })
    );

  assert.equal(response.status, 201, JSON.stringify(response.body));
  const profile = response.body.data;
  profileIds.add(Number(profile.id));
  assert.deepEqual(profile.accountRoles, ["adviser", "coordinator", "teacher"]);

  const stored = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
  assert.equal(stored.rows[0].role, "coordinator", "the highest-ranked role is primary");
  assert.deepEqual(await storedRoles(userId), ["adviser", "coordinator", "teacher"]);

  const audit = await pool.query(
    `SELECT details FROM audit_logs
     WHERE action = 'personnel.roles_updated' AND entity_id = $1
     ORDER BY id DESC LIMIT 1`,
    [String(userId)]
  );
  assert.deepEqual(audit.rows[0].details.after, ["adviser", "coordinator", "teacher"]);
});

test("editing the role set adds and removes roles without touching other roles", async () => {
  const userId = await createAccount("teacher", "b");
  const created = await head.agent
    .post("/api/personnel")
    .set("X-CSRF-Token", head.csrfToken)
    .send(profilePayload({ userId, employeeNo: `${RUN}-002`, roles: ["teacher", "coordinator"] }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const profileId = Number(created.body.data.id);
  profileIds.add(profileId);

  const response = await head.agent
    .put(`/api/personnel/${profileId}`)
    .set("X-CSRF-Token", head.csrfToken)
    .send(
      profilePayload({
        userId,
        employeeNo: `${RUN}-002`,
        roles: ["adviser"]
      })
    );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.deepEqual(response.body.data.accountRoles, ["adviser"]);

  const stored = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
  assert.equal(stored.rows[0].role, "adviser");
  assert.deepEqual(await storedRoles(userId), ["adviser"]);
});

test("removing every role from an account with no other role is rejected", async () => {
  const userId = await createAccount("teacher", "c");
  const created = await head.agent
    .post("/api/personnel")
    .set("X-CSRF-Token", head.csrfToken)
    .send(profilePayload({ userId, employeeNo: `${RUN}-003`, roles: ["teacher"] }));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const profileId = Number(created.body.data.id);
  profileIds.add(profileId);

  const response = await head.agent
    .put(`/api/personnel/${profileId}`)
    .set("X-CSRF-Token", head.csrfToken)
    .send(profilePayload({ userId, employeeNo: `${RUN}-003`, roles: [] }));

  assert.equal(response.status, 400);
  assert.equal(response.body.code, "ROLE_REQUIRED");
  const unchanged = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
  assert.equal(unchanged.rows[0].role, "teacher", "the failed request changes nothing");
});

test("a non-teaching account keeps its NT role and can add or drop coordinator", async () => {
  const userId = await createAccount("nt", "d");
  const created = await head.agent
    .post("/api/personnel")
    .set("X-CSRF-Token", head.csrfToken)
    .send(
      profilePayload({
        userId,
        employeeNo: `${RUN}-004`,
        isTeaching: false,
        position: "School Nurse",
        roles: ["coordinator"]
      })
    );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const profileId = Number(created.body.data.id);
  profileIds.add(profileId);
  assert.deepEqual(created.body.data.accountRoles, ["coordinator", "nt"]);

  const stored = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
  assert.equal(stored.rows[0].role, "coordinator");

  const removed = await head.agent
    .put(`/api/personnel/${profileId}`)
    .set("X-CSRF-Token", head.csrfToken)
    .send(
      profilePayload({
        userId,
        employeeNo: `${RUN}-004`,
        isTeaching: false,
        position: "School Nurse",
        roles: []
      })
    );
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.deepEqual(removed.body.data.accountRoles, ["nt"]);

  const after = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
  assert.equal(after.rows[0].role, "nt");
});

test("roles outside the assignable set are rejected", async () => {
  const userId = await createAccount("teacher", "e");
  const response = await head.agent
    .post("/api/personnel")
    .set("X-CSRF-Token", head.csrfToken)
    .send(
      profilePayload({
        userId,
        employeeNo: `${RUN}-005`,
        roles: ["school_head"]
      })
    );
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "VALIDATION_ERROR");
  assert.equal(response.body.details.field, "roles");
});

test("a class adviser cannot assign roles", async () => {
  const target = await pool.query(
    `SELECT p.id FROM personnel_profiles p
     WHERE p.employee_no LIKE $1 AND p.archived_at IS NULL
     ORDER BY p.id LIMIT 1`,
    [`${RUN}%`]
  );
  assert.ok(target.rows[0], "an earlier test profile should exist");
  const response = await adviser.agent
    .put(`/api/personnel/${target.rows[0].id}`)
    .set("X-CSRF-Token", adviser.csrfToken)
    .send(profilePayload({ employeeNo: `${RUN}-001`, roles: ["teacher"] }));
  assert.equal(response.status, 403);
});

test("a school head assigns roles directly to an unprofiled staff account", async () => {
  const userId = await createAccount("teacher", "f");
  const response = await head.agent
    .put(`/api/personnel/accounts/${userId}/roles`)
    .set("X-CSRF-Token", head.csrfToken)
    .send({ roles: ["teacher", "adviser", "coordinator"] });

  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.userId, userId);
  assert.deepEqual(response.body.data.accountRoles, ["adviser", "coordinator", "teacher"]);

  const stored = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
  assert.equal(stored.rows[0].role, "coordinator");
  assert.deepEqual(await storedRoles(userId), ["adviser", "coordinator", "teacher"]);

  const profiles = await pool.query(
    "SELECT COUNT(*)::int AS total FROM personnel_profiles WHERE user_id = $1",
    [userId]
  );
  assert.equal(profiles.rows[0].total, 0, "role assignment never creates an SF7 profile");
});

test("the account role endpoint validates the role list", async () => {
  const userId = await createAccount("teacher", "g");
  const empty = await head.agent
    .put(`/api/personnel/accounts/${userId}/roles`)
    .set("X-CSRF-Token", head.csrfToken)
    .send({ roles: [] });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.code, "ROLE_REQUIRED");

  const invalid = await head.agent
    .put(`/api/personnel/accounts/${userId}/roles`)
    .set("X-CSRF-Token", head.csrfToken)
    .send({ roles: ["school_head"] });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "VALIDATION_ERROR");
  assert.equal(invalid.body.details.field, "roles");

  const missing = await head.agent
    .put("/api/personnel/accounts/99999999/roles")
    .set("X-CSRF-Token", head.csrfToken)
    .send({ roles: ["teacher"] });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "USER_NOT_FOUND");
});

test("a class adviser cannot use the account role endpoint", async () => {
  const userId = await createAccount("teacher", "h");
  const response = await adviser.agent
    .put(`/api/personnel/accounts/${userId}/roles`)
    .set("X-CSRF-Token", adviser.csrfToken)
    .send({ roles: ["coordinator"] });
  assert.equal(response.status, 403);
});
