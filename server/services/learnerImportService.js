"use strict";

// Secure bulk import for permanent learner profiles.
//
// Profiles only: no enrollment, guardian, grade, attendance, health, or form
// record is created here. Every row is validated against the same rules as the
// manual learner form and inserted with a parameterized statement.

const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const {
  fail,
  optionalEmail,
  optionalNumber,
  optionalPhone,
  optionalString,
  requireEnum,
  requireString
} = require("../utils/validators");
const { SPREADSHEET_LIMITS } = require("../utils/spreadsheetGuard");
const { createToken, safeEqual } = require("../utils/tokens");
const auditService = require("./auditService");
const {
  IMPORT_TTL_MINUTES,
  issue,
  cellText,
  createHeaderResolver,
  scanFiles,
  buildTemplateWorkbook,
  buildErrorWorkbook,
  insertImportBatch,
  loadBatchForUser,
  importHistory,
  countRejectedRows
} = require("../utils/spreadsheetImport");

const IMPORT_KEY = "learner";
const SCHOOL_CODE_PATTERN = /^[A-Z0-9-]+$/;
const ZIP_PATTERN = /^\d{4,10}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SEX_ALIASES = {
  male: "male",
  m: "male",
  female: "female",
  f: "female"
};
const DISTRICT_WIDE_ROLES = new Set(["district_admin", "psds", "staff"]);
const SCHOOL_ROLES = new Set(["school_head", "teacher", "coordinator", "adviser", "nt", "learner"]);

const RESERVED_HEADERS = new Set([
  "id",
  "user_id",
  "district_id",
  "school_id",
  "archived_at",
  "created_by",
  "created_at",
  "updated_at"
]);

function requireLrn(value) {
  const lrn = requireString(value, "LRN", { min: 12, max: 12 }).replace(/\s+/g, "");
  if (!/^\d{12}$/.test(lrn)) {
    fail("The LRN must be exactly 12 digits.", { field: "lrn" });
  }
  return lrn;
}

function requireBirthDate(value) {
  const text = requireString(value, "Birth date", { min: 10, max: 10 });
  if (!DATE_PATTERN.test(text)) {
    fail("Birth date must use the YYYY-MM-DD format.", { field: "birth_date" });
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    fail("Birth date is not a valid date.", { field: "birth_date" });
  }
  const today = new Date().toISOString().slice(0, 10);
  if (text > today) {
    fail("Birth date cannot be in the future.", { field: "birth_date" });
  }
  if (text < "1900-01-01") {
    fail("Birth date is out of range.", { field: "birth_date" });
  }
  return text;
}

function requireSex(value) {
  const text = requireString(value, "Sex", { min: 1, max: 6 }).toLowerCase();
  const normalized = SEX_ALIASES[text];
  if (!normalized) {
    fail("Sex must be male or female.", { field: "sex" });
  }
  return normalized;
}

function optionalZip(value) {
  const text = optionalString(value, "ZIP code", { min: 4, max: 10 });
  if (text === null) {
    return null;
  }
  if (!ZIP_PATTERN.test(text)) {
    fail("Enter a valid Philippine ZIP code.", { field: "zip_code" });
  }
  return text;
}

const FIELD_DEFINITIONS = [
  {
    key: "lrn",
    label: "LRN",
    required: true,
    aliases: ["lrn", "learner reference number", "learner reference no"],
    validate(value) {
      return requireLrn(value);
    }
  },
  {
    key: "last_name",
    label: "Last name",
    required: true,
    aliases: ["last_name", "last name", "surname", "family name"],
    validate(value) {
      return requireString(value, "Last name", { min: 1, max: 80 });
    }
  },
  {
    key: "first_name",
    label: "First name",
    required: true,
    aliases: ["first_name", "first name", "given name"],
    validate(value) {
      return requireString(value, "First name", { min: 1, max: 80 });
    }
  },
  {
    key: "middle_name",
    label: "Middle name",
    required: false,
    aliases: ["middle_name", "middle name"],
    validate(value) {
      return optionalString(value, "Middle name", { max: 80 });
    }
  },
  {
    key: "extension_name",
    label: "Name extension",
    required: false,
    aliases: ["extension_name", "name extension", "suffix"],
    validate(value) {
      return optionalString(value, "Name extension", { max: 16 });
    }
  },
  {
    key: "birth_date",
    label: "Birth date",
    required: true,
    aliases: ["birth_date", "birth date", "date of birth", "birthday"],
    validate(value) {
      return requireBirthDate(value);
    }
  },
  {
    key: "sex",
    label: "Sex",
    required: true,
    aliases: ["sex", "gender"],
    validate(value) {
      return requireSex(value);
    }
  },
  {
    key: "weight_kg",
    label: "Weight (kg)",
    required: false,
    aliases: ["weight_kg", "weight", "weight kg", "weight (kg)"],
    validate(value) {
      return optionalNumber(value, "Weight", { min: 1, max: 500 });
    }
  },
  {
    key: "height_cm",
    label: "Height (cm)",
    required: false,
    aliases: ["height_cm", "height", "height cm", "height (cm)"],
    validate(value) {
      return optionalNumber(value, "Height", { min: 1, max: 300 });
    }
  },
  {
    key: "house_number",
    label: "House number / street",
    required: false,
    aliases: ["house_number", "house number", "street", "house number street"],
    validate(value) {
      return optionalString(value, "House number / street", { max: 120 });
    }
  },
  {
    key: "barangay",
    label: "Barangay",
    required: false,
    aliases: ["barangay", "brgy"],
    validate(value) {
      return optionalString(value, "Barangay", { max: 120 });
    }
  },
  {
    key: "municipality",
    label: "Municipality / city",
    required: false,
    aliases: ["municipality", "city", "municipality city", "town"],
    validate(value) {
      return optionalString(value, "Municipality / city", { max: 120 });
    }
  },
  {
    key: "province",
    label: "Province",
    required: false,
    aliases: ["province"],
    validate(value) {
      return optionalString(value, "Province", { max: 120 });
    }
  },
  {
    key: "region",
    label: "Region",
    required: false,
    aliases: ["region"],
    validate(value) {
      return optionalString(value, "Region", { max: 120 });
    }
  },
  {
    key: "zip_code",
    label: "ZIP code",
    required: false,
    aliases: ["zip_code", "zip code", "postal code", "zip"],
    validate(value) {
      return optionalZip(value);
    }
  },
  {
    key: "contact_number",
    label: "Contact number",
    required: false,
    aliases: ["contact_number", "contact number", "phone", "mobile"],
    validate(value) {
      return optionalPhone(value, "Contact number");
    }
  },
  {
    key: "email",
    label: "Email address",
    required: false,
    aliases: ["email", "email address"],
    validate(value) {
      return optionalEmail(value, "Email address");
    }
  },
  {
    key: "school_code",
    label: "School code",
    required: true,
    aliases: ["school_code", "school code", "school", "school id"],
    validate(value) {
      const code = optionalString(value, "School code", { min: 2, max: 32 });
      if (code === null) {
        return null;
      }
      const normalized = code.toUpperCase();
      if (!SCHOOL_CODE_PATTERN.test(normalized)) {
        fail("School code may only contain letters, numbers, and hyphens.", {
          field: "school_code"
        });
      }
      return normalized;
    }
  }
];

const TEMPLATE_HEADERS = FIELD_DEFINITIONS.map((field) => field.key);
const resolveHeaders = createHeaderResolver({
  fields: FIELD_DEFINITIONS,
  reservedHeaders: RESERVED_HEADERS,
  templateLabel: "learner import"
});

async function loadSchoolContext(user) {
  const isSystemAdmin = user.role === "system_admin";
  const params = [];
  let scope = "";
  let fixedSchoolId = null;

  if (!isSystemAdmin) {
    if (DISTRICT_WIDE_ROLES.has(user.role)) {
      if (!user.districtId) {
        throw new HttpError(
          400,
          "Your account is not assigned to a district. Contact a system administrator.",
          "DISTRICT_REQUIRED"
        );
      }
      params.push(user.districtId);
      scope = ` AND s.district_id = $${params.length}`;
    } else if (SCHOOL_ROLES.has(user.role) && user.schoolId) {
      fixedSchoolId = Number(user.schoolId);
      params.push(fixedSchoolId);
      scope = ` AND s.id = $${params.length}`;
    } else {
      throw new HttpError(
        403,
        "You do not have access to a school for learner imports.",
        "SCHOOL_FORBIDDEN"
      );
    }
  }

  const result = await query(
    `SELECT s.id, s.school_code, s.school_name, s.district_id, d.district_name
       FROM schools s
       JOIN districts d ON d.id = s.district_id
      WHERE s.status = 'active'${scope}
      ORDER BY s.school_name ASC`,
    params
  );

  const byCode = new Map();
  const byId = new Map();
  result.rows.forEach((row) => {
    const school = {
      id: Number(row.id),
      code: row.school_code,
      name: row.school_name,
      districtId: Number(row.district_id),
      districtName: row.district_name
    };
    byCode.set(String(school.code).toLowerCase(), school);
    byId.set(school.id, school);
  });

  return {
    isSystemAdmin,
    fixedSchool: fixedSchoolId ? byId.get(fixedSchoolId) || null : null,
    byCode,
    byId
  };
}

function resolveSchool(record, errors, context) {
  if (errors.some((error) => error.column === "school_code")) {
    return null;
  }
  if (!record.school_code) {
    if (context.fixedSchool) {
      return context.fixedSchool;
    }
    errors.push({
      column: "school_code",
      reason: "School code is required. Every row must name an active school."
    });
    return null;
  }
  const school = context.byCode.get(record.school_code.toLowerCase());
  if (!school) {
    errors.push({
      column: "school_code",
      reason: context.fixedSchool
        ? `You can only import learners into your own school (${context.fixedSchool.code}).`
        : context.isSystemAdmin
          ? `School code ${record.school_code} was not found among active schools.`
          : `School code ${record.school_code} was not found among the active schools in your district.`
    });
    return null;
  }
  return school;
}

function validateValues(values, headers) {
  const record = {};
  const errors = [];

  FIELD_DEFINITIONS.forEach((field) => {
    const index = headers.indexOf(field.key);
    const raw = index === -1 ? null : values[index];
    let text;
    try {
      text = cellText(raw);
    } catch (error) {
      errors.push({ column: field.key, reason: error.message });
      return;
    }
    try {
      record[field.key] = field.validate(text);
    } catch (error) {
      errors.push({ column: field.key, reason: error.message });
    }
  });

  return { record, errors };
}

function finishRecord(record, errors, school) {
  record.school_id = school.id;
  record.school_code = school.code;
  record.school_name = school.name;
  record.district_id = school.districtId;
  record.district_name = school.districtName;
  record.full_name = [
    record.first_name,
    record.middle_name,
    record.last_name,
    record.extension_name
  ]
    .filter(Boolean)
    .join(" ");
  return errors.length ? null : record;
}

function toStoredRecord(record, meta) {
  return {
    file: meta.file,
    sheet: meta.sheet,
    row: meta.row,
    lrn: record.lrn,
    lastName: record.last_name,
    firstName: record.first_name,
    middleName: record.middle_name,
    extensionName: record.extension_name,
    birthDate: record.birth_date,
    sex: record.sex,
    weightKg: record.weight_kg,
    heightCm: record.height_cm,
    houseNumber: record.house_number,
    barangay: record.barangay,
    municipality: record.municipality,
    province: record.province,
    region: record.region,
    zipCode: record.zip_code,
    contactNumber: record.contact_number,
    email: record.email,
    schoolId: record.school_id,
    schoolCode: record.school_code,
    schoolName: record.school_name,
    districtId: record.district_id,
    fullName: record.full_name
  };
}

function revalidateStoredRow(entry, context) {
  const errors = [];
  const record = {};

  const fields = [
    ["lrn", entry.lrn, (value) => requireLrn(value)],
    ["last_name", entry.lastName, (value) => requireString(value, "Last name", { min: 1, max: 80 })],
    ["first_name", entry.firstName, (value) =>
      requireString(value, "First name", { min: 1, max: 80 })],
    ["middle_name", entry.middleName, (value) => optionalString(value, "Middle name", { max: 80 })],
    ["extension_name", entry.extensionName, (value) =>
      optionalString(value, "Name extension", { max: 16 })],
    ["birth_date", entry.birthDate, (value) => requireBirthDate(value)],
    ["sex", entry.sex, (value) => requireSex(value)],
    ["weight_kg", entry.weightKg, (value) => optionalNumber(value, "Weight", { min: 1, max: 500 })],
    ["height_cm", entry.heightCm, (value) => optionalNumber(value, "Height", { min: 1, max: 300 })],
    ["house_number", entry.houseNumber, (value) =>
      optionalString(value, "House number / street", { max: 120 })],
    ["barangay", entry.barangay, (value) => optionalString(value, "Barangay", { max: 120 })],
    ["municipality", entry.municipality, (value) =>
      optionalString(value, "Municipality / city", { max: 120 })],
    ["province", entry.province, (value) => optionalString(value, "Province", { max: 120 })],
    ["region", entry.region, (value) => optionalString(value, "Region", { max: 120 })],
    ["zip_code", entry.zipCode, (value) => optionalZip(value)],
    ["contact_number", entry.contactNumber, (value) => optionalPhone(value, "Contact number")],
    ["email", entry.email, (value) => optionalEmail(value, "Email address")]
  ];

  fields.forEach(([key, value, validator]) => {
    try {
      record[key] = validator(value);
    } catch (error) {
      errors.push({ column: key, reason: error.message });
    }
  });

  const school = context.byId.get(Number(entry.schoolId));
  if (!school) {
    errors.push({
      column: "school_code",
      reason: "The school for this row no longer exists or is no longer active."
    });
  }
  if (errors.length) {
    return { errors };
  }

  const finished = finishRecord(record, errors, school);
  if (!finished) {
    return { errors };
  }
  return { errors: [], record: finished };
}

async function existingLrns(lrns) {
  if (!lrns.length) {
    return new Set();
  }
  const unique = Array.from(new Set(lrns.map((value) => String(value))));
  const result = await query("SELECT lrn FROM learners WHERE lrn = ANY($1::text[])", [unique]);
  return new Set(result.rows.map((row) => String(row.lrn)));
}

function duplicateIssue(summary, reason, value, row) {
  if (summary) {
    summary.duplicates += 1;
    summary.status = "warning";
  }
  return issue({
    file: row.file,
    sheet: row.sheet,
    row: row.row,
    column: "lrn",
    reason,
    type: "duplicate",
    value
  });
}

function databaseDuplicateIssue(summaries, row, reason, value) {
  const summary = summaries[row.summaryIndex];
  if (summary) {
    summary.valid = Math.max(0, summary.valid - 1);
    summary.duplicates += 1;
    summary.status = "warning";
  }
  return issue({
    file: row.file,
    sheet: row.sheet,
    row: row.row,
    column: "lrn",
    reason,
    type: "duplicate",
    value
  });
}

async function preview(user, files, ipAddress) {
  const startedAt = Date.now();
  const context = await loadSchoolContext(user);
  const scanned = await scanFiles(files, {
    resolveHeaders,
    preferredSheets: ["Learners", "Learner Profiles", "Learners Profile"]
  });
  const summaries = scanned.summaries;
  const issues = scanned.issues.slice();
  const candidates = [];
  const seen = new Map();

  for (const row of scanned.rows) {
    const summary = summaries[row.summaryIndex];
    const { record, errors } = validateValues(row.values, row.headers);

    if (errors.length) {
      summary.rejected += 1;
      errors.forEach((error) => {
        issues.push(
          issue({
            file: row.file,
            sheet: row.sheet,
            row: row.row,
            column: error.column,
            reason: error.reason
          })
        );
      });
      continue;
    }

    const school = resolveSchool(record, errors, context);
    const finished = errors.length || !school ? null : finishRecord(record, errors, school);
    if (errors.length || !finished) {
      summary.rejected += 1;
      errors.forEach((error) => {
        issues.push(
          issue({
            file: row.file,
            sheet: row.sheet,
            row: row.row,
            column: error.column,
            reason: error.reason
          })
        );
      });
      continue;
    }

    if (seen.has(finished.lrn)) {
      const first = seen.get(finished.lrn);
      issues.push(
        duplicateIssue(
          summary,
          `LRN ${finished.lrn} is duplicated in this upload (first at ${first.file}, row ${first.row}).`,
          finished.lrn,
          row
        )
      );
      continue;
    }

    seen.set(finished.lrn, { file: row.file, row: row.row });
    summary.valid += 1;
    candidates.push({ record: finished, row });
  }

  summaries.forEach((summary) => {
    if (summary.error) {
      return;
    }
    summary.status =
      summary.valid > 0
        ? summary.duplicates + summary.rejected > 0
          ? "warning"
          : "valid"
        : "warning";
  });

  const existing = await existingLrns(candidates.map((entry) => entry.record.lrn));
  const validRows = [];

  candidates.forEach(({ record, row }) => {
    if (existing.has(record.lrn)) {
      issues.push(
        databaseDuplicateIssue(
          summaries,
          row,
          `LRN ${record.lrn} is already registered to another learner.`,
          record.lrn
        )
      );
      return;
    }
    validRows.push(toStoredRecord(record, { file: row.file, sheet: row.sheet, row: row.row }));
  });

  const summary = {
    files: summaries.length,
    recordsDetected: scanned.totalDetected,
    validRecords: validRows.length,
    duplicates: summaries.reduce((total, item) => total + item.duplicates, 0),
    rejected: summaries.reduce((total, item) => total + item.rejected, 0),
    durationMs: Date.now() - startedAt
  };

  const token = createToken(32);
  const expiresAt = new Date(Date.now() + IMPORT_TTL_MINUTES * 60 * 1000);
  const inserted = await insertImportBatch(IMPORT_KEY, {
    token,
    userId: user.id,
    summaries,
    summary,
    validRows,
    issues,
    expiresAt
  });
  const batch = inserted.rows[0];

  await auditService.record({
    userId: user.id,
    districtId: user.districtId || null,
    action: "learner.import_previewed",
    entityType: "learner_import",
    entityId: batch.id,
    ipAddress,
    details: {
      batch_id: Number(batch.id),
      files: summaries.map((item) => item.name),
      records_detected: summary.recordsDetected,
      valid: summary.validRecords,
      duplicates: summary.duplicates,
      rejected: summary.rejected,
      status: "previewed",
      duration_ms: summary.durationMs
    }
  });

  return {
    importId: Number(batch.id),
    token,
    status: "previewed",
    expiresAt: batch.expires_at,
    summary,
    files: summaries,
    preview: validRows.slice(0, 200).map((entry) => ({
      file: entry.file,
      sheet: entry.sheet,
      row: entry.row,
      fullName: entry.fullName,
      lrn: entry.lrn,
      school: entry.schoolName,
      schoolCode: entry.schoolCode,
      sex: entry.sex,
      birthDate: entry.birthDate
    })),
    issues: issues.slice(0, 200),
    issueCount: issues.length,
    limits: {
      maxFiles: SPREADSHEET_LIMITS.maxFiles,
      maxFileBytes: SPREADSHEET_LIMITS.maxFileBytes,
      maxTotalBytes: SPREADSHEET_LIMITS.maxTotalBytes,
      maxRowsPerSheet: SPREADSHEET_LIMITS.maxRowsPerSheet,
      maxRecords: SPREADSHEET_LIMITS.maxRecords,
      expiresInMinutes: IMPORT_TTL_MINUTES
    }
  };
}

async function commit(user, id, token, ipAddress) {
  if (!token || typeof token !== "string") {
    throw new HttpError(400, "The import confirmation token is missing.", "IMPORT_TOKEN_REQUIRED");
  }

  const client = await getClient();
  let open = true;
  try {
    await client.query("BEGIN");
    const batch = await loadBatchForUser(IMPORT_KEY, user.id, id, {
      client,
      forUpdate: true
    });

    if (!safeEqual(token, batch.token)) {
      throw new HttpError(403, "The import confirmation token is invalid.", "IMPORT_TOKEN_INVALID");
    }
    if (batch.status !== "previewed") {
      throw new HttpError(409, "This import is no longer awaiting confirmation.", "IMPORT_NOT_PENDING");
    }
    if (new Date(batch.expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE learner_import_batches SET status = 'expired' WHERE id = $1`,
        [batch.id]
      );
      await client.query("COMMIT");
      open = false;
      throw new HttpError(
        409,
        "This preview has expired. Upload the files again to revalidate them.",
        "IMPORT_EXPIRED"
      );
    }

    const context = await loadSchoolContext(user);
    const storedRows = Array.isArray(batch.valid_rows) ? batch.valid_rows : [];
    const issues = Array.isArray(batch.issues) ? batch.issues.slice() : [];
    const summaries = Array.isArray(batch.files) ? batch.files : [];
    const revalidated = [];

    storedRows.forEach((entry) => {
      const checked = revalidateStoredRow(entry, context);
      if (checked.errors.length) {
        checked.errors.forEach((error) => {
          issues.push(
            issue({
              file: entry.file,
              sheet: entry.sheet,
              row: entry.row,
              column: error.column,
              reason: error.reason
            })
          );
        });
        return;
      }
      revalidated.push({ ...checked.record, file: entry.file, sheet: entry.sheet, row: entry.row });
    });

    const existing = await existingLrns(revalidated.map((entry) => entry.lrn));
    const imported = [];
    let duplicates = 0;

    for (const entry of revalidated) {
      if (existing.has(entry.lrn)) {
        duplicates += 1;
        issues.push(
          issue({
            file: entry.file,
            sheet: entry.sheet,
            row: entry.row,
            column: "lrn",
            reason: `LRN ${entry.lrn} already exists and was skipped.`,
            type: "duplicate",
            value: entry.lrn
          })
        );
        continue;
      }

      const result = await client.query(
        `INSERT INTO learners (
           lrn, last_name, first_name, middle_name, extension_name, birth_date, sex,
           weight_kg, height_cm, house_number, barangay, municipality, province,
           region, zip_code, contact_number, email, school_id, district_id, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
         ON CONFLICT (lrn) DO NOTHING
         RETURNING id`,
        [
          entry.lrn,
          entry.last_name,
          entry.first_name,
          entry.middle_name,
          entry.extension_name,
          entry.birth_date,
          entry.sex,
          entry.weight_kg,
          entry.height_cm,
          entry.house_number,
          entry.barangay,
          entry.municipality,
          entry.province,
          entry.region,
          entry.zip_code,
          entry.contact_number,
          entry.email,
          entry.school_id,
          entry.district_id,
          user.id
        ]
      );

      if (!result.rows[0]) {
        duplicates += 1;
        issues.push(
          issue({
            file: entry.file,
            sheet: entry.sheet,
            row: entry.row,
            column: "lrn",
            reason: `LRN ${entry.lrn} was claimed by another import and the row was skipped.`,
            type: "duplicate",
            value: entry.lrn
          })
        );
        continue;
      }

      existing.add(entry.lrn);
      imported.push({
        id: Number(result.rows[0].id),
        fullName: entry.full_name,
        lrn: entry.lrn,
        school: entry.school_name,
        schoolCode: entry.school_code,
        sex: entry.sex,
        birthDate: entry.birth_date
      });
    }

    const rejected = countRejectedRows(issues);
    const previewDuplicates = Number((batch.summary && batch.summary.duplicates) || 0);
    const totalDuplicates = previewDuplicates + duplicates;
    const committedSummary = {
      ...(batch.summary || {}),
      files: summaries.length,
      imported: imported.length,
      duplicates: totalDuplicates,
      rejected,
      validRecords: imported.length,
      status: "committed",
      committedAt: new Date().toISOString()
    };

    await client.query(
      `UPDATE learner_import_batches
          SET status = 'committed',
              summary = $2,
              valid_rows = '[]'::jsonb,
              issues = $3,
              committed_at = now()
        WHERE id = $1`,
      [batch.id, JSON.stringify(committedSummary), JSON.stringify(issues)]
    );

    await auditService.record({
      client,
      userId: user.id,
      districtId: user.districtId || null,
      action: "learner.imported",
      entityType: "learner_import",
      entityId: batch.id,
      ipAddress,
      details: {
        batch_id: Number(batch.id),
        files: summaries.map((item) => item.name),
        records_detected: committedSummary.recordsDetected || 0,
        imported: imported.length,
        duplicates,
        rejected,
        status: "committed",
        duration_ms: committedSummary.durationMs || null
      }
    });

    await client.query("COMMIT");
    open = false;

    return {
      importId: Number(batch.id),
      status: "committed",
      summary: committedSummary,
      imported,
      duplicates: totalDuplicates,
      rejected,
      issueCount: issues.length,
      files: summaries
    };
  } catch (error) {
    if (open) {
      await client.query("ROLLBACK").catch(() => {});
    }
    throw error;
  } finally {
    client.release();
  }
}

function templateWorkbook() {
  return buildTemplateWorkbook({
    sheetName: "Learners",
    headers: TEMPLATE_HEADERS,
    widths: [16, 18, 18, 18, 16, 14, 8, 12, 12, 22, 18, 20, 18, 18, 12, 18, 30, 16],
    example: [
      "123456789012",
      "Dela Cruz",
      "Juan",
      "Santos",
      "",
      "2012-05-14",
      "male",
      38.5,
      142,
      "12 Mabini Street",
      "Poblacion",
      "Sorsogon City",
      "Sorsogon",
      "Region V",
      "4700",
      "+63 912 345 6789",
      "juan.delacruz@example.org",
      "NVD-001"
    ],
    instructions: [
      ["Learner profile bulk import template"],
      ["Fill the Learners sheet. The Example sheet is for reference only and is never imported."],
      ["Sheet", "Column", "Required", "Limit / rule"],
      ["Learners", "lrn", "Yes", "Exactly 12 digits. Format the column as Text so leading zeros are kept."],
      ["Learners", "last_name", "Yes", "Up to 80 characters"],
      ["Learners", "first_name", "Yes", "Up to 80 characters"],
      ["Learners", "middle_name", "No", "Up to 80 characters"],
      ["Learners", "extension_name", "No", "Up to 16 characters"],
      ["Learners", "birth_date", "Yes", "YYYY-MM-DD; not in the future"],
      ["Learners", "sex", "Yes", "male or female"],
      ["Learners", "weight_kg", "No", "Number from 1 to 500"],
      ["Learners", "height_cm", "No", "Number from 1 to 300"],
      ["Learners", "house_number", "No", "Up to 120 characters"],
      ["Learners", "barangay", "No", "Up to 120 characters"],
      ["Learners", "municipality", "No", "Up to 120 characters"],
      ["Learners", "province", "No", "Up to 120 characters"],
      ["Learners", "region", "No", "Up to 120 characters"],
      ["Learners", "zip_code", "No", "4 to 10 digits"],
      ["Learners", "contact_number", "No", "Numbers, spaces, + ( ) - . only; up to 32 characters"],
      ["Learners", "email", "No", "Valid email, up to 160 characters"],
      ["Learners", "school_code", "Yes", "An existing active school. School users may leave it blank for their own school."],
      ["", "", "", ""],
      ["Scope", "", "", "Profiles only. This import never creates enrollments, guardians, grades, attendance, or health records."],
      ["Rules", "", "", "Only the Learners sheet is read. Other sheets are ignored."],
      ["Rules", "", "", "Do not add id, user_id, school_id, district_id, or archived_at columns."],
      ["Rules", "", "", "Existing LRNs are skipped, never overwritten."],
      ["Rules", "", "", "Formulas, macros, embedded objects, and external links are rejected."],
      ["Rules", "", "", "Maximum 5 files, 5 MB each, 15 MB total, 1,000 rows per sheet."],
      ["Rules", "", "", "Nothing is saved until an administrator confirms the server-validated preview."]
    ]
  });
}

async function errorReport(user, id) {
  const batch = await loadBatchForUser(IMPORT_KEY, user.id, id);
  return {
    filename: `learner-import-${batch.id}-errors.xlsx`,
    buffer: buildErrorWorkbook({ title: "Learner bulk import report", batch }),
    status: batch.status
  };
}

async function history(user, limit = 10) {
  return importHistory(IMPORT_KEY, user.id, limit);
}

module.exports = {
  preview,
  commit,
  templateWorkbook,
  errorReport,
  history,
  FIELD_DEFINITIONS,
  TEMPLATE_HEADERS,
  SCHOOL_CODE_PATTERN
};
