"use strict";

// Acceptance tests for subject-period attendance, adviser daily validation,
// the three-term calendar, correction requests, and duplicate prevention.
// Runs against the seeded Central Elementary section (id 21) and removes only
// the attendance rows it creates for the two test dates.
process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../server/app");
const { pool } = require("../server/config/database");

const ACCOUNTS = {
  teacher: { username: "northteacher", password: "Demo@2026" },
  adviser: { username: "northadviser", password: "Demo@2026" },
  head: { username: "northhead", password: "Demo@2026" },
  southAdmin: { username: "southadmin", password: "District@2026" }
};

const SECTION_ID = 21;
const SCHOOL_ID = 386;
const YEAR_ID = 2;
const DATES = ["2026-06-08", "2026-06-09"];

const sessions = {};
const state = { roster: null, terms: null };

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
  return { agent, csrfToken: response.body.data.csrfToken || token, user: response.body.data.user };
}

function auth(session, req) {
  return req.set("X-CSRF-Token", session.csrfToken);
}

async function clearScope() {
  await pool.query(
    `DELETE FROM subject_attendance_corrections
     WHERE subject_attendance_id IN (
       SELECT id FROM subject_attendance WHERE section_id = $1 AND attendance_date = ANY($2::date[])
     )`,
    [SECTION_ID, DATES]
  );
  await pool.query(
    "DELETE FROM subject_attendance WHERE section_id = $1 AND attendance_date = ANY($2::date[])",
    [SECTION_ID, DATES]
  );
  await pool.query(
    "DELETE FROM subject_attendance_submissions WHERE section_id = $1 AND attendance_date = ANY($2::date[])",
    [SECTION_ID, DATES]
  );
  await pool.query(
    "DELETE FROM adviser_attendance WHERE section_id = $1 AND attendance_date = ANY($2::date[])",
    [SECTION_ID, DATES]
  );
}

async function writeSubject(session, subjectId, date, periodNo, statusFor) {
  const entries = state.roster.map((learner, index) => ({
    enrollmentId: learner.enrollmentId,
    date,
    periodNo,
    status: statusFor(index)
  }));
  return auth(session, session.agent.put("/api/attendance/subject/matrix")).send({
    sectionId: SECTION_ID,
    schoolYearId: YEAR_ID,
    subjectId,
    date,
    submit: true,
    entries
  });
}

before(async () => {
  await clearScope();
  sessions.head = await login(ACCOUNTS.head);
  sessions.teacher = await login(ACCOUNTS.teacher);
  sessions.adviser = await login(ACCOUNTS.adviser);
  sessions.south = await login(ACCOUNTS.southAdmin);
});

after(async () => {
  await clearScope().catch(() => {});
  await pool.end();
});

test("terms and periods stay configurable per school and grade level", async () => {
  let response = await sessions.head.agent.get(
    `/api/attendance/terms?schoolId=${SCHOOL_ID}&schoolYearId=${YEAR_ID}`
  );
  assert.equal(response.status, 200, response.text);
  if (!response.body.data.terms.length) {
    response = await auth(sessions.head, sessions.head.agent.post("/api/attendance/terms")).send({
      schoolId: SCHOOL_ID,
      schoolYearId: YEAR_ID
    });
    assert.equal(response.status, 201, response.text);
  }
  response = await auth(sessions.head, sessions.head.agent.post("/api/attendance/terms/approve")).send({
    schoolId: SCHOOL_ID,
    schoolYearId: YEAR_ID
  });
  assert.equal(response.status, 200, response.text);
  state.terms = response.body.data;
  assert.equal(state.terms.termModel, "three_term");
  assert.deepEqual(state.terms.terms.map((term) => term.termNo), [1, 2, 3]);
  assert.ok(state.terms.terms.every((term) => term.status === "approved"));
  assert.equal(state.terms.canConfigure, true);

  const layout = [
    { periodNo: 1, label: "Period 1", startTime: "07:30", endTime: "08:20" },
    { periodNo: 2, label: "Period 2", startTime: "08:20", endTime: "09:10" },
    { periodNo: 3, label: "Period 3", startTime: "09:30", endTime: "10:20" },
    { periodNo: 4, label: "Period 4", startTime: "10:20", endTime: "11:10" },
    { periodNo: 5, label: "Period 5", startTime: "13:00", endTime: "13:50" }
  ];
  response = await auth(sessions.head, sessions.head.agent.put("/api/attendance/periods")).send({
    schoolId: SCHOOL_ID,
    schoolYearId: YEAR_ID,
    gradeLevelId: 8,
    periods: layout
  });
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.data.periods.length, 5);
  assert.equal(response.body.data.periods[4].startTime, "13:00");

  response = await sessions.teacher.agent.get(
    `/api/attendance/periods?sectionId=${SECTION_ID}&schoolYearId=${YEAR_ID}`
  );
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.data.canConfigure, false);
  assert.ok(response.body.data.effective.length >= 5);
});

test("teacher sees only assigned loads and can submit their own subject", async () => {
  let response = await sessions.teacher.agent.get(
    `/api/attendance/teacher-loads?schoolYearId=${YEAR_ID}`
  );
  assert.equal(response.status, 200, response.text);
  assert.ok(response.body.data.loads.length >= 3);
  assert.ok(response.body.data.loads.every((load) => load.teacherId === sessions.teacher.user.id));

  response = await sessions.teacher.agent.get(
    `/api/attendance/subject/matrix?sectionId=${SECTION_ID}&schoolYearId=${YEAR_ID}&subjectId=42&date=2026-06-08`
  );
  assert.equal(response.status, 200, response.text);
  const matrix = response.body.data;
  state.roster = matrix.learners;
  assert.equal(matrix.learners.length, 8);
  assert.equal(matrix.dates.length, 5);
  assert.equal(matrix.dates[0].term.termNo, 1);
  assert.deepEqual(matrix.dates[0].activePeriods, [1]);
  assert.equal(matrix.canEdit, true);
  assert.equal(matrix.configured, true);

  response = await writeSubject(
    sessions.teacher,
    42,
    "2026-06-08",
    1,
    (index) => (index === 2 ? "absent" : index === 3 ? "tardy" : "present")
  );
  assert.equal(response.status, 200, response.text);
  // The week view aggregates any other dates in the week, so assert the cells
  // for the date under test instead of the whole-week totals.
  const dayCells = response.body.data.learners.map((learner) => learner.cells["2026-06-08|1"]);
  assert.equal(dayCells.filter((cell) => cell && cell.status).length, 8);
  assert.equal(response.body.data.dates[0].submitted, true);
  assert.equal(dayCells.filter((cell) => cell.status === "absent").length, 1);
  assert.equal(dayCells.filter((cell) => cell.status === "tardy").length, 1);

  response = await auth(sessions.teacher, sessions.teacher.agent.put("/api/attendance/subject/matrix")).send({
    sectionId: SECTION_ID,
    schoolYearId: YEAR_ID,
    subjectId: 42,
    date: "2026-06-08",
    entries: [
      { enrollmentId: state.roster[2].enrollmentId, date: "2026-06-08", periodNo: 1, status: "excused" }
    ]
  });
  assert.equal(response.status, 200, response.text);
  const count = await pool.query(
    `SELECT COUNT(*)::int AS n FROM subject_attendance
     WHERE section_id = $1 AND attendance_date = '2026-06-08' AND subject_id = 42`,
    [SECTION_ID]
  );
  assert.equal(count.rows[0].n, 8, "re-saving updates instead of duplicating rows");

  response = await auth(sessions.teacher, sessions.teacher.agent.put("/api/attendance/subject/matrix")).send({
    sectionId: SECTION_ID,
    schoolYearId: YEAR_ID,
    subjectId: 43,
    assignmentId: 28,
    date: "2026-06-08",
    entries: [
      { enrollmentId: state.roster[0].enrollmentId, date: "2026-06-08", periodNo: 1, status: "present" }
    ]
  });
  assert.equal(response.status, 403, response.text);
});

test("adviser consolidates multiple subjects once per learner and validates explicitly", async () => {
  const writes = [
    [sessions.teacher, 42, 1, (index) => (index === 0 ? "absent" : "present")],
    [sessions.teacher, 44, 2, () => "present"],
    [sessions.adviser, 43, 4, () => "present"],
    [sessions.adviser, 45, 3, () => "present"]
  ];
  for (const [session, subjectId, periodNo, statusFor] of writes) {
    const response = await writeSubject(session, subjectId, "2026-06-09", periodNo, statusFor);
    assert.equal(response.status, 200, `${subjectId}: ${response.text}`);
  }

  let response = await sessions.adviser.agent.get(
    `/api/attendance/adviser/consolidation?sectionId=${SECTION_ID}&schoolYearId=${YEAR_ID}&date=2026-06-09`
  );
  assert.equal(response.status, 200, response.text);
  const day = response.body.data;
  assert.equal(day.subjects.length, 5);
  assert.equal(day.learners[0].conflict, true);
  assert.equal(day.learners[0].suggestedStatus, "present");
  assert.equal(day.learners[0].absentSubjects, 1);
  assert.equal(day.missingSubjects, 1);

  response = await auth(sessions.adviser, sessions.adviser.agent.post("/api/attendance/adviser/validate")).send({
    sectionId: SECTION_ID,
    schoolYearId: YEAR_ID,
    date: "2026-06-09"
  });
  assert.equal(response.status, 400, "validation without explicit statuses must be rejected");
  assert.equal(response.body.code, "VALIDATION_EXPLICIT_REQUIRED");

  response = await auth(sessions.adviser, sessions.adviser.agent.post("/api/attendance/adviser/validate")).send({
    sectionId: SECTION_ID,
    schoolYearId: YEAR_ID,
    date: "2026-06-09",
    learners: state.roster.map((learner) => ({
      enrollmentId: learner.enrollmentId,
      status: "present",
      manual: false
    }))
  });
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.data.validatedCount, 8);
  const daily = await pool.query(
    `SELECT COUNT(*)::int AS n FROM adviser_attendance
     WHERE section_id = $1 AND attendance_date = '2026-06-09'`,
    [SECTION_ID]
  );
  assert.equal(daily.rows[0].n, 8, "one daily record per learner, not one per subject");
});

test("validated days lock teachers and can be reopened for late submissions", async () => {
  let response = await auth(sessions.teacher, sessions.teacher.agent.put("/api/attendance/subject/matrix")).send({
    sectionId: SECTION_ID,
    schoolYearId: YEAR_ID,
    subjectId: 42,
    date: "2026-06-09",
    entries: [
      { enrollmentId: state.roster[0].enrollmentId, date: "2026-06-09", periodNo: 1, status: "present" }
    ]
  });
  assert.equal(response.status, 409, response.text);
  assert.equal(response.body.code, "ATTENDANCE_LOCKED");

  response = await auth(sessions.teacher, sessions.teacher.agent.post("/api/attendance/adviser/reopen-validation")).send({
    sectionId: SECTION_ID,
    schoolYearId: YEAR_ID,
    date: "2026-06-09"
  });
  assert.equal(response.status, 403, response.text);

  response = await auth(sessions.adviser, sessions.adviser.agent.post("/api/attendance/adviser/reopen-validation")).send({
    sectionId: SECTION_ID,
    schoolYearId: YEAR_ID,
    date: "2026-06-09"
  });
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.data.validatedCount, 0);

  response = await writeSubject(sessions.teacher, 42, "2026-06-09", 1, () => "present");
  assert.equal(response.status, 200, "a late submission must be accepted after reopening");

  response = await auth(sessions.adviser, sessions.adviser.agent.post("/api/attendance/adviser/validate")).send({
    sectionId: SECTION_ID,
    schoolYearId: YEAR_ID,
    date: "2026-06-09",
    learners: state.roster.map((learner) => ({
      enrollmentId: learner.enrollmentId,
      status: "present",
      manual: false
    }))
  });
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.data.validatedCount, 8);
});

test("correction requests update the source record without duplicating the day", async () => {
  const record = await pool.query(
    `SELECT id FROM subject_attendance
     WHERE enrollment_id = $1 AND subject_id = 42 AND attendance_date = '2026-06-09'`,
    [state.roster[0].enrollmentId]
  );
  let response = await auth(sessions.teacher, sessions.teacher.agent.post("/api/attendance/corrections")).send({
    subjectAttendanceId: record.rows[0].id,
    status: "tardy",
    reason: "Learner arrived after roll call and was recorded present by mistake."
  });
  assert.equal(response.status, 201, response.text);
  const correctionId = response.body.data.id;

  response = await auth(sessions.adviser, sessions.adviser.agent.post(`/api/attendance/corrections/${correctionId}/review`)).send({
    decision: "approved",
    reviewNotes: "Verified with the class logbook."
  });
  assert.equal(response.status, 200, response.text);

  const corrected = await pool.query("SELECT status FROM subject_attendance WHERE id = $1", [
    record.rows[0].id
  ]);
  assert.equal(corrected.rows[0].status, "tardy");
  const stillOnce = await pool.query(
    `SELECT COUNT(*)::int AS n, MIN(status) AS status FROM adviser_attendance
     WHERE enrollment_id = $1 AND attendance_date = '2026-06-09'`,
    [state.roster[0].enrollmentId]
  );
  assert.equal(stillOnce.rows[0].n, 1);
  assert.equal(stillOnce.rows[0].status, "present");
});

test("term summaries distinguish a real term from the full school year", async () => {
  let response = await sessions.adviser.agent.get(
    `/api/attendance/term-summary?sectionId=${SECTION_ID}&schoolYearId=${YEAR_ID}&termNo=1`
  );
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.data.term.termNo, 1);
  assert.equal(response.body.data.term.status, "approved");
  assert.ok(response.body.data.totals.present >= 8);
  assert.equal(response.body.data.totals.recorded, response.body.data.totals.present + response.body.data.totals.absent + response.body.data.totals.tardy + response.body.data.totals.excused + response.body.data.totals.half_day);

  response = await sessions.adviser.agent.get(
    `/api/attendance/term-summary?sectionId=${SECTION_ID}&schoolYearId=${YEAR_ID}`
  );
  assert.equal(response.status, 200, response.text);
  assert.equal(response.body.data.term.termNo, null);
  assert.equal(response.body.data.term.status, null, "full-year summary is not a draft term");
});

test("all three terms are detected from dates on the matrix header", async () => {
  for (const term of state.terms.terms) {
    const date = new Date(`${term.startsOn}T00:00:00Z`);
    while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
      date.setUTCDate(date.getUTCDate() + 1);
    }
    const response = await sessions.teacher.agent.get(
      `/api/attendance/subject/matrix?sectionId=${SECTION_ID}&schoolYearId=${YEAR_ID}&subjectId=42&mode=day&date=${date
        .toISOString()
        .slice(0, 10)}`
    );
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.data.dates[0].term.termNo, term.termNo);
  }
});

test("students of another district cannot read this school's attendance", async () => {
  const response = await sessions.south.agent.get(
    `/api/attendance/subject/matrix?sectionId=${SECTION_ID}&schoolYearId=${YEAR_ID}&subjectId=42&date=2026-06-08`
  );
  assert.ok([403, 404].includes(response.status), response.text);
});
