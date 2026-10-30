"use strict";

// Acceptance tests for School Forms 1–10, attended data, health privacy,
// learner-scoped submissions, printing, and auditability.
// Run with NODE_ENV=test before the app (and its session store) is loaded.
process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../server/app");
const { pool } = require("../server/config/database");

const ACCOUNTS = {
  system: { username: "sysadmin", password: "Admin@2026" },
  head: { username: "northhead", password: "Demo@2026" },
  adviser: { username: "northadviser", password: "Demo@2026" },
  south: { username: "southadmin", password: "District@2026" }
};

let sessions = {};
let schoolId = null;
let schoolYearId = null;
let sectionId = null;
let learnerIds = [];
let sf10Learners = [];
let submissionBaseline = 0;
const createdSubmissionIds = [];

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

function preview(session, code, query) {
  const search = new URLSearchParams(query).toString();
  return session.agent.get(`/api/school-forms/preview/${code}?${search}`);
}

function generate(session, code, body) {
  return session.agent
    .post(`/api/school-forms/generate/${code}`)
    .set("X-CSRF-Token", session.csrfToken)
    .send(body);
}

function messages(validation, key) {
  return ((validation && validation[key]) || []).map((issue) => issue.message);
}

before(async () => {
  // Anchor the fixture to the seeded school head's school. Picking the first
  // school in the database is unreliable on a development database that also
  // contains newly added schools without enrollments yet.
  const school = await pool.query(
    `SELECT u.school_id AS id
     FROM users u
     WHERE u.username = 'northhead' AND u.school_id IS NOT NULL
     LIMIT 1`
  );
  assert.ok(school.rows[0], "the demo school head account must be seeded (npm run db:init)");
  schoolId = Number(school.rows[0].id);

  const year = await pool.query(`SELECT id FROM school_years WHERE is_current ORDER BY id LIMIT 1`);
  assert.ok(year.rows[0], "a current school year is required");
  schoolYearId = Number(year.rows[0].id);

  const section = await pool.query(
    `SELECT id FROM sections
     WHERE school_id = $1 AND school_year_id = $2
     ORDER BY id LIMIT 1`,
    [schoolId, schoolYearId]
  );
  assert.ok(section.rows[0], "a section is required for the current school year");
  sectionId = Number(section.rows[0].id);

  const learners = await pool.query(
    `SELECT l.id
     FROM learners l
     JOIN enrollments e ON e.learner_id = l.id
     WHERE e.school_id = $1 AND e.school_year_id = $2 AND e.section_id = $3
     ORDER BY l.id`,
    [schoolId, schoolYearId, sectionId]
  );
  learnerIds = learners.rows.map((row) => Number(row.id));
  assert.ok(learnerIds.length >= 2, "at least two enrolled learners are required");

  const withoutSf10 = await pool.query(
    `SELECT l.id
     FROM learners l
     JOIN enrollments e ON e.learner_id = l.id
     WHERE e.school_id = $1 AND e.school_year_id = $2 AND e.section_id = $3
       AND NOT EXISTS (
         SELECT 1 FROM form_submissions fs
         WHERE fs.learner_id = l.id AND fs.form_code = 'sf10' AND fs.school_year_id = $2
       )
     ORDER BY l.id
     LIMIT 2`,
    [schoolId, schoolYearId, sectionId]
  );
  sf10Learners = withoutSf10.rows.map((row) => Number(row.id));
  assert.ok(sf10Learners.length >= 2, "two learners without an SF 10 submission are required");

  const baseline = await pool.query(`SELECT COALESCE(MAX(id), 0)::int AS max_id FROM form_submissions`);
  submissionBaseline = baseline.rows[0].max_id;

  sessions.system = await login(ACCOUNTS.system);
  sessions.head = await login(ACCOUNTS.head);
  sessions.adviser = await login(ACCOUNTS.adviser);
  sessions.south = await login(ACCOUNTS.south);
});

after(async () => {
  if (createdSubmissionIds.length) {
    await pool.query(`DELETE FROM audit_logs WHERE action = 'school_form.generate' AND entity_id = ANY($1)`, [
      createdSubmissionIds.map(String)
    ]);
  }
  await pool.query(`DELETE FROM form_submissions WHERE id > $1`, [submissionBaseline]);
  await pool.end();
});

test("form pages and APIs deny unauthenticated and unauthorised access", async () => {
  const anonymousApi = await request(app).get("/api/school-forms/cards");
  assert.equal(anonymousApi.status, 401);
  assert.equal(anonymousApi.body.code, "AUTH_REQUIRED");

  const anonymousPage = await request(app).get("/school-forms.html");
  assert.equal(anonymousPage.status, 302);
  assert.match(anonymousPage.headers.location, /index\.html/);

  const adviserHealthPage = await sessions.adviser.agent.get("/health.html");
  assert.equal(adviserHealthPage.status, 403);
  assert.match(adviserHealthPage.text, /You do not have access to this page/);

  const adviserHealthApi = await sessions.adviser.agent.get(`/api/health/learners/${learnerIds[0]}`);
  assert.equal(adviserHealthApi.status, 403);

  const adviserFormsPage = await sessions.adviser.agent.get("/school-forms.html");
  assert.equal(adviserFormsPage.status, 200);

  const headHealthPage = await sessions.head.agent.get("/health.html");
  assert.equal(headHealthPage.status, 200);
  const headHealthApi = await sessions.head.agent.get("/api/health/summary");
  assert.equal(headHealthApi.status, 200);
});

test("school scoping prevents cross-district form, attendance, and submission access", async () => {
  const foreignPreview = await preview(sessions.south, "sf1", {
    schoolId,
    schoolYearId
  });
  assert.equal(foreignPreview.status, 403);
  assert.equal(foreignPreview.body.code, "SCHOOL_FORBIDDEN");

  const foreignGenerate = await generate(sessions.south, "sf1", { schoolId, schoolYearId });
  assert.equal(foreignGenerate.status, 403);
  assert.equal(foreignGenerate.body.code, "SCHOOL_FORBIDDEN");

  const foreignAttendance = await sessions.south.agent.get(
    `/api/attendance/sheet?sectionId=${sectionId}&schoolYearId=${schoolYearId}&date=2027-01-04`
  );
  assert.equal(foreignAttendance.status, 403);
  assert.equal(foreignAttendance.body.code, "SCHOOL_FORBIDDEN");

  const foreignSubmissions = await sessions.south.agent.get(
    `/api/school-forms/submissions?schoolId=${schoolId}`
  );
  assert.equal(foreignSubmissions.status, 200);
  assert.ok(
    (foreignSubmissions.body.data || []).every((row) => Number(row.schoolId) !== schoolId),
    "submissions from another district must never be returned"
  );
});

test("duplicate LRNs and duplicate school-year enrollments are rejected", async () => {
  const existing = await pool.query(`SELECT lrn FROM learners ORDER BY id LIMIT 1`);
  const countBefore = await pool.query(`SELECT COUNT(*)::int AS count FROM learners`);

  const duplicateLearner = await sessions.head.agent
    .post("/api/learners")
    .set("X-CSRF-Token", sessions.head.csrfToken)
    .send({
      lrn: existing.rows[0].lrn,
      lastName: "Duplicate",
      firstName: "Learner",
      sex: "male",
      birthDate: "2012-01-01",
      schoolId
    });
  assert.equal(duplicateLearner.status, 409);
  assert.equal(duplicateLearner.body.code, "LRN_IN_USE");

  const countAfter = await pool.query(`SELECT COUNT(*)::int AS count FROM learners`);
  assert.equal(countAfter.rows[0].count, countBefore.rows[0].count);

  const enrollment = await pool.query(
    `SELECT school_year_id, grade_level_id, section_id FROM enrollments WHERE learner_id = $1 LIMIT 1`,
    [learnerIds[0]]
  );
  const duplicateEnrollment = await sessions.head.agent
    .post(`/api/learners/${learnerIds[0]}/enrollments`)
    .set("X-CSRF-Token", sessions.head.csrfToken)
    .send({
      schoolYearId: Number(enrollment.rows[0].school_year_id),
      gradeLevelId: Number(enrollment.rows[0].grade_level_id),
      sectionId: Number(enrollment.rows[0].section_id),
      enrollmentDate: "2026-06-01",
      status: "enrolled"
    });
  assert.equal(duplicateEnrollment.status, 409);
  assert.equal(duplicateEnrollment.body.code, "ENROLLMENT_EXISTS");
});

test("attendance is never assumed present and SF 2 blocks unsaved days", async () => {
  const sheet = await sessions.head.agent.get(
    `/api/attendance/sheet?sectionId=${sectionId}&schoolYearId=${schoolYearId}&date=2027-01-04`
  );
  assert.equal(sheet.status, 200);
  assert.ok(sheet.body.data.learners.length >= 2);
  assert.ok(
    sheet.body.data.learners.every((learner) => learner.status === null && learner.recordId === null),
    "an unrecorded day must not default any learner to present"
  );

  const report = await preview(sessions.head, "sf2", {
    schoolId,
    schoolYearId,
    sectionId,
    month: "2027-01"
  });
  assert.equal(report.status, 200);
  const validation = report.body.data.data.validation;
  assert.ok(validation.errors.length > 0);
  assert.ok(
    messages(validation, "errors").some((message) => /No attendance was saved/.test(message)),
    "SF 2 must flag school days without saved attendance"
  );
  assert.ok(report.body.data.data.completeness < 100);
});

test("SF 4 reconciles movement and attendance without inventing records", async () => {
  const report = await preview(sessions.head, "sf4", {
    schoolId,
    schoolYearId,
    month: "2026-10"
  });
  assert.equal(report.status, 200);
  const data = report.body.data.data;
  const warnings = messages(data.validation, "warnings").join(" ");
  assert.match(warnings, /No attendance records exist for this month/);
  assert.match(warnings, /No learner movement was recorded this month/);
  assert.deepEqual(
    data.tables.map((table) => table.key),
    ["movement-summary", "movement-detail"]
  );
});

test("SF 6 aggregates only approved or finalized SF 5 decisions", async () => {
  const report = await preview(sessions.head, "sf6", { schoolId, schoolYearId });
  assert.equal(report.status, 200);
  const data = report.body.data.data;
  const errors = messages(data.validation, "errors").join(" ");
  assert.match(errors, /without finalized final grades/);
  assert.match(errors, /promotion decision is not approved or finalized/);
  assert.ok(data.completeness < 100);
});

test("SF 9 blocks report cards until final grades are finalized", async () => {
  const report = await preview(sessions.head, "sf9", {
    schoolId,
    schoolYearId,
    learnerId: learnerIds[0]
  });
  assert.equal(report.status, 200);
  const errors = messages(report.body.data.data.validation, "errors").join(" ");
  assert.match(errors, /has no finalized final grades/);
});

test("SF 10 is learner-scoped, preserves history, and re-generating one learner does not overwrite another", async () => {
  const first = await generate(sessions.head, "sf10", {
    schoolId,
    schoolYearId,
    learnerId: sf10Learners[0]
  });
  assert.equal(first.status, 201);
  const firstSubmission = first.body.data.submission;
  createdSubmissionIds.push(firstSubmission.id);
  assert.equal(firstSubmission.learnerId, sf10Learners[0]);
  assert.equal(firstSubmission.status, "validation_failed");
  assert.ok(
    messages(first.body.data.data.validation, "errors").some((message) =>
      /no permanent academic record entries/.test(message)
    ),
    "SF 10 must not certify an empty permanent record"
  );

  const second = await generate(sessions.head, "sf10", {
    schoolId,
    schoolYearId,
    learnerId: sf10Learners[1]
  });
  assert.equal(second.status, 201);
  createdSubmissionIds.push(second.body.data.submission.id);
  assert.equal(second.body.data.submission.learnerId, sf10Learners[1]);
  assert.notEqual(second.body.data.submission.id, firstSubmission.id);

  const again = await generate(sessions.head, "sf10", {
    schoolId,
    schoolYearId,
    learnerId: sf10Learners[0]
  });
  assert.equal(again.status, 201);
  assert.equal(again.body.data.submission.id, firstSubmission.id);
  assert.equal(Number(again.body.data.submission.version), Number(firstSubmission.version) + 1);
  assert.equal(again.body.data.submission.learnerId, sf10Learners[0]);

  const scopedList = await sessions.head.agent.get(
    `/api/school-forms/submissions?schoolId=${schoolId}&schoolYearId=${schoolYearId}` +
      `&formCode=sf10&learnerId=${sf10Learners[0]}`
  );
  assert.equal(scopedList.status, 200);
  assert.equal(scopedList.body.data.length, 1);
  assert.equal(Number(scopedList.body.data[0].id), Number(firstSubmission.id));

  const both = await sessions.head.agent.get(
    `/api/school-forms/submissions?schoolId=${schoolId}&schoolYearId=${schoolYearId}&formCode=sf10`
  );
  const ids = both.body.data
    .filter((row) => sf10Learners.includes(Number(row.learnerId)))
    .map((row) => Number(row.id));
  assert.equal(new Set(ids).size, ids.length, "each learner must keep a distinct SF 10 submission");
  assert.ok(ids.includes(Number(firstSubmission.id)));
  assert.ok(ids.includes(Number(second.body.data.submission.id)));
});

test("SF 1 preview is complete for a seeded school and cards expose every form", async () => {
  const report = await preview(sessions.head, "sf1", { schoolId, schoolYearId });
  assert.equal(report.status, 200);
  const data = report.body.data.data;
  assert.equal(data.validation.errors.length, 0);
  assert.equal(data.completeness, 100);
  assert.equal(data.tables[0].key, "register");

  const cards = await sessions.head.agent.get(
    `/api/school-forms/cards?schoolId=${schoolId}&schoolYearId=${schoolYearId}`
  );
  assert.equal(cards.status, 200);
  assert.equal(cards.body.data.cards.length, 10);
  const codes = cards.body.data.cards.map((card) => card.code).sort();
  assert.deepEqual(codes, [
    "sf1",
    "sf10",
    "sf2",
    "sf3",
    "sf4",
    "sf5",
    "sf6",
    "sf7",
    "sf8",
    "sf9"
  ]);
});

test("generated forms render as PDF and every generation is audited", async () => {
  const generated = await generate(sessions.head, "sf1", { schoolId, schoolYearId });
  assert.equal(generated.status, 201);
  const submission = generated.body.data.submission;
  assert.equal(submission.formCode, "sf1");
  if (Number(submission.id) > submissionBaseline && !createdSubmissionIds.includes(submission.id)) {
    createdSubmissionIds.push(submission.id);
  }

  const pdf = await sessions.head.agent.get(
    `/api/school-forms/submissions/${submission.id}/render?format=pdf`
  );
  assert.equal(pdf.status, 200);
  assert.equal(pdf.headers["content-type"], "application/pdf");
  assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");

  const audit = await pool.query(
    `SELECT details, user_id FROM audit_logs
     WHERE action = 'school_form.generate' AND entity_id = $1
     ORDER BY id DESC LIMIT 1`,
    [String(submission.id)]
  );
  assert.ok(audit.rows[0], "form generation must create an audit entry");
  assert.equal(audit.rows[0].details.formCode, "sf1");
  assert.equal(Number(audit.rows[0].user_id), Number(sessions.head.user.id));
  assert.equal(Number(audit.rows[0].details.schoolId), schoolId);
});
