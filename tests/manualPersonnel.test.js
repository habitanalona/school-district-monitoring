"use strict";

// Regression coverage for manual personnel creation. Every profile must be
// anchored to a staff account: an explicitly chosen account, an unprofiled
// account matched by email, or a dormant account provisioned in the same
// transaction. Legacy profiles that were saved with a null user_id are
// repaired the next time they are edited.

process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../server/app");
const { pool } = require("../server/config/database");

const RUN = `MPR${Date.now().toString(36).slice(-6)}`.toUpperCase();
const RUN_LOWER = RUN.toLowerCase();
const HEAD = { username: "northhead", password: "Demo@2026" };
const DUMMY_HASH = `$2b$12$${"x".repeat(53)}`;

let head = null;
let schoolId = null;
let otherSchoolUserId = null;
let existingAccountId = null;
const createdUserIds = new Set();

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
    lastName: "Manual",
    firstName: "Alice",
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

function createProfile(session, overrides) {
  return session.agent
    .post("/api/personnel")
    .set("X-CSRF-Token", session.csrfToken)
    .send(profilePayload(overrides));
}

async function cleanupTestData() {
  const removed = await pool.query(
    "SELECT id, user_id FROM personnel_profiles WHERE employee_no LIKE $1",
    [`${RUN}%`]
  );
  removed.rows.forEach((row) => {
    if (row.user_id) {
      createdUserIds.add(Number(row.user_id));
    }
  });
  await pool.query("DELETE FROM personnel_profiles WHERE employee_no LIKE $1", [`${RUN}%`]);
  await pool.query(
    `DELETE FROM audit_logs
      WHERE action IN ('personnel.create', 'personnel.update')
        AND details->>'employeeNo' LIKE $1`,
    [`${RUN}%`]
  );
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`${RUN_LOWER}%`]);
  await pool.query(
    "DELETE FROM users WHERE lower(email) LIKE $1",
    [`personnel-${schoolId}-${RUN_LOWER}-%`]
  );
  if (createdUserIds.size) {
    await pool.query("DELETE FROM users WHERE id = ANY($1::bigint[])", [Array.from(createdUserIds)]);
  }
}

before(async () => {
  const school = await pool.query(
    `SELECT u.school_id AS id, u.district_id
     FROM users u
     WHERE u.username = 'northhead' AND u.school_id IS NOT NULL
     LIMIT 1`
  );
  assert.ok(school.rows[0], "the demo school head account must be seeded (npm run db:init)");
  schoolId = Number(school.rows[0].id);

  const other = await pool.query(
    `SELECT id FROM users
     WHERE school_id IS NOT NULL AND school_id <> $1
     ORDER BY id LIMIT 1`,
    [schoolId]
  );
  assert.ok(other.rows[0], "a second school with an account is required");
  otherSchoolUserId = Number(other.rows[0].id);

  const account = await pool.query(
    `INSERT INTO users (
       full_name, username, email, password_hash, role, district_id, school_id,
       is_active, approval_status
     ) VALUES ($1, $2, $3, $4, 'teacher', $5, $6, TRUE, 'active')
     RETURNING id`,
    [
      "Existing Teacher",
      `${RUN_LOWER}.existing`,
      `${RUN_LOWER}.existing@north.test`,
      DUMMY_HASH,
      Number(school.rows[0].district_id),
      schoolId
    ]
  );
  existingAccountId = Number(account.rows[0].id);
  createdUserIds.add(existingAccountId);

  head = await login(HEAD);
});

after(async () => {
  await cleanupTestData();
  await pool.end();
});

test("creating personnel without an account provisions a dormant staff account", async () => {
  const response = await createProfile(head, {
    employeeNo: `${RUN}-A`,
    firstName: "Alice",
    lastName: "Aurora",
    email: `${RUN_LOWER}.alice@north.test`
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const profile = response.body.data;
  assert.ok(profile.userId, "the response must expose a linked account");
  assert.equal(profile.accountRole, "teacher");

  const stored = await pool.query(
    "SELECT user_id FROM personnel_profiles WHERE id = $1",
    [profile.id]
  );
  assert.equal(Number(stored.rows[0].user_id), Number(profile.userId));

  const account = await pool.query(
    "SELECT id, username, email, role, is_active, approval_status FROM users WHERE id = $1",
    [profile.userId]
  );
  assert.equal(account.rows[0].role, "teacher");
  assert.equal(account.rows[0].is_active, false);
  assert.equal(account.rows[0].approval_status, "active");
  assert.equal(account.rows[0].email, `${RUN_LOWER}.alice@north.test`);
  createdUserIds.add(Number(profile.userId));

  const audit = await pool.query(
    `SELECT details FROM audit_logs
     WHERE action = 'personnel.create' AND entity_id = $1
     ORDER BY id DESC LIMIT 1`,
    [String(profile.id)]
  );
  assert.equal(audit.rows[0].details.accountCreated, true);
});

test("creating personnel with no email still stores a user_id", async () => {
  const response = await createProfile(head, {
    employeeNo: `${RUN}-B`,
    firstName: "Bob",
    lastName: "Noemail"
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const profile = response.body.data;
  assert.ok(profile.userId);

  const account = await pool.query(
    "SELECT email, role, is_active FROM users WHERE id = $1",
    [profile.userId]
  );
  assert.equal(account.rows[0].role, "teacher");
  assert.equal(account.rows[0].is_active, false);
  assert.match(account.rows[0].email, new RegExp(`^personnel-${schoolId}-${RUN_LOWER}-b@sdms\\.invalid$`));
  createdUserIds.add(Number(profile.userId));
});

test("creating personnel reuses an unprofiled account with the same email", async () => {
  const response = await createProfile(head, {
    employeeNo: `${RUN}-C`,
    firstName: "Carol",
    lastName: "Existing",
    email: `${RUN_LOWER}.existing@north.test`
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(Number(response.body.data.userId), existingAccountId);

  const count = await pool.query(
    "SELECT COUNT(*)::int AS total FROM users WHERE lower(email) = lower($1)",
    [`${RUN_LOWER}.existing@north.test`]
  );
  assert.equal(count.rows[0].total, 1, "no duplicate account may be created");

  const account = await pool.query("SELECT is_active FROM users WHERE id = $1", [existingAccountId]);
  assert.equal(account.rows[0].is_active, true, "a linked account keeps its status");
});

test("creating personnel rejects an account from another school", async () => {
  const response = await createProfile(head, {
    employeeNo: `${RUN}-D`,
    firstName: "Dana",
    lastName: "Other",
    userId: otherSchoolUserId
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "USER_SCHOOL_MISMATCH");
});

test("editing a legacy profile with a null user_id repairs the link", async () => {
  const legacy = await pool.query(
    `INSERT INTO personnel_profiles
       (school_id, employee_no, last_name, first_name, position, created_by)
     VALUES ($1, $2, 'Legacy', 'Lee', 'Teacher', $3)
     RETURNING id, user_id`,
    [schoolId, `${RUN}-E`, head.user.id]
  );
  assert.equal(legacy.rows[0].user_id, null);

  const response = await head.agent
    .put(`/api/personnel/${legacy.rows[0].id}`)
    .set("X-CSRF-Token", head.csrfToken)
    .send(
      profilePayload({
        employeeNo: `${RUN}-E`,
        firstName: "Lee",
        lastName: "Legacy",
        email: `${RUN_LOWER}.legacy@north.test`,
        userId: null
      })
    );
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.ok(response.body.data.userId);

  const stored = await pool.query(
    "SELECT user_id FROM personnel_profiles WHERE id = $1",
    [legacy.rows[0].id]
  );
  assert.equal(Number(stored.rows[0].user_id), Number(response.body.data.userId));
  createdUserIds.add(Number(response.body.data.userId));
});
