"use strict";

process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const XLSX = require("xlsx");

const app = require("../server/app");
const { pool } = require("../server/config/database");
const {
  inspectFilename,
  inspectSpreadsheet,
  safeExportValue
} = require("../server/utils/spreadsheetGuard");
const schoolImportService = require("../server/services/schoolImportService");

const RUN = `SCH${Date.now().toString(36).slice(-6)}`.toUpperCase();
const PREFIX = `${RUN}-`;
const HEADERS = [
  "school_code",
  "school_name",
  "school_type",
  "address",
  "district_code",
  "school_head",
  "contact_email",
  "contact_phone",
  "student_count",
  "teacher_count",
  "performance_score",
  "status"
];
const DEMO = {
  system: { username: "sysadmin", password: "Admin@2026" },
  northAdmin: { username: "northadmin", password: "District@2026" },
  northStaff: { username: "northstaff", password: "Staff@2026" }
};

let admin = null;
let northAdmin = null;
let northStaff = null;
let seedDistrict = null;
let ownDistrict = null;
let otherDistrict = null;
let mainBatch = null;

async function cleanupTestData() {
  await pool.query("DELETE FROM schools WHERE school_code LIKE $1", [`${RUN}-%`]);
  await pool.query(
    `DELETE FROM school_import_batches
      WHERE files::text LIKE $1 OR issues::text LIKE $1 OR valid_rows::text LIKE $1`,
    [`%${RUN}%`]
  );
  await pool.query(
    `DELETE FROM audit_logs
      WHERE action LIKE 'school.import%'
        AND details::text LIKE $1`,
    [`%${RUN}%`]
  );
}

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

function schoolRow(code, districtCode, overrides = {}) {
  if (overrides.row) {
    return overrides.row;
  }
  return [
    code,
    overrides.name === undefined ? `${RUN} School ${code}` : overrides.name,
    overrides.type === undefined ? "Elementary School" : overrides.type,
    overrides.address === undefined ? "123 School Street, Barangay Poblacion" : overrides.address,
    districtCode === undefined ? null : districtCode,
    overrides.head === undefined ? "Maria Santos" : overrides.head,
    overrides.email === undefined ? "school@example.org" : overrides.email,
    overrides.phone === undefined ? "+63 2 8000 0000" : overrides.phone,
    overrides.students === undefined ? 850 : overrides.students,
    overrides.teachers === undefined ? 32 : overrides.teachers,
    overrides.score === undefined ? 88.5 : overrides.score,
    overrides.status === undefined ? "active" : overrides.status
  ];
}

function workbookBuffer(rows, options = {}) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([HEADERS, ...rows]);
  XLSX.utils.book_append_sheet(workbook, sheet, options.sheetName || "Schools");
  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

function csvBuffer(rows) {
  const lines = [HEADERS.join(",")].concat(
    rows.map((row) =>
      row
        .map((value) => {
          const text = value === null || value === undefined ? "" : String(value);
          return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(",")
    )
  );
  return Buffer.from(lines.join("\n"), "utf8");
}

function previewUpload(session, files) {
  let builder = session.agent
    .post("/api/schools/imports/preview")
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
    .post(`/api/schools/imports/${batch.importId}/commit`)
    .set("X-CSRF-Token", session.csrfToken)
    .send({ token });
}

function getBinary(session, path) {
  return session.agent
    .get(path)
    .buffer(true)
    .parse((res, callback) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => callback(null, Buffer.concat(chunks)));
    });
}

async function schoolByCode(code) {
  const result = await pool.query("SELECT * FROM schools WHERE school_code = $1", [code]);
  return result.rows[0] || null;
}

async function importBatchRow(id) {
  const result = await pool.query("SELECT * FROM school_import_batches WHERE id = $1", [id]);
  return result.rows[0] || null;
}

before(async () => {
  admin = await login(DEMO.system);
  northAdmin = await login(DEMO.northAdmin);
  northStaff = await login(DEMO.northStaff);

  const seed = await pool.query(
    "SELECT id, district_code, district_name FROM districts ORDER BY id LIMIT 1"
  );
  assert.ok(seed.rows[0], "the database must be seeded before running tests (npm run db:init)");
  seedDistrict = seed.rows[0];

  assert.ok(northAdmin.user.districtId, "the district administrator must be scoped to a district");
  const own = await pool.query(
    "SELECT id, district_code, district_name FROM districts WHERE id = $1",
    [northAdmin.user.districtId]
  );
  ownDistrict = own.rows[0];
  assert.ok(ownDistrict, "the district administrator's district must exist");

  const other = await pool.query(
    "SELECT id, district_code, district_name FROM districts WHERE id <> $1 ORDER BY id LIMIT 1",
    [ownDistrict.id]
  );
  otherDistrict = other.rows[0] || null;

  await cleanupTestData();
});

after(async () => {
  await cleanupTestData();
  await pool.end();
});

test("school import endpoints require an administrator with add permission", async () => {
  const anonymous = await request(app).get("/api/schools/imports/template");
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.code, "AUTH_REQUIRED");

  const teacher = await northStaff.agent.get("/api/schools/imports/template");
  assert.equal(teacher.status, 403);
  assert.equal(teacher.body.code, "FORBIDDEN");

  const districtTemplate = await getBinary(northAdmin, "/api/schools/imports/template");
  assert.equal(districtTemplate.status, 200, "district administrators may upload schools for their own district");

  const missingCsrf = await admin.agent
    .post("/api/schools/imports/preview")
    .attach("files", workbookBuffer([schoolRow(`${RUN}-NOCSRF`, seedDistrict.district_code)]), {
      filename: `${RUN}-no-csrf.xlsx`
    });
  assert.equal(missingCsrf.status, 403);
  assert.equal(missingCsrf.body.code, "CSRF_INVALID");
});

test("school template download matches the school schema", async () => {
  const response = await getBinary(admin, "/api/schools/imports/template");
  assert.equal(response.status, 200);
  assert.match(String(response.headers["content-type"]), /spreadsheetml\.sheet/);
  assert.match(String(response.headers["content-disposition"]), /attachment/);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.ok(Buffer.isBuffer(response.body), "template should be binary");

  const workbook = XLSX.read(response.body, { type: "buffer" });
  assert.ok(workbook.SheetNames.includes("Schools"));
  assert.ok(workbook.SheetNames.includes("Example"));
  assert.ok(workbook.SheetNames.includes("Instructions"));

  const schools = XLSX.utils.sheet_to_json(workbook.Sheets.Schools, { header: 1 });
  assert.deepEqual(schools[0], HEADERS, "template headers must match the mapped fields");
  assert.equal(schools.length, 1, "the template sheet must not contain sample data");

  const example = XLSX.utils.sheet_to_json(workbook.Sheets.Example, { header: 1 });
  assert.equal(example.length, 2, "the example row lives on its own sheet");
});

test("preview validates school records without writing to PostgreSQL", async () => {
  const codeA = `${PREFIX}A1`;
  const codeB = `${PREFIX}A2`;

  const file = workbookBuffer([
    schoolRow(codeA, seedDistrict.district_code, { name: `  ${RUN} Alpha School  `, status: "" }),
    schoolRow(codeB, seedDistrict.district_code, { name: `${RUN} Beta School`, status: "inactive" })
  ]);
  const response = await previewUpload(admin, [{ name: `${RUN}-alpha.xlsx`, buffer: file }]);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const data = response.body.data;

  assert.equal(data.summary.files, 1);
  assert.equal(data.summary.recordsDetected, 2);
  assert.equal(data.summary.validRecords, 2);
  assert.equal(data.summary.rejected, 0);
  assert.equal(data.summary.duplicates, 0);
  assert.equal(data.files[0].status, "valid");
  assert.equal(data.preview.length, 2);
  assert.equal(data.preview[0].name, `${RUN} Alpha School`, "values are trimmed");
  assert.equal(data.preview[0].districtCode, seedDistrict.district_code);
  assert.equal(data.preview[0].status, "active", "blank status defaults to active");
  assert.ok(data.token && data.token.length >= 32);
  assert.equal(typeof data.expiresAt, "string");

  assert.equal(await schoolByCode(codeA), null, "preview must not insert records");
  assert.equal(await schoolByCode(codeB), null, "preview must not insert records");

  const batch = await importBatchRow(data.importId);
  assert.equal(batch.status, "previewed");
  assert.equal(Number(batch.user_id), Number(admin.user.id));

  const audited = await pool.query(
    `SELECT action FROM audit_logs
      WHERE action = 'school.import_previewed' AND details->>'batch_id' = $1`,
    [String(data.importId)]
  );
  assert.equal(audited.rowCount, 1, "preview must be audit-logged");

  mainBatch = {
    importId: data.importId,
    token: data.token,
    summary: data.summary
  };
});

test("commit requires the preview token and writes once", async () => {
  assert.ok(mainBatch, "preview test must run first");

  const wrongToken = await commitImport(admin, mainBatch, "x".repeat(64));
  assert.equal(wrongToken.status, 403);
  assert.equal(wrongToken.body.code, "IMPORT_TOKEN_INVALID");
  assert.equal(await schoolByCode(`${PREFIX}A1`), null);

  const commit = await commitImport(admin, mainBatch);
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  const result = commit.body.data;
  assert.equal(result.status, "committed");
  assert.equal(result.imported.length, 2);
  assert.equal(result.summary.imported, 2);
  assert.equal(result.duplicates, 0);

  const first = await schoolByCode(`${PREFIX}A1`);
  assert.ok(first, "committed school must exist");
  assert.equal(first.school_name, `${RUN} Alpha School`);
  assert.equal(first.school_type, "Elementary School");
  assert.equal(first.school_head, "Maria Santos");
  assert.equal(first.student_count, 850);
  assert.equal(first.teacher_count, 32);
  assert.equal(Number(first.performance_score), 88.5);
  assert.equal(first.status, "active");
  assert.equal(Number(first.district_id), Number(seedDistrict.id));
  assert.equal((await schoolByCode(`${PREFIX}A2`)).status, "inactive");

  const batch = await importBatchRow(mainBatch.importId);
  assert.equal(batch.status, "committed");
  assert.deepEqual(batch.valid_rows, [], "staged records are purged after commit");
  assert.ok(batch.committed_at);

  const audited = await pool.query(
    `SELECT details FROM audit_logs
      WHERE action = 'school.imported' AND details->>'batch_id' = $1`,
    [String(mainBatch.importId)]
  );
  assert.equal(audited.rowCount, 1);
  assert.equal(audited.rows[0].details.imported, 2);
  assert.ok(!("token" in audited.rows[0].details));

  const again = await commitImport(admin, mainBatch);
  assert.equal(again.status, 409);
  assert.equal(again.body.code, "IMPORT_NOT_PENDING");
});

test("multiple files and CSV imports commit independently", async () => {
  const codeC = `${PREFIX}C1`;
  const codeD = `${PREFIX}D1`;
  const codeE = `${PREFIX}E1`;

  const fileOne = workbookBuffer([
    schoolRow(codeC, seedDistrict.district_code),
    schoolRow(codeD, seedDistrict.district_code)
  ]);
  const fileTwo = csvBuffer([
    schoolRow(codeE, seedDistrict.district_code, { type: "High School" })
  ]);
  const preview = await previewUpload(admin, [
    { name: `${RUN}-multi.xlsx`, buffer: fileOne },
    { name: `${RUN}-multi.csv`, buffer: fileTwo, type: "text/csv" }
  ]);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.data.summary.files, 2);
  assert.equal(preview.body.data.summary.validRecords, 3);
  assert.deepEqual(
    preview.body.data.files.map((item) => item.status),
    ["valid", "valid"]
  );

  const commit = await commitImport(admin, preview.body.data);
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  assert.equal(commit.body.data.imported.length, 3);
  for (const code of [codeC, codeD, codeE]) {
    assert.ok(await schoolByCode(code), `school ${code} should be imported`);
  }
  assert.equal((await schoolByCode(codeE)).school_type, "High School");
});

test("duplicates within files, across files, and against the database are skipped", async () => {
  const intra = `${PREFIX}INTRA`;
  const cross = `${PREFIX}CROSS`;
  const seedSchool = await pool.query("SELECT school_code FROM schools ORDER BY id LIMIT 1");
  assert.ok(seedSchool.rows[0], "a seeded school is required");
  const existingCode = seedSchool.rows[0].school_code;

  const fileOne = workbookBuffer([
    schoolRow(existingCode, seedDistrict.district_code, { name: `${RUN} Existing Code` }),
    schoolRow(intra, seedDistrict.district_code, { name: `${RUN} Intra One` }),
    schoolRow(intra.toUpperCase(), seedDistrict.district_code, { name: `${RUN} Intra Two` }),
    schoolRow(cross, seedDistrict.district_code, { name: `${RUN} Cross One` })
  ]);
  const fileTwo = workbookBuffer([
    schoolRow(cross.toLowerCase(), seedDistrict.district_code, { name: `${RUN} Cross Two` })
  ]);
  const preview = await previewUpload(admin, [
    { name: `${RUN}-dupes-one.xlsx`, buffer: fileOne },
    { name: `${RUN}-dupes-two.xlsx`, buffer: fileTwo }
  ]);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const data = preview.body.data;
  assert.equal(data.summary.recordsDetected, 5);
  assert.equal(data.summary.duplicates, 3);
  assert.equal(data.summary.validRecords, 2);
  assert.ok(data.issues.every((item) => item.type === "duplicate"));
  assert.ok(
    data.issues.some((item) => /in this upload/i.test(item.reason)),
    "within-file duplicates should explain the first row"
  );

  const commit = await commitImport(admin, data);
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  assert.equal(commit.body.data.imported.length, 2);
  assert.equal(commit.body.data.duplicates, 3);
  const existing = await schoolByCode(existingCode);
  assert.notEqual(existing.school_name, `${RUN} Existing Code`, "existing records are never overwritten");
});

test("district administrators can only import into their own district", async () => {
  assert.ok(otherDistrict, "a second district is required for the scope test");
  const ownCode = `${PREFIX}OWN`;
  const otherCode = `${PREFIX}OTHER`;

  const file = workbookBuffer([
    schoolRow(ownCode, "", { name: `${RUN} Own District School` }),
    schoolRow(otherCode, otherDistrict.district_code, { name: `${RUN} Other District School` })
  ]);
  const preview = await previewUpload(northAdmin, [{ name: `${RUN}-scope.xlsx`, buffer: file }]);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const data = preview.body.data;
  assert.equal(data.summary.recordsDetected, 2);
  assert.equal(data.summary.validRecords, 1, "the blank district resolves to the administrator's own district");
  assert.equal(data.summary.rejected, 1);
  const scopeIssue = data.issues.find((item) => /not found in your district scope/i.test(item.reason));
  assert.ok(scopeIssue, "a district outside the administrator's scope must be rejected");
  assert.equal(data.preview[0].districtCode, ownDistrict.district_code);

  const commit = await commitImport(northAdmin, data);
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  assert.equal(commit.body.data.imported.length, 1);
  const own = await schoolByCode(ownCode);
  assert.ok(own);
  assert.equal(Number(own.district_id), Number(ownDistrict.id));
  assert.equal(await schoolByCode(otherCode), null);
});

test("invalid rows are rejected with file, sheet, row, column, and reason", async () => {
  const good = `${PREFIX}GOOD`;
  const missing = `${PREFIX}MISS1`;
  const badEmail = `${PREFIX}BAD1`;

  const file = workbookBuffer([
    schoolRow(good, seedDistrict.district_code),
    schoolRow(missing, seedDistrict.district_code, { name: "   " }),
    schoolRow(badEmail, seedDistrict.district_code, { email: "not-an-email" })
  ]);
  const preview = await previewUpload(admin, [{ name: `${RUN}-invalid.xlsx`, buffer: file }]);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const data = preview.body.data;
  assert.equal(data.summary.validRecords, 1);
  assert.equal(data.summary.rejected, 2);
  assert.equal(data.files[0].status, "warning");

  const nameIssue = data.issues.find((item) => item.row === 3 && item.column === "school_name");
  assert.ok(nameIssue, "the empty-name row should be reported");
  assert.equal(nameIssue.file, `${RUN}-invalid.xlsx`);
  assert.equal(nameIssue.sheet, "Schools");
  assert.equal(nameIssue.row, 3);
  assert.ok(nameIssue.reason);

  const emailIssue = data.issues.find((item) => item.row === 4 && /email/i.test(item.column));
  assert.ok(emailIssue, "the invalid email should be reported");

  const report = await getBinary(admin, `/api/schools/imports/${data.importId}/errors.xlsx`);
  assert.equal(report.status, 200);
  assert.match(String(report.headers["content-type"]), /spreadsheetml\.sheet/);
  const reportWorkbook = XLSX.read(report.body, { type: "buffer" });
  assert.ok(reportWorkbook.SheetNames.includes("Summary"));
  assert.ok(reportWorkbook.SheetNames.includes("Files"));
  assert.ok(reportWorkbook.SheetNames.includes("Issues"));
  const issuesSheet = XLSX.utils.sheet_to_json(reportWorkbook.Sheets.Issues, { header: 1 });
  assert.ok(issuesSheet.length >= 3, "report lists each rejected row");

  const commit = await commitImport(admin, data);
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  assert.equal(commit.body.data.imported.length, 1);
  assert.equal(commit.body.data.rejected, 2);
  assert.ok(await schoolByCode(good));
  assert.equal(await schoolByCode(missing), null);
  assert.equal(await schoolByCode(badEmail), null);
});

test("a corrupt file does not block valid files in the same upload", async () => {
  const code = `${PREFIX}IND`;

  const corrupt = Buffer.from("this is not a spreadsheet", "utf8");
  const good = workbookBuffer([schoolRow(code, seedDistrict.district_code)]);
  const truncated = good.subarray(0, 200);
  const preview = await previewUpload(admin, [
    { name: `${RUN}-corrupt.xlsx`, buffer: corrupt },
    { name: `${RUN}-independent.xlsx`, buffer: good },
    { name: `${RUN}-interrupted.xlsx`, buffer: truncated }
  ]);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const data = preview.body.data;
  assert.equal(data.files[0].status, "failed");
  assert.match(data.files[0].error, /zip/i);
  assert.equal(data.files[1].status, "valid");
  assert.equal(data.files[2].status, "failed", "a truncated upload is rejected");
  assert.match(data.files[2].error, /archive|zip/i);
  assert.equal(data.summary.validRecords, 1);

  const commit = await commitImport(admin, data);
  assert.equal(commit.status, 200, JSON.stringify(commit.body));
  assert.equal(commit.body.data.imported.length, 1);
  assert.ok(await schoolByCode(code));
});

test("formulas, macro-enabled workbooks, and executable files are rejected", async () => {
  const formulaWorkbook = XLSX.utils.book_new();
  const formulaSheet = XLSX.utils.aoa_to_sheet([
    HEADERS,
    schoolRow(`${PREFIX}FORMULA`, seedDistrict.district_code)
  ]);
  formulaSheet.A2 = { t: "s", f: 'CONCATENATE("Evil", " School")', v: "Evil School" };
  XLSX.utils.book_append_sheet(formulaWorkbook, formulaSheet, "Schools");
  const formulaBuffer = XLSX.write(formulaWorkbook, { bookType: "xlsx", type: "buffer" });

  const formulaPreview = await previewUpload(admin, [
    { name: `${RUN}-formula.xlsx`, buffer: formulaBuffer }
  ]);
  assert.equal(formulaPreview.status, 200, JSON.stringify(formulaPreview.body));
  assert.equal(formulaPreview.body.data.files[0].status, "failed");
  assert.match(formulaPreview.body.data.files[0].error, /formula/i);
  assert.equal(formulaPreview.body.data.summary.validRecords, 0);

  const ole = Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.from("_VBA_PROJECT", "utf16le"),
    Buffer.alloc(256)
  ]);
  const macroPreview = await previewUpload(admin, [{ name: `${RUN}-macro.xls`, buffer: ole }]);
  assert.equal(macroPreview.status, 200, JSON.stringify(macroPreview.body));
  assert.equal(macroPreview.body.data.files[0].status, "failed");
  assert.match(macroPreview.body.data.files[0].error, /macro/i);

  const executableBuffer = workbookBuffer([
    schoolRow(`${PREFIX}EXE`, seedDistrict.district_code)
  ]);
  const executablePreview = await previewUpload(admin, [
    { name: "invoice.exe", buffer: executableBuffer }
  ]);
  assert.equal(executablePreview.status, 200, JSON.stringify(executablePreview.body));
  assert.equal(executablePreview.body.data.files[0].status, "failed");
  assert.match(executablePreview.body.data.files[0].error, /supported/i);
  assert.equal(executablePreview.body.data.summary.validRecords, 0);
});

test("spreadsheet helpers reject traversal, formula injection, and macro payloads", () => {
  assert.match(inspectFilename("../secret.xlsx").error, /path/i);
  assert.match(inspectFilename("..\\secret.xlsx").error, /path/i);
  assert.match(inspectFilename("bad\u0000name.xlsx").error, /control|path/i);
  assert.match(inspectFilename("payload.exe").error, /supported/i);
  assert.equal(inspectFilename("Schools 2026.xlsx").extension, ".xlsx");

  assert.throws(() => inspectSpreadsheet(Buffer.from("plain text"), ".xlsx"), /ZIP/i);
  assert.throws(
    () =>
      inspectSpreadsheet(
        Buffer.concat([
          Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
          Buffer.from("VBA", "utf16le")
        ]),
        ".xls"
      ),
    /macro/i
  );

  assert.equal(safeExportValue("=1+1"), "'=1+1");
  assert.equal(safeExportValue("+SUM(A1)"), "'+SUM(A1)");
  assert.equal(safeExportValue("@cmd"), "'@cmd");
  assert.equal(safeExportValue("ordinary"), "ordinary");
});

test("oversized uploads and too many files are rejected before parsing", async () => {
  const oversized = Buffer.alloc(5 * 1024 * 1024 + 1, 0x41);
  const tooLarge = await previewUpload(admin, [{ name: `${RUN}-huge.xlsx`, buffer: oversized }]);
  assert.equal(tooLarge.status, 413);
  assert.equal(tooLarge.body.code, "SPREADSHEET_TOO_LARGE");

  const chunks = Array.from({ length: 4 }, () => Buffer.alloc(4 * 1024 * 1024, 0x42));
  const tooMuch = await previewUpload(
    admin,
    chunks.map((buffer, index) => ({ name: `${RUN}-part${index}.xlsx`, buffer }))
  );
  assert.equal(tooMuch.status, 413);
  assert.equal(tooMuch.body.code, "TOTAL_TOO_LARGE");

  const small = workbookBuffer([schoolRow(`${PREFIX}SIX`, seedDistrict.district_code)]);
  const tooMany = await previewUpload(
    admin,
    Array.from({ length: 6 }, (unused, index) => ({
      name: `${RUN}-six-${index}.xlsx`,
      buffer: small
    }))
  );
  assert.equal(tooMany.status, 400);
  assert.ok(
    ["TOO_MANY_FILES", "UPLOAD_FIELD_INVALID"].includes(tooMany.body.code),
    `unexpected code ${tooMany.body.code}`
  );
});

test("SQL injection strings and script payloads are stored as plain data", async () => {
  const injectionCode = `${PREFIX}SQLI`;
  const scriptCode = `${PREFIX}XSS`;
  const injectionName = "Robert'); DROP TABLE schools;--";
  const scriptName = "<script>alert(1)</script> School";

  const file = workbookBuffer([
    schoolRow(injectionCode, seedDistrict.district_code, { name: injectionName }),
    schoolRow(scriptCode, seedDistrict.district_code, { name: scriptName })
  ]);
  const preview = await previewUpload(admin, [{ name: `${RUN}-payloads.xlsx`, buffer: file }]);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.data.summary.validRecords, 2);

  const commit = await commitImport(admin, preview.body.data);
  assert.equal(commit.status, 200, JSON.stringify(commit.body));

  const tableStillExists = await pool.query("SELECT count(*)::int AS total FROM schools");
  assert.ok(tableStillExists.rows[0].total >= 2, "the schools table must still exist");
  assert.equal((await schoolByCode(injectionCode)).school_name, injectionName);
  assert.equal((await schoolByCode(scriptCode)).school_name, scriptName);
});

test("expired previews cannot be committed", async () => {
  const code = `${PREFIX}EXP`;
  const file = workbookBuffer([schoolRow(code, seedDistrict.district_code)]);
  const preview = await previewUpload(admin, [{ name: `${RUN}-expiring.xlsx`, buffer: file }]);
  assert.equal(preview.status, 200, JSON.stringify(preview.body));

  await pool.query(
    "UPDATE school_import_batches SET expires_at = now() - interval '1 minute' WHERE id = $1",
    [preview.body.data.importId]
  );
  const commit = await commitImport(admin, preview.body.data);
  assert.equal(commit.status, 409);
  assert.equal(commit.body.code, "IMPORT_EXPIRED");
  assert.equal(await schoolByCode(code), null);

  const batch = await importBatchRow(preview.body.data.importId);
  assert.equal(batch.status, "expired");
});

test("header validation blocks unknown, reserved, duplicate, and missing columns", async () => {
  const cases = [
    {
      name: "unknown column",
      rows: [HEADERS.concat("favourite_colour"), schoolRow(`${PREFIX}HDR1`, seedDistrict.district_code).concat("blue")],
      reason: /not part of the school import template/i
    },
    {
      name: "reserved column",
      rows: [["district_id"].concat(HEADERS), ["1"].concat(schoolRow(`${PREFIX}HDR2`, seedDistrict.district_code))],
      reason: /database-controlled/i
    },
    {
      name: "duplicate column",
      rows: [HEADERS.concat("school_name"), schoolRow(`${PREFIX}HDR3`, seedDistrict.district_code).concat("Again")],
      reason: /more than once/i
    },
    {
      name: "missing required column",
      rows: [
        HEADERS.filter((header) => header !== "school_head"),
        schoolRow(`${PREFIX}HDR4`, seedDistrict.district_code).filter(
          (value, index) => index !== 5
        )
      ],
      reason: /missing required column/i
    }
  ];

  for (const testCase of cases) {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet(testCase.rows),
      "Schools"
    );
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
    const preview = await previewUpload(admin, [
      { name: `${RUN}-${testCase.name.replace(/\s+/g, "-")}.xlsx`, buffer }
    ]);
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.data.summary.validRecords, 0, testCase.name);
    assert.equal(preview.body.data.files[0].status, "failed", testCase.name);
    assert.match(preview.body.data.files[0].error, testCase.reason, testCase.name);
  }
});

test("history and error reports are scoped to the authenticated administrator", async () => {
  const history = await admin.agent.get("/api/schools/imports?limit=10");
  assert.equal(history.status, 200);
  assert.ok(Array.isArray(history.body.data));
  assert.ok(history.body.data.length >= 1);
  const serialized = JSON.stringify(history.body.data);
  assert.ok(!serialized.includes('"token"'), "history must not expose confirmation tokens");
  assert.ok(!serialized.includes("valid_rows"), "history must not expose staged rows");

  const districtHistory = await northAdmin.agent.get("/api/schools/imports?limit=10");
  assert.equal(districtHistory.status, 200);
  assert.ok(
    districtHistory.body.data.every((row) => row.id !== mainBatch.importId),
    "another administrator must not see this account's batches"
  );

  const teacher = await northStaff.agent.get("/api/schools/imports");
  assert.equal(teacher.status, 403);

  const notFound = await admin.agent.get("/api/schools/imports/999999/errors.xlsx");
  assert.equal(notFound.status, 404);

  const invalidLimit = await admin.agent.get("/api/schools/imports?limit=500");
  assert.equal(invalidLimit.status, 400);
});

test("the service exposes the validated school field catalog", () => {
  const keys = schoolImportService.FIELD_DEFINITIONS.map((field) => field.key);
  assert.deepEqual(keys, HEADERS);
  assert.ok(schoolImportService.SCHOOL_CODE_PATTERN.test("NVD-001"));
  assert.ok(!schoolImportService.SCHOOL_CODE_PATTERN.test("NVD 001"));
});
