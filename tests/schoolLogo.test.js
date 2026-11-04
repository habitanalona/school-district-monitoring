"use strict";

// School logo upload tests.
//
// Images are generated with sharp, uploaded through the real Express routes,
// and verified end to end: authorization, content validation, re-encoding,
// per-school isolation, replacement/removal, audit rows, and path safety.

process.env.NODE_ENV = "test";

const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const bcrypt = require("bcrypt");
const sharp = require("sharp");

const STORAGE_DIR = path.join(os.tmpdir(), `sdms-logo-test-${process.pid}-${Date.now()}`);
process.env.SCHOOL_LOGO_DIR = STORAGE_DIR;

const app = require("../server/app");
const { pool } = require("../server/config/database");

const PASSWORD = "LogoTst1234";
const SYSTEM = { username: "tst.logosystem", email: "tst.logosystem@example.test", role: "system_admin" };
const NORTH = { username: "tst.logonorth", email: "tst.logonorth@example.test", role: "district_admin" };
const SOUTH = { username: "tst.logosouth", email: "tst.logosouth@example.test", role: "district_admin" };
const TEACHER = { username: "tst.logoteacher", email: "tst.logoteacher@example.test", role: "teacher" };

let system = null;
let north = null;
let south = null;
let teacher = null;
let northDistrictId = null;
let southDistrictId = null;
let schoolA = null;
let schoolB = null;
let schoolC = null;

let png = null;
let jpg = null;
let jpeg = null;
let webp = null;

function binaryParser(res, callback) {
  res.setEncoding("binary");
  let data = "";
  res.on("data", (chunk) => {
    data += chunk;
  });
  res.on("end", () => callback(null, Buffer.from(data, "binary")));
}

async function cleanup() {
  await pool.query(
    `DELETE FROM audit_logs
     WHERE user_id IN (SELECT id FROM users WHERE username LIKE 'tst.logo%')
        OR details->>'school_code' LIKE 'TST-L%'`
  );
  await pool.query("DELETE FROM users WHERE username LIKE $1", ["tst.logo%"]);
  await pool.query("DELETE FROM schools WHERE school_code LIKE $1", ["TST-L%"]);
  await fs.promises.rm(STORAGE_DIR, { recursive: true, force: true });
}

async function createAccount({ username, email, role }, districtId = null, schoolId = null) {
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  await pool.query(
    `INSERT INTO users
       (full_name, username, email, password_hash, role, district_id, school_id, is_active, approval_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 'active')
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role,
           district_id = EXCLUDED.district_id, school_id = EXCLUDED.school_id,
           is_active = TRUE, approval_status = 'active'`,
    [`School Logo ${role}`, username, email, passwordHash, role, districtId, schoolId]
  );
}

async function createSchool(code, name, districtId) {
  const result = await pool.query(
    `INSERT INTO schools
       (school_code, school_name, school_type, address, district_id, school_head,
        contact_email, contact_phone, student_count, teacher_count, status)
     VALUES ($1, $2, 'Elementary School', 'School logo test address', $3,
             'Logo Test Head', 'logo@example.test', '555-0100', 10, 1, 'active')
     RETURNING id`,
    [code, name, districtId]
  );
  return Number(result.rows[0].id);
}

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
    .send({ identifier: credentials.username, password: PASSWORD });
  assert.equal(response.status, 200, `login for ${credentials.username}: ${JSON.stringify(response.body)}`);
  return { agent, csrfToken: response.body.data.csrfToken || token };
}

function upload(actor, schoolId, buffer, filename, contentType) {
  return actor.agent
    .post(`/api/schools/${schoolId}/logo`)
    .set("X-CSRF-Token", actor.csrfToken)
    .attach("logo", buffer, { filename, contentType });
}

async function schoolRow(id) {
  const result = await pool.query("SELECT school_logo FROM schools WHERE id = $1", [id]);
  return result.rows[0];
}

function storedAbsolute(relative) {
  return path.resolve(STORAGE_DIR, relative);
}

async function latestAudit(action, schoolId) {
  const result = await pool.query(
    `SELECT action, entity_type, entity_id, user_id, district_id, details, created_at
     FROM audit_logs
     WHERE action = $1 AND entity_id = $2
     ORDER BY id DESC LIMIT 1`,
    [action, String(schoolId)]
  );
  return result.rows[0] || null;
}

before(async () => {
  await cleanup();

  const districts = await pool.query(
    "SELECT district_code, id FROM districts WHERE district_code IN ('NVD', 'SGD')"
  );
  const byCode = Object.fromEntries(districts.rows.map((row) => [row.district_code, Number(row.id)]));
  assert.ok(byCode.NVD && byCode.SGD, "seeded NVD and SGD districts are required");
  northDistrictId = byCode.NVD;
  southDistrictId = byCode.SGD;

  await createAccount(SYSTEM);
  await createAccount(NORTH, northDistrictId);
  await createAccount(SOUTH, southDistrictId);

  schoolA = await createSchool("TST-L1", "Logo Test North A", northDistrictId);
  schoolB = await createSchool("TST-L2", "Logo Test North B", northDistrictId);
  schoolC = await createSchool("TST-L3", "Logo Test South C", southDistrictId);

  await createAccount(TEACHER, northDistrictId, schoolA);

  system = await login(SYSTEM);
  north = await login(NORTH);
  south = await login(SOUTH);
  teacher = await login(TEACHER);

  png = await sharp({
    create: { width: 320, height: 200, channels: 3, background: { r: 20, g: 90, b: 180 } }
  })
    .png()
    .toBuffer();
  jpg = await sharp({
    create: { width: 240, height: 240, channels: 3, background: { r: 200, g: 60, b: 40 } }
  })
    .jpeg()
    .toBuffer();
  jpeg = await sharp({
    create: { width: 200, height: 120, channels: 3, background: { r: 40, g: 160, b: 90 } }
  })
    .jpeg({ quality: 90 })
    .toBuffer();
  webp = await sharp({
    create: { width: 180, height: 260, channels: 3, background: { r: 150, g: 60, b: 200 } }
  })
    .webp()
    .toBuffer();
});

after(async () => {
  await cleanup();
  await fs.promises.rm(STORAGE_DIR, { recursive: true, force: true });
  await pool.end();
});

test("only authorized administrators in the school's district may change a logo", async () => {
  const anonymous = request.agent(app);
  const anonymousToken = await fetchCsrf(anonymous);
  const anonymousUpload = await anonymous
    .post(`/api/schools/${schoolA}/logo`)
    .set("X-CSRF-Token", anonymousToken)
    .attach("logo", png, { filename: "logo.png", contentType: "image/png" });
  assert.equal(anonymousUpload.status, 401);
  assert.equal(anonymousUpload.body.code, "AUTH_REQUIRED");

  const teacherUpload = await upload(teacher, schoolA, png, "logo.png", "image/png");
  assert.equal(teacherUpload.status, 403);
  assert.equal(teacherUpload.body.code, "FORBIDDEN");

  const crossDistrict = await upload(north, schoolC, png, "logo.png", "image/png");
  assert.equal(crossDistrict.status, 403);
  assert.equal(crossDistrict.body.code, "DISTRICT_FORBIDDEN");

  const noCsrf = await north.agent
    .post(`/api/schools/${schoolA}/logo`)
    .attach("logo", png, { filename: "logo.png", contentType: "image/png" });
  assert.equal(noCsrf.status, 403);
  assert.equal(noCsrf.body.code, "CSRF_INVALID");

  const southUpload = await upload(south, schoolC, png, "logo.png", "image/png");
  assert.equal(southUpload.status, 200, JSON.stringify(southUpload.body));

  const crossDistrictView = await north.agent.get(`/api/schools/${schoolC}/logo`);
  assert.equal(crossDistrictView.status, 403);
  assert.equal(crossDistrictView.body.code, "DISTRICT_FORBIDDEN");
});

test("unsupported, oversized, renamed, and corrupted files are rejected", async () => {
  const oversized = Buffer.alloc(2 * 1024 * 1024 + 16, 0x41);
  const oversizedResponse = await upload(north, schoolA, oversized, "huge.png", "image/png");
  assert.equal(oversizedResponse.status, 413);
  assert.equal(oversizedResponse.body.code, "LOGO_TOO_LARGE");

  const tooWide = await sharp({
    create: { width: 2001, height: 10, channels: 3, background: { r: 1, g: 2, b: 3 } }
  })
    .png()
    .toBuffer();
  const dimensionsResponse = await upload(north, schoolA, tooWide, "wide.png", "image/png");
  assert.equal(dimensionsResponse.status, 413);
  assert.equal(dimensionsResponse.body.code, "LOGO_DIMENSIONS");

  const executable = Buffer.from("MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff", "binary");
  const executableResponse = await upload(north, schoolA, executable, "payload.png", "image/png");
  assert.equal(executableResponse.status, 415);
  assert.equal(executableResponse.body.code, "LOGO_TYPE_UNSUPPORTED");

  const gifResponse = await upload(
    north,
    schoolA,
    Buffer.from("GIF89a\x01\x00\x01\x00", "binary"),
    "logo.gif",
    "image/gif"
  );
  assert.equal(gifResponse.status, 415);
  assert.equal(gifResponse.body.code, "LOGO_TYPE_UNSUPPORTED");

  const corrupted = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(128, 0x7a)
  ]);
  const corruptedResponse = await upload(north, schoolA, corrupted, "broken.png", "image/png");
  assert.equal(corruptedResponse.status, 415);
  assert.equal(corruptedResponse.body.code, "LOGO_INVALID");

  assert.equal((await schoolRow(schoolA)).school_logo, null, "rejected uploads must not be stored");
  assert.equal(
    fs.existsSync(path.join(STORAGE_DIR, `school-${schoolA}`)),
    false,
    "rejected uploads must not leave files behind for that school"
  );
});

test("PNG, JPG, JPEG, and WEBP uploads are re-encoded, served, audited, and replaced safely", async () => {
  const first = await upload(north, schoolA, png, "crest.png", "image/png");
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.match(first.body.data.logoUrl, new RegExp(`^/api/schools/${schoolA}/logo\\?v=`));

  const afterFirst = await schoolRow(schoolA);
  assert.ok(afterFirst.school_logo);
  assert.match(afterFirst.school_logo, new RegExp(`^school-${schoolA}/[0-9a-f-]+\\.webp$`));
  assert.ok(fs.existsSync(storedAbsolute(afterFirst.school_logo)));

  const served = await north.agent
    .get(`/api/schools/${schoolA}/logo`)
    .buffer(true)
    .parse(binaryParser);
  assert.equal(served.status, 200);
  assert.match(served.headers["content-type"], /^image\/webp/);
  assert.equal(served.headers["x-content-type-options"], "nosniff");
  assert.match(served.headers["content-disposition"], /^inline; filename="school-logo\.webp"$/);
  const servedMeta = await sharp(served.body).metadata();
  assert.equal(servedMeta.format, "webp");
  assert.equal(servedMeta.width, 320);
  assert.equal(servedMeta.height, 200);
  assert.equal(servedMeta.exif, undefined, "EXIF metadata must be stripped");

  const uploadedAudit = await latestAudit("school.logo_uploaded", schoolA);
  assert.ok(uploadedAudit, "an upload audit row is required");
  assert.equal(uploadedAudit.details.outcome, "uploaded");
  assert.equal(uploadedAudit.details.school_code, "TST-L1");
  assert.equal(uploadedAudit.details.mime_type, "image/webp");
  assert.ok(uploadedAudit.created_at);
  assert.equal(String(uploadedAudit.entity_id), String(schoolA));

  const previous = afterFirst.school_logo;
  const formats = [
    [jpg, "crest.jpg", "image/jpeg"],
    [jpeg, "crest.jpeg", "image/jpeg"],
    [webp, "crest.webp", "image/webp"]
  ];
  for (const [buffer, filename, contentType] of formats) {
    const response = await upload(north, schoolA, buffer, filename, contentType);
    assert.equal(response.status, 200, `${filename}: ${JSON.stringify(response.body)}`);
  }

  const replaced = await schoolRow(schoolA);
  assert.notEqual(replaced.school_logo, previous);
  assert.ok(fs.existsSync(storedAbsolute(replaced.school_logo)));
  assert.equal(fs.existsSync(storedAbsolute(previous)), false, "the old file must be deleted after replacement");

  const replaceAudit = await latestAudit("school.logo_replaced", schoolA);
  assert.ok(replaceAudit);
  assert.equal(replaceAudit.details.outcome, "replaced");

  const serializedDetails = JSON.stringify(replaceAudit.details);
  assert.equal(serializedDetails.includes(STORAGE_DIR), false, "audit details must not expose server paths");
});

test("logos stay isolated per school and removal restores the placeholder", async () => {
  const a = await upload(north, schoolA, png, "a.png", "image/png");
  assert.equal(a.status, 200);
  const b = await upload(north, schoolB, webp, "b.webp", "image/webp");
  assert.equal(b.status, 200, JSON.stringify(b.body));

  const aRow = await schoolRow(schoolA);
  const bRow = await schoolRow(schoolB);
  assert.notEqual(aRow.school_logo, bRow.school_logo);
  assert.match(aRow.school_logo, new RegExp(`^school-${schoolA}/`));
  assert.match(bRow.school_logo, new RegExp(`^school-${schoolB}/`));

  const aImage = await north.agent.get(`/api/schools/${schoolA}/logo`).buffer(true).parse(binaryParser);
  const bImage = await north.agent.get(`/api/schools/${schoolB}/logo`).buffer(true).parse(binaryParser);
  assert.equal(aImage.status, 200);
  assert.equal(bImage.status, 200);
  assert.notDeepEqual(aImage.body, bImage.body);

  const list = await north.agent.get("/api/schools?page=1&pageSize=50");
  assert.equal(list.status, 200);
  const listedA = list.body.data.find((school) => school.id === schoolA);
  const listedB = list.body.data.find((school) => school.id === schoolB);
  assert.match(listedA.logoUrl, new RegExp(`^/api/schools/${schoolA}/logo`));
  assert.match(listedB.logoUrl, new RegExp(`^/api/schools/${schoolB}/logo`));

  const removed = await north.agent
    .delete(`/api/schools/${schoolA}/logo`)
    .set("X-CSRF-Token", north.csrfToken);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(removed.body.data.logoUrl, null);
  assert.equal((await schoolRow(schoolA)).school_logo, null);
  assert.equal(fs.existsSync(storedAbsolute(aRow.school_logo)), false);

  const removedAudit = await latestAudit("school.logo_removed", schoolA);
  assert.ok(removedAudit);
  assert.equal(removedAudit.details.outcome, "removed");

  const gone = await north.agent.get(`/api/schools/${schoolA}/logo`);
  assert.equal(gone.status, 404);
  assert.equal(gone.body.code, "LOGO_NOT_FOUND");

  const stillThere = await north.agent.get(`/api/schools/${schoolB}/logo`).buffer(true).parse(binaryParser);
  assert.equal(stillThere.status, 200, "removing one school's logo must not affect another school");
});

test("stored references cannot escape the logo directory and school APIs still work", async () => {
  await pool.query("UPDATE schools SET school_logo = $1 WHERE id = $2", [
    "../../client/js/school-logo.js",
    schoolC
  ]);
  const traversal = await south.agent.get(`/api/schools/${schoolC}/logo`);
  assert.equal(traversal.status, 404);
  assert.equal(traversal.body.code, "LOGO_NOT_FOUND");
  await pool.query("UPDATE schools SET school_logo = NULL WHERE id = $1", [schoolC]);

  const list = await system.agent.get("/api/schools?page=1&pageSize=5&sort=name");
  assert.equal(list.status, 200);
  assert.ok(Array.isArray(list.body.data));
  assert.ok(list.body.data.length > 0);
  const sample = list.body.data[0];
  ["id", "code", "name", "type", "districtId", "head", "studentCount", "teacherCount", "status"].forEach((field) => {
    assert.ok(Object.prototype.hasOwnProperty.call(sample, field), `school payload must keep ${field}`);
  });
  assert.ok(Object.prototype.hasOwnProperty.call(sample, "logoUrl"));

  const detail = await system.agent.get(`/api/schools/${schoolA}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.code, "TST-L1");
  assert.equal(detail.body.data.logoUrl, null);

  const page = await system.agent.get("/schools");
  assert.equal(page.status, 200);
  assert.match(page.text, /js\/school-logo\.js/);
});
