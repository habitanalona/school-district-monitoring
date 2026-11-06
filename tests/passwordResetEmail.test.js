"use strict";

// Password reset email delivery through Mailgun's HTTP API. The HTTP call is
// stubbed so the test never contacts Mailgun.

process.env.NODE_ENV = "test";
process.env.MAILGUN_API_KEY = "test-api-key";
process.env.MAILGUN_DOMAIN = "mg.example.test";
process.env.PUBLIC_BASE_URL = "https://sdms.example.test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcrypt");

const app = require("../server/app");
const { pool } = require("../server/config/database");

const RUN = `MAIL${Date.now().toString(36).slice(-6)}`.toUpperCase();
const USERNAME = `${RUN.toLowerCase()}.user`;
const EMAIL = `${USERNAME}@example.org`;

const mailCalls = [];
const realFetch = global.fetch;
let userId = null;

before(async () => {
  const passwordHash = await bcrypt.hash("ResetPass123!", 12);
  const inserted = await pool.query(
    `INSERT INTO users (full_name, username, email, password_hash, role, is_active, approval_status)
     VALUES ($1, $2, $3, $4, 'system_admin', TRUE, 'active')
     RETURNING id`,
    [`${RUN} Mail User`, USERNAME, EMAIL, passwordHash]
  );
  userId = inserted.rows[0].id;

  global.fetch = async (url, options) => {
    mailCalls.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ id: "stub-message" })
    };
  };
});

after(async () => {
  global.fetch = realFetch;
  await pool.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [userId]);
  await pool.query(
    "DELETE FROM audit_logs WHERE entity_type = 'user' AND entity_id = $1 AND action = 'user.password_reset_requested'",
    [userId]
  );
  await pool.query("DELETE FROM users WHERE id = $1", [userId]);
  await pool.end();
});

async function waitForMail() {
  for (let attempt = 0; attempt < 40 && mailCalls.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

test("forgot password emails a single-use reset link through Mailgun", async () => {
  const agent = request.agent(app);
  const csrfResponse = await agent.get("/api/auth/csrf");
  const csrfToken = csrfResponse.body.data.csrfToken;

  const response = await agent
    .post("/api/auth/forgot-password")
    .set("X-CSRF-Token", csrfToken)
    .send({ identifier: EMAIL });

  assert.equal(response.status, 200);
  assert.equal(
    response.body.data.message,
    "If an account matches those details, a password reset link has been created."
  );

  await waitForMail();
  assert.equal(mailCalls.length, 1, "exactly one Mailgun request should be sent");

  const call = mailCalls[0];
  assert.equal(call.url, "https://api.mailgun.net/v3/mg.example.test/messages");
  assert.equal(
    call.options.headers.Authorization,
    `Basic ${Buffer.from("api:test-api-key").toString("base64")}`
  );

  const body = call.options.body;
  assert.equal(body.get("to"), EMAIL);
  assert.equal(body.get("from"), "School District Monitoring System <no-reply@mg.example.test>");

  const token = new URL(response.body.data.devResetUrl).searchParams.get("token");
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.match(body.get("text"), /https:\/\/sdms\.example\.test\/reset-password\.html\?token=[a-f0-9]{64}/);
  assert.match(body.get("html"), /reset-password\.html\?token=[a-f0-9]{64}/);

  const stored = await pool.query(
    "SELECT token_hash, used_at, expires_at > now() AS live FROM password_reset_tokens WHERE user_id = $1",
    [userId]
  );
  assert.equal(stored.rowCount, 1);
  assert.notEqual(stored.rows[0].token_hash, token, "the raw token must not be stored");
  assert.equal(stored.rows[0].used_at, null);
  assert.equal(stored.rows[0].live, true);
});

test("unknown accounts still receive the generic response and no email", async () => {
  mailCalls.length = 0;

  const agent = request.agent(app);
  const csrfResponse = await agent.get("/api/auth/csrf");
  const csrfToken = csrfResponse.body.data.csrfToken;

  const response = await agent
    .post("/api/auth/forgot-password")
    .set("X-CSRF-Token", csrfToken)
    .send({ identifier: `${RUN.toLowerCase()}.missing@example.org` });

  assert.equal(response.status, 200);
  assert.equal(response.body.data.devResetUrl, null);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(mailCalls.length, 0);
});
