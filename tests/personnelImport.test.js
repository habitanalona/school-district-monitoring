"use strict";

// Acceptance tests for the secure staff bulk import (school heads, teachers,
// and non-teaching personnel). Each committed row creates a personnel profile
// and one login account with a single-use activation link.

process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const request = require("supertest");
const XLSX = require("xlsx");

const app = require("../server/app");
const { pool } = require("../server/config/database");
const { TEMPLATE_HEADERS } = require("../server/services/personnelImportService");

const RUN = `PIM${Date.now().toString(36).slice(-6)}`.toUpperCase();
const RUN_LOWER = RUN.toLowerCase();
const HEADERS = TEMPLATE_HEADERS;
const PASSWORD = "ImportedPass123";
const DEMO = {
  system: { username: "sysadmin", password: "Admin@2026" },
  northAdmin: { username: "northadmin", password: "District@2026" },
  northStaff: { username: "northstaff", password: "Staff@2026" },
  northHead: { username: "northhead", password: "Demo@2026" }
};

let admin = null;
let northAdmin = null;
let northStaff = null;
let northHead = null;
let school = null;
let otherDistrictSchool = null;
let mainBatch = null;

function staffRow(values) {
  return HEADERS.map((key) =>
    values[key] === undefined || values[key] === null ? "" : values[key]
  );
}

function staffFile(rows, sheetName = "Personnel") {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

async function cleanupTestData() {
  await pool.query(
    `DELETE FROM audit_logs
      WHERE action IN ('personnel.import_previewed', 'personnel.imported')
        AND details::text ILIKE $1`,
    [`%${RUN}%`]
  );
  await pool.query(
    `DELETE FROM audit_logs
      WHERE action = 'user.created'
        AND details->>'source' = 'bulk_import'
        AND details->>'username' LIKE $1`,
    [`${RUN_LOWER}%`]
  );
  await pool.query(
    `DELETE FROM password_reset_tokens
      WHERE user_id IN (SELECT id FROM users WHERE username LIKE $1)`,
    [`${RUN_LOWER}%`]
  );
  await pool.query("DELETE FROM personnel_profiles WHERE employee_no LIKE $1", [`${RUN}-%`]);
  await pool.query("DELETE FROM users WHERE username LIKE $1", [`${RUN_LOWER}%`]);
  await pool.query(
    `DELETE FROM personnel_import_batches
      WHERE files::text ILIKE $1 OR issues::text ILIKE $1 OR valid_rows::text ILIKE $1`,
    [`%${RUN}%`]
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
    .post("/api/personnel/imports/preview")
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
    .post(`/api/personnel/imports/${batch.importId}/commit`)
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

async function userByUsername(username) {
  const result = await pool.query("SELECT * FROM users WHERE username = $1", [username]);
  return result.rows[0] || null;
}

async function profileByEmployee(employeeNo) {
  const result = await pool.query(
    "SELECT * FROM personnel_profiles WHERE employee_no = $1",
    [employeeNo]
  );
  return result.rows[0] || null;
}

async function batchRow(id) {
  const result = await pool.query("SELECT * FROM personnel_import_batches WHERE id = $1", [id]);
  return result.rows[0] || null;
}

before(async () => {
  admin = await login(DEMO.system);
  northAdmin = await login(DEMO.northAdmin);
  northStaff = await login(DEMO.northStaff);
  northHead = await login(DEMO.northHead);

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
  assert.ok(school, "the district administrator's district needs an active school");

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

test("staff import needs an administrator with personnel and account rights", async () => {
  const anonymous = await request(app).get("/api/personnel/imports/template");
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.code, "AUTH_REQUIRED");

  const staff = await northStaff.agent.get("/api/personnel/imports/template");
  assert.equal(staff.status, 403);
  assert.equal(staff.body.code, "FORBIDDEN");

  const head = await northHead.agent.get("/api/personnel/imports/template");
  assert.equal(head.status, 403, "school heads may not create accounts in bulk");

  const district = await getBinary(northAdmin, "/api/personnel/imports/template");
  assert.equal(district.status, 200);

  const missingCsrf = await admin.agent
    .post("/api/personnel/imports/preview")
    .attach("files", staffFile([staffRow({ personnel_type: "teacher" })]), {
      filename: `${RUN}-no-csrf.xlsx`
    });
  assert.equal(missingCsrf.status, 403);
  assert.equal(missingCsrf.body.code, "CSRF_INVALID");
});

test("staff template lists the staff schema", async () => {
  const response = await getBinary(admin, "/api/personnel/imports/template");
  assert.equal(response.status, 200);
  assert.match(String(response.headers["content-type"]), /spreadsheetml\.sheet/);
  assert.match(String(response.headers["content-disposition"]), /staff-import-template\.xlsx/);

  const workbook = XLSX.read(response.body, { type: "buffer" });
  assert.ok(workbook.SheetNames.includes("Personnel"));
  assert.ok(workbook.SheetNames.includes("Example"));
  assert.ok(workbook.SheetNames.includes("Instructions"));

  const personnel = XLSX.utils.sheet_to_json(workbook.Sheets.Personnel, { header: 1 });
  assert.deepEqual(personnel[0], HEADERS);
  assert.equal(personnel.length, 1, "the template sheet must not contain sample rows");
});

test("preview validates staff records without writing accounts or profiles", async () => {
  const headEmp = `${RUN}-HEAD`;
  const teacherEmp = `${RUN}-TEACH`;
  const ntEmp = `${RUN}-NT`;

  const file = staffFile([
    staffRow({
      personnel_type: "school_head",
      school_code: school.school_code,
      employee_no: headEmp,
      last_name: "  Dela Cruz ",
      first_name: " Ana ",
      email: `${RUN_LOWER}.head@example.org`,
      date_hired: "2019-06-03"
    }),
    staffRow({
      personnel_type: "teacher",
      school_code: school.school_code.toLowerCase(),
      employee_no: teacherEmp,
      last_name: "Santos",
      first_name: "Ramon",
      middle_name: "B.",
      position: "Master Teacher I",
      employment_type: "provisional",
      email: `${RUN_LOWER}.teacher@example.org`,
      username: `${RUN_LOWER}t1`,
      contact_number: "+63 917 555 0101"
    }),
    staffRow({
      personnel_type: "non_teaching",
      school_code: school.school_code,
      employee_no: ntEmp,
      last_name: "Reyes",
      first_name: "Liza",
      email: `${RUN_LOWER}.nt@example.org`,
      username: `${RUN_LOWER}n1`,
      employment_status: "inactive"
    })
  ]);

  const response = await previewUpload(admin, [{ name: `${RUN}-staff.xlsx`, buffer: file }]);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const data = response.body.data;

  assert.equal(data.summary.files, 1);
  assert.equal(data.summary.recordsDetected, 3);
  assert.equal(data.summary.validRecords, 3);
  assert.equal(data.summary.rejected, 0);
  assert.equal(data.summary.duplicates, 0);
  assert.equal(data.files[0].status, "valid");
  assert.equal(data.preview.length, 3);

  const head = data.preview[0];
  assert.equal(head.fullName, "Ana Dela Cruz", "values are trimmed");
  assert.equal(head.role, "school_head");
  assert.equal(head.roleLabel, "School Head");
  assert.equal(head.position, "School Head", "the type supplies a default position");
  assert.equal(head.username, `${RUN_LOWER}.head`, "username is derived from the email");
  assert.equal(head.schoolCode, school.school_code);
  assert.ok(data.token && data.token.length >= 32);

  const teacher = data.preview[1];
  assert.equal(teacher.position, "Master Teacher I");
  assert.equal(teacher.username, `${RUN_LOWER}t1`);
  assert.equal(teacher.role, "teacher");

  const nt = data.preview[2];
  assert.equal(nt.role, "nt");
  assert.equal(nt.roleLabel, "Non-Teaching Personnel");
  assert.equal(nt.position, "Non-Teaching Personnel");

  assert.equal(await userByUsername(`${RUN_LOWER}t1`), null, "preview must not create accounts");
  assert.equal(await profileByEmployee(headEmp), null, "preview must not create profiles");

  const batch = await batchRow(data.importId);
  assert.equal(batch.status, "previewed");
  assert.equal(Number(batch.user_id), Number(admin.user.id));

  const audited = await pool.query(
    `SELECT action FROM audit_logs
      WHERE action = 'personnel.import_previewed' AND details->>'batch_id' = $1`,
    [String(data.importId)]
  );
  assert.equal(audited.rowCount, 1);

  mainBatch = { importId: data.importId, token: data.token };
});

test("commit writes one profile and one active account per row", async () => {
  assert.ok(mainBatch, "the preview test must run first");

  const wrongToken = await commitImport(admin, mainBatch, "x".repeat(64));
  assert.equal(wrongToken.status, 403);
  assert.equal(wrongToken.body.code, "IMPORT_TOKEN_INVALID");
  assert.equal(await profileByEmployee(`${RUN}-HEAD`), null);

  const commit = await commitImport(admin, mainBatch);
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  const result = commit.body.data;
  assert.equal(result.status, "committed");
  assert.equal(result.imported.length, 3);
  assert.equal(result.credentials.length, 3, "every account gets one activation link");
  assert.equal(result.summary.accountsCreated, 3);
  mainBatch.credentials = result.credentials;

  const headUser = await userByUsername(`${RUN_LOWER}.head`);
  assert.ok(headUser, "the derived username account must exist");
  assert.equal(headUser.role, "school_head");
  assert.equal(headUser.approval_status, "active");
  assert.equal(headUser.is_active, true);
  assert.equal(Number(headUser.school_id), Number(school.id));
  assert.equal(Number(headUser.district_id), Number(school.district_id));
  assert.match(headUser.password_hash, /^\$2[aby]\$12\$/, "passwords are bcrypt cost 12");

  const headProfile = await profileByEmployee(`${RUN}-HEAD`);
  assert.ok(headProfile);
  assert.equal(Number(headProfile.user_id), Number(headUser.id));
  assert.equal(headProfile.first_name, "Ana");
  assert.equal(headProfile.position, "School Head");
  assert.equal(headProfile.is_teaching, true);
  const hired = await pool.query(
    "SELECT to_char(date_hired, 'YYYY-MM-DD') AS hired FROM personnel_profiles WHERE employee_no = $1",
    [`${RUN}-HEAD`]
  );
  assert.equal(hired.rows[0].hired, "2019-06-03");

  const teacherProfile = await profileByEmployee(`${RUN}-TEACH`);
  assert.equal(teacherProfile.position, "Master Teacher I");
  assert.equal(teacherProfile.employment_type, "provisional");

  const ntProfile = await profileByEmployee(`${RUN}-NT`);
  assert.equal(ntProfile.is_teaching, false);
  assert.equal(ntProfile.employment_status, "inactive");

  const credential = result.credentials.find((item) => item.username === `${RUN_LOWER}.head`);
  assert.ok(credential, "credentials are returned for each account");
  assert.match(credential.activationUrl, /\/reset-password\.html\?token=[a-f0-9]{64}$/);
  const rawToken = new URL(credential.activationUrl).searchParams.get("token");
  const stored = await pool.query(
    `SELECT token_hash, used_at, expires_at FROM password_reset_tokens WHERE user_id = $1`,
    [headUser.id]
  );
  assert.equal(stored.rowCount, 1);
  assert.equal(
    stored.rows[0].token_hash.trim(),
    crypto.createHash("sha256").update(rawToken).digest("hex"),
    "only the token hash is stored"
  );
  assert.equal(stored.rows[0].used_at, null);
  const days = (new Date(stored.rows[0].expires_at).getTime() - Date.now()) / 86400000;
  assert.ok(days > 6.5 && days <= 7.1, "activation links last seven days");

  const batch = await batchRow(mainBatch.importId);
  assert.equal(batch.status, "committed");
  assert.deepEqual(batch.valid_rows, [], "staged rows are purged after commit");
  assert.ok(!JSON.stringify(batch.summary).includes(rawToken), "raw tokens are never stored");

  const audited = await pool.query(
    `SELECT details FROM audit_logs
      WHERE action = 'personnel.imported' AND details->>'batch_id' = $1`,
    [String(mainBatch.importId)]
  );
  assert.equal(audited.rowCount, 1);
  assert.equal(audited.rows[0].details.accounts_created, 3);
  assert.ok(!("token" in audited.rows[0].details));

  const again = await commitImport(admin, mainBatch);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "IMPORT_NOT_PENDING");
});

test("activation link sets a password and signs the new teacher in", async () => {
  const teacherUser = await userByUsername(`${RUN_LOWER}t1`);
  assert.ok(teacherUser, "the teacher account must exist");
  assert.ok(mainBatch && mainBatch.credentials, "the commit response holds the one-time links");

  const credential = mainBatch.credentials.find((item) => item.username === `${RUN_LOWER}t1`);
  assert.ok(credential);
  const rawToken = new URL(credential.activationUrl).searchParams.get("token");
  assert.match(rawToken, /^[a-f0-9]{64}$/);

  const resetAgent = request.agent(app);
  const csrf = await fetchCsrf(resetAgent);

  const unknown = await resetAgent
    .post("/api/auth/reset-password")
    .set("X-CSRF-Token", csrf)
    .send({ token: "a".repeat(64), password: PASSWORD });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.code, "RESET_INVALID");

  const reset = await resetAgent
    .post("/api/auth/reset-password")
    .set("X-CSRF-Token", csrf)
    .send({ token: rawToken, password: PASSWORD });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));

  const secondAgent = request.agent(app);
  const secondCsrf = await fetchCsrf(secondAgent);
  const reused = await secondAgent
    .post("/api/auth/reset-password")
    .set("X-CSRF-Token", secondCsrf)
    .send({ token: rawToken, password: PASSWORD });
  assert.equal(reused.status, 400, "activation links are single use");

  const signedIn = await login({ username: `${RUN_LOWER}t1`, password: PASSWORD });
  assert.equal(signedIn.user.role, "teacher");
  assert.equal(Number(signedIn.user.schoolId), Number(school.id));

  const audited = await pool.query(
    `SELECT action FROM audit_logs
      WHERE action = 'user.password_reset' AND user_id = $1`,
    [teacherUser.id]
  );
  assert.equal(audited.rowCount, 1, "activation is audit-logged");
});

test("duplicates within the upload and against PostgreSQL are skipped", async () => {
  const importedHead = await profileByEmployee(`${RUN}-HEAD`);
  assert.ok(importedHead, "the earlier commit must have created the head profile");

  const file = staffFile([
    staffRow({
      personnel_type: "teacher",
      school_code: school.school_code,
      employee_no: `${RUN}-HEAD`,
      last_name: "Existing",
      first_name: "Employee",
      email: `${RUN_LOWER}.dup-emp@example.org`
    }),
    staffRow({
      personnel_type: "teacher",
      school_code: school.school_code,
      employee_no: `${RUN}-D2`,
      last_name: "Existing",
      first_name: "Email",
      email: `${RUN_LOWER}.head@example.org`
    }),
    staffRow({
      personnel_type: "teacher",
      school_code: school.school_code,
      employee_no: `${RUN}-D3`,
      last_name: "Existing",
      first_name: "Username",
      email: `${RUN_LOWER}.dup-user@example.org`,
      username: `${RUN_LOWER}t1`
    }),
    staffRow({
      personnel_type: "teacher",
      school_code: school.school_code,
      employee_no: `${RUN}-DUP`,
      last_name: "Repeat",
      first_name: "First",
      email: `${RUN_LOWER}.dup1@example.org`
    }),
    staffRow({
      personnel_type: "teacher",
      school_code: school.school_code,
      employee_no: `${RUN}-DUP`,
      last_name: "Repeat",
      first_name: "Second",
      email: `${RUN_LOWER}.dup2@example.org`
    }),
    staffRow({
      personnel_type: "non_teaching",
      school_code: school.school_code,
      employee_no: `${RUN}-NEW`,
      last_name: "Fresh",
      first_name: "Record",
      email: `${RUN_LOWER}.fresh@example.org`,
      username: `${RUN_LOWER}fresh`
    })
  ]);

  const preview = await previewUpload(admin, [{ name: `${RUN}-dupes.xlsx`, buffer: file }]);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const data = preview.body.data;
  assert.equal(data.summary.recordsDetected, 6);
  assert.equal(data.summary.duplicates, 4);
  assert.equal(data.summary.validRecords, 2);
  assert.equal(data.summary.rejected, 0);
  assert.ok(data.issues.every((item) => item.type === "duplicate"));
  assert.ok(
    data.issues.some((item) => /duplicated in this upload/i.test(item.reason)),
    "within-upload duplicates explain the first row"
  );

  const commit = await commitImport(admin, data);
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  assert.equal(commit.body.data.imported.length, 2);
  assert.equal(commit.body.data.duplicates, 4);

  const head = await profileByEmployee(`${RUN}-HEAD`);
  assert.equal(head.email, `${RUN_LOWER}.head@example.org`, "existing records are never overwritten");
  assert.ok(await profileByEmployee(`${RUN}-DUP`));
  assert.ok(await profileByEmployee(`${RUN}-NEW`));
});

test("district administrators import only into their own district", async () => {
  assert.ok(otherDistrictSchool, "a second district school is required");

  const file = staffFile([
    staffRow({
      personnel_type: "teacher",
      school_code: school.school_code,
      employee_no: `${RUN}-OWN`,
      last_name: "Own",
      first_name: "District",
      email: `${RUN_LOWER}.own@example.org`
    }),
    staffRow({
      personnel_type: "teacher",
      school_code: otherDistrictSchool.school_code,
      employee_no: `${RUN}-OTHER`,
      last_name: "Other",
      first_name: "District",
      email: `${RUN_LOWER}.other@example.org`
    }),
    staffRow({
      personnel_type: "teacher",
      school_code: "",
      employee_no: `${RUN}-BLANK`,
      last_name: "Blank",
      first_name: "Code",
      email: `${RUN_LOWER}.blank@example.org`
    })
  ]);

  const preview = await previewUpload(northAdmin, [{ name: `${RUN}-scope.xlsx`, buffer: file }]);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const data = preview.body.data;
  assert.equal(data.summary.recordsDetected, 3);
  assert.equal(data.summary.validRecords, 1);
  assert.equal(data.summary.rejected, 2);
  assert.ok(
    data.issues.some((item) => /not found among the active schools in your district/i.test(item.reason))
  );
  assert.ok(data.issues.some((item) => /school code is required/i.test(item.reason)));
  assert.equal(data.preview[0].schoolCode, school.school_code);

  const commit = await commitImport(northAdmin, data);
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  assert.equal(commit.body.data.imported.length, 1);
  assert.ok(await profileByEmployee(`${RUN}-OWN`));
  assert.equal(await profileByEmployee(`${RUN}-OTHER`), null);
  assert.equal(await profileByEmployee(`${RUN}-BLANK`), null);
});

test("invalid staff rows report file, sheet, row, column, and reason", async () => {
  const good = `${RUN}-GOOD`;
  const file = staffFile([
    staffRow({
      personnel_type: "teacher",
      school_code: school.school_code,
      employee_no: good,
      last_name: "Valid",
      first_name: "Row",
      email: `${RUN_LOWER}.good@example.org`
    }),
    staffRow({
      personnel_type: "teacher",
      school_code: school.school_code,
      employee_no: `${RUN}-MISS`,
      last_name: "",
      first_name: "NoSurname",
      email: `${RUN_LOWER}.miss@example.org`
    }),
    staffRow({
      personnel_type: "teacher",
      school_code: school.school_code,
      employee_no: `${RUN}-EMAIL`,
      last_name: "Bad",
      first_name: "Email",
      email: "not-an-email"
    }),
    staffRow({
      personnel_type: "teacher",
      school_code: school.school_code,
      employee_no: `${RUN}-DATE`,
      last_name: "Bad",
      first_name: "Date",
      email: `${RUN_LOWER}.date@example.org`,
      date_hired: "03/06/2019"
    }),
    staffRow({
      personnel_type: "teacher",
      school_code: school.school_code,
      employee_no: `${RUN}-EMPLOY`,
      last_name: "Bad",
      first_name: "Employment",
      email: `${RUN_LOWER}.employ@example.org`,
      employment_type: "permanent"
    }),
    staffRow({
      personnel_type: "janitor",
      school_code: school.school_code,
      employee_no: `${RUN}-TYPE`,
      last_name: "Bad",
      first_name: "Type",
      email: `${RUN_LOWER}.type@example.org`
    })
  ]);

  const preview = await previewUpload(admin, [{ name: `${RUN}-invalid.xlsx`, buffer: file }]);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const data = preview.body.data;
  assert.equal(data.summary.recordsDetected, 6);
  assert.equal(data.summary.validRecords, 1);
  assert.equal(data.summary.rejected, 5);

  const lastNameIssue = data.issues.find((item) => item.row === 3 && item.column === "last_name");
  assert.ok(lastNameIssue);
  assert.equal(lastNameIssue.file, `${RUN}-invalid.xlsx`);
  assert.equal(lastNameIssue.sheet, "Personnel");
  assert.ok(lastNameIssue.reason);
  assert.ok(data.issues.find((item) => item.row === 4 && item.column === "email"));
  assert.ok(data.issues.find((item) => item.row === 5 && item.column === "date_hired"));
  assert.ok(data.issues.find((item) => item.row === 6 && item.column === "employment_type"));
  assert.ok(data.issues.find((item) => item.row === 7 && item.column === "personnel_type"));

  const report = await getBinary(admin, `/api/personnel/imports/${data.importId}/errors.xlsx`);
  assert.equal(report.status, 200);
  const reportWorkbook = XLSX.read(report.body, { type: "buffer" });
  assert.ok(reportWorkbook.SheetNames.includes("Summary"));
  assert.ok(reportWorkbook.SheetNames.includes("Issues"));

  const commit = await commitImport(admin, data);
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  assert.equal(commit.body.data.imported.length, 1);
  assert.equal(commit.body.data.rejected, 5);
  assert.ok(await profileByEmployee(good));
  assert.equal(await profileByEmployee(`${RUN}-MISS`), null);
  assert.equal(await profileByEmployee(`${RUN}-TYPE`), null);
});

test("a corrupt file or a formula cell does not block valid files", async () => {
  const corrupt = Buffer.from("this is not a spreadsheet", "utf8");
  const formulaWorkbook = XLSX.utils.book_new();
  const formulaSheet = XLSX.utils.aoa_to_sheet([
    HEADERS,
    staffRow({
      personnel_type: "teacher",
      school_code: school.school_code,
      employee_no: `${RUN}-FORMULA`,
      last_name: "Formula",
      first_name: "Cell",
      email: `${RUN_LOWER}.formula@example.org`
    })
  ]);
  formulaSheet.A2 = { t: "s", f: "CONCAT(\"tea\",\"cher\")", v: "teacher" };
  XLSX.utils.book_append_sheet(formulaWorkbook, formulaSheet, "Personnel");
  const formula = XLSX.write(formulaWorkbook, { bookType: "xlsx", type: "buffer" });

  const good = staffFile([
    staffRow({
      personnel_type: "teacher",
      school_code: school.school_code,
      employee_no: `${RUN}-IND`,
      last_name: "Independent",
      first_name: "File",
      email: `${RUN_LOWER}.ind@example.org`
    })
  ]);

  const preview = await previewUpload(admin, [
    { name: `${RUN}-corrupt.xlsx`, buffer: corrupt },
    { name: `${RUN}-formula.xlsx`, buffer: formula },
    { name: `${RUN}-independent.xlsx`, buffer: good }
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
  assert.ok(await profileByEmployee(`${RUN}-IND`));
  assert.equal(await profileByEmployee(`${RUN}-FORMULA`), null);
});

test("history and error reports stay scoped to the importing account", async () => {
  const history = await admin.agent.get("/api/personnel/imports?limit=20");
  assert.equal(history.status, 200);
  const ids = (history.body.data || []).map((row) => Number(row.id));
  assert.ok(ids.includes(Number(mainBatch.importId)), "the importer sees their own batch");

  const otherHistory = await northAdmin.agent.get("/api/personnel/imports?limit=20");
  assert.equal(otherHistory.status, 200);
  assert.ok(
    !(otherHistory.body.data || []).some((row) => Number(row.id) === Number(mainBatch.importId)),
    "another administrator never sees the batch"
  );

  const foreignReport = await getBinary(
    northAdmin,
    `/api/personnel/imports/${mainBatch.importId}/errors.xlsx`
  );
  assert.equal(foreignReport.status, 404);

  const badLimit = await admin.agent.get("/api/personnel/imports?limit=0");
  assert.equal(badLimit.status, 400);
  assert.equal(badLimit.body.code, "VALIDATION_ERROR");
});
