"use strict";

// Secure bulk import for school heads, teachers, and non-teaching personnel.
//
// One row creates both the login account (role school_head / teacher / nt) and
// the personnel profile. Accounts receive an unknowable random password hash
// and a single-use, seven-day activation link whose raw token is returned once
// in the commit response and never stored or audit-logged.

const bcrypt = require("bcrypt");
const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const {
  fail,
  optionalPhone,
  optionalString,
  requireEmail,
  requireEnum,
  requireString
} = require("../utils/validators");
const { SPREADSHEET_LIMITS } = require("../utils/spreadsheetGuard");
const { createToken, hashToken, safeEqual } = require("../utils/tokens");
const { BCRYPT_ROUNDS } = require("./authService");
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

const IMPORT_KEY = "personnel";
const ACTIVATION_DAYS = 7;
const ACTIVATION_MS = ACTIVATION_DAYS * 24 * 60 * 60 * 1000;
const SCHOOL_CODE_PATTERN = /^[A-Z0-9-]+$/;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const EMPLOYMENT_TYPES = ["plantilla", "provisional", "contractual", "substitute", "volunteer", "other"];
const EMPLOYMENT_STATUSES = ["active", "inactive"];

const PERSONNEL_TYPES = {
  school_head: {
    role: "school_head",
    isTeaching: true,
    label: "School Head",
    defaultPosition: "School Head"
  },
  teacher: {
    role: "teacher",
    isTeaching: true,
    label: "Teacher",
    defaultPosition: "Teacher"
  },
  non_teaching: {
    role: "nt",
    isTeaching: false,
    label: "Non-Teaching Personnel",
    defaultPosition: "Non-Teaching Personnel"
  }
};

const TYPE_ALIASES = {
  school_head: "school_head",
  schoolhead: "school_head",
  head: "school_head",
  principal: "school_head",
  school_head_personnel: "school_head",
  teacher: "teacher",
  teaching: "teacher",
  teaching_personnel: "teacher",
  non_teaching: "non_teaching",
  nonteaching: "non_teaching",
  non_teaching_personnel: "non_teaching",
  nt: "non_teaching"
};

const RESERVED_HEADERS = new Set([
  "id",
  "user_id",
  "district_id",
  "school_id",
  "is_teaching",
  "account_role",
  "password_hash",
  "approval_status",
  "archived_at",
  "created_at",
  "updated_at"
]);

function optionalType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return TYPE_ALIASES[normalized] || null;
}

function optionalUsername(value) {
  const text = optionalString(value, "Username", { min: 3, max: 64 });
  if (text === null) {
    return null;
  }
  if (!USERNAME_PATTERN.test(text)) {
    fail("Username may only contain letters, numbers, dots, underscores, and hyphens.", {
      field: "username"
    });
  }
  return text;
}

function deriveUsername(email, firstName, lastName) {
  const clean = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, ".")
      .replace(/^[._-]+|[._-]+$/g, "")
      .replace(/[._-]{2,}/g, ".");
  let candidate = clean(String(email || "").split("@")[0]);
  if (candidate.length < 3) {
    candidate = clean(`${firstName || ""}.${lastName || ""}`);
  }
  if (candidate.length < 3) {
    return null;
  }
  return candidate.slice(0, 64).replace(/[._-]+$/g, "");
}

function validateDate(value, field) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    fail(`${field} must use the YYYY-MM-DD format.`, { field });
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    fail(`${field} is not a valid date.`, { field });
  }
  return text;
}

function optionalDate(value, field) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return null;
  }
  return validateDate(value, field);
}

const FIELD_DEFINITIONS = [
  {
    key: "personnel_type",
    label: "Personnel type",
    required: true,
    aliases: ["personnel_type", "personnel type", "staff type", "employee type", "type", "role"],
    validate(value) {
      const text = requireString(value, "Personnel type", { min: 3, max: 40 });
      const type = optionalType(text);
      if (!type) {
        fail("Personnel type must be school_head, teacher, or non_teaching.", {
          field: "personnel_type"
        });
      }
      return type;
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
  },
  {
    key: "employee_no",
    label: "Employee number",
    required: true,
    aliases: ["employee_no", "employee no", "employee number", "employee id"],
    validate(value) {
      return requireString(value, "Employee number", { min: 1, max: 32 });
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
    key: "suffix",
    label: "Suffix",
    required: false,
    aliases: ["suffix", "name extension", "extension name"],
    validate(value) {
      return optionalString(value, "Suffix", { max: 16 });
    }
  },
  {
    key: "position",
    label: "Position",
    required: false,
    aliases: ["position", "designation title", "job title"],
    validate(value) {
      return optionalString(value, "Position", { max: 120 });
    }
  },
  {
    key: "employment_type",
    label: "Employment type",
    required: false,
    aliases: ["employment_type", "employment type", "nature of employment"],
    validate(value) {
      if (value === undefined || value === null || String(value).trim() === "") {
        return "plantilla";
      }
      return requireEnum(String(value).trim().toLowerCase(), "Employment type", EMPLOYMENT_TYPES);
    }
  },
  {
    key: "employment_status",
    label: "Employment status",
    required: false,
    aliases: ["employment_status", "employment status", "status"],
    validate(value) {
      if (value === undefined || value === null || String(value).trim() === "") {
        return "active";
      }
      return requireEnum(String(value).trim().toLowerCase(), "Employment status", EMPLOYMENT_STATUSES);
    }
  },
  {
    key: "specialization",
    label: "Specialization",
    required: false,
    aliases: ["specialization", "specialisation", "subject specialization"],
    validate(value) {
      return optionalString(value, "Specialization", { max: 160 });
    }
  },
  {
    key: "designation",
    label: "Designation",
    required: false,
    aliases: ["designation", "administrative designation"],
    validate(value) {
      return optionalString(value, "Designation", { max: 160 });
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
    label: "Email",
    required: true,
    aliases: ["email", "email address", "account email"],
    validate(value) {
      return requireEmail(value, "Email");
    }
  },
  {
    key: "username",
    label: "Username",
    required: false,
    aliases: ["username", "user name", "login"],
    validate(value) {
      return optionalUsername(value);
    }
  },
  {
    key: "date_hired",
    label: "Date hired",
    required: false,
    aliases: ["date_hired", "date hired", "hiring date"],
    validate(value) {
      return optionalDate(value, "Date hired");
    }
  },
  {
    key: "qualifications",
    label: "Qualifications",
    required: false,
    aliases: ["qualifications", "qualification", "education"],
    validate(value) {
      return optionalString(value, "Qualifications", { max: 4000 });
    }
  }
];

const TEMPLATE_HEADERS = FIELD_DEFINITIONS.map((field) => field.key);
const resolveHeaders = createHeaderResolver({
  fields: FIELD_DEFINITIONS,
  reservedHeaders: RESERVED_HEADERS,
  templateLabel: "staff import"
});

async function loadSchoolContext(user) {
  const isSystemAdmin = user.role === "system_admin";
  const params = [];
  let scope = "";
  if (!isSystemAdmin) {
    if (!user.districtId) {
      throw new HttpError(
        400,
        "Your account is not assigned to a district. Contact a system administrator.",
        "DISTRICT_REQUIRED"
      );
    }
    params.push(user.districtId);
    scope = ` AND s.district_id = $${params.length}`;
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

  return { isSystemAdmin, byCode, byId };
}

function resolveSchool(record, errors, context) {
  if (errors.some((error) => error.column === "school_code")) {
    return null;
  }
  if (!record.school_code) {
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
      reason: context.isSystemAdmin
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
  const type = PERSONNEL_TYPES[record.personnel_type];
  if (!type) {
    return null;
  }
  record.role = type.role;
  record.is_teaching = type.isTeaching;
  record.role_label = type.label;
  record.school_id = school.id;
  record.school_code = school.code;
  record.school_name = school.name;
  record.district_id = school.districtId;
  record.district_name = school.districtName;
  record.position = record.position || type.defaultPosition;
  record.full_name = [record.first_name, record.middle_name, record.last_name, record.suffix]
    .filter(Boolean)
    .join(" ");

  if (record.full_name.length > 160) {
    errors.push({
      column: "first_name",
      reason: "The combined full name is longer than 160 characters."
    });
  }

  if (!record.username) {
    record.username = deriveUsername(record.email, record.first_name, record.last_name);
    if (!record.username) {
      errors.push({
        column: "username",
        reason: "A username could not be derived from the email. Add a username column."
      });
    }
  }

  return errors.length ? null : record;
}

function toStoredRecord(record, meta) {
  return {
    file: meta.file,
    sheet: meta.sheet,
    row: meta.row,
    personnelType: record.personnel_type,
    schoolId: record.school_id,
    schoolCode: record.school_code,
    schoolName: record.school_name,
    districtId: record.district_id,
    employeeNo: record.employee_no,
    lastName: record.last_name,
    firstName: record.first_name,
    middleName: record.middle_name,
    suffix: record.suffix,
    position: record.position,
    employmentType: record.employment_type,
    employmentStatus: record.employment_status,
    specialization: record.specialization,
    designation: record.designation,
    contactNumber: record.contact_number,
    email: record.email,
    username: record.username,
    dateHired: record.date_hired,
    qualifications: record.qualifications,
    fullName: record.full_name,
    role: record.role,
    roleLabel: record.role_label,
    isTeaching: record.is_teaching
  };
}

function revalidateStoredRow(entry, context) {
  const errors = [];
  const record = {};

  const fields = [
    ["personnel_type", entry.personnelType, (value) => {
      const type = optionalType(value);
      if (!type) {
        fail("Personnel type must be school_head, teacher, or non_teaching.", {
          field: "personnel_type"
        });
      }
      return type;
    }],
    ["employee_no", entry.employeeNo, (value) =>
      requireString(value, "Employee number", { min: 1, max: 32 })],
    ["last_name", entry.lastName, (value) => requireString(value, "Last name", { min: 1, max: 80 })],
    ["first_name", entry.firstName, (value) =>
      requireString(value, "First name", { min: 1, max: 80 })],
    ["middle_name", entry.middleName, (value) => optionalString(value, "Middle name", { max: 80 })],
    ["suffix", entry.suffix, (value) => optionalString(value, "Suffix", { max: 16 })],
    ["position", entry.position, (value) => optionalString(value, "Position", { max: 120 })],
    ["employment_type", entry.employmentType, (value) =>
      requireEnum(value || "plantilla", "Employment type", EMPLOYMENT_TYPES)],
    ["employment_status", entry.employmentStatus, (value) =>
      requireEnum(value || "active", "Employment status", EMPLOYMENT_STATUSES)],
    ["specialization", entry.specialization, (value) =>
      optionalString(value, "Specialization", { max: 160 })],
    ["designation", entry.designation, (value) =>
      optionalString(value, "Designation", { max: 160 })],
    ["contact_number", entry.contactNumber, (value) => optionalPhone(value, "Contact number")],
    ["email", entry.email, (value) => requireEmail(value, "Email")],
    ["username", entry.username, (value) => optionalUsername(value)],
    ["date_hired", entry.dateHired, (value) => optionalDate(value, "Date hired")],
    ["qualifications", entry.qualifications, (value) =>
      optionalString(value, "Qualifications", { max: 4000 })]
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

async function existingProfiles(candidates) {
  if (!candidates.length) {
    return new Set();
  }
  const schoolIds = Array.from(new Set(candidates.map((entry) => Number(entry.school_id))));
  const employeeNos = Array.from(
    new Set(candidates.map((entry) => String(entry.employee_no).toLowerCase()))
  );
  const result = await query(
    `SELECT school_id, lower(employee_no) AS employee_no
       FROM personnel_profiles
      WHERE school_id = ANY($1::bigint[])
        AND lower(employee_no) = ANY($2::text[])`,
    [schoolIds, employeeNos]
  );
  return new Set(
    result.rows.map((row) => `${Number(row.school_id)}|${String(row.employee_no).toLowerCase()}`)
  );
}

async function existingAccounts(candidates) {
  const emails = Array.from(new Set(candidates.map((entry) => String(entry.email).toLowerCase())));
  const usernames = Array.from(
    new Set(candidates.map((entry) => String(entry.username).toLowerCase()))
  );
  if (!emails.length && !usernames.length) {
    return { emails: new Set(), usernames: new Set() };
  }
  const result = await query(
    `SELECT lower(email) AS email, lower(username) AS username
       FROM users
      WHERE lower(email) = ANY($1::text[]) OR lower(username) = ANY($2::text[])`,
    [emails, usernames]
  );
  return {
    emails: new Set(result.rows.map((row) => String(row.email).toLowerCase())),
    usernames: new Set(result.rows.map((row) => String(row.username).toLowerCase()))
  };
}

function profileKey(record) {
  return `${Number(record.school_id)}|${String(record.employee_no).toLowerCase()}`;
}

function duplicateIssue(summary, column, reason, value, row) {
  if (summary) {
    summary.duplicates += 1;
    summary.status = "warning";
  }
  return issue({
    file: row.file,
    sheet: row.sheet,
    row: row.row,
    column,
    reason,
    type: "duplicate",
    value
  });
}

function databaseDuplicateIssue(summaries, row, column, reason, value) {
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
    column,
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
    preferredSheets: ["Personnel", "Staff", "School Personnel"]
  });
  const summaries = scanned.summaries;
  const issues = scanned.issues.slice();
  const candidates = [];
  const seenProfiles = new Map();
  const seenEmails = new Map();
  const seenUsernames = new Map();

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

    const key = profileKey(finished);
    const emailKey = String(finished.email).toLowerCase();
    const usernameKey = String(finished.username).toLowerCase();

    if (seenProfiles.has(key)) {
      const first = seenProfiles.get(key);
      issues.push(
        duplicateIssue(
          summary,
          "employee_no",
          `Employee number ${finished.employee_no} is duplicated in this upload (first at ${first.file}, row ${first.row}).`,
          finished.employee_no,
          row
        )
      );
      continue;
    }
    if (seenEmails.has(emailKey)) {
      const first = seenEmails.get(emailKey);
      issues.push(
        duplicateIssue(
          summary,
          "email",
          `Email ${finished.email} is duplicated in this upload (first at ${first.file}, row ${first.row}).`,
          finished.email,
          row
        )
      );
      continue;
    }
    if (seenUsernames.has(usernameKey)) {
      const first = seenUsernames.get(usernameKey);
      issues.push(
        duplicateIssue(
          summary,
          "username",
          `Username ${finished.username} is duplicated in this upload (first at ${first.file}, row ${first.row}).`,
          finished.username,
          row
        )
      );
      continue;
    }

    seenProfiles.set(key, { file: row.file, row: row.row });
    seenEmails.set(emailKey, { file: row.file, row: row.row });
    seenUsernames.set(usernameKey, { file: row.file, row: row.row });
    summary.valid += 1;
    candidates.push({ record: finished, row });
  }

  summaries.forEach((summary) => {
    if (summary.error) {
      return;
    }
    summary.status = summary.valid > 0 ? (summary.duplicates + summary.rejected > 0 ? "warning" : "valid") : "warning";
  });

  const existing = await existingProfiles(candidates.map((entry) => entry.record));
  const accounts = await existingAccounts(candidates.map((entry) => entry.record));
  const validRows = [];

  candidates.forEach(({ record, row }) => {
    const key = profileKey(record);
    const emailKey = String(record.email).toLowerCase();
    const usernameKey = String(record.username).toLowerCase();

    if (existing.has(key)) {
      issues.push(
        databaseDuplicateIssue(
          summaries,
          row,
          "employee_no",
          `Employee number ${record.employee_no} already exists for ${record.school_name}.`,
          record.employee_no
        )
      );
      return;
    }
    if (accounts.emails.has(emailKey)) {
      issues.push(
        databaseDuplicateIssue(
          summaries,
          row,
          "email",
          `Email ${record.email} is already used by an existing account.`,
          record.email
        )
      );
      return;
    }
    if (accounts.usernames.has(usernameKey)) {
      issues.push(
        databaseDuplicateIssue(
          summaries,
          row,
          "username",
          `Username ${record.username} is already in use. Add a unique username column.`,
          record.username
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
    action: "personnel.import_previewed",
    entityType: "personnel_import",
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
      employeeNo: entry.employeeNo,
      school: entry.schoolName,
      schoolCode: entry.schoolCode,
      personnelType: entry.personnelType,
      role: entry.role,
      roleLabel: entry.roleLabel,
      position: entry.position,
      email: entry.email,
      username: entry.username
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

function normalizeBaseUrl(baseUrl) {
  const value = String(baseUrl || "").replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+$/i.test(value)) {
    throw new HttpError(400, "The request host is invalid.", "REQUEST_INVALID");
  }
  return value;
}

async function commit(user, id, token, ipAddress, baseUrl) {
  if (!token || typeof token !== "string") {
    throw new HttpError(400, "The import confirmation token is missing.", "IMPORT_TOKEN_REQUIRED");
  }
  const origin = normalizeBaseUrl(baseUrl);

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
        `UPDATE personnel_import_batches SET status = 'expired' WHERE id = $1`,
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

    const existing = await existingProfiles(revalidated);
    const accounts = await existingAccounts(revalidated);
    const passwordHash = await bcrypt.hash(createToken(32), BCRYPT_ROUNDS);
    const activationExpiresAt = new Date(Date.now() + ACTIVATION_MS);
    const imported = [];
    const credentials = [];
    let duplicates = 0;

    for (const entry of revalidated) {
      const key = profileKey(entry);
      const emailKey = String(entry.email).toLowerCase();
      const usernameKey = String(entry.username).toLowerCase();

      if (
        existing.has(key) ||
        accounts.emails.has(emailKey) ||
        accounts.usernames.has(usernameKey)
      ) {
        duplicates += 1;
        issues.push(
          issue({
            file: entry.file,
            sheet: entry.sheet,
            row: entry.row,
            column: existing.has(key) ? "employee_no" : accounts.emails.has(emailKey) ? "email" : "username",
            reason: existing.has(key)
              ? `Employee number ${entry.employee_no} already exists and was skipped.`
              : accounts.emails.has(emailKey)
                ? `Email ${entry.email} is already used by an existing account and was skipped.`
                : `Username ${entry.username} is already in use and was skipped.`,
            type: "duplicate",
            value: existing.has(key) ? entry.employee_no : accounts.emails.has(emailKey) ? entry.email : entry.username
          })
        );
        continue;
      }

      const userInsert = await client.query(
        `INSERT INTO users (
           full_name, username, email, password_hash, role, district_id, school_id,
           is_active, approval_status, approved_by, approved_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 'active', $8, now())
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          entry.full_name,
          entry.username,
          entry.email,
          passwordHash,
          entry.role,
          entry.district_id,
          entry.school_id,
          user.id
        ]
      );
      if (!userInsert.rows[0]) {
        duplicates += 1;
        issues.push(
          issue({
            file: entry.file,
            sheet: entry.sheet,
            row: entry.row,
            column: "email",
            reason: `Email ${entry.email} or username ${entry.username} was claimed by another account and the row was skipped.`,
            type: "duplicate",
            value: entry.email
          })
        );
        continue;
      }
      const userId = Number(userInsert.rows[0].id);

      const rawActivation = createToken(32);
      await client.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [userId, hashToken(rawActivation), activationExpiresAt]
      );

      const profileInsert = await client.query(
        `INSERT INTO personnel_profiles (
           user_id, school_id, employee_no, last_name, first_name, middle_name, suffix,
           position, employment_type, employment_status, is_teaching, specialization,
           qualifications, designation, contact_number, email, date_hired, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         ON CONFLICT (school_id, employee_no) DO NOTHING
         RETURNING id`,
        [
          userId,
          entry.school_id,
          entry.employee_no,
          entry.last_name,
          entry.first_name,
          entry.middle_name,
          entry.suffix,
          entry.position,
          entry.employment_type,
          entry.employment_status,
          entry.is_teaching,
          entry.specialization,
          entry.qualifications,
          entry.designation,
          entry.contact_number,
          entry.email,
          entry.date_hired,
          user.id
        ]
      );

      if (!profileInsert.rows[0]) {
        await client.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [userId]);
        await client.query("DELETE FROM users WHERE id = $1", [userId]);
        duplicates += 1;
        issues.push(
          issue({
            file: entry.file,
            sheet: entry.sheet,
            row: entry.row,
            column: "employee_no",
            reason: `Employee number ${entry.employee_no} was claimed by another import and the row was skipped.`,
            type: "duplicate",
            value: entry.employee_no
          })
        );
        continue;
      }

      const profileId = Number(profileInsert.rows[0].id);
      existing.add(key);
      accounts.emails.add(emailKey);
      accounts.usernames.add(usernameKey);

      await auditService.record({
        client,
        userId: user.id,
        action: "user.created",
        entityType: "user",
        entityId: userId,
        districtId: entry.district_id,
        ipAddress,
        details: {
          username: entry.username,
          role: entry.role,
          school_id: entry.school_id,
          source: "bulk_import",
          batch_id: Number(batch.id)
        }
      });

      imported.push({
        userId,
        profileId,
        fullName: entry.full_name,
        employeeNo: entry.employee_no,
        school: entry.school_name,
        schoolCode: entry.school_code,
        role: entry.role,
        roleLabel: entry.role_label,
        position: entry.position,
        email: entry.email,
        username: entry.username
      });
      credentials.push({
        fullName: entry.full_name,
        username: entry.username,
        email: entry.email,
        role: entry.roleLabel,
        activationUrl: `${origin}/reset-password.html?token=${encodeURIComponent(rawActivation)}`,
        expiresAt: activationExpiresAt.toISOString()
      });
    }

    const rejected = countRejectedRows(issues);
    const previewDuplicates = Number((batch.summary && batch.summary.duplicates) || 0);
    const totalDuplicates = previewDuplicates + duplicates;
    const committedSummary = {
      ...(batch.summary || {}),
      files: summaries.length,
      imported: imported.length,
      accountsCreated: credentials.length,
      duplicates: totalDuplicates,
      rejected,
      validRecords: imported.length,
      status: "committed",
      committedAt: new Date().toISOString()
    };

    await client.query(
      `UPDATE personnel_import_batches
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
      action: "personnel.imported",
      entityType: "personnel_import",
      entityId: batch.id,
      ipAddress,
      details: {
        batch_id: Number(batch.id),
        files: summaries.map((item) => item.name),
        records_detected: committedSummary.recordsDetected || 0,
        imported: imported.length,
        accounts_created: credentials.length,
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
      credentials,
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
    sheetName: "Personnel",
    headers: TEMPLATE_HEADERS,
    widths: [18, 16, 18, 18, 18, 18, 10, 28, 18, 18, 24, 22, 18, 30, 22, 14, 36],
    example: [
      "teacher",
      "NVD-001",
      "EMP-1001",
      "Santos",
      "Maria",
      "Reyes",
      "",
      "Teacher III",
      "plantilla",
      "active",
      "Mathematics",
      "Mathematics Coordinator",
      "+63 912 345 6789",
      "maria.santos@example.org",
      "",
      "2018-06-04",
      "Bachelor of Secondary Education, major in Mathematics"
    ],
    instructions: [
      ["Staff bulk import template"],
      ["Fill the Personnel sheet. The Example sheet is for reference only and is never imported."],
      ["Sheet", "Column", "Required", "Limit / rule"],
      ["Personnel", "personnel_type", "Yes", "school_head, teacher, or non_teaching"],
      ["Personnel", "school_code", "Yes", "An existing active school in your district"],
      ["Personnel", "employee_no", "Yes", "Up to 32 characters; unique within the school"],
      ["Personnel", "last_name", "Yes", "Up to 80 characters"],
      ["Personnel", "first_name", "Yes", "Up to 80 characters"],
      ["Personnel", "middle_name", "No", "Up to 80 characters"],
      ["Personnel", "suffix", "No", "Up to 16 characters"],
      ["Personnel", "position", "No", "Up to 120 characters; defaults from the personnel type"],
      ["Personnel", "employment_type", "No", "plantilla, provisional, contractual, substitute, volunteer, or other"],
      ["Personnel", "employment_status", "No", "active or inactive; defaults to active"],
      ["Personnel", "specialization", "No", "Up to 160 characters"],
      ["Personnel", "designation", "No", "Up to 160 characters"],
      ["Personnel", "contact_number", "No", "Numbers, spaces, + ( ) - . only; up to 32 characters"],
      ["Personnel", "email", "Yes", "Valid email; becomes the login email and must be unique"],
      ["Personnel", "username", "No", "3–64 characters; derived from the email when blank"],
      ["Personnel", "date_hired", "No", "YYYY-MM-DD"],
      ["Personnel", "qualifications", "No", "Up to 4,000 characters"],
      ["", "", "", ""],
      ["Accounts", "", "", "Each valid row creates an active login account and a personnel profile."],
      ["Accounts", "", "", "Accounts receive a random, unknowable password and a single-use activation link."],
      ["Accounts", "", "", "Activation links are shown once after import. Download the credentials file and deliver links privately."],
      ["Rules", "", "", "Only the Personnel sheet is read. Other sheets are ignored."],
      ["Rules", "", "", "Do not add id, user_id, school_id, district_id, is_teaching, or archived_at columns."],
      ["Rules", "", "", "Existing employee numbers, emails, and usernames are skipped, never overwritten."],
      ["Rules", "", "", "Formulas, macros, embedded objects, and external links are rejected."],
      ["Rules", "", "", "Maximum 5 files, 5 MB each, 15 MB total, 1,000 rows per sheet."],
      ["Rules", "", "", "Nothing is saved until an administrator confirms the server-validated preview."]
    ]
  });
}

async function errorReport(user, id) {
  const batch = await loadBatchForUser(IMPORT_KEY, user.id, id);
  return {
    filename: `personnel-import-${batch.id}-errors.xlsx`,
    buffer: buildErrorWorkbook({ title: "Staff bulk import report", batch }),
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
  PERSONNEL_TYPES,
  SCHOOL_CODE_PATTERN
};
