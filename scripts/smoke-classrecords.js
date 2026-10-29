"use strict";

// Manual end-to-end verification for the Class Record -> Adviser -> SF 9 workflow.
// Usage:
//   NODE_ENV=test DATABASE_URL=... SESSION_SECRET=... node scripts/smoke-classrecords.js
//
// The script creates a class record for one seeded subject, encodes full Q1
// scores, submits the quarter, accepts it as adviser, then checks the
// consolidated grade. Verification rows are removed before exit unless
// KEEP_SMOKE_DATA=1 is set.

process.env.NODE_ENV = process.env.NODE_ENV || "test";

const request = require("supertest");
const app = require("../server/app");
const { pool } = require("../server/config/database");
const { ensurePermissionCatalog } = require("../server/services/permissionService");

const CREDENTIALS = {
  teacher: { identifier: "northteacher", password: "Demo@2026" },
  adviser: { identifier: "northadviser", password: "Demo@2026" },
  head: { identifier: "northhead", password: "Demo@2026" }
};

const KEEP = process.env.KEEP_SMOKE_DATA === "1";

async function login(key) {
  const agent = request.agent(app);
  const csrf = await agent.get("/api/auth/csrf");
  const token = csrf.body.data.csrfToken;
  const response = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", token)
    .send(CREDENTIALS[key]);
  if (response.status !== 200) {
    throw new Error(`Login failed for ${key}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return { agent, csrfToken: response.body.data.csrfToken || token };
}

function check(label, condition, detail) {
  if (condition) {
    console.log(`ok   ${label}`);
    return true;
  }
  console.log(`FAIL ${label}`, detail === undefined ? "" : JSON.stringify(detail).slice(0, 500));
  process.exitCode = 1;
  return false;
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

async function main() {
  await ensurePermissionCatalog();

  const teacher = await login("teacher");
  const adviser = await login("adviser");
  const head = await login("head");

  const dashboard = await teacher.agent.get("/api/class-records/dashboard");
  check(
    "teacher dashboard",
    dashboard.status === 200 && Array.isArray(dashboard.body.data.items),
    dashboard.body
  );

  const assignment = await pool.query(
    `SELECT ta.id AS assignment_id, ta.section_id, ta.subject_id, ta.school_year_id,
            sec.name AS section_name, sub.code
     FROM teacher_assignments ta
     JOIN sections sec ON sec.id = ta.section_id
     JOIN subjects sub ON sub.id = ta.subject_id
     JOIN users u ON u.id = ta.teacher_id
     WHERE u.username = 'northteacher' AND sub.code = 'ENG6'
     LIMIT 1`
  );
  if (!assignment.rows[0]) {
    throw new Error("Seeded ENG6 assignment for northteacher is missing.");
  }
  const scope = assignment.rows[0];
  console.log("scope", scope);

  const stale = await pool.query(
    `SELECT id FROM class_records
     WHERE school_year_id = $1 AND section_id = $2 AND subject_id = $3`,
    [Number(scope.school_year_id), Number(scope.section_id), Number(scope.subject_id)]
  );
  for (const row of stale.rows) {
    await removeRecord(row.id);
  }
  await pool.query(
    `DELETE FROM report_card_revisions
     WHERE report_card_id IN (SELECT id FROM report_cards WHERE section_id = $1 AND school_year_id = $2)`,
    [Number(scope.section_id), Number(scope.school_year_id)]
  );
  await pool.query("DELETE FROM report_cards WHERE section_id = $1 AND school_year_id = $2", [
    Number(scope.section_id),
    Number(scope.school_year_id)
  ]);

  const initialized = await teacher.agent
    .post("/api/class-records")
    .set("X-CSRF-Token", teacher.csrfToken)
    .send({
      sectionId: Number(scope.section_id),
      subjectId: Number(scope.subject_id),
      schoolYearId: Number(scope.school_year_id),
      assignmentId: Number(scope.assignment_id)
    });
  check("initialize class record", initialized.status === 201, initialized.body);
  const record = initialized.body.data;
  const recordId = record.record.id;
  const roster = record.roster;
  check("roster loaded", roster.length > 0, roster.slice(0, 2));
  check("template weights configured", record.template.config.components.every((c) => c.weight > 0), record.template);

  const assessments = [];
  for (const [componentKey, title, maxScore, sortOrder] of [
    ["ww", "Written Work 1", 20, 1],
    ["pt", "Performance Task 1", 30, 2],
    ["qa", "Quarterly Assessment", 50, 3]
  ]) {
    const created = await teacher.agent
      .post(`/api/class-records/${recordId}/assessments`)
      .set("X-CSRF-Token", teacher.csrfToken)
      .send({ period: "q1", componentKey, title, maxScore, sortOrder, assessmentDate: "2026-08-15" });
    const saved =
      created.body.data &&
      created.body.data.assessments.find(
        (row) => row.title === title && row.period === "q1" && row.isActive !== false
      );
    check(`assessment ${componentKey}`, created.status === 200 && Boolean(saved), created.body);
    if (saved) {
      assessments.push(saved);
    }
  }
  if (assessments.length !== 3) {
    throw new Error("Assessments were not created; aborting before score encoding.");
  }

  const entries = [];
  roster.forEach((learner, index) => {
    assessments.forEach((assessment, position) => {
      // Deterministic spread that includes a genuine zero for one learner.
      const ratio = position === 2 ? 0.6 + 0.05 * (index % 5) : 0.7 + 0.03 * ((index + position) % 7);
      const raw = index === 0 && position === 0 ? 0 : Math.round(Number(assessment.maxScore) * ratio);
      entries.push({
        assessmentId: assessment.id,
        enrollmentId: learner.enrollmentId,
        score: raw
      });
    });
  });

  const saved = await teacher.agent
    .put(`/api/class-records/${recordId}/scores`)
    .set("X-CSRF-Token", teacher.csrfToken)
    .send({ period: "q1", entries });
  check("save scores", saved.status === 200, saved.body);

  const detail = await teacher.agent.get(`/api/class-records/${recordId}`);
  const q1 = detail.body.data.computation.periods.q1;
  check("quarter complete", q1.complete === true, q1.issues);
  const sampleLearner = q1.learners[String(roster[0].enrollmentId)];
  check("computed initial grade", Number.isFinite(sampleLearner.initialGrade), sampleLearner);
  check("computed quarterly grade", Number.isFinite(sampleLearner.quarterlyGrade), sampleLearner);
  const zeroLearner = q1.learners[String(roster[0].enrollmentId)];
  const zeroComponent = zeroLearner.components.find((component) => component.key === "ww");
  check("genuine zero kept", zeroComponent && zeroComponent.total === 0, zeroComponent);

  const submitted = await teacher.agent
    .post(`/api/class-records/${recordId}/submit`)
    .set("X-CSRF-Token", teacher.csrfToken)
    .send({ period: "q1", notes: "Q1 scores complete" });
  const q1Submission =
    submitted.body.data &&
    submitted.body.data.submissions.find((row) => row.period === "q1");
  check(
    "submit quarter",
    submitted.status === 200 && q1Submission && q1Submission.status === "submitted",
    submitted.body
  );
  const submissionId = q1Submission ? q1Submission.id : null;
  if (!submissionId) {
    throw new Error("Quarter was not submitted; aborting review checks.");
  }

  const blockedResubmit = await teacher.agent
    .post(`/api/class-records/${recordId}/submit`)
    .set("X-CSRF-Token", teacher.csrfToken)
    .send({ period: "q1" });
  check("resubmit blocked while submitted", blockedResubmit.status === 409, blockedResubmit.body);

  const adviserView = await adviser.agent.get("/api/class-records/adviser/overview");
  check("adviser overview", adviserView.status === 200 && adviserView.body.data.sections.length > 0, adviserView.body);

  const submission = await adviser.agent.get(`/api/class-records/submissions/${submissionId}`);
  check("submission detail", submission.status === 200 && submission.body.data.items.length > 0, submission.body);

  const outsider = await head.agent.get(`/api/class-records/submissions/${submissionId}`);
  check("school head can read submission", outsider.status === 200, outsider.body.code);

  const accepted = await adviser.agent
    .post(`/api/class-records/submissions/${submissionId}/accept`)
    .set("X-CSRF-Token", adviser.csrfToken)
    .send({ comments: "Checked against encoded scores" });
  check(
    "adviser accepts quarter",
    accepted.status === 200 && accepted.body.data.submission.status === "accepted",
    accepted.body
  );

  const grades = await pool.query(
    `SELECT period, status, grade, class_record_id, source
     FROM grade_records
     WHERE class_record_id = $1 AND period = 'q1'
     ORDER BY enrollment_id`,
    [recordId]
  );
  check(
    "accepted quarter finalized in grade_records",
    grades.rows.length === roster.length && grades.rows.every((row) => row.status === "finalized"),
    grades.rows.slice(0, 3)
  );

  const consolidation = await adviser.agent.get(
    `/api/class-records/consolidation?sectionId=${scope.section_id}&schoolYearId=${scope.school_year_id}`
  );
  check("adviser consolidation", consolidation.status === 200, consolidation.body);
  const firstLearner = consolidation.body.data.learners[0];
  const eng6 = firstLearner && firstLearner.subjects.find((row) => row.subjectCode === "ENG6");
  check(
    "consolidation shows accepted subject",
    eng6 && eng6.quarters.q1.grade !== null && eng6.quarters.q1.accepted === true,
    eng6
  );

  const templateRead = await adviser.agent.get("/api/class-records/templates");
  check("template readable", templateRead.status === 200, templateRead.body);

  const templateWrite = await head.agent
    .put("/api/class-records/templates")
    .set("X-CSRF-Token", head.csrfToken)
    .send({
      gradeLevelId: Number(record.record.gradeLevelId),
      subjectId: Number(record.record.subjectId),
      name: "Smoke test configuration",
      sourceNote: "Smoke test configuration; not an official DepEd policy.",
      config: {
        components: [
          { key: "ww", label: "Written Work", weight: 0.3 },
          { key: "pt", label: "Performance Tasks", weight: 0.5 },
          { key: "qa", label: "Quarterly Assessment", weight: 0.2 }
        ],
        rounding: "nearest_whole",
        transmutation: { mode: "none" }
      }
    });
  check("school head configures template", templateWrite.status === 200, templateWrite.body);

  // Report card pipeline. Only ENG6 has accepted class-record grades at this
  // point, so the first generation must report the card as incomplete.
  const yearId = Number(scope.school_year_id);
  const sectionId = Number(scope.section_id);
  const generatedIncomplete = await adviser.agent
    .post("/api/class-records/report-cards/generate")
    .set("X-CSRF-Token", adviser.csrfToken)
    .send({ sectionId, schoolYearId: yearId });
  check("report cards generate", generatedIncomplete.status === 200, generatedIncomplete.body);
  const firstCard = generatedIncomplete.body.data.items.find(
    (item) => item.enrollmentId === roster[0].enrollmentId
  );
  check(
    "incomplete card reported",
    firstCard && firstCard.complete === false,
    firstCard && { complete: firstCard.complete, missing: firstCard.missingSubjects.length }
  );

  // Verification-only fixture: finalize the remaining offered subjects so the
  // snapshot and rendering paths can be exercised. Production users can only
  // reach this state through adviser acceptance of subject teacher submissions.
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
         VALUES ($1, $2, $3, $4, 87, 'finalized', 'smoke_fixture', $5, $5)
         ON CONFLICT (enrollment_id, subject_id, period) DO UPDATE SET
           grade = EXCLUDED.grade, status = 'finalized', updated_at = now()`,
        [roster[0].enrollmentId, subject.id, yearId, period, 1]
      );
    }
    await pool.query(
      `INSERT INTO grade_records
         (enrollment_id, subject_id, school_year_id, period, grade, status, source, created_by, updated_by)
       VALUES ($1, $2, $3, 'final', 88, 'finalized', 'smoke_fixture', $4, $4)
       ON CONFLICT (enrollment_id, subject_id, period) DO UPDATE SET
         grade = EXCLUDED.grade, status = 'finalized', updated_at = now()`,
      [roster[0].enrollmentId, subject.id, yearId, 1]
    );
  }

  const regenerated = await adviser.agent
    .post("/api/class-records/report-cards/generate")
    .set("X-CSRF-Token", adviser.csrfToken)
    .send({ sectionId, schoolYearId: yearId });
  const readyCard = regenerated.body.data.items.find(
    (item) => item.enrollmentId === roster[0].enrollmentId
  );
  check("card becomes ready", readyCard && readyCard.complete === true, readyCard);

  const finalizedCard = await adviser.agent
    .post(`/api/class-records/report-cards/${readyCard.id}/finalize`)
    .set("X-CSRF-Token", adviser.csrfToken)
    .send({ reason: "Smoke verification of the finalized snapshot" });
  check(
    "finalize report card",
    finalizedCard.status === 200 && finalizedCard.body.data.status === "finalized",
    finalizedCard.body
  );

  const frozen = await adviser.agent.get(`/api/class-records/report-cards/${readyCard.id}`);
  check(
    "snapshot is frozen",
    frozen.status === 200 && frozen.body.data.card.frozen === true,
    frozen.body.data && frozen.body.data.card
  );

  const pdf = await adviser.agent.get(`/api/class-records/report-cards/${readyCard.id}/render?format=pdf`);
  check(
    "report card PDF",
    pdf.status === 200 && pdf.headers["content-type"].includes("application/pdf") && pdf.body.length > 1000,
    { status: pdf.status, type: pdf.headers["content-type"], size: pdf.body && pdf.body.length }
  );

  const batchPdf = await adviser.agent.get(
    `/api/class-records/report-cards/batch?sectionId=${sectionId}&schoolYearId=${yearId}&format=pdf`
  );
  check(
    "batch report card PDF",
    batchPdf.status === 200 && batchPdf.headers["content-type"].includes("application/pdf"),
    { status: batchPdf.status, type: batchPdf.headers["content-type"] }
  );

  const csv = await adviser.agent.get(
    `/api/class-records/report-cards/export?sectionId=${sectionId}&schoolYearId=${yearId}`
  );
  check(
    "report card CSV",
    csv.status === 200 && String(csv.text || "").includes("LRN") && String(csv.text || "").includes("ENG6 Final"),
    csv.body
  );

  const reopen = await adviser.agent
    .post(`/api/class-records/report-cards/${readyCard.id}/reopen`)
    .set("X-CSRF-Token", adviser.csrfToken)
    .send({ reason: "Verification reopened the card to test the audit trail" });
  check("reopen report card", reopen.status === 200 && reopen.body.data.status === "reopened", reopen.body);

  const refinalize = await adviser.agent
    .post(`/api/class-records/report-cards/${readyCard.id}/finalize`)
    .set("X-CSRF-Token", adviser.csrfToken)
    .send({ reason: "Re-finalized after verification reopen" });
  check(
    "re-finalize increments version",
    refinalize.status === 200 && refinalize.body.data.version === 3,
    refinalize.body
  );

  if (!KEEP) {
    await pool.query(
      `DELETE FROM report_card_revisions
       WHERE report_card_id IN (SELECT id FROM report_cards WHERE section_id = $1 AND school_year_id = $2)`,
      [sectionId, yearId]
    );
    await pool.query("DELETE FROM report_cards WHERE section_id = $1 AND school_year_id = $2", [
      sectionId,
      yearId
    ]);
    await pool.query("DELETE FROM grade_records WHERE enrollment_id = $1 AND school_year_id = $2", [
      roster[0].enrollmentId,
      yearId
    ]);
  }

  if (!KEEP) {
    await removeRecord(recordId);
    await pool.query("DELETE FROM class_record_templates WHERE name = 'Smoke test configuration'");
    console.log("verification rows removed");
  }
}

main()
  .then(async () => {
    await pool.end();
  })
  .catch(async (error) => {
    console.error("SMOKE FAILED", error);
    try {
      await pool.end();
    } catch (ignored) {}
    process.exitCode = 1;
  });
