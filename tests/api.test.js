"use strict";

// Run with NODE_ENV=test before the app (and its session store) is loaded.
process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const sharp = require("sharp");

const app = require("../server/app");
const { pool } = require("../server/config/database");

const PREFIX = "TST";
const DEMO = {
  system: { username: "sysadmin", password: "Admin@2026" },
  northAdmin: { username: "northadmin", password: "District@2026" },
  northStaff: { username: "northstaff", password: "Staff@2026" },
  northPsds: { username: "northpsds", password: "Demo@2026" },
  northHead: { username: "northhead", password: "Demo@2026" },
  northAdviser: { username: "northadviser", password: "Demo@2026" },
  northLearner: { username: "northlearner", password: "Demo@2026" },
  southAdmin: { username: "southadmin", password: "District@2026" }
};
const TEST_PASSWORD = "TestPass1234";
const REGISTERED_PASSWORD = "Registered1234";

let districtId = null;
let southSchoolId = null;
let northSchoolId = null;
let northDistrictId = null;
let createdSchoolId = null;
let createdReportId = null;
let createdUserId = null;
const registrations = {};

async function cleanupTestData() {
  await pool.query(
    "DELETE FROM school_reports WHERE school_id IN (SELECT id FROM schools WHERE school_code LIKE $1)",
    [`${PREFIX}-%`]
  );
  await pool.query("DELETE FROM schools WHERE school_code LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM users WHERE username LIKE $1", ["tst.%"]);
  await pool.query("DELETE FROM announcements WHERE title LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM audit_logs WHERE details::text ILIKE $1", [`%${PREFIX}-%`]);
  await pool.query("DELETE FROM audit_logs WHERE details::text ILIKE $1", ["%tst.%"]);
  await pool.query("DELETE FROM districts WHERE district_code LIKE $1", [`${PREFIX}-%`]);
}

async function fetchCsrf(agent) {
  const response = await agent.get("/api/auth/csrf");
  assert.equal(response.status, 200, "csrf endpoint should return 200");
  assert.ok(response.body.data.csrfToken, "csrf token should be present");
  return response.body.data.csrfToken;
}

async function login(credentials) {
  const agent = request.agent(app);
  const token = await fetchCsrf(agent);
  const response = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", token)
    .send({ identifier: credentials.username, password: credentials.password });
  assert.equal(response.status, 200, `login for ${credentials.username} should succeed: ${JSON.stringify(response.body)}`);
  assert.ok(response.body.data.user, "login should return a user");
  return { agent, csrfToken: response.body.data.csrfToken || token, user: response.body.data.user };
}

async function attemptLogin(identifier, password) {
  const agent = request.agent(app);
  const token = await fetchCsrf(agent);
  return agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", token)
    .send({ identifier, password });
}

async function registerAccount({ username, role, schoolId = null, districtId: targetDistrictId = null, csrf = true }) {
  const agent = request.agent(app);
  const token = await fetchCsrf(agent);
  const body = {
    fullName: `Test ${role} Applicant`,
    username,
    email: `${username}@example.com`,
    password: REGISTERED_PASSWORD,
    role,
    districtId: targetDistrictId === null ? northDistrictId : targetDistrictId,
    schoolId
  };
  const requestBuilder = agent.post("/api/auth/register");
  if (csrf) {
    requestBuilder.set("X-CSRF-Token", token);
  }
  return requestBuilder.send(body);
}

function schoolPayload(overrides = {}) {
  return {
    schoolCode: `${PREFIX}-101`,
    schoolName: "Test Verification School",
    schoolType: "Elementary School",
    address: "101 Test Lane, Validation City",
    schoolHead: "Test Head",
    contactEmail: "test.school@example.com",
    contactPhone: "+1 555 010 1010",
    studentCount: 100,
    teacherCount: 10,
    performanceScore: 75,
    status: "active",
    districtId,
    ...overrides
  };
}

before(async () => {
  const district = await pool.query("SELECT id FROM districts ORDER BY id LIMIT 1");
  assert.ok(district.rows[0], "the database must be seeded before running tests (npm run db:init)");
  districtId = Number(district.rows[0].id);

  const south = await pool.query(
    `SELECT s.id FROM schools s
     JOIN districts d ON d.id = s.district_id
     WHERE d.district_code = 'SGD'
     ORDER BY s.id
     LIMIT 1`
  );
  southSchoolId = south.rows[0] ? Number(south.rows[0].id) : null;

  const north = await pool.query(
    `SELECT s.id, s.district_id FROM schools s
     JOIN districts d ON d.id = s.district_id
     WHERE d.district_code = 'NVD' AND s.school_code = 'NES-001'`
  );
  assert.ok(north.rows[0], "the seeded NES-001 school is required for registration tests");
  northSchoolId = Number(north.rows[0].id);
  northDistrictId = Number(north.rows[0].district_id);
  districtId = northDistrictId;

  await cleanupTestData();
});

after(async () => {
  await cleanupTestData();
  await pool.end();
});

test("security headers and JSON 404 are applied", async () => {
  const page = await request(app).get("/");
  assert.equal(page.status, 200);
  assert.match(page.headers["content-security-policy"], /script-src 'self'/);
  assert.equal(page.headers["x-content-type-options"], "nosniff");
  assert.ok(page.headers["referrer-policy"]);

  const admin = await login(DEMO.system);
  const missing = await admin.agent.get("/api/does-not-exist");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "NOT_FOUND");
});

test("unauthenticated API requests are rejected", async () => {
  const response = await request(app).get("/api/dashboard/summary");
  assert.equal(response.status, 401);
  assert.equal(response.body.code, "AUTH_REQUIRED");
});

test("login rejects bad credentials with a generic message", async () => {
  const agent = request.agent(app);
  const token = await fetchCsrf(agent);
  const response = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", token)
    .send({ identifier: DEMO.system.username, password: "definitely-wrong" });
  assert.equal(response.status, 401);
  assert.equal(response.body.code, "INVALID_CREDENTIALS");
  assert.match(response.body.error, /invalid email\/username or password/i);
});

test("login issues an HttpOnly SameSite session and CSRF token", async () => {
  const agent = request.agent(app);
  const token = await fetchCsrf(agent);
  const response = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", token)
    .send({ identifier: DEMO.system.username, password: DEMO.system.password });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data.user.role, "system_admin");
  assert.equal(response.body.data.permissions.canSelectDistrict, true);
  assert.ok(response.body.data.csrfToken);
  const cookie = String(response.headers["set-cookie"]);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);

  const me = await agent.get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.username, DEMO.system.username);
});

test("state-changing requests require a matching CSRF token", async () => {
  const admin = await login(DEMO.system);
  const blocked = await admin.agent.post("/api/auth/logout").send({});
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.code, "CSRF_INVALID");

  const allowed = await admin.agent
    .post("/api/auth/logout")
    .set("X-CSRF-Token", admin.csrfToken)
    .send({});
  assert.equal(allowed.status, 200);

  const afterLogout = await admin.agent.get("/api/auth/me");
  assert.equal(afterLogout.status, 401);
});

test("dashboard analytics endpoints return scoped data", async () => {
  const admin = await login(DEMO.system);

  const summary = await admin.agent.get("/api/dashboard/summary");
  assert.equal(summary.status, 200);
  assert.ok(summary.body.data.totalSchools > 0);
  assert.ok(summary.body.data.totalStudents > 0);

  const enrollment = await admin.agent.get("/api/dashboard/enrollment");
  assert.equal(enrollment.status, 200);
  assert.ok(Array.isArray(enrollment.body.data.schools));

  const performance = await admin.agent.get("/api/dashboard/performance");
  assert.equal(performance.status, 200);
  assert.ok(Array.isArray(performance.body.data.schools));

  const reportStatus = await admin.agent.get("/api/dashboard/report-status");
  assert.equal(reportStatus.status, 200);
  assert.equal(typeof reportStatus.body.data.statuses, "object");
  assert.equal(typeof reportStatus.body.data.total, "number");

  const activity = await admin.agent.get("/api/dashboard/recent-activity");
  assert.equal(activity.status, 200);
  assert.ok(Array.isArray(activity.body.data.activities));
});

test("school list supports pagination and search", async () => {
  const admin = await login(DEMO.system);
  const list = await admin.agent.get("/api/schools?page=1&pageSize=5&sort=name&direction=asc");
  assert.equal(list.status, 200);
  assert.ok(list.body.data.length > 0 && list.body.data.length <= 5);
  assert.equal(list.body.pagination.page, 1);
  assert.equal(list.body.pagination.pageSize, 5);
  assert.ok(list.body.pagination.total >= list.body.data.length);

  const search = await admin.agent.get("/api/schools?search=Central&pageSize=20");
  assert.equal(search.status, 200);
  for (const school of search.body.data) {
    const haystack = `${school.name} ${school.code} ${school.head}`.toLowerCase();
    assert.ok(haystack.includes("central"), "search results should match the query");
  }
});

test("school registration validates input and prevents duplicate codes", async () => {
  const admin = await login(DEMO.system);

  const invalid = await admin.agent
    .post("/api/schools")
    .set("X-CSRF-Token", admin.csrfToken)
    .send(schoolPayload({ schoolName: "" }));
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.code, "VALIDATION_ERROR");
  assert.equal(invalid.body.details.field, "School name");

  const created = await admin.agent
    .post("/api/schools")
    .set("X-CSRF-Token", admin.csrfToken)
    .send(schoolPayload());
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.code, `${PREFIX}-101`);
  createdSchoolId = created.body.data.id;

  const duplicate = await admin.agent
    .post("/api/schools")
    .set("X-CSRF-Token", admin.csrfToken)
    .send(schoolPayload({ schoolName: "Another School" }));
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "SCHOOL_CODE_IN_USE");
});

test("school records can be viewed, edited, archived, and restored", async () => {
  assert.ok(createdSchoolId, "school creation test must run first");
  const admin = await login(DEMO.system);

  const detail = await admin.agent.get(`/api/schools/${createdSchoolId}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.name, "Test Verification School");

  const updated = await admin.agent
    .put(`/api/schools/${createdSchoolId}`)
    .set("X-CSRF-Token", admin.csrfToken)
    .send(schoolPayload({ schoolName: "Test Verification School Updated", studentCount: 120 }));
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.name, "Test Verification School Updated");
  assert.equal(updated.body.data.studentCount, 120);

  const archived = await admin.agent
    .patch(`/api/schools/${createdSchoolId}/archive`)
    .set("X-CSRF-Token", admin.csrfToken)
    .send({});
  assert.equal(archived.status, 200);
  assert.equal(archived.body.data.status, "archived");

  const restored = await admin.agent
    .patch(`/api/schools/${createdSchoolId}/restore`)
    .set("X-CSRF-Token", admin.csrfToken)
    .send({});
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.status, "active");
});

test("staff cannot manage schools and district administrators are scoped", async () => {
  assert.ok(createdSchoolId, "school creation test must run first");

  const staff = await login(DEMO.northStaff);
  const forbidden = await staff.agent
    .post("/api/schools")
    .set("X-CSRF-Token", staff.csrfToken)
    .send(schoolPayload({ schoolCode: `${PREFIX}-STAFF` }));
  assert.equal(forbidden.status, 403);

  const staffUsers = await staff.agent.get("/api/users");
  assert.equal(staffUsers.status, 403);
  const staffAudit = await staff.agent.get("/api/audit-logs");
  assert.equal(staffAudit.status, 403);

  if (southSchoolId) {
    const outOfScope = await staff.agent.get(`/api/schools/${southSchoolId}`);
    assert.ok([403, 404].includes(outOfScope.status));
  }

  const districtAdmin = await login(DEMO.northAdmin);
  const users = await districtAdmin.agent.get("/api/users?pageSize=100");
  assert.equal(users.status, 200);
  for (const user of users.body.data) {
    assert.equal(Number(user.districtId), Number(districtAdmin.user.districtId));
  }
  const audit = await districtAdmin.agent.get("/api/audit-logs");
  assert.equal(audit.status, 403);

  if (southSchoolId) {
    const scopedSchool = await districtAdmin.agent.get(`/api/schools/${southSchoolId}`);
    assert.ok([403, 404].includes(scopedSchool.status));
  }

  const adminList = await districtAdmin.agent.get("/api/schools?pageSize=100");
  assert.equal(adminList.status, 200);
  for (const school of adminList.body.data) {
    assert.equal(Number(school.districtId), Number(districtAdmin.user.districtId));
  }
});

test("reports enforce uniqueness and can be updated", async () => {
  assert.ok(createdSchoolId, "school creation test must run first");
  const admin = await login(DEMO.system);
  const payload = {
    schoolId: createdSchoolId,
    reportingPeriod: "2025-03",
    reportType: "Compliance",
    submissionStatus: "pending",
    remarks: "Automated test report."
  };

  const created = await admin.agent
    .post("/api/reports")
    .set("X-CSRF-Token", admin.csrfToken)
    .send(payload);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.submissionStatus, "pending");
  createdReportId = created.body.data.id;

  const duplicate = await admin.agent
    .post("/api/reports")
    .set("X-CSRF-Token", admin.csrfToken)
    .send(payload);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "REPORT_DUPLICATE");

  const updated = await admin.agent
    .put(`/api/reports/${createdReportId}`)
    .set("X-CSRF-Token", admin.csrfToken)
    .send({ ...payload, submissionStatus: "reviewed" });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.submissionStatus, "reviewed");
});

test("user accounts can be provisioned and deactivated", async () => {
  const admin = await login(DEMO.system);
  const payload = {
    fullName: "Test API User",
    username: "tst.api.user",
    email: "tst.api.user@example.com",
    role: "staff",
    districtId,
    password: TEST_PASSWORD,
    isActive: true
  };

  const created = await admin.agent
    .post("/api/users")
    .set("X-CSRF-Token", admin.csrfToken)
    .send(payload);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.role, "staff");
  assert.equal(created.body.data.isActive, true);
  createdUserId = created.body.data.id;

  const duplicate = await admin.agent
    .post("/api/users")
    .set("X-CSRF-Token", admin.csrfToken)
    .send({ ...payload, email: "tst.other@example.com" });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "USERNAME_IN_USE");

  const deactivated = await admin.agent
    .patch(`/api/users/${createdUserId}/status`)
    .set("X-CSRF-Token", admin.csrfToken)
    .send({ isActive: false });
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.body.data.isActive, false);
});

test("announcements can be drafted, published, and updated", async () => {
  const admin = await login(DEMO.system);
  const created = await admin.agent
    .post("/api/announcements")
    .set("X-CSRF-Token", admin.csrfToken)
    .send({
      title: `${PREFIX}-API Notice`,
      content: "This announcement is created by the automated API test suite.",
      status: "published",
      districtId
    });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.status, "published");

  const updated = await admin.agent
    .put(`/api/announcements/${created.body.data.id}`)
    .set("X-CSRF-Token", admin.csrfToken)
    .send({
      title: `${PREFIX}-API Notice Updated`,
      content: "This announcement was updated by the automated API test suite.",
      status: "published",
      districtId
    });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.title, `${PREFIX}-API Notice Updated`);

  const staff = await login(DEMO.northStaff);
  const visible = await staff.agent.get("/api/announcements");
  assert.equal(visible.status, 200);
  assert.ok(visible.body.data.some((item) => item.title === `${PREFIX}-API Notice Updated`));
});

test("district and notification endpoints are available to signed-in users", async () => {
  const staff = await login(DEMO.northStaff);
  const districts = await staff.agent.get("/api/districts");
  assert.equal(districts.status, 200);
  assert.ok(districts.body.data.length >= 1);
  assert.ok(districts.body.data.every((district) => Number(district.id) === Number(staff.user.districtId)));

  const hierarchy = await staff.agent.get("/api/districts/hierarchy");
  assert.equal(hierarchy.status, 200);
  assert.equal(hierarchy.body.data.districts.length, 1);
  assert.equal(Number(hierarchy.body.data.districts[0].id), Number(staff.user.districtId));
  assert.ok(hierarchy.body.data.districts[0].schools.length > 0);
  assert.equal(hierarchy.body.data.districts[0].psds.length, 2);

  const notifications = await staff.agent.get("/api/notifications");
  assert.equal(notifications.status, 200);
  assert.ok(Array.isArray(notifications.body.data.notifications));
  assert.equal(typeof notifications.body.data.unreadCount, "number");
});

test("districts can be created, updated, scoped, and deleted", async () => {
  const admin = await login(DEMO.system);
  const payload = {
    name: "Test District Office",
    code: `${PREFIX}-D1`,
    address: "1 Test Plaza, Validation City",
    contactEmail: "tst.district@example.com",
    psds: [
      { name: "Alpha Supervisor", email: "tst.alpha@example.com", phone: "+1 555 0100" },
      { name: "Beta Supervisor", email: "tst.beta@example.com", phone: "+1 555 0101" }
    ]
  };

  const incomplete = await admin.agent
    .post("/api/districts")
    .set("X-CSRF-Token", admin.csrfToken)
    .send({ ...payload, psds: [payload.psds[0]] });
  assert.equal(incomplete.status, 400);
  assert.equal(incomplete.body.code, "VALIDATION_ERROR");
  assert.equal(incomplete.body.details.field, "PSDS");

  const created = await admin.agent
    .post("/api/districts")
    .set("X-CSRF-Token", admin.csrfToken)
    .send(payload);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.data.code, `${PREFIX}-D1`);
  assert.equal(created.body.data.psds.length, 2);
  const districtIdToDelete = created.body.data.id;

  const duplicate = await admin.agent
    .post("/api/districts")
    .set("X-CSRF-Token", admin.csrfToken)
    .send({ ...payload, name: "Another Test District" });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "DISTRICT_CODE_IN_USE");

  const hierarchy = await admin.agent.get("/api/districts/hierarchy");
  assert.equal(hierarchy.status, 200);
  const node = hierarchy.body.data.districts.find((district) => district.id === districtIdToDelete);
  assert.ok(node, "the new district should appear in the hierarchy");
  assert.equal(node.psds.length, 2);
  assert.deepEqual(node.schools, []);

  const updated = await admin.agent
    .put(`/api/districts/${districtIdToDelete}`)
    .set("X-CSRF-Token", admin.csrfToken)
    .send({
      ...payload,
      name: "Test District Office Updated",
      psds: [
        payload.psds[0],
        { name: "Gamma Supervisor", email: "tst.gamma@example.com", phone: null }
      ]
    });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.name, "Test District Office Updated");
  assert.equal(updated.body.data.psds[1].name, "Gamma Supervisor");

  const districtAdmin = await login(DEMO.northAdmin);
  const scoped = await districtAdmin.agent.get("/api/districts/hierarchy");
  assert.equal(scoped.status, 200);
  assert.equal(scoped.body.data.districts.length, 1);
  assert.equal(Number(scoped.body.data.districts[0].id), Number(districtAdmin.user.districtId));

  const forbidden = await districtAdmin.agent
    .post("/api/districts")
    .set("X-CSRF-Token", districtAdmin.csrfToken)
    .send({ ...payload, code: `${PREFIX}-DA` });
  assert.equal(forbidden.status, 403);

  const guarded = await admin.agent
    .delete(`/api/districts/${districtId}`)
    .set("X-CSRF-Token", admin.csrfToken);
  assert.equal(guarded.status, 409);
  assert.equal(guarded.body.code, "DISTRICT_IN_USE");

  const removed = await admin.agent
    .delete(`/api/districts/${districtIdToDelete}`)
    .set("X-CSRF-Token", admin.csrfToken);
  assert.equal(removed.status, 200);

  const missing = await admin.agent.get(`/api/districts/${districtIdToDelete}`);
  assert.equal(missing.status, 404);
  assert.equal(missing.body.code, "DISTRICT_NOT_FOUND");
});

test("malformed JSON is reported without leaking internals", async () => {
  const admin = await login(DEMO.system);
  const response = await admin.agent
    .post("/api/schools")
    .set("X-CSRF-Token", admin.csrfToken)
    .set("Content-Type", "application/json")
    .send("{ not-valid-json");
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "INVALID_JSON");
  assert.doesNotMatch(response.body.error, /at .*\.js:/);
});

test("registration options expose self-service roles and create pending accounts", async () => {
  const options = await request(app).get("/api/auth/registration-options");
  assert.equal(options.status, 200, JSON.stringify(options.body));
  const roleValues = options.body.data.roles.map((role) => role.value);
  for (const role of ["psds", "school_head", "teacher", "nt", "adviser", "learner"]) {
    assert.ok(roleValues.includes(role), `${role} should be self-registrable`);
  }
  assert.ok(!roleValues.includes("system_admin"), "system administrators cannot self-register");
  const psdsMeta = options.body.data.roles.find((role) => role.value === "psds");
  assert.equal(psdsMeta.approverLabel, "District Administrator");
  const headMeta = options.body.data.roles.find((role) => role.value === "school_head");
  assert.equal(headMeta.approverLabel, "PSDS");

  const requests = [
    { key: "teacher", username: "tst.reg.teacher", role: "teacher", schoolId: northSchoolId, approver: "school_head" },
    { key: "nt", username: "tst.reg.nt", role: "nt", schoolId: northSchoolId, approver: "school_head" },
    { key: "learner", username: "tst.reg.learner", role: "learner", schoolId: northSchoolId, approver: "adviser" },
    { key: "head", username: "tst.reg.head", role: "school_head", schoolId: northSchoolId, approver: "psds" },
    { key: "psds", username: "tst.reg.psds", role: "psds", schoolId: null, approver: "district_admin" }
  ];

  for (const item of requests) {
    const response = await registerAccount(item);
    assert.equal(response.status, 201, `${item.role} registration: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.data.user.approvalStatus, "pending");
    assert.equal(response.body.data.user.isActive, false);
    assert.equal(response.body.data.user.schoolId, item.schoolId);
    assert.equal(response.body.data.approval.status, "pending");
    assert.equal(response.body.data.approval.approverRole, item.approver);
    assert.ok(response.body.data.approval.approverCount >= 1, "an approver should be notified");
    registrations[item.key] = {
      id: response.body.data.user.id,
      username: item.username
    };
  }
});

test("pending registrations cannot sign in and reveal no account state on bad passwords", async () => {
  assert.ok(registrations.teacher, "registration test must run first");

  const pending = await attemptLogin(registrations.teacher.username, REGISTERED_PASSWORD);
  assert.equal(pending.status, 403);
  assert.equal(pending.body.code, "ACCOUNT_PENDING");
  assert.match(pending.body.error, /School Head/i);

  const wrongPassword = await attemptLogin(registrations.teacher.username, "NotThePassword123");
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongPassword.body.code, "INVALID_CREDENTIALS");
});

test("approval queues are scoped to the immediate superior", async () => {
  assert.ok(registrations.learner, "registration test must run first");
  const ids = (list) => list.map((item) => Number(item.id));

  const head = await login(DEMO.northHead);
  const headQueue = await head.agent.get("/api/approvals");
  assert.equal(headQueue.status, 200);
  const headIds = ids(headQueue.body.data);
  assert.ok(headIds.includes(Number(registrations.teacher.id)), "school head sees teacher registrations");
  assert.ok(headIds.includes(Number(registrations.nt.id)), "school head sees NT registrations");
  assert.ok(!headIds.includes(Number(registrations.learner.id)), "school head does not confirm learners");
  assert.ok(!headIds.includes(Number(registrations.head.id)), "school head does not confirm school heads");

  const adviser = await login(DEMO.northAdviser);
  const adviserQueue = await adviser.agent.get("/api/approvals");
  assert.equal(adviserQueue.status, 200);
  const adviserIds = ids(adviserQueue.body.data);
  assert.ok(adviserIds.includes(Number(registrations.learner.id)), "adviser sees learner registrations");
  assert.ok(!adviserIds.includes(Number(registrations.teacher.id)), "adviser does not confirm teachers");

  const psds = await login(DEMO.northPsds);
  const psdsQueue = await psds.agent.get("/api/approvals");
  assert.equal(psdsQueue.status, 200);
  assert.ok(ids(psdsQueue.body.data).includes(Number(registrations.head.id)));

  const districtAdmin = await login(DEMO.northAdmin);
  const adminQueue = await districtAdmin.agent.get("/api/approvals");
  assert.equal(adminQueue.status, 200);
  assert.ok(ids(adminQueue.body.data).includes(Number(registrations.psds.id)));
});

test("the immediate superior confirms each role and unlocks sign-in", async () => {
  assert.ok(registrations.psds, "registration test must run first");

  const adviser = await login(DEMO.northAdviser);
  const wrongApprover = await adviser.agent
    .post(`/api/approvals/${registrations.teacher.id}/approve`)
    .set("X-CSRF-Token", adviser.csrfToken)
    .send({});
  assert.equal(wrongApprover.status, 403, "an adviser cannot confirm a teacher");

  const head = await login(DEMO.northHead);
  for (const key of ["teacher", "nt"]) {
    const approved = await head.agent
      .post(`/api/approvals/${registrations[key].id}/approve`)
      .set("X-CSRF-Token", head.csrfToken)
      .send({});
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.data.approvalStatus, "active");
    assert.equal(approved.body.data.isActive, true);
  }

  const learnerApproved = await adviser.agent
    .post(`/api/approvals/${registrations.learner.id}/approve`)
    .set("X-CSRF-Token", adviser.csrfToken)
    .send({});
  assert.equal(learnerApproved.status, 200);

  const psds = await login(DEMO.northPsds);
  const headApproved = await psds.agent
    .post(`/api/approvals/${registrations.head.id}/approve`)
    .set("X-CSRF-Token", psds.csrfToken)
    .send({});
  assert.equal(headApproved.status, 200);

  const districtAdmin = await login(DEMO.northAdmin);
  const psdsApproved = await districtAdmin.agent
    .post(`/api/approvals/${registrations.psds.id}/approve`)
    .set("X-CSRF-Token", districtAdmin.csrfToken)
    .send({});
  assert.equal(psdsApproved.status, 200);
  assert.equal(psdsApproved.body.data.approvedBy, districtAdmin.user.id);
});

test("confirmed accounts can sign in and update their own records", async () => {
  assert.ok(registrations.teacher, "registration test must run first");
  const confirmed = await login({
    username: registrations.teacher.username,
    password: REGISTERED_PASSWORD
  });
  assert.equal(confirmed.user.approvalStatus, "active");

  const updated = await confirmed.agent
    .put("/api/profile")
    .set("X-CSRF-Token", confirmed.csrfToken)
    .send({
      fullName: "Confirmed Test Teacher",
      email: "tst.reg.teacher.updated@example.com"
    });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.data.fullName, "Confirmed Test Teacher");

  const me = await confirmed.agent.get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.equal(me.body.data.user.email, "tst.reg.teacher.updated@example.com");
});

test("rejected registrations stay blocked and cannot be confirmed again", async () => {
  const created = await registerAccount({
    username: "tst.reg.rejected",
    role: "teacher",
    schoolId: northSchoolId
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const head = await login(DEMO.northHead);
  const rejected = await head.agent
    .post(`/api/approvals/${created.body.data.user.id}/reject`)
    .set("X-CSRF-Token", head.csrfToken)
    .send({ note: "Missing appointment documents." });
  assert.equal(rejected.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.data.approvalStatus, "rejected");
  assert.equal(rejected.body.data.rejectionNote, "Missing appointment documents.");

  const blockedLogin = await attemptLogin("tst.reg.rejected", REGISTERED_PASSWORD);
  assert.equal(blockedLogin.status, 403);
  assert.equal(blockedLogin.body.code, "ACCOUNT_REJECTED");

  const reconsidered = await head.agent
    .post(`/api/approvals/${created.body.data.user.id}/approve`)
    .set("X-CSRF-Token", head.csrfToken)
    .send({});
  assert.equal(reconsidered.status, 409);
  assert.equal(reconsidered.body.code, "REGISTRATION_REVIEWED");
});

test("registration validates roles, school scope, duplicates, CSRF, and queue access", async () => {
  const privileged = await registerAccount({
    username: "tst.reg.privileged",
    role: "system_admin",
    schoolId: null
  });
  assert.equal(privileged.status, 400);
  assert.equal(privileged.body.code, "VALIDATION_ERROR");

  const crossDistrict = await registerAccount({
    username: "tst.reg.cross",
    role: "teacher",
    schoolId: southSchoolId
  });
  assert.equal(crossDistrict.status, 400);
  assert.equal(crossDistrict.body.code, "VALIDATION_ERROR");
  assert.equal(crossDistrict.body.details.field, "schoolId");

  const duplicate = await registerAccount({
    username: "tst.reg.teacher",
    role: "teacher",
    schoolId: northSchoolId
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "USERNAME_IN_USE");

  const noCsrf = await registerAccount({
    username: "tst.reg.nocsrf",
    role: "teacher",
    schoolId: northSchoolId,
    csrf: false
  });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.body.code, "CSRF_INVALID");

  const anonymous = await request(app).get("/api/approvals");
  assert.equal(anonymous.status, 401);

  const staff = await login(DEMO.northStaff);
  const forbidden = await staff.agent.get("/api/approvals");
  assert.equal(forbidden.status, 403);
});

test("profile photos are validated, normalised, scoped, and removable", async () => {
  const admin = await login(DEMO.system);
  const created = await admin.agent
    .post("/api/users")
    .set("X-CSRF-Token", admin.csrfToken)
    .send({
      fullName: "Test Photo Learner",
      username: "tst.photo.learner",
      email: "tst.photo.learner@example.com",
      password: TEST_PASSWORD,
      role: "learner",
      districtId: northDistrictId,
      schoolId: northSchoolId,
      isActive: true
    });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const learnerId = created.body.data.id;

  const learner = await login({ username: "tst.photo.learner", password: TEST_PASSWORD });
  assert.equal(learner.user.id, learnerId);

  const png = await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 32, g: 96, b: 160 } }
  })
    .png()
    .toBuffer();

  const anonymous = await request(app).get(`/api/users/${learnerId}/photo`);
  assert.equal(anonymous.status, 401);

  const noCsrf = await learner.agent
    .post("/api/profile/photo")
    .attach("photo", png, { filename: "learner.png", contentType: "image/png" });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.body.code, "CSRF_INVALID");

  const upload = await learner.agent
    .post("/api/profile/photo")
    .set("X-CSRF-Token", learner.csrfToken)
    .attach("photo", png, { filename: "learner.png", contentType: "image/png" });
  assert.equal(upload.status, 200, JSON.stringify(upload.body));
  assert.ok(upload.body.data.photoUpdatedAt);

  const me = await learner.agent.get("/api/auth/me");
  assert.equal(me.status, 200);
  assert.ok(me.body.data.user.photoUpdatedAt);

  const head = await login(DEMO.northHead);
  const image = await head.agent.get(`/api/users/${learnerId}/photo`);
  assert.equal(image.status, 200);
  assert.equal(image.headers["content-type"], "image/webp");
  assert.equal(image.headers["x-content-type-options"], "nosniff");
  assert.equal(image.headers["cache-control"], "private, max-age=60, must-revalidate");
  const metadata = await sharp(image.body).metadata();
  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);

  const cached = await head.agent
    .get(`/api/users/${learnerId}/photo`)
    .set("If-None-Match", image.headers.etag);
  assert.equal(cached.status, 304);

  const gif = await learner.agent
    .post("/api/profile/photo")
    .set("X-CSRF-Token", learner.csrfToken)
    .attach("photo", png, { filename: "learner.gif", contentType: "image/gif" });
  assert.equal(gif.status, 415);
  assert.equal(gif.body.code, "PHOTO_TYPE_UNSUPPORTED");

  const spoofed = await learner.agent
    .post("/api/profile/photo")
    .set("X-CSRF-Token", learner.csrfToken)
    .attach("photo", Buffer.from("this is not an image", "utf8"), {
      filename: "fake.png",
      contentType: "image/png"
    });
  assert.equal(spoofed.status, 415);
  assert.equal(spoofed.body.code, "PHOTO_INVALID");

  const tooLarge = await learner.agent
    .post("/api/profile/photo")
    .set("X-CSRF-Token", learner.csrfToken)
    .attach("photo", Buffer.alloc(2 * 1024 * 1024 + 1, 0x41), {
      filename: "huge.png",
      contentType: "image/png"
    });
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.code, "PHOTO_TOO_LARGE");

  const selfOnly = await learner.agent
    .put(`/api/users/${head.user.id}/photo`)
    .set("X-CSRF-Token", learner.csrfToken)
    .attach("photo", png, { filename: "learner.png", contentType: "image/png" });
  assert.equal(selfOnly.status, 403);

  const northAdmin = await login(DEMO.northAdmin);
  const adminUpload = await northAdmin.agent
    .put(`/api/users/${learnerId}/photo`)
    .set("X-CSRF-Token", northAdmin.csrfToken)
    .attach("photo", png, { filename: "learner.png", contentType: "image/png" });
  assert.equal(adminUpload.status, 200, JSON.stringify(adminUpload.body));

  const southAdmin = await login(DEMO.southAdmin);
  const crossAdmin = await southAdmin.agent
    .put(`/api/users/${learnerId}/photo`)
    .set("X-CSRF-Token", southAdmin.csrfToken)
    .attach("photo", png, { filename: "learner.png", contentType: "image/png" });
  assert.equal(crossAdmin.status, 403);

  const southUser = await pool.query("SELECT id FROM users WHERE username = 'southstaff'");
  const crossView = await learner.agent.get(`/api/users/${southUser.rows[0].id}/photo`);
  assert.equal(crossView.status, 403);
  assert.equal(crossView.body.code, "PHOTO_FORBIDDEN");

  const removed = await learner.agent
    .delete("/api/profile/photo")
    .set("X-CSRF-Token", learner.csrfToken);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.data.photoUpdatedAt, null);

  const gone = await head.agent.get(`/api/users/${learnerId}/photo`);
  assert.equal(gone.status, 404);
  assert.equal(gone.body.code, "PHOTO_NOT_FOUND");

  const audit = await pool.query(
    `SELECT action FROM audit_logs
     WHERE entity_type = 'user' AND entity_id = $1 AND action LIKE '%photo%'`,
    [String(learnerId)]
  );
  const actions = audit.rows.map((row) => row.action);
  assert.ok(actions.includes("profile.photo_updated"), JSON.stringify(actions));
  assert.ok(actions.includes("user.photo_updated"), JSON.stringify(actions));
  assert.ok(actions.includes("profile.photo_removed"), JSON.stringify(actions));
});
