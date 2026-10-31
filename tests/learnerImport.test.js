"use strict";

// Acceptance tests for the secure learner bulk import. The upload creates
// permanent learner profiles only: no enrollment, guardian, grade, attendance,
// or health record is written by an import.

process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const XLSX = require("xlsx");

const app = require("../server/app");
const { pool } = require("../server/config/database");
const { TEMPLATE_HEADERS } = require("../server/services/learnerImportService");

const LRN_BASE = `91${String(Date.now()).slice(-9)}`;
const LRN_ALT = `92${String(Date.now()).slice(-9)}`;
const HEADERS = TEMPLATE_HEADERS;
const DEMO = {
  system: { username: "sysadmin", password: "Admin@2026" },
  northAdmin: { username: "northadmin", password: "District@2026" },
  northStaff: { username: "northstaff", password: "Staff@2026" },
  northHead: { username: "northhead", password: "Demo@2026" },
  northTeacher: { username: "northteacher", password: "Demo@2026" }
};

let admin = null;
let northAdmin = null;
let northStaff = null;
let northHead = null;
let northTeacher = null;
let school = null;
let headSchool = null;
let otherDistrictSchool = null;
let mainBatch = null;

function lrn(n) {
  return `${LRN_BASE}${n}`;
}

function altLrn(n) {
  return `${LRN_ALT}${n}`;
}

function learnerRow(values) {
  return HEADERS.map((key) =>
    values[key] === undefined || values[key] === null ? "" : values[key]
  );
}

function learnerFile(rows, sheetName = "Learners") {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

function csvCell(value) {
  const text = String(value === undefined || value === null ? "" : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function learnerCsv(rows) {
  return Buffer.from(
    [HEADERS, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n"),
    "utf8"
  );
}

async function cleanupTestData() {
  await pool.query(
    `DELETE FROM audit_logs
      WHERE action IN ('learner.import_previewed', 'learner.imported')
        AND details::text ILIKE $1`,
    [`%${LRN_BASE}%`]
  );
  await pool.query("DELETE FROM learners WHERE lrn LIKE $1 OR lrn LIKE $2", [
    `${LRN_BASE}%`,
    `${LRN_ALT}%`
  ]);
  await pool.query(
    `DELETE FROM learner_import_batches
      WHERE files::text ILIKE $1 OR issues::text ILIKE $1 OR valid_rows::text ILIKE $1
         OR files::text ILIKE $2 OR issues::text ILIKE $2 OR valid_rows::text ILIKE $2`,
    [`%${LRN_BASE}%`, `%${LRN_ALT}%`]
  );
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
    .send({ identifier: credentials.username, password: credentials.password });
  assert.equal(
    response.status,
    200,
    `login for ${credentials.username} should succeed: ${JSON.stringify(response.body)}`
  );
  return {
    agent,
    csrfToken: response.body.data.csrfToken || token,
    user: response.body.data.user
  };
}

function previewUpload(session, files) {
  let builder = session.agent
    .post("/api/learners/imports/preview")
    .set("X-CSRF-Token", session.csrfToken);
  files.forEach((file) => {
    builder = builder.attach("files", file.buffer, {
      filename: file.name,
      contentType: file.type || "application/octet-stream"
    });
  });
  return builder;
}

function commitImport(session, batch, token = batch.token) {
  return session.agent
    .post(`/api/learners/imports/${batch.importId}/commit`)
    .set("X-CSRF-Token", session.csrfToken)
    .send({ token });
}

function getBinary(session, path) {
  return session.agent.get(path).buffer(true).parse((res, callback) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => callback(null, Buffer.concat(chunks)));
  });
}

async function learnerByLrn(value) {
  const result = await pool.query("SELECT * FROM learners WHERE lrn = $1", [value]);
  return result.rows[0] || null;
}

async function batchRow(id) {
  const result = await pool.query("SELECT * FROM learner_import_batches WHERE id = $1", [id]);
  return result.rows[0] || null;
}

before(async () => {
  admin = await login(DEMO.system);
  northAdmin = await login(DEMO.northAdmin);
  northStaff = await login(DEMO.northStaff);
  northHead = await login(DEMO.northHead);
  northTeacher = await login(DEMO.northTeacher);

  assert.ok(northAdmin.user.districtId, "the district administrator must be scoped");

  const own = await pool.query(
    `SELECT s.id, s.school_code, s.school_name, s.district_id
       FROM schools s
      WHERE s.status = 'active' AND s.district_id = $1
      ORDER BY s.id
      LIMIT 1`,
    [northAdmin.user.districtId]
  );
  school = own.rows[0];
  assert.ok(school, "the district needs an active school");

  const head = await pool.query(
    `SELECT s.id, s.school_code, s.school_name, s.district_id
       FROM schools s
      WHERE s.id = $1`,
    [northHead.user.schoolId]
  );
  headSchool = head.rows[0];
  assert.ok(headSchool, "the school head's school must exist");

  const other = await pool.query(
    `SELECT s.id, s.school_code, s.school_name, s.district_id
       FROM schools s
      WHERE s.status = 'active' AND s.district_id <> $1
      ORDER BY s.id
      LIMIT 1`,
    [northAdmin.user.districtId]
  );
  otherDistrictSchool = other.rows[0] || null;

  await cleanupTestData();
});

after(async () => {
  await cleanupTestData();
  await pool.end();
});

test("learner import requires learner add rights", async () => {
  const anonymous = await request(app).get("/api/learners/imports/template");
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.code, "AUTH_REQUIRED");

  const teacher = await northTeacher.agent.get("/api/learners/imports/template");
  assert.equal(teacher.status, 403);
  assert.equal(teacher.body.code, "FORBIDDEN");

  const head = await getBinary(northHead, "/api/learners/imports/template");
  assert.equal(head.status, 200, "school heads maintain their own learner register");

  const staff = await getBinary(northStaff, "/api/learners/imports/template");
  assert.equal(staff.status, 200, "district staff may prepare learner profiles");

  const missingCsrf = await admin.agent
    .post("/api/learners/imports/preview")
    .attach("files", learnerFile([learnerRow({ lrn: lrn(9) })]), {
      filename: `${LRN_BASE}-no-csrf.xlsx`
    });
  assert.equal(missingCsrf.status, 403);
  assert.equal(missingCsrf.body.code, "CSRF_INVALID");
});

test("learner template lists the learner profile schema", async () => {
  const response = await getBinary(admin, "/api/learners/imports/template");
  assert.equal(response.status, 200);
  assert.match(String(response.headers["content-disposition"]), /learner-import-template\.xlsx/);

  const workbook = XLSX.read(response.body, { type: "buffer" });
  assert.ok(workbook.SheetNames.includes("Learners"));
  assert.ok(workbook.SheetNames.includes("Example"));
  assert.ok(workbook.SheetNames.includes("Instructions"));

  const learners = XLSX.utils.sheet_to_json(workbook.Sheets.Learners, { header: 1 });
  assert.deepEqual(learners[0], HEADERS);
  assert.equal(learners.length, 1, "the template sheet holds no sample rows");
});

test("preview validates learner profiles without writing records", async () => {
  const file = learnerFile([
    learnerRow({
      lrn: lrn(0),
      last_name: "  Mercado ",
      first_name: " Juan ",
      middle_name: "P.",
      extension_name: "Jr.",
      birth_date: "2014-02-11",
      sex: "M",
      weight_kg: 32.5,
      height_cm: 128,
      house_number: "12-A",
      barangay: "Poblacion",
      municipality: "North Valley",
      province: "Nueva Ecija",
      region: "Region III",
      zip_code: "3100",
      contact_number: "+63 917 555 0110",
      email: `${LRN_BASE}.juan@example.org`,
      school_code: school.school_code
    }),
    learnerRow({
      lrn: lrn(1),
      last_name: "Villanueva",
      first_name: "Maria",
      birth_date: "2013-08-30",
      sex: "Female",
      school_code: school.school_code.toLowerCase()
    }),
    learnerRow({
      lrn: lrn(2),
      last_name: "Ocampo",
      first_name: "Eli",
      birth_date: "2012-11-05",
      sex: "f",
      school_code: school.school_code
    })
  ]);

  const response = await previewUpload(admin, [{ name: `${LRN_BASE}-three.xlsx`, buffer: file }]);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const data = response.body.data;

  assert.equal(data.summary.files, 1);
  assert.equal(data.summary.recordsDetected, 3);
  assert.equal(data.summary.validRecords, 3);
  assert.equal(data.summary.rejected, 0);
  assert.equal(data.summary.duplicates, 0);
  assert.equal(data.files[0].status, "valid");
  assert.equal(data.preview.length, 3);

  const first = data.preview[0];
  assert.equal(first.fullName, "Juan P. Mercado Jr.");
  assert.equal(first.lrn, lrn(0));
  assert.equal(first.sex, "male");
  assert.equal(first.birthDate, "2014-02-11");
  assert.equal(first.schoolCode, school.school_code);
  assert.equal(data.preview[1].sex, "female");
  assert.equal(data.preview[2].sex, "female");

  assert.equal(await learnerByLrn(lrn(0)), null, "preview must not write learners");
  const batch = await batchRow(data.importId);
  assert.equal(batch.status, "previewed");
  assert.equal(Number(batch.user_id), Number(admin.user.id));

  const audited = await pool.query(
    `SELECT action FROM audit_logs
      WHERE action = 'learner.import_previewed' AND details->>'batch_id' = $1`,
    [String(data.importId)]
  );
  assert.equal(audited.rowCount, 1);

  mainBatch = { importId: data.importId, token: data.token };
});

test("commit writes learner profiles only, in one transaction", async () => {
  assert.ok(mainBatch, "the preview test must run first");

  const wrongToken = await commitImport(admin, mainBatch, "x".repeat(64));
  assert.equal(wrongToken.status, 403);
  assert.equal(wrongToken.body.code, "IMPORT_TOKEN_INVALID");
  assert.equal(await learnerByLrn(lrn(0)), null);

  const commit = await commitImport(admin, mainBatch);
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  const result = commit.body.data;
  assert.equal(result.status, "committed");
  assert.equal(result.imported.length, 3);

  const juan = await learnerByLrn(lrn(0));
  assert.ok(juan);
  assert.equal(juan.last_name, "Mercado");
  assert.equal(juan.first_name, "Juan");
  assert.equal(juan.extension_name, "Jr.");
  assert.equal(juan.sex, "male");
  assert.equal(Number(juan.school_id), Number(school.id));
  assert.equal(Number(juan.district_id), Number(school.district_id));
  assert.equal(Number(juan.created_by), Number(admin.user.id));
  assert.equal(Number(juan.weight_kg), 32.5);
  assert.equal(Number(juan.height_cm), 128);
  assert.equal(juan.zip_code, "3100");

  const birth = await pool.query(
    "SELECT to_char(birth_date, 'YYYY-MM-DD') AS birthday FROM learners WHERE lrn = $1",
    [lrn(0)]
  );
  assert.equal(birth.rows[0].birthday, "2014-02-11");

  const enrollments = await pool.query(
    "SELECT COUNT(*)::int AS total FROM enrollments WHERE learner_id = ANY($1::bigint[])",
    [result.imported.map((item) => Number(item.id))]
  );
  assert.equal(enrollments.rows[0].total, 0, "an import never creates enrollments");
  const guardians = await pool.query(
    "SELECT COUNT(*)::int AS total FROM guardians WHERE learner_id = ANY($1::bigint[])",
    [result.imported.map((item) => Number(item.id))]
  );
  assert.equal(guardians.rows[0].total, 0, "an import never creates guardians");

  const batch = await batchRow(mainBatch.importId);
  assert.equal(batch.status, "committed");
  assert.deepEqual(batch.valid_rows, []);

  const audited = await pool.query(
    `SELECT details FROM audit_logs
      WHERE action = 'learner.imported' AND details->>'batch_id' = $1`,
    [String(mainBatch.importId)]
  );
  assert.equal(audited.rowCount, 1);
  assert.equal(audited.rows[0].details.imported, 3);

  const again = await commitImport(admin, mainBatch);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "IMPORT_NOT_PENDING");
});

test("duplicate LRNs within the upload and in PostgreSQL are skipped", async () => {
  const existing = await learnerByLrn(lrn(0));
  assert.ok(existing, "the earlier commit must have created the learner");

  const file = learnerFile([
    learnerRow({
      lrn: lrn(0),
      last_name: "Overwrite",
      first_name: "Attempt",
      birth_date: "2014-02-11",
      sex: "male",
      school_code: school.school_code
    }),
    learnerRow({
      lrn: lrn(6),
      last_name: "Repeat",
      first_name: "First",
      birth_date: "2011-04-04",
      sex: "male",
      school_code: school.school_code
    }),
    learnerRow({
      lrn: lrn(6),
      last_name: "Repeat",
      first_name: "Second",
      birth_date: "2011-04-04",
      sex: "male",
      school_code: school.school_code
    }),
    learnerRow({
      lrn: lrn(5),
      last_name: "Unique",
      first_name: "Profile",
      birth_date: "2010-09-19",
      sex: "female",
      school_code: school.school_code
    })
  ]);

  const preview = await previewUpload(admin, [{ name: `${LRN_BASE}-dupes.xlsx`, buffer: file }]);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const data = preview.body.data;
  assert.equal(data.summary.recordsDetected, 4);
  assert.equal(data.summary.duplicates, 2);
  assert.equal(data.summary.validRecords, 2);
  assert.ok(data.issues.every((item) => item.type === "duplicate"));
  assert.ok(data.issues.some((item) => /duplicated in this upload/i.test(item.reason)));

  const commit = await commitImport(admin, data);
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  assert.equal(commit.body.data.imported.length, 2);
  assert.equal(commit.body.data.duplicates, 2);

  const unchanged = await learnerByLrn(lrn(0));
  assert.equal(unchanged.last_name, "Mercado", "existing learners are never overwritten");
  assert.equal(unchanged.first_name, "Juan");

  const repeat = await learnerByLrn(lrn(6));
  assert.equal(repeat.first_name, "First");
  assert.ok(await learnerByLrn(lrn(5)));
});

test("district staff and school heads stay inside their learner scope", async () => {
  assert.ok(otherDistrictSchool, "a second district school is required");

  const staffFile = learnerFile([
    learnerRow({
      lrn: lrn(7),
      last_name: "Scoped",
      first_name: "Own",
      birth_date: "2013-01-15",
      sex: "male",
      school_code: school.school_code
    }),
    learnerRow({
      lrn: lrn(8),
      last_name: "Scoped",
      first_name: "Other",
      birth_date: "2013-01-15",
      sex: "female",
      school_code: otherDistrictSchool.school_code
    }),
    learnerRow({
      lrn: lrn(9),
      last_name: "Scoped",
      first_name: "Blank",
      birth_date: "2013-01-15",
      sex: "male",
      school_code: ""
    })
  ]);

  const staffPreview = await previewUpload(northStaff, [
    { name: `${LRN_BASE}-staff-scope.xlsx`, buffer: staffFile }
  ]);
  assert.equal(staffPreview.status, 200, JSON.stringify(staffPreview.body));
  const data = staffPreview.body.data;
  assert.equal(data.summary.recordsDetected, 3);
  assert.equal(data.summary.validRecords, 1);
  assert.equal(data.summary.rejected, 2);
  assert.ok(data.issues.some((item) => /not found among the active schools in your district/i.test(item.reason)));
  assert.ok(data.issues.some((item) => /school code is required/i.test(item.reason)));

  const staffCommit = await commitImport(northStaff, data);
  assert.equal(staffCommit.status, 200, JSON.stringify(staffCommit.body));
  assert.equal(staffCommit.body.data.imported.length, 1);
  assert.ok(await learnerByLrn(lrn(7)));
  assert.equal(await learnerByLrn(lrn(8)), null);
  assert.equal(await learnerByLrn(lrn(9)), null);

  const headFile = learnerFile([
    learnerRow({
      lrn: lrn(4),
      last_name: "OwnSchool",
      first_name: "Head",
      birth_date: "2012-06-21",
      sex: "female",
      school_code: ""
    }),
    learnerRow({
      lrn: lrn(3),
      last_name: "OtherSchool",
      first_name: "Head",
      birth_date: "2012-06-21",
      sex: "male",
      school_code: otherDistrictSchool.school_code
    })
  ]);

  const headPreview = await previewUpload(northHead, [
    { name: `${LRN_BASE}-head-scope.xlsx`, buffer: headFile }
  ]);
  assert.equal(headPreview.status, 200, JSON.stringify(headPreview.body));
  const headData = headPreview.body.data;
  assert.equal(headData.summary.validRecords, 1, "a blank school code resolves to the head's own school");
  assert.equal(headData.summary.rejected, 1);
  assert.equal(headData.preview[0].schoolCode, headSchool.school_code);

  const headCommit = await commitImport(northHead, headData);
  assert.equal(headCommit.status, 200, JSON.stringify(headCommit.body));
  const created = await learnerByLrn(lrn(4));
  assert.ok(created);
  assert.equal(Number(created.school_id), Number(headSchool.id));
  assert.equal(await learnerByLrn(lrn(3)), null);
});

test("invalid learner rows report file, sheet, row, column, and reason", async () => {
  const validLrn = altLrn(2);
  const file = learnerFile([
    learnerRow({
      lrn: validLrn,
      last_name: "Valid",
      first_name: "Learner",
      birth_date: "2013-03-03",
      sex: "male",
      school_code: school.school_code
    }),
    learnerRow({
      lrn: "12345678901",
      last_name: "Short",
      first_name: "Lrn",
      birth_date: "2013-03-03",
      sex: "male",
      school_code: school.school_code
    }),
    learnerRow({
      lrn: altLrn(2),
      last_name: "NoFirst",
      first_name: "",
      birth_date: "2013-03-03",
      sex: "male",
      school_code: school.school_code
    }),
    learnerRow({
      lrn: "123456789013",
      last_name: "Future",
      first_name: "Birth",
      birth_date: "2999-01-01",
      sex: "male",
      school_code: school.school_code
    }),
    learnerRow({
      lrn: "123456789014",
      last_name: "Bad",
      first_name: "Sex",
      birth_date: "2013-03-03",
      sex: "unknown",
      school_code: school.school_code
    }),
    learnerRow({
      lrn: "123456789015",
      last_name: "Bad",
      first_name: "Zip",
      birth_date: "2013-03-03",
      sex: "female",
      zip_code: "12",
      school_code: school.school_code
    })
  ]);

  const preview = await previewUpload(admin, [
    { name: `${LRN_BASE}-invalid.xlsx`, buffer: file }
  ]);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const data = preview.body.data;
  assert.equal(data.summary.recordsDetected, 6);
  assert.equal(data.summary.validRecords, 1);
  assert.equal(data.summary.rejected, 5);
  assert.equal(data.summary.duplicates, 0);

  const lrnIssue = data.issues.find((item) => item.row === 3 && item.column === "lrn");
  assert.ok(lrnIssue, "the short LRN is rejected");
  assert.equal(lrnIssue.file, `${LRN_BASE}-invalid.xlsx`);
  assert.equal(lrnIssue.sheet, "Learners");
  assert.ok(data.issues.find((item) => item.row === 4 && item.column === "first_name"));
  assert.ok(data.issues.find((item) => item.row === 5 && item.column === "birth_date"));
  assert.ok(data.issues.find((item) => item.row === 6 && item.column === "sex"));
  assert.ok(data.issues.find((item) => item.row === 7 && item.column === "zip_code"));

  const report = await getBinary(admin, `/api/learners/imports/${data.importId}/errors.xlsx`);
  assert.equal(report.status, 200);
  const reportWorkbook = XLSX.read(report.body, { type: "buffer" });
  assert.ok(reportWorkbook.SheetNames.includes("Summary"));
  assert.ok(reportWorkbook.SheetNames.includes("Issues"));

  const commit = await commitImport(admin, data);
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  assert.equal(commit.body.data.imported.length, 1);
  assert.equal(commit.body.data.rejected, 5);
  assert.ok(await learnerByLrn(validLrn));
});

test("a corrupt file or a formula cell does not block a valid file", async () => {
  const corrupt = Buffer.from("this is not a spreadsheet", "utf8");
  const formulaWorkbook = XLSX.utils.book_new();
  const formulaSheet = XLSX.utils.aoa_to_sheet([
    HEADERS,
    learnerRow({
      lrn: altLrn(1),
      last_name: "Formula",
      first_name: "Cell",
      birth_date: "2013-03-03",
      sex: "male",
      school_code: school.school_code
    })
  ]);
  formulaSheet.A2 = { t: "s", f: "CONCAT(\"91\",\"0000000000\")", v: lrn(1) };
  XLSX.utils.book_append_sheet(formulaWorkbook, formulaSheet, "Learners");
  const formula = XLSX.write(formulaWorkbook, { bookType: "xlsx", type: "buffer" });

  const good = learnerFile([
    learnerRow({
      lrn: altLrn(8),
      last_name: "Independent",
      first_name: "Learner",
      birth_date: "2012-12-12",
      sex: "female",
      school_code: school.school_code
    })
  ]);

  const preview = await previewUpload(admin, [
    { name: `${LRN_BASE}-corrupt.xlsx`, buffer: corrupt },
    { name: `${LRN_BASE}-formula.xlsx`, buffer: formula },
    { name: `${LRN_BASE}-independent.xlsx`, buffer: good }
  ]);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const data = preview.body.data;
  assert.equal(data.files[0].status, "failed");
  assert.match(data.files[0].error, /zip/i);
  assert.equal(data.files[1].status, "failed");
  assert.match(data.files[1].error, /formula/i);
  assert.equal(data.files[2].status, "valid");
  assert.equal(data.summary.validRecords, 1);

  const commit = await commitImport(admin, data);
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  assert.equal(commit.body.data.imported.length, 1);
  assert.ok(await learnerByLrn(altLrn(8)));
  assert.equal(await learnerByLrn(altLrn(1)), null);
});

test("a UTF-8 CSV keeps typed dates and numbers", async () => {
  const csvLrn = altLrn(9);
  const file = learnerCsv([
    learnerRow({
      lrn: csvLrn,
      last_name: "Csv",
      first_name: "Typed",
      birth_date: "2011-07-04",
      sex: "female",
      weight_kg: "37.25",
      height_cm: "141",
      school_code: school.school_code
    })
  ]);

  const preview = await previewUpload(admin, [
    { name: `${LRN_ALT}-typed.csv`, buffer: file, type: "text/csv" }
  ]);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const data = preview.body.data;
  assert.equal(data.summary.validRecords, 1, JSON.stringify(data.issues));
  assert.equal(data.summary.rejected, 0);
  assert.equal(data.preview[0].birthDate, "2011-07-04");
  assert.equal(data.preview[0].lrn, csvLrn);

  const commit = await commitImport(admin, data);
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  assert.equal(commit.body.data.imported.length, 1);

  const stored = await pool.query(
    `SELECT to_char(birth_date, 'YYYY-MM-DD') AS birthday, weight_kg, height_cm
       FROM learners WHERE lrn = $1`,
    [csvLrn]
  );
  assert.equal(stored.rows[0].birthday, "2011-07-04");
  assert.equal(Number(stored.rows[0].weight_kg), 37.25);
  assert.equal(Number(stored.rows[0].height_cm), 141);
});

test("typed Excel date cells and ISO timestamps normalize to calendar dates", async () => {
  const file = learnerFile([
    learnerRow({
      lrn: altLrn(3),
      last_name: "Serial",
      first_name: "Date",
      // Excel writes a typed date cell as a serial number (41623).
      birth_date: new Date(2013, 11, 15),
      sex: "female",
      school_code: school.school_code
    }),
    learnerRow({
      lrn: altLrn(4),
      last_name: "Timestamp",
      first_name: "Iso",
      birth_date: "2012-01-30T00:00:00.000Z",
      sex: "male",
      school_code: school.school_code
    }),
    learnerRow({
      lrn: altLrn(5),
      last_name: "Plain",
      first_name: "Text",
      birth_date: "2014-05-18",
      sex: "female",
      school_code: school.school_code
    }),
    learnerRow({
      lrn: altLrn(6),
      last_name: "Ambiguous",
      first_name: "Day",
      birth_date: "15/12/2013",
      sex: "male",
      school_code: school.school_code
    })
  ]);

  const preview = await previewUpload(admin, [
    { name: `${LRN_ALT}-dates.xlsx`, buffer: file }
  ]);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const data = preview.body.data;

  assert.equal(data.summary.validRecords, 3, JSON.stringify(data.issues));
  assert.equal(data.summary.rejected, 1);
  assert.equal(data.summary.duplicates, 0);
  assert.deepEqual(
    data.preview.map((row) => row.birthDate).sort(),
    ["2012-01-30", "2013-12-15", "2014-05-18"]
  );

  const rejected = data.issues.find((issue) => issue.column === "birth_date");
  assert.ok(rejected, "an ambiguous date is rejected");
  assert.match(rejected.reason, /YYYY-MM-DD/);

  const commit = await commitImport(admin, data);
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  assert.equal(commit.body.data.imported.length, 3);
  assert.equal(await learnerByLrn(altLrn(6)), null);

  const stored = await pool.query(
    `SELECT lrn, to_char(birth_date, 'YYYY-MM-DD') AS birthday
       FROM learners WHERE lrn = ANY($1::text[]) ORDER BY lrn`,
    [[altLrn(3), altLrn(4), altLrn(5)]]
  );
  assert.deepEqual(stored.rows, [
    { lrn: altLrn(3), birthday: "2013-12-15" },
    { lrn: altLrn(4), birthday: "2012-01-30" },
    { lrn: altLrn(5), birthday: "2014-05-18" }
  ]);
});

test("history and error reports stay scoped to the importing account", async () => {
  const history = await admin.agent.get("/api/learners/imports?limit=20");
  assert.equal(history.status, 200);
  const ids = (history.body.data || []).map((row) => Number(row.id));
  assert.ok(ids.includes(Number(mainBatch.importId)));

  const staffHistory = await northStaff.agent.get("/api/learners/imports?limit=20");
  assert.equal(staffHistory.status, 200);
  assert.ok(
    !(staffHistory.body.data || []).some((row) => Number(row.id) === Number(mainBatch.importId))
  );

  const foreignReport = await getBinary(
    northStaff,
    `/api/learners/imports/${mainBatch.importId}/errors.xlsx`
  );
  assert.equal(foreignReport.status, 404);

  const badLimit = await admin.agent.get("/api/learners/imports?limit=99");
  assert.equal(badLimit.status, 400);
  assert.equal(badLimit.body.code, "VALIDATION_ERROR");
});
