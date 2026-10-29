"use strict";

// Acceptance tests for the Class Record -> Subject Teacher -> Class Adviser ->
// SF 9 workflow. Covers score computation, missing-versus-zero handling, the
// return/resubmission loop, role and school boundaries, report card
// finalization, frozen snapshots, reopen history, PDF/CSV output, and learner
// self-access.
//
// Run against a disposable or verification database: the suite creates and
// then removes class records, grade fixtures, and report cards for one seeded
// section. It does not alter seeds outside that scope.
process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const app = require("../server/app");
const { pool } = require("../server/config/database");
const { ensurePermissionCatalog } = require("../server/services/permissionService");

const ACCOUNTS = {
  teacher: { username: "northteacher", password: "Demo@2026" },
  adviser: { username: "northadviser", password: "Demo@2026" },
  head: { username: "northhead", password: "Demo@2026" },
  learner: { username: "northlearner", password: "Demo@2026" },
  southAdmin: { username: "southadmin", password: "District@2026" }
};

const sessions = {};
const scope = {};
const created = { recordId: null, assessmentIds: [], submissionIds: [], cardIds: [] };
let originalTemplate = null;

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

async function removeRecord(recordId) {
  await pool.query(
    "DELETE FROM grade_submission_reviews WHERE submission_id IN (SELECT id FROM grade_submissions WHERE class_record_id = $1)",
    [recordId]
  );
  await pool.query(
    "DELETE FROM grade_submission_items WHERE submission_id IN (SELECT id FROM grade_submissions WHERE class_record_id = $1)",
    [recordId]
  );
  await pool.query("DELETE FROM grade_submissions WHERE class_record_id = $1", [recordId]);
  await pool.query("DELETE FROM grade_records WHERE class_record_id = $1", [recordId]);
  await pool.query("DELETE FROM class_record_scores WHERE class_record_id = $1", [recordId]);
  await pool.query("DELETE FROM class_record_assessments WHERE class_record_id = $1", [recordId]);
  await pool.query("DELETE FROM class_record_grades WHERE class_record_id = $1", [recordId]);
  await pool.query("DELETE FROM class_records WHERE id = $1", [recordId]);
}

async function clearScope() {
  const stale = await pool.query(
    `SELECT id FROM class_records
     WHERE school_year_id = $1 AND section_id = $2 AND subject_id = $3`,
    [scope.yearId, scope.sectionId, scope.subjectId]
  );
  for (const row of stale.rows) {
    await removeRecord(row.id);
  }
  await pool.query(
    `DELETE FROM report_card_revisions
     WHERE report_card_id IN (SELECT id FROM report_cards WHERE section_id = $1 AND school_year_id = $2)`,
    [scope.sectionId, scope.yearId]
  );
  await pool.query("DELETE FROM report_cards WHERE section_id = $1 AND school_year_id = $2", [
    scope.sectionId,
    scope.yearId
  ]);
  await pool.query(
    "DELETE FROM grade_records WHERE source IN ('cr_test_fixture', 'smoke_fixture') AND school_year_id = $1",
    [scope.yearId]
  );
}

before(async () => {
  await ensurePermissionCatalog();
  for (const [key, credentials] of Object.entries(ACCOUNTS)) {
    sessions[key] = await login(credentials);
  }

  const assignment = await pool.query(
    `SELECT ta.section_id, ta.subject_id, ta.school_year_id, ta.id AS assignment_id,
            sec.grade_level_id, sec.school_id
     FROM teacher_assignments ta
     JOIN sections sec ON sec.id = ta.section_id
     JOIN subjects sub ON sub.id = ta.subject_id
     JOIN users u ON u.id = ta.teacher_id
     WHERE u.username = 'northteacher' AND sub.code = 'ENG6'
     LIMIT 1`
  );
  assert.ok(assignment.rows[0], "seeded ENG6 assignment for northteacher is required");
  Object.assign(scope, {
    sectionId: Number(assignment.rows[0].section_id),
    subjectId: Number(assignment.rows[0].subject_id),
    yearId: Number(assignment.rows[0].school_year_id),
    assignmentId: Number(assignment.rows[0].assignment_id),
    gradeLevelId: Number(assignment.rows[0].grade_level_id),
    schoolId: Number(assignment.rows[0].school_id)
  });

  const template = await pool.query(
    `SELECT * FROM class_record_templates
     WHERE school_id = $1 AND grade_level_id = $2 AND (subject_id = $3 OR subject_id IS NULL)
     ORDER BY subject_id NULLS LAST, id ASC LIMIT 1`,
    [scope.schoolId, scope.gradeLevelId, scope.subjectId]
  );
  if (template.rows[0]) {
    originalTemplate = {
      id: template.rows[0].id,
      name: template.rows[0].name,
      sourceNote: template.rows[0].source_note,
      config: template.rows[0].config
    };
  }

  await clearScope();
});

after(async () => {
  for (const recordId of [created.recordId]) {
    if (recordId) {
      await removeRecord(recordId);
    }
  }
  await clearScope();
  if (originalTemplate) {
    await pool.query(
      "UPDATE class_record_templates SET name = $1, source_note = $2, config = $3, updated_at = now() WHERE id = $4",
      [
        originalTemplate.name,
        originalTemplate.sourceNote,
        originalTemplate.config,
        originalTemplate.id
      ]
    );
  }
  await pool.end();
});

test("class record to SF 9 workflow", async (t) => {
  const teacher = sessions.teacher;
  const adviser = sessions.adviser;
  const head = sessions.head;

  await t.test("teacher dashboard is scoped to the signed-in teacher", async () => {
    const response = await teacher.agent.get("/api/class-records/dashboard");
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(response.body.data.items));
    assert.ok(
      response.body.data.items.every((item) => item.teacherId === teacher.user.id),
      "only the teacher's own assignments should be listed"
    );
  });

  await t.test("learners cannot open class records", async () => {
    const response = await sessions.learner.agent.get("/api/class-records/dashboard");
    assert.equal(response.status, 403);
  });

  const initialized = await teacher.agent
    .post("/api/class-records")
    .set("X-CSRF-Token", teacher.csrfToken)
    .send({
      sectionId: scope.sectionId,
      subjectId: scope.subjectId,
      schoolYearId: scope.yearId,
      assignmentId: scope.assignmentId
    });
  assert.equal(initialized.status, 201, JSON.stringify(initialized.body));
  const detail = initialized.body.data;
  created.recordId = detail.record.id;
  const roster = detail.roster;
  assert.ok(roster.length > 0, "the section should have enrolled learners");
  assert.ok(
    detail.template.config.components.every((component) => component.weight > 0),
    "the seeded template should have configured weights"
  );

  await t.test("initializing the same assignment again returns the same record", async () => {
    const again = await teacher.agent
      .post("/api/class-records")
      .set("X-CSRF-Token", teacher.csrfToken)
      .send({
        sectionId: scope.sectionId,
        subjectId: scope.subjectId,
        schoolYearId: scope.yearId,
        assignmentId: scope.assignmentId
      });
    assert.equal(again.status, 201);
    assert.equal(again.body.data.record.id, created.recordId);
  });

  const assessments = [];
  for (const [componentKey, title, maxScore, sortOrder] of [
    ["ww", "Written Work 1", 20, 1],
    ["pt", "Performance Task 1", 30, 2],
    ["qa", "Quarterly Assessment", 50, 3]
  ]) {
    const response = await teacher.agent
      .post(`/api/class-records/${created.recordId}/assessments`)
      .set("X-CSRF-Token", teacher.csrfToken)
      .send({ period: "q1", componentKey, title, maxScore, sortOrder, assessmentDate: "2026-08-15" });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const saved = response.body.data.assessments.find(
      (assessment) => assessment.title === title && assessment.period === "q1"
    );
    assert.ok(saved, `assessment ${title} should be present`);
    assessments.push(saved);
    created.assessmentIds.push(saved.id);
  }

  await t.test("missing scores are not treated as zero", async () => {
    const [ww, pt] = assessments;
    const partial = await teacher.agent
      .put(`/api/class-records/${created.recordId}/scores`)
      .set("X-CSRF-Token", teacher.csrfToken)
      .send({
        period: "q1",
        entries: [
          { assessmentId: ww.id, enrollmentId: roster[0].enrollmentId, score: 10 },
          { assessmentId: pt.id, enrollmentId: roster[0].enrollmentId, score: null }
        ]
      });
    assert.equal(partial.status, 200);
    const afterPartial = await teacher.agent.get(`/api/class-records/${created.recordId}`);
    const learner = afterPartial.body.data.computation.periods.q1.learners[String(roster[0].enrollmentId)];
    assert.equal(learner.complete, false);
    assert.ok(learner.missing.length >= 2, "the missing PT and QA scores should be reported");
    assert.equal(learner.quarterlyGrade, null, "an incomplete quarter must not produce a grade");
  });

  const entries = [];
  roster.forEach((learner, index) => {
    assessments.forEach((assessment, position) => {
      const ratio = position === 2 ? 0.6 + 0.05 * (index % 5) : 0.7 + 0.03 * ((index + position) % 7);
      const raw = index === 0 && position === 0 ? 0 : Math.round(Number(assessment.maxScore) * ratio);
      entries.push({ assessmentId: assessment.id, enrollmentId: learner.enrollmentId, score: raw });
    });
  });

  const saved = await teacher.agent
    .put(`/api/class-records/${created.recordId}/scores`)
    .set("X-CSRF-Token", teacher.csrfToken)
    .send({ period: "q1", entries });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  await t.test("quarterly grade is computed from configured weights and keeps a genuine zero", async () => {
    const response = await teacher.agent.get(`/api/class-records/${created.recordId}`);
    const q1 = response.body.data.computation.periods.q1;
    assert.equal(q1.complete, true, JSON.stringify(q1.issues));
    const learner = q1.learners[String(roster[0].enrollmentId)];
    assert.ok(Number.isFinite(learner.initialGrade));
    assert.ok(Number.isFinite(learner.quarterlyGrade));
    const ww = learner.components.find((component) => component.key === "ww");
    assert.equal(ww.total, 0, "a genuine zero score must remain zero");
    assert.equal(learner.quarterlyGrade, Math.round(learner.initialGrade), "nearest whole rounding is configured");
  });

  await t.test("the adviser cannot overwrite the teacher's raw scores", async () => {
    const response = await adviser.agent
      .put(`/api/class-records/${created.recordId}/scores`)
      .set("X-CSRF-Token", adviser.csrfToken)
      .send({
        period: "q1",
        entries: [{ assessmentId: assessments[0].id, enrollmentId: roster[0].enrollmentId, score: 20 }]
      });
    assert.equal(response.status, 403);
  });

  await t.test("another district cannot read the class record", async () => {
    const response = await sessions.southAdmin.agent.get(`/api/class-records/${created.recordId}`);
    assert.equal(response.status, 403);
  });

  let submissionId = null;
  const submitted = await teacher.agent
    .post(`/api/class-records/${created.recordId}/submit`)
    .set("X-CSRF-Token", teacher.csrfToken)
    .send({ period: "q1", notes: "Q1 scores complete" });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));
  const received = submitted.body.data.submissions.find((row) => row.period === "q1");
  assert.ok(received && received.status === "submitted");
  submissionId = received.id;
  created.submissionIds.push(submissionId);

  await t.test("a submitted quarter is locked against silent resubmission", async () => {
    const response = await teacher.agent
      .post(`/api/class-records/${created.recordId}/submit`)
      .set("X-CSRF-Token", teacher.csrfToken)
      .send({ period: "q1" });
    assert.equal(response.status, 409);
  });

  await t.test("teachers cannot accept their own submission", async () => {
    const response = await teacher.agent
      .post(`/api/class-records/submissions/${submissionId}/accept`)
      .set("X-CSRF-Token", teacher.csrfToken)
      .send({ comments: "self approval" });
    assert.equal(response.status, 403);
  });

  await t.test("return for correction requires a reason and records history", async () => {
    const short = await adviser.agent
      .post(`/api/class-records/submissions/${submissionId}/return`)
      .set("X-CSRF-Token", adviser.csrfToken)
      .send({ reason: "no" });
    assert.equal(short.status, 400);

    const returned = await adviser.agent
      .post(`/api/class-records/submissions/${submissionId}/return`)
      .set("X-CSRF-Token", adviser.csrfToken)
      .send({ reason: "Please re-check the quarterly assessment scores." });
    assert.equal(returned.status, 200, JSON.stringify(returned.body));
    assert.equal(returned.body.data.submission.status, "returned");
    assert.ok(
      returned.body.data.reviews.some((review) => review.action === "returned"),
      "the return should appear in the review history"
    );
  });

  const resubmitted = await teacher.agent
    .post(`/api/class-records/${created.recordId}/submit`)
    .set("X-CSRF-Token", teacher.csrfToken)
    .send({ period: "q1", notes: "Corrected and resubmitted" });
  assert.equal(resubmitted.status, 200, JSON.stringify(resubmitted.body));
  const resubmission = resubmitted.body.data.submissions.find((row) => row.period === "q1");
  assert.equal(resubmission.status, "submitted");
  assert.equal(resubmission.version, 2, "resubmission should increment the version");
  submissionId = resubmission.id;
  created.submissionIds.push(submissionId);

  await t.test("school head can read but is not the reviewing adviser", async () => {
    const read = await head.agent.get(`/api/class-records/submissions/${submissionId}`);
    assert.equal(read.status, 200);
  });

  const accepted = await adviser.agent
    .post(`/api/class-records/submissions/${submissionId}/accept`)
    .set("X-CSRF-Token", adviser.csrfToken)
    .send({ comments: "Checked against encoded scores" });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.data.submission.status, "accepted");
  assert.ok(accepted.body.data.reviews.some((review) => review.action === "accepted"));

  await t.test("acceptance finalizes grade_records without changing raw scores", async () => {
    const grades = await pool.query(
      `SELECT period, status, grade, class_record_id, source
       FROM grade_records WHERE class_record_id = $1 AND period = 'q1'`,
      [created.recordId]
    );
    assert.equal(grades.rows.length, roster.length);
    assert.ok(grades.rows.every((row) => row.status === "finalized"));
    const scores = await pool.query(
      `SELECT COUNT(*)::int AS count FROM class_record_scores
       WHERE class_record_id = $1 AND assessment_id = $2`,
      [created.recordId, assessments[0].id]
    );
    assert.equal(scores.rows[0].count, roster.length);
  });

  await t.test("consolidation shows accepted quarters only", async () => {
    const response = await adviser.agent.get(
      `/api/class-records/consolidation?sectionId=${scope.sectionId}&schoolYearId=${scope.yearId}`
    );
    assert.equal(response.status, 200);
    const subject = response.body.data.learners[0].subjects.find((row) => row.subjectCode === "ENG6");
    assert.ok(subject, "ENG6 should appear in consolidation");
    assert.equal(subject.quarters.q1.accepted, true);
    assert.ok(Number.isFinite(subject.quarters.q1.grade));
  });

  await t.test("teachers cannot generate or finalize report cards", async () => {
    const generated = await teacher.agent
      .post("/api/class-records/report-cards/generate")
      .set("X-CSRF-Token", teacher.csrfToken)
      .send({ sectionId: scope.sectionId, schoolYearId: scope.yearId });
    assert.equal(generated.status, 403);
  });

  const generated = await adviser.agent
    .post("/api/class-records/report-cards/generate")
    .set("X-CSRF-Token", adviser.csrfToken)
    .send({ sectionId: scope.sectionId, schoolYearId: scope.yearId });
  assert.equal(generated.status, 200, JSON.stringify(generated.body));
  generated.body.data.items.forEach((item) => created.cardIds.push(item.id));
  const firstCard = generated.body.data.items.find(
    (item) => item.enrollmentId === roster[0].enrollmentId
  );
  assert.ok(firstCard && firstCard.complete === false, "only ENG6 has an accepted quarter");

  await t.test("an incomplete card cannot be finalized", async () => {
    const response = await adviser.agent
      .post(`/api/class-records/report-cards/${firstCard.id}/finalize`)
      .set("X-CSRF-Token", adviser.csrfToken)
      .send({ reason: "" });
    assert.equal(response.status, 409);
    assert.equal(response.body.code, "REPORT_CARD_INCOMPLETE");
  });

  // Verification-only fixture: finalize the remaining offered subjects so the
  // snapshot, rendering, and reopen paths can be exercised. Production users
  // reach this state through adviser acceptance of every subject teacher.
  const offered = await pool.query(
    `SELECT sub.id FROM subjects sub
     JOIN enrollments e ON e.id = $1
     WHERE sub.school_id = e.school_id
       AND (sub.grade_level_id = e.grade_level_id OR sub.grade_level_id IS NULL)`,
    [roster[0].enrollmentId]
  );
  for (const subject of offered.rows) {
    for (const period of ["q2", "q3", "q4"]) {
      await pool.query(
        `INSERT INTO grade_records
           (enrollment_id, subject_id, school_year_id, period, grade, status, source, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 87, 'finalized', 'cr_test_fixture', $5, $5)
         ON CONFLICT (enrollment_id, subject_id, period) DO UPDATE SET
           grade = EXCLUDED.grade, status = 'finalized', updated_at = now()`,
        [roster[0].enrollmentId, subject.id, scope.yearId, period, teacher.user.id]
      );
    }
    await pool.query(
      `INSERT INTO grade_records
         (enrollment_id, subject_id, school_year_id, period, grade, status, source, created_by, updated_by)
       VALUES ($1, $2, $3, 'final', 88, 'finalized', 'cr_test_fixture', $4, $4)
       ON CONFLICT (enrollment_id, subject_id, period) DO UPDATE SET
         grade = EXCLUDED.grade, status = 'finalized', updated_at = now()`,
      [roster[0].enrollmentId, subject.id, scope.yearId, teacher.user.id]
    );
  }

  const regenerated = await adviser.agent
    .post("/api/class-records/report-cards/generate")
    .set("X-CSRF-Token", adviser.csrfToken)
    .send({ sectionId: scope.sectionId, schoolYearId: scope.yearId });
  assert.equal(regenerated.status, 200);
  const readyCard = regenerated.body.data.items.find(
    (item) => item.enrollmentId === roster[0].enrollmentId
  );
  assert.ok(readyCard && readyCard.complete === true, "the card should be ready after the fixture finals");

  await t.test("teacher cannot finalize a report card", async () => {
    const response = await teacher.agent
      .post(`/api/class-records/report-cards/${readyCard.id}/finalize`)
      .set("X-CSRF-Token", teacher.csrfToken)
      .send({ reason: "teacher attempt" });
    assert.equal(response.status, 403);
  });

  const finalized = await adviser.agent
    .post(`/api/class-records/report-cards/${readyCard.id}/finalize`)
    .set("X-CSRF-Token", adviser.csrfToken)
    .send({ reason: "End of quarter validation" });
  assert.equal(finalized.status, 200, JSON.stringify(finalized.body));
  assert.equal(finalized.body.data.status, "finalized");

  await t.test("a finalized card uses a frozen snapshot", async () => {
    const before = await adviser.agent.get(`/api/class-records/report-cards/${readyCard.id}`);
    assert.equal(before.status, 200);
    const frozenAverage = before.body.data.data.generalAverage;
    const eng6 = before.body.data.data.subjects.find((subject) => subject.code === "ENG6");
    assert.ok(eng6);
    await pool.query(
      `UPDATE grade_records SET grade = 99, status = 'finalized', updated_at = now()
       WHERE enrollment_id = $1 AND subject_id = $2 AND school_year_id = $3 AND period = 'final'`,
      [roster[0].enrollmentId, scope.subjectId, scope.yearId]
    );
    try {
      const afterChange = await adviser.agent.get(`/api/class-records/report-cards/${readyCard.id}`);
      const afterEng6 = afterChange.body.data.data.subjects.find((subject) => subject.code === "ENG6");
      assert.equal(afterChange.body.data.data.generalAverage, frozenAverage);
      assert.equal(afterEng6.final, eng6.final, "the frozen snapshot must ignore later grade edits");
    } finally {
      await pool.query(
        `UPDATE grade_records SET grade = 88, status = 'finalized', updated_at = now()
         WHERE enrollment_id = $1 AND subject_id = $2 AND school_year_id = $3 AND period = 'final'`,
        [roster[0].enrollmentId, scope.subjectId, scope.yearId]
      );
    }
  });

  await t.test("list and detail expose readiness without leaking other scopes", async () => {
    const list = await adviser.agent.get(
      `/api/class-records/report-cards?sectionId=${scope.sectionId}&schoolYearId=${scope.yearId}`
    );
    assert.equal(list.status, 200);
    assert.ok(list.body.data.items.length >= roster.length);
    assert.equal(list.body.data.totals.finalized >= 1, true);
  });

  await t.test("learners cannot open class record or report card APIs", async () => {
    const own = await pool.query("SELECT id FROM learners WHERE user_id = $1", [sessions.learner.user.id]);
    assert.ok(own.rows[0], "the learner account should be linked to a learner profile");
    const ownEnrollment = await pool.query(
      `SELECT id FROM enrollments WHERE learner_id = $1 AND section_id = $2 AND school_year_id = $3`,
      [own.rows[0].id, scope.sectionId, scope.yearId]
    );
    assert.ok(ownEnrollment.rows[0], "the learner should be enrolled in the seeded section");
    const ownCard = generated.body.data.items.find(
      (item) => item.enrollmentId === Number(ownEnrollment.rows[0].id)
    );
    assert.ok(ownCard, "a report card should exist for the learner");
    const read = await sessions.learner.agent.get(`/api/class-records/report-cards/${ownCard.id}`);
    assert.equal(read.status, 403);
    const list = await sessions.learner.agent.get(
      `/api/class-records/report-cards?sectionId=${scope.sectionId}&schoolYearId=${scope.yearId}`
    );
    assert.equal(list.status, 403);
  });

  await t.test("reopen requires a reason and preserves revision history", async () => {
    const short = await adviser.agent
      .post(`/api/class-records/report-cards/${readyCard.id}/reopen`)
      .set("X-CSRF-Token", adviser.csrfToken)
      .send({ reason: "no" });
    assert.equal(short.status, 400);

    const reopened = await adviser.agent
      .post(`/api/class-records/report-cards/${readyCard.id}/reopen`)
      .set("X-CSRF-Token", adviser.csrfToken)
      .send({ reason: "Correct a transposed grade before printing." });
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
    assert.equal(reopened.body.data.status, "reopened");

    const detail = await adviser.agent.get(`/api/class-records/report-cards/${readyCard.id}`);
    assert.ok(detail.body.data.revisions.length >= 1, "the frozen version should remain in history");
    assert.ok(detail.body.data.card.reopenReason);
  });

  await t.test("refinalizing increments the version", async () => {
    const detail = await adviser.agent.get(`/api/class-records/report-cards/${readyCard.id}`);
    const previous = Number(detail.body.data.card.version);
    const again = await adviser.agent
      .post(`/api/class-records/report-cards/${readyCard.id}/finalize`)
      .set("X-CSRF-Token", adviser.csrfToken)
      .send({ reason: "Corrected and reissued" });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.data.version, previous + 1);
  });

  await t.test("individual HTML, PDF, batch PDF, and CSV output render", async () => {
    const html = await adviser.agent.get(
      `/api/class-records/report-cards/${readyCard.id}/render?format=html`
    );
    assert.equal(html.status, 200);
    assert.match(html.text, /<!DOCTYPE html>/i);

    const pdf = await adviser.agent
      .get(`/api/class-records/report-cards/${readyCard.id}/render?format=pdf`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers["content-type"], "application/pdf");
    assert.equal(pdf.body.slice(0, 4).toString(), "%PDF");

    const batch = await adviser.agent
      .get(`/api/class-records/report-cards/batch?sectionId=${scope.sectionId}&schoolYearId=${scope.yearId}&format=pdf`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    assert.equal(batch.status, 200);
    assert.equal(batch.body.slice(0, 4).toString(), "%PDF");

    const csv = await adviser.agent.get(
      `/api/class-records/report-cards/export?sectionId=${scope.sectionId}&schoolYearId=${scope.yearId}`
    );
    assert.equal(csv.status, 200);
    assert.match(csv.text, /Learner/);
    assert.match(csv.text, /ENG6/);
  });
});
