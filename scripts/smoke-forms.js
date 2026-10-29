"use strict";

// Manual verification helper for the School Forms add-on.
// Usage:
//   NODE_ENV=test DATABASE_URL=... SESSION_SECRET=... node scripts/smoke-forms.js

process.env.NODE_ENV = process.env.NODE_ENV || "test";

const request = require("supertest");
const app = require("../server/app");
const { pool } = require("../server/config/database");

const CREDENTIALS = {
  head: { identifier: "northhead", password: "Demo@2026" },
  psds: { identifier: "northpsds", password: "Demo@2026" },
  adviser: { identifier: "northadviser", password: "Demo@2026" },
  learner: { identifier: "northlearner", password: "Demo@2026" },
  southAdmin: { identifier: "southadmin", password: "District@2026" }
};

async function login(person) {
  const agent = request.agent(app);
  const csrf = await agent.get("/api/auth/csrf");
  const token = csrf.body.data.csrfToken;
  const response = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", token)
    .send(CREDENTIALS[person]);
  if (response.status !== 200) {
    throw new Error(`Login failed for ${person}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return { agent, csrfToken: response.body.data.csrfToken || token, user: response.body.data.user };
}

async function pickScope() {
  const school = await pool.query(
    "SELECT id, school_name FROM schools WHERE school_code = 'NES-001'"
  );
  const year = await pool.query(
    "SELECT id, name FROM school_years WHERE is_current = TRUE ORDER BY starts_on DESC LIMIT 1"
  );
  const section = await pool.query(
    "SELECT id, name FROM sections WHERE school_id = $1 AND school_year_id = $2 ORDER BY id LIMIT 1",
    [school.rows[0].id, year.rows[0].id]
  );
  const learner = await pool.query(
    `SELECT l.id FROM learners l JOIN enrollments e ON e.learner_id = l.id
     WHERE e.school_id = $1 AND e.school_year_id = $2 ORDER BY l.id LIMIT 1`,
    [school.rows[0].id, year.rows[0].id]
  );
  return {
    schoolId: school.rows[0].id,
    schoolName: school.rows[0].school_name,
    schoolYearId: year.rows[0].id,
    schoolYearName: year.rows[0].name,
    sectionId: section.rows[0] ? section.rows[0].id : null,
    learnerId: learner.rows[0] ? learner.rows[0].id : null
  };
}

async function main() {
  const scope = await pickScope();
  console.log("Scope", scope);
  const session = await login("head");
  const qs = `schoolId=${scope.schoolId}&schoolYearId=${scope.schoolYearId}`;

  const definitions = await session.agent.get("/api/school-forms/definitions");
  console.log("definitions", definitions.status, definitions.body.data.length);

  const cards = await session.agent.get(`/api/school-forms/cards?${qs}`);
  console.log("cards", cards.status, cards.body.data ? cards.body.data.cards.length : cards.body);

  const monitoring = await session.agent.get(`/api/monitoring?schoolYearId=${scope.schoolYearId}`);
  console.log("monitoring", monitoring.status, monitoring.body.data ? monitoring.body.data.totals : monitoring.body);

  const attempts = [
    ["sf1", `${qs}`],
    ["sf2", `${qs}&sectionId=${scope.sectionId}&month=2026-10`],
    ["sf3", `${qs}`],
    ["sf4", `${qs}&month=2026-10`],
    ["sf5", `${qs}&sectionId=${scope.sectionId}`],
    ["sf6", `${qs}`],
    ["sf7", `${qs}`],
    ["sf8", `${qs}`],
    ["sf9", `${qs}&learnerId=${scope.learnerId}`],
    ["sf9", `${qs}&sectionId=${scope.sectionId}`],
    ["sf10", `${qs}&learnerId=${scope.learnerId}`]
  ];

  for (const [code, query] of attempts) {
    const response = await session.agent.get(`/api/school-forms/preview/${code}?${query}`);
    if (response.status !== 200) {
      console.log(code, response.status, JSON.stringify(response.body).slice(0, 400));
      continue;
    }
    const data = response.body.data.data;
    console.log(
      code,
      response.status,
      `tables=${data.tables.length}`,
      `errors=${data.validation.errors.length}`,
      `warnings=${data.validation.warnings.length}`,
      `completeness=${data.completeness}`,
      `html=${response.body.data.html.length}b`,
      data.validation.errors[0] ? `firstError="${data.validation.errors[0].message.slice(0, 90)}"` : ""
    );
  }

  // Clean any submission left by a previous run for the SF 3 scope.
  await pool.query(
    `DELETE FROM form_submissions
     WHERE form_code = 'sf3' AND school_id = $1 AND school_year_id = $2`,
    [scope.schoolId, scope.schoolYearId]
  );

  const generated = await session.agent
    .post("/api/school-forms/generate/sf3")
    .set("X-CSRF-Token", session.csrfToken)
    .send({ schoolId: scope.schoolId, schoolYearId: scope.schoolYearId });
  console.log("generate sf3", generated.status, generated.body.data && generated.body.data.submission.status);
  const submissionId = generated.body.data ? generated.body.data.submission.id : null;

  if (submissionId) {
    const submitted = await session.agent
      .post(`/api/school-forms/submissions/${submissionId}/submit`)
      .set("X-CSRF-Token", session.csrfToken)
      .send({});
    console.log("submit sf3", submitted.status, submitted.body.data && submitted.body.data.status);
    const approved = await session.agent
      .post(`/api/school-forms/submissions/${submissionId}/approve`)
      .set("X-CSRF-Token", session.csrfToken)
      .send({ comments: "Smoke test approval" });
    console.log("approve sf3", approved.status, approved.body.data && approved.body.data.status);
    const pdf = await session.agent.get(`/api/school-forms/submissions/${submissionId}/render?format=pdf`);
    console.log("pdf sf3", pdf.status, pdf.headers["content-type"], pdf.body ? pdf.body.length : 0);
    const locked = await session.agent
      .post("/api/school-forms/generate/sf3")
      .set("X-CSRF-Token", session.csrfToken)
      .send({ schoolId: scope.schoolId, schoolYearId: scope.schoolYearId });
    console.log("regenerate approved", locked.status, locked.body.code || "unexpected");
    const afterGenerate = await session.agent.get(`/api/school-forms/cards?${qs}`);
    console.log(
      "cards after approve",
      afterGenerate.status,
      afterGenerate.body.data.cards[2].submission
        ? `${afterGenerate.body.data.cards[2].submission.status} v${afterGenerate.body.data.cards[2].submission.version}`
        : null
    );
    await pool.query("DELETE FROM form_submissions WHERE id = $1", [submissionId]);
  }

  const adviser = await login("adviser");
  const adviserHealth = await adviser.agent.get(`/api/school-forms/preview/sf8?${qs}`);
  console.log("adviser sf8", adviserHealth.status, adviserHealth.body.code || "unexpected");
  const adviserForms = await adviser.agent.get(`/api/school-forms/cards?${qs}`);
  console.log("adviser cards", adviserForms.status);

  const learnerSession = await login("learner");
  const learnerCards = await learnerSession.agent.get(`/api/school-forms/cards?${qs}`);
  console.log("learner cards", learnerCards.status, learnerCards.body.code || "unexpected");

  const south = await login("southAdmin");
  const southPreview = await south.agent.get(
    `/api/school-forms/preview/sf1?schoolId=${scope.schoolId}&schoolYearId=${scope.schoolYearId}`
  );
  console.log("south other-school sf1", southPreview.status, southPreview.body.code || "unexpected");
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
