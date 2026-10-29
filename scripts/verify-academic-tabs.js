"use strict";

// Local verification for the learner-profile academic tabs and learner-scoped
// SF 9 / SF 10 submissions. Run against the disposable verification database:
//   DATABASE_URL=... SESSION_SECRET=... node scripts/verify-academic-tabs.js

process.env.NODE_ENV = process.env.NODE_ENV || "test";

const request = require("supertest");
const app = require("../server/app");
const { pool } = require("../server/config/database");

async function login(identifier, password) {
  const agent = request.agent(app);
  const csrf = await agent.get("/api/auth/csrf");
  const token = csrf.body.data.csrfToken;
  const response = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", token)
    .send({ identifier, password });
  if (response.status !== 200) {
    throw new Error(`Login failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return { agent, csrfToken: response.body.data.csrfToken || token };
}

async function main() {
  const learner = await pool.query(
    `SELECT l.id, l.lrn FROM learners l
     JOIN enrollments e ON e.learner_id = l.id
     WHERE e.school_id = 1 AND e.school_year_id = 2
     ORDER BY l.id LIMIT 2`
  );
  const [first, second] = learner.rows;
  if (!first || !second) {
    throw new Error("Verification learners are missing.");
  }

  const session = await login("northhead", "Demo@2026");
  const agent = session.agent;

  const calls = [
    ["attendance", `/api/attendance/learner/${first.id}?schoolYearId=2`],
    ["grades", `/api/grades/learners/${first.id}`],
    ["books", `/api/books/issuances?learnerId=${first.id}&pageSize=10`],
    ["health", `/api/health/learners/${first.id}`],
    ["forms cards", "/api/school-forms/cards?schoolId=1&schoolYearId=2"],
    ["learner submissions", `/api/school-forms/submissions?schoolId=1&schoolYearId=2&learnerId=${first.id}`]
  ];
  for (const [label, url] of calls) {
    const response = await agent.get(url);
    console.log(label, response.status, response.status === 200 ? "ok" : JSON.stringify(response.body));
    if (response.status !== 200) {
      process.exitCode = 1;
    }
  }

  for (const row of [first, second]) {
    const response = await agent
      .post("/api/school-forms/generate/sf10")
      .set("X-CSRF-Token", session.csrfToken)
      .send({ schoolId: 1, schoolYearId: 2, learnerId: row.id });
    console.log("generate sf10", row.lrn, response.status, response.body.data ? response.body.data.status : JSON.stringify(response.body));
  }

  const rows = await pool.query(
    `SELECT id, learner_id, section_id, form_code, status
     FROM form_submissions WHERE form_code = 'sf10' AND school_id = 1 AND school_year_id = 2
       AND learner_id = ANY($1::bigint[]) ORDER BY learner_id`,
    [[first.id, second.id]]
  );
  console.log("sf10 rows", rows.rows);
  if (rows.rows.length !== 2) {
    console.error("Expected one SF 10 submission per learner.");
    process.exitCode = 1;
  }
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await pool.end().catch(() => {});
});
