"use strict";

// Administrator-managed subject options. The fixture creates its own district,
// school, and school-head account so the test does not depend on demonstration
// rows that may have been replaced by real school data.

process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcrypt");

const app = require("../server/app");
const { pool } = require("../server/config/database");

const RUN = `SUB${Date.now().toString(36).slice(-6)}`.toUpperCase();
const PREFIX = `${RUN} `;
const PASSWORD = "TestPass1234";
const OPTION_ONE = `${PREFIX}Subject 91`;
const OPTION_TWO = `${PREFIX}Subject 92`;
const SUBJECT_CODE = `${RUN}-S91`;

const state = {
  districtId: null,
  schoolId: null,
  sysadmin: null,
  head: null,
  optionId: null,
  secondOptionId: null,
  subjectId: null
};

async function cleanupTestData() {
  await pool.query(
    "DELETE FROM subjects WHERE school_id IN (SELECT id FROM schools WHERE school_code LIKE $1)",
    [`${RUN}-%`]
  );
  await pool.query("DELETE FROM subject_options WHERE name LIKE $1", [`${PREFIX}%`]);
  await pool.query("DELETE FROM audit_logs WHERE details::text LIKE $1", [`%${PREFIX}%`]);
  await pool.query("DELETE FROM users WHERE username LIKE $1", [`${RUN.toLowerCase()}.%`]);
  await pool.query("DELETE FROM schools WHERE school_code LIKE $1", [`${RUN}-%`]);
  await pool.query("DELETE FROM districts WHERE district_code LIKE $1", [`${RUN}-%`]);
}

async function fetchCsrf(agent) {
  const response = await agent.get("/api/auth/csrf");
  assert.equal(response.status, 200, "csrf endpoint should return 200");
  return response.body.data.csrfToken;
}

async function login(identifier) {
  const agent = request.agent(app);
  const token = await fetchCsrf(agent);
  const response = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", token)
    .send({ identifier, password: identifier === "sysadmin" ? "Admin@2026" : PASSWORD });
  assert.equal(
    response.status,
    200,
    `login for ${identifier} should succeed: ${JSON.stringify(response.body)}`
  );
  return {
    agent,
    csrfToken: response.body.data.csrfToken || token,
    user: response.body.data.user
  };
}

before(async () => {
  await cleanupTestData();

  const district = await pool.query(
    `INSERT INTO districts (district_name, district_code, address)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [`${PREFIX}Test District`, `${RUN}-D`, "Subject options test address"]
  );
  state.districtId = Number(district.rows[0].id);

  const school = await pool.query(
    `INSERT INTO schools (
       school_code, school_name, school_type, address, district_id, school_head
     ) VALUES ($1, $2, 'Elementary School', $3, $4, $5)
     RETURNING id`,
    [
      `${RUN}-S`,
      `${PREFIX}Test School`,
      "Subject options test address",
      state.districtId,
      "Test School Head"
    ]
  );
  state.schoolId = Number(school.rows[0].id);

  const hash = await bcrypt.hash(PASSWORD, 10);
  await pool.query(
    `INSERT INTO users (
       full_name, username, email, password_hash, role, district_id, school_id,
       is_active, approval_status
     ) VALUES ($1, $2, $3, $4, 'school_head', $5, $6, TRUE, 'active')`,
    [
      "Subject Options Test Head",
      `${RUN.toLowerCase()}.head`,
      `${RUN.toLowerCase()}.head@example.test`,
      hash,
      state.districtId,
      state.schoolId
    ]
  );

  state.sysadmin = await login("sysadmin");
  state.head = await login(`${RUN.toLowerCase()}.head`);
});

after(async () => {
  await cleanupTestData();
  await pool.end();
});

test("system administrator manages the subject option catalog", async (t) => {
  await t.test("only the system administrator may create options", async () => {
    const blocked = await state.head.agent
      .post("/api/academic/subject-options")
      .set("X-CSRF-Token", state.head.csrfToken)
      .send({ name: OPTION_ONE, sortOrder: 91 });
    assert.equal(blocked.status, 403);
  });

  await t.test("creates an option and rejects a case-only duplicate", async () => {
    const created = await state.sysadmin.agent
      .post("/api/academic/subject-options")
      .set("X-CSRF-Token", state.sysadmin.csrfToken)
      .send({ name: OPTION_ONE, sortOrder: 91 });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.name, OPTION_ONE);
    assert.equal(created.body.data.sortOrder, 91);
    assert.equal(created.body.data.isActive, true);
    state.optionId = created.body.data.id;

    const duplicate = await state.sysadmin.agent
      .post("/api/academic/subject-options")
      .set("X-CSRF-Token", state.sysadmin.csrfToken)
      .send({ name: OPTION_ONE.toLowerCase(), sortOrder: 91 });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, "SUBJECT_OPTION_EXISTS");
  });

  await t.test("schools receive the active options for their dropdown", async () => {
    const response = await state.head.agent.get("/api/academic/subject-options");
    assert.equal(response.status, 200);
    const option = response.body.data.find((item) => item.id === state.optionId);
    assert.ok(option, "the new option should be visible to the school");
    assert.equal(option.isActive, true);
    assert.ok(
      response.body.data.some((item) => item.name === "Kindergarten"),
      "the starter catalogue should include Kindergarten"
    );
    assert.ok(
      response.body.data.some((item) => item.name === "Mathematics"),
      "the starter catalogue should include Mathematics"
    );
    assert.ok(
      response.body.data.some((item) => item.name === "General Mathematics"),
      "the starter catalogue should include senior high subjects"
    );
  });

  await t.test("a school subject must use an active catalog option", async () => {
    const created = await state.head.agent
      .post("/api/academic/subjects")
      .set("X-CSRF-Token", state.head.csrfToken)
      .send({ code: SUBJECT_CODE, name: OPTION_ONE.toLowerCase() });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.name, OPTION_ONE, "the canonical option name is stored");
    assert.equal(created.body.data.code, SUBJECT_CODE);
    assert.equal(created.body.data.schoolId, state.schoolId);
    state.subjectId = created.body.data.id;

    const freeText = await state.head.agent
      .post("/api/academic/subjects")
      .set("X-CSRF-Token", state.head.csrfToken)
      .send({ code: `${RUN}-FREE`, name: `${PREFIX}Free text` });
    assert.equal(freeText.status, 400);
    assert.equal(freeText.body.code, "SUBJECT_OPTION_REQUIRED");
  });

  await t.test("deactivation hides the option and blocks new use", async () => {
    const deactivated = await state.sysadmin.agent
      .put("/api/academic/subject-options/" + state.optionId)
      .set("X-CSRF-Token", state.sysadmin.csrfToken)
      .send({ name: OPTION_ONE, sortOrder: 91, isActive: false });
    assert.equal(deactivated.status, 200, JSON.stringify(deactivated.body));
    assert.equal(deactivated.body.data.isActive, false);

    const visible = await state.head.agent.get("/api/academic/subject-options");
    assert.equal(visible.status, 200);
    assert.equal(
      visible.body.data.some((item) => item.id === state.optionId),
      false,
      "inactive options are hidden from schools"
    );

    const blocked = await state.head.agent
      .post("/api/academic/subjects")
      .set("X-CSRF-Token", state.head.csrfToken)
      .send({ code: `${RUN}-INACTIVE`, name: OPTION_ONE });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.code, "SUBJECT_OPTION_INACTIVE");
  });

  await t.test("an existing subject keeps its current name", async () => {
    const updated = await state.head.agent
      .put("/api/academic/subjects/" + state.subjectId)
      .set("X-CSRF-Token", state.head.csrfToken)
      .send({ code: SUBJECT_CODE, name: OPTION_ONE });
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal(updated.body.data.name, OPTION_ONE);
  });

  await t.test("options in use cannot be removed", async () => {
    const blocked = await state.sysadmin.agent
      .delete("/api/academic/subject-options/" + state.optionId)
      .set("X-CSRF-Token", state.sysadmin.csrfToken);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, "SUBJECT_OPTION_IN_USE");
  });

  await t.test("admin can add another option and remove an unused one", async () => {
    const created = await state.sysadmin.agent
      .post("/api/academic/subject-options")
      .set("X-CSRF-Token", state.sysadmin.csrfToken)
      .send({ name: OPTION_TWO, sortOrder: 92 });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    state.secondOptionId = created.body.data.id;

    const removed = await state.sysadmin.agent
      .delete("/api/academic/subject-options/" + state.secondOptionId)
      .set("X-CSRF-Token", state.sysadmin.csrfToken);
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    state.secondOptionId = null;
  });

  await t.test("all option changes are audited", async () => {
    const audit = await pool.query(
      `SELECT action FROM audit_logs
       WHERE action LIKE 'subject_option.%'
         AND details::text LIKE $1`,
      [`%${PREFIX}%`]
    );
    const actions = audit.rows.map((row) => row.action);
    assert.ok(actions.includes("subject_option.created"));
    assert.ok(actions.includes("subject_option.updated"));
    assert.ok(actions.includes("subject_option.removed"));
  });

  await t.test("the school can remove its subject but not the option history", async () => {
    const removed = await state.head.agent
      .delete("/api/academic/subjects/" + state.subjectId)
      .set("X-CSRF-Token", state.head.csrfToken);
    assert.equal(removed.status, 200, JSON.stringify(removed.body));
    state.subjectId = null;

    const blocked = await state.head.agent
      .delete("/api/academic/subject-options/" + state.optionId)
      .set("X-CSRF-Token", state.head.csrfToken);
    assert.equal(blocked.status, 403);

    const cleaned = await state.sysadmin.agent
      .delete("/api/academic/subject-options/" + state.optionId)
      .set("X-CSRF-Token", state.sysadmin.csrfToken);
    assert.equal(cleaned.status, 200, JSON.stringify(cleaned.body));
    state.optionId = null;
  });
});
