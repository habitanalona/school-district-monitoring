"use strict";

const XLSX = require("xlsx");
const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const {
  optionalEmail,
  optionalPhone,
  optionalString,
  optionalNumber,
  requireEnum,
  requireInteger,
  requireString,
  SCHOOL_TYPES
} = require("../utils/validators");
const {
  SPREADSHEET_LIMITS,
  formatBytes,
  inspectFilename,
  inspectSpreadsheet,
  safeExportValue
} = require("../utils/spreadsheetGuard");
const { createToken, safeEqual } = require("../utils/tokens");
const auditService = require("./auditService");

const SCHOOL_CODE_PATTERN = /^[A-Z0-9-]+$/;
const DISTRICT_CODE_PATTERN = /^[A-Z0-9-]+$/;
const IMPORT_TTL_MINUTES = 30;
const IMPORT_STATUSES = ["active", "inactive"];

const FIELD_DEFINITIONS = [
  {
    key: "school_code",
    label: "School code",
    required: true,
    aliases: ["school_code", "school code", "code", "school id", "school id code"],
    validate(value) {
      const code = requireString(value, "School code", { min: 3, max: 32 }).toUpperCase();
      if (!SCHOOL_CODE_PATTERN.test(code)) {
        throw new HttpError(
          400,
          "School code may only contain letters, numbers, and hyphens.",
          "VALIDATION_ERROR"
        );
      }
      return code;
    }
  },
  {
    key: "school_name",
    label: "School name",
    required: true,
    aliases: ["school_name", "school name", "name", "official school name"],
    validate(value) {
      return requireString(value, "School name", { min: 2, max: 200 });
    }
  },
  {
    key: "school_type",
    label: "School type",
    required: true,
    aliases: ["school_type", "school type", "type"],
    validate(value) {
      return requireEnum(value, "School type", SCHOOL_TYPES);
    }
  },
  {
    key: "address",
    label: "Complete address",
    required: true,
    aliases: ["address", "complete address", "school address"],
    validate(value) {
      return requireString(value, "Address", { min: 5, max: 500 });
    }
  },
  {
    key: "district_code",
    label: "District code",
    required: true,
    aliases: ["district_code", "district code", "district", "district id code"],
    validate(value) {
      const code = optionalString(value, "District code", { min: 2, max: 24 });
      if (code === null) {
        return null;
      }
      const normalized = code.toUpperCase();
      if (!DISTRICT_CODE_PATTERN.test(normalized)) {
        throw new HttpError(
          400,
          "District code may only contain letters, numbers, and hyphens.",
          "VALIDATION_ERROR"
        );
      }
      return normalized;
    }
  },
  {
    key: "school_head",
    label: "School head",
    required: true,
    aliases: ["school_head", "school head", "head", "principal"],
    validate(value) {
      return requireString(value, "School head", { min: 2, max: 160 });
    }
  },
  {
    key: "contact_email",
    label: "Contact email",
    required: false,
    aliases: ["contact_email", "contact email", "email"],
    validate(value) {
      return optionalEmail(value, "Contact email");
    }
  },
  {
    key: "contact_phone",
    label: "Contact phone",
    required: false,
    aliases: ["contact_phone", "contact phone", "phone"],
    validate(value) {
      return optionalPhone(value, "Contact phone");
    }
  },
  {
    key: "student_count",
    label: "Student count",
    required: true,
    aliases: ["student_count", "student count", "students", "total students"],
    validate(value) {
      return requireInteger(value, "Student count", { min: 0, max: 1000000 });
    }
  },
  {
    key: "teacher_count",
    label: "Teaching personnel count",
    required: true,
    aliases: ["teacher_count", "teacher count", "teaching personnel", "teachers"],
    validate(value) {
      return requireInteger(value, "Teaching personnel count", { min: 0, max: 100000 });
    }
  },
  {
    key: "performance_score",
    label: "Performance score",
    required: false,
    aliases: ["performance_score", "performance score", "score"],
    validate(value) {
      return optionalNumber(value, "Performance score", { min: 0, max: 100 });
    }
  },
  {
    key: "status",
    label: "School status",
    required: false,
    aliases: ["status", "school status"],
    validate(value) {
      if (value === null || value === undefined || String(value).trim() === "") {
        return "active";
      }
      return requireEnum(String(value).trim().toLowerCase(), "School status", IMPORT_STATUSES);
    }
  }
];

const HEADER_LOOKUP = new Map();
FIELD_DEFINITIONS.forEach((field) => {
  field.aliases.forEach((alias) => HEADER_LOOKUP.set(normalizeHeader(alias), field.key));
});

const RESERVED_HEADERS = new Set([
  "id",
  "district_id",
  "created_at",
  "updated_at",
  "archived_at",
  "report_status",
  "school_id"
]);

const TEMPLATE_HEADERS = FIELD_DEFINITIONS.map((field) => field.key);

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function normalizeHeader(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function displayName(name) {
  return String(name || "file").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 160);
}

function issue({ file, sheet = null, row = null, column = null, reason, type = "rejected", value = null }) {
  return {
    type,
    file: displayName(file),
    sheet,
    row,
    column,
    reason: String(reason || "The row was rejected.").slice(0, 300),
    value: value === null || value === undefined ? null : safeExportValue(String(value)).slice(0, 160)
  };
}

function fileSummary(name, size, extension) {
  return {
    name: displayName(name),
    size,
    sizeLabel: formatBytes(size),
    extension,
    status: "failed",
    detected: 0,
    valid: 0,
    duplicates: 0,
    rejected: 0,
    sheet: null,
    error: null
  };
}

function cellText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }
  const text = String(value).normalize("NFC").trim();
  if (CONTROL_CHARACTERS.test(text)) {
    throw new Error("The value contains control characters.");
  }
  return text;
}

function pickWorksheet(workbook) {
  const names = workbook.SheetNames || [];
  if (!names.length) {
    throw new HttpError(400, "The workbook has no worksheets.", "SPREADSHEET_EMPTY");
  }
  if (names.length > SPREADSHEET_LIMITS.maxWorksheets) {
    throw new HttpError(
      400,
      `The workbook has more than ${SPREADSHEET_LIMITS.maxWorksheets} worksheets.`,
      "SPREADSHEET_INVALID"
    );
  }
  const schoolSheet = names.find((name) => normalizeHeader(name) === "schools");
  const selected = schoolSheet || names[0];
  return {
    name: selected,
    ignored: names.filter((name) => name !== selected)
  };
}

function readWorksheetRows(worksheet, label) {
  const cellKeys = Object.keys(worksheet).filter((key) => key.charAt(0) !== "!");
  if (!cellKeys.length) {
    throw new HttpError(400, `Worksheet “${label}” is empty.`, "SPREADSHEET_EMPTY");
  }

  if (worksheet["!fullref"]) {
    throw new HttpError(
      400,
      `Worksheet “${label}” has more rows than the ${SPREADSHEET_LIMITS.maxRowsPerSheet}-row limit.`,
      "SPREADSHEET_TOO_MANY_ROWS"
    );
  }

  let maxRow = 0;
  let maxColumn = 0;
  for (const key of cellKeys) {
    const cell = worksheet[key];
    const address = XLSX.utils.decode_cell(key);
    if (address.r > maxRow) {
      maxRow = address.r;
    }
    if (address.c > maxColumn) {
      maxColumn = address.c;
    }
    if (cell && cell.f) {
      throw new HttpError(
        400,
        `Worksheet “${label}” contains formulas. Paste values only; formulas are never executed.`,
        "SPREADSHEET_FORMULA_REJECTED"
      );
    }
  }

  if (maxColumn + 1 > SPREADSHEET_LIMITS.maxColumns) {
    throw new HttpError(
      400,
      `Worksheet “${label}” has more than ${SPREADSHEET_LIMITS.maxColumns} columns.`,
      "SPREADSHEET_TOO_MANY_COLUMNS"
    );
  }
  if (maxRow + 1 > SPREADSHEET_LIMITS.maxRowsPerSheet + 5) {
    throw new HttpError(
      400,
      `Worksheet “${label}” has more rows than the ${SPREADSHEET_LIMITS.maxRowsPerSheet}-row limit.`,
      "SPREADSHEET_TOO_MANY_ROWS"
    );
  }

  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
    range: { s: { r: 0, c: 0 }, e: { r: maxRow, c: maxColumn } }
  });

  return rows.map((row) => (Array.isArray(row) ? row : []));
}

function resolveHeaders(row) {
  const headers = [];
  const seen = new Set();
  let lastHeaderIndex = -1;

  row.forEach((value, index) => {
    const text = cellText(value);
    if (!text) {
      return;
    }
    lastHeaderIndex = index;
    const key = normalizeHeader(text);
    if (RESERVED_HEADERS.has(key)) {
      throw new HttpError(
        400,
        `Column “${text}” is database-controlled and cannot be imported.`,
        "SPREADSHEET_RESERVED_COLUMN"
      );
    }
    const fieldKey = HEADER_LOOKUP.get(key);
    if (!fieldKey) {
      throw new HttpError(
        400,
        `Column “${text}” is not part of the school import template.`,
        "SPREADSHEET_UNKNOWN_COLUMN"
      );
    }
    if (seen.has(fieldKey)) {
      throw new HttpError(
        400,
        `Column “${text}” appears more than once in the header row.`,
        "SPREADSHEET_DUPLICATE_COLUMN"
      );
    }
    seen.add(fieldKey);
    headers[index] = fieldKey;
  });

  for (let index = 0; index <= lastHeaderIndex; index += 1) {
    if (!headers[index]) {
      throw new HttpError(
        400,
        "The header row contains an empty column. Remove the gap and try again.",
        "SPREADSHEET_HEADER_INVALID"
      );
    }
  }

  const missing = FIELD_DEFINITIONS.filter(
    (field) => field.required && !headers.includes(field.key)
  ).map((field) => field.label);
  if (missing.length) {
    throw new HttpError(
      400,
      `The header row is missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
      "SPREADSHEET_HEADER_INVALID"
    );
  }

  return { headers, width: lastHeaderIndex + 1 };
}

async function loadDistrictContext(user) {
  const scopeId = user.role === "system_admin" ? null : user.districtId;
  if (user.role !== "system_admin" && !scopeId) {
    throw new HttpError(
      400,
      "Your account is not assigned to a district. Contact a system administrator.",
      "DISTRICT_REQUIRED"
    );
  }

  const result = await query(
    `SELECT id, district_code, district_name
       FROM districts
      WHERE ($1::bigint IS NULL OR id = $1)
      ORDER BY district_name ASC`,
    [scopeId]
  );

  const byCode = new Map();
  const byId = new Map();
  result.rows.forEach((row) => {
    const district = {
      id: Number(row.id),
      code: row.district_code,
      name: row.district_name
    };
    byCode.set(String(district.code).toLowerCase(), district);
    byId.set(district.id, district);
  });

  return {
    isSystemAdmin: user.role === "system_admin",
    byCode,
    byId,
    defaultDistrict: scopeId ? byId.get(Number(scopeId)) || null : null
  };
}

function resolveDistrict(record, errors, context) {
  if (errors.some((error) => error.column === "district_code")) {
    return null;
  }
  const code = record.district_code;
  if (code) {
    const district = context.byCode.get(code.toLowerCase());
    if (!district) {
      errors.push({
        column: "district_code",
        reason: `District code ${code} was not found in your district scope.`
      });
      return null;
    }
    return district;
  }

  if (context.defaultDistrict) {
    return context.defaultDistrict;
  }

  errors.push({
    column: "district_code",
    reason: context.isSystemAdmin
      ? "District code is required."
      : "Your account is not assigned to an active district."
  });
  return null;
}

function validateRow(values, headers, context) {
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

  const district = resolveDistrict(record, errors, context);
  if (district) {
    record.district_id = district.id;
    record.district_code = district.code;
    record.district_name = district.name;
  }

  return { record, errors };
}

function toSchoolRecord(row, headers, meta, context) {
  const { record, errors } = validateRow(row, headers, context);
  if (errors.length) {
    return { errors };
  }
  return {
    errors: [],
    record: {
      file: meta.file,
      sheet: meta.sheet,
      row: meta.row,
      schoolCode: record.school_code,
      schoolName: record.school_name,
      schoolType: record.school_type,
      address: record.address,
      districtId: record.district_id,
      districtCode: record.district_code,
      districtName: record.district_name,
      schoolHead: record.school_head,
      contactEmail: record.contact_email,
      contactPhone: record.contact_phone,
      studentCount: record.student_count,
      teacherCount: record.teacher_count,
      performanceScore: record.performance_score,
      status: record.status
    }
  };
}

function revalidateStoredRow(entry, context) {
  const errors = [];
  const record = {};
  const fields = [
    ["school_code", entry.schoolCode, (value) => {
      const code = requireString(value, "School code", { min: 3, max: 32 }).toUpperCase();
      if (!SCHOOL_CODE_PATTERN.test(code)) {
        throw new HttpError(400, "School code may only contain letters, numbers, and hyphens.");
      }
      return code;
    }],
    ["school_name", entry.schoolName, (value) => requireString(value, "School name", { min: 2, max: 200 })],
    ["school_type", entry.schoolType, (value) => requireEnum(value, "School type", SCHOOL_TYPES)],
    ["address", entry.address, (value) => requireString(value, "Address", { min: 5, max: 500 })],
    ["school_head", entry.schoolHead, (value) => requireString(value, "School head", { min: 2, max: 160 })],
    ["contact_email", entry.contactEmail, (value) => optionalEmail(value, "Contact email")],
    ["contact_phone", entry.contactPhone, (value) => optionalPhone(value, "Contact phone")],
    ["student_count", entry.studentCount, (value) => requireInteger(value, "Student count", { min: 0, max: 1000000 })],
    ["teacher_count", entry.teacherCount, (value) =>
      requireInteger(value, "Teaching personnel count", { min: 0, max: 100000 })],
    ["performance_score", entry.performanceScore, (value) =>
      optionalNumber(value, "Performance score", { min: 0, max: 100 })],
    ["status", entry.status, (value) => {
      if (value === null || value === undefined || String(value).trim() === "") {
        return "active";
      }
      return requireEnum(String(value).trim().toLowerCase(), "School status", IMPORT_STATUSES);
    }]
  ];

  fields.forEach(([key, value, validator]) => {
    try {
      record[key] = validator(value);
    } catch (error) {
      errors.push({ column: key, reason: error.message });
    }
  });

  const storedDistrict =
    entry.districtId === null || entry.districtId === undefined
      ? null
      : context.byId.get(Number(entry.districtId));
  if (!storedDistrict) {
    if (context.isSystemAdmin) {
      errors.push({
        column: "district_code",
        reason: "The district for this row no longer exists or is outside your scope."
      });
    } else {
      record.district_id = context.defaultDistrict ? context.defaultDistrict.id : null;
      record.district_code = context.defaultDistrict ? context.defaultDistrict.code : null;
      record.district_name = context.defaultDistrict ? context.defaultDistrict.name : null;
      if (!context.defaultDistrict) {
        errors.push({ column: "district_code", reason: "Your account is not assigned to an active district." });
      }
    }
  } else {
    record.district_id = storedDistrict.id;
    record.district_code = storedDistrict.code;
    record.district_name = storedDistrict.name;
  }

  if (errors.length) {
    return { errors };
  }

  return {
    errors: [],
    record: {
      file: entry.file,
      sheet: entry.sheet,
      row: entry.row,
      schoolCode: record.school_code,
      schoolName: record.school_name,
      schoolType: record.school_type,
      address: record.address,
      districtId: record.district_id,
      districtCode: record.district_code,
      districtName: record.district_name,
      schoolHead: record.school_head,
      contactEmail: record.contact_email,
      contactPhone: record.contact_phone,
      studentCount: record.student_count,
      teacherCount: record.teacher_count,
      performanceScore: record.performance_score,
      status: record.status
    }
  };
}

async function existingCodes(codes) {
  if (!codes.length) {
    return new Set();
  }
  const result = await query(
    `SELECT lower(school_code) AS code
     FROM schools
     WHERE lower(school_code) = ANY($1::text[])`,
    [Array.from(new Set(codes.map((code) => String(code).toLowerCase())))]
  );
  return new Set(result.rows.map((row) => row.code));
}

async function preview(user, files, ipAddress) {
  const startedAt = Date.now();
  const context = await loadDistrictContext(user);
  const summaries = [];
  const issues = [];
  const candidates = [];
  const seenCodes = new Map();
  let totalDetected = 0;

  for (const file of files || []) {
    const size = Number(file.size || 0);
    const filename = inspectFilename(file.originalname);
    if (filename.error) {
      const summary = fileSummary(file.originalname, size, "");
      summary.error = filename.error;
      summaries.push(summary);
      issues.push(issue({ file: file.originalname, reason: filename.error, type: "rejected" }));
      continue;
    }

    const summary = fileSummary(filename.name, size, filename.extension);
    const summaryIndex = summaries.length;
    summaries.push(summary);

    let fileCandidates = [];
    let fileIssues = [];
    const localSeen = new Map(seenCodes);

    try {
      if (size <= 0) {
        throw new HttpError(400, "The file is empty.", "SPREADSHEET_EMPTY");
      }
      if (size > SPREADSHEET_LIMITS.maxFileBytes) {
        throw new HttpError(400, "The file is larger than the allowed size.", "SPREADSHEET_TOO_LARGE");
      }

      const inspected = inspectSpreadsheet(file.buffer, filename.extension);
      const readOptions = {
        type: inspected.kind === "csv" ? "string" : "buffer",
        cellFormula: true,
        cellHTML: false,
        cellStyles: false,
        bookVBA: false,
        sheetRows: SPREADSHEET_LIMITS.maxRowsPerSheet + 5,
        WTF: false
      };
      const workbook = XLSX.read(inspected.kind === "csv" ? inspected.text : file.buffer, readOptions);
      const selected = pickWorksheet(workbook);
      summary.sheet = selected.name;
      const rows = readWorksheetRows(workbook.Sheets[selected.name], selected.name);

      let headerIndex = -1;
      for (let index = 0; index < Math.min(rows.length, 5); index += 1) {
        if (rows[index].some((value) => cellText(value))) {
          headerIndex = index;
          break;
        }
      }
      if (headerIndex === -1) {
        throw new HttpError(400, "The worksheet has no header row.", "SPREADSHEET_HEADER_MISSING");
      }

      const { headers, width } = resolveHeaders(rows[headerIndex]);
      const dataRows = rows.slice(headerIndex + 1);
      if (!dataRows.some((row) => row.some((value) => cellText(value)))) {
        throw new HttpError(400, "The worksheet has a header row but no data rows.", "SPREADSHEET_NO_DATA");
      }
      if (dataRows.length > SPREADSHEET_LIMITS.maxRowsPerSheet) {
        throw new HttpError(
          400,
          `Worksheet “${selected.name}” has more than ${SPREADSHEET_LIMITS.maxRowsPerSheet} data rows.`,
          "SPREADSHEET_TOO_MANY_ROWS"
        );
      }

      dataRows.forEach((values, index) => {
        const rowNumber = headerIndex + index + 2;
        const nonEmpty = values.some((value) => cellText(value));
        if (!nonEmpty) {
          return;
        }
        summary.detected += 1;
        totalDetected += 1;

        if (values.length > width) {
          const extra = values.slice(width).filter((value) => cellText(value));
          if (extra.length) {
            summary.rejected += 1;
            fileIssues.push(
              issue({
                file: summary.name,
                sheet: selected.name,
                row: rowNumber,
                column: `column ${width + 1}`,
                reason: "The row contains values outside the header columns.",
                value: extra[0]
              })
            );
            return;
          }
        }

        const mappedValues = values.slice(0, width);
        const validated = toSchoolRecord(mappedValues, headers, {
          file: summary.name,
          sheet: selected.name,
          row: rowNumber
        }, context);

        if (validated.errors.length) {
          summary.rejected += 1;
          validated.errors.forEach((error) => {
            fileIssues.push(
              issue({
                file: summary.name,
                sheet: selected.name,
                row: rowNumber,
                column: error.column,
                reason: error.reason
              })
            );
          });
          return;
        }

        const code = validated.record.schoolCode;
        const key = code.toLowerCase();
        if (localSeen.has(key)) {
          const first = localSeen.get(key);
          summary.duplicates += 1;
          fileIssues.push(
            issue({
              file: summary.name,
              sheet: selected.name,
              row: rowNumber,
              column: "school_code",
              reason: `School code ${code} is duplicated in this upload (first at ${first.file}, row ${first.row}).`,
              type: "duplicate",
              value: code
            })
          );
          return;
        }

        localSeen.set(key, { file: summary.name, row: rowNumber });
        summary.valid += 1;
        fileCandidates.push({ ...validated.record, summaryIndex });
      });

      if (summary.valid > 0) {
        summary.status = summary.duplicates + summary.rejected > 0 ? "warning" : "valid";
      } else {
        summary.status = "warning";
      }

      fileCandidates.forEach((entry) => {
        seenCodes.set(entry.schoolCode.toLowerCase(), { file: entry.file, row: entry.row });
      });
      candidates.push(...fileCandidates);
      issues.push(...fileIssues);
    } catch (error) {
      summary.status = "failed";
      summary.valid = 0;
      summary.duplicates = 0;
      summary.rejected = 0;
      summary.error =
        error && error.message
          ? error.message
          : "The spreadsheet could not be read.";
      issues.push(
        issue({
          file: summary.name,
          sheet: summary.sheet,
          reason: summary.error,
          type: "rejected"
        })
      );
    }
  }

  if (totalDetected > SPREADSHEET_LIMITS.maxRecords) {
    throw new HttpError(
      400,
      `The combined uploads contain more than ${SPREADSHEET_LIMITS.maxRecords} records. Split the files and try again.`,
      "SPREADSHEET_TOO_MANY_RECORDS"
    );
  }

  const dbCodes = await existingCodes(candidates.map((entry) => entry.schoolCode));
  const validRows = [];
  candidates.forEach((entry) => {
    const key = entry.schoolCode.toLowerCase();
    if (dbCodes.has(key)) {
      const summary = summaries[entry.summaryIndex];
      if (summary) {
        summary.valid = Math.max(0, summary.valid - 1);
        summary.duplicates += 1;
        summary.status = "warning";
      }
      issues.push(
        issue({
          file: entry.file,
          sheet: entry.sheet,
          row: entry.row,
          column: "school_code",
          reason: `School code ${entry.schoolCode} already exists in the school register.`,
          type: "duplicate",
          value: entry.schoolCode
        })
      );
      return;
    }
    validRows.push({
      file: entry.file,
      sheet: entry.sheet,
      row: entry.row,
      schoolCode: entry.schoolCode,
      schoolName: entry.schoolName,
      schoolType: entry.schoolType,
      address: entry.address,
      districtId: entry.districtId,
      districtCode: entry.districtCode,
      districtName: entry.districtName,
      schoolHead: entry.schoolHead,
      contactEmail: entry.contactEmail,
      contactPhone: entry.contactPhone,
      studentCount: entry.studentCount,
      teacherCount: entry.teacherCount,
      performanceScore: entry.performanceScore,
      status: entry.status
    });
  });

  const summary = {
    files: summaries.length,
    recordsDetected: totalDetected,
    validRecords: validRows.length,
    duplicates: summaries.reduce((total, item) => total + item.duplicates, 0),
    rejected: summaries.reduce((total, item) => total + item.rejected, 0),
    durationMs: Date.now() - startedAt
  };

  const token = createToken(32);
  const expiresAt = new Date(Date.now() + IMPORT_TTL_MINUTES * 60 * 1000);
  const inserted = await query(
    `INSERT INTO school_import_batches
       (token, user_id, status, files, summary, valid_rows, issues, expires_at)
     VALUES ($1, $2, 'previewed', $3, $4, $5, $6, $7)
     RETURNING id, created_at, expires_at`,
    [
      token,
      user.id,
      JSON.stringify(summaries),
      JSON.stringify(summary),
      JSON.stringify(validRows),
      JSON.stringify(issues),
      expiresAt
    ]
  );

  const batch = inserted.rows[0];
  await auditService.record({
    userId: user.id,
    districtId: user.districtId || null,
    action: "school.import_previewed",
    entityType: "school_import",
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
      code: entry.schoolCode,
      name: entry.schoolName,
      type: entry.schoolType,
      district: entry.districtName,
      districtCode: entry.districtCode,
      head: entry.schoolHead,
      students: entry.studentCount,
      teachers: entry.teacherCount,
      status: entry.status
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

async function loadBatchForUser(user, id, client = null) {
  const runner = client || { query };
  const result = await runner.query(
    `SELECT * FROM school_import_batches WHERE id = $1`,
    [id]
  );
  const batch = result.rows[0];
  if (!batch || Number(batch.user_id) !== Number(user.id)) {
    throw new HttpError(404, "Import batch not found.", "IMPORT_NOT_FOUND");
  }
  return batch;
}

async function commit(user, id, token, ipAddress) {
  if (!token || typeof token !== "string") {
    throw new HttpError(400, "The import confirmation token is missing.", "IMPORT_TOKEN_REQUIRED");
  }

  const client = await getClient();
  let open = true;
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT * FROM school_import_batches WHERE id = $1 FOR UPDATE`,
      [id]
    );
    const batch = locked.rows[0];
    if (!batch || Number(batch.user_id) !== Number(user.id)) {
      throw new HttpError(404, "Import batch not found.", "IMPORT_NOT_FOUND");
    }

    if (!safeEqual(token, batch.token)) {
      throw new HttpError(403, "The import confirmation token is invalid.", "IMPORT_TOKEN_INVALID");
    }
    if (batch.status !== "previewed") {
      throw new HttpError(409, "This import is no longer awaiting confirmation.", "IMPORT_NOT_PENDING");
    }
    if (new Date(batch.expires_at).getTime() <= Date.now()) {
      await client.query(
        `UPDATE school_import_batches SET status = 'expired' WHERE id = $1`,
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

    const context = await loadDistrictContext(user);
    const storedRows = Array.isArray(batch.valid_rows) ? batch.valid_rows : [];
    const storedIssues = Array.isArray(batch.issues) ? batch.issues : [];
    const summaries = Array.isArray(batch.files) ? batch.files : [];
    const revalidated = [];
    const issues = storedIssues.slice();

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
      revalidated.push(checked.record);
    });

    const existing = await existingCodes(revalidated.map((entry) => entry.schoolCode));
    const seen = new Set();
    const imported = [];
    let duplicates = 0;

    for (const entry of revalidated) {
      const key = entry.schoolCode.toLowerCase();
      if (existing.has(key) || seen.has(key)) {
        duplicates += 1;
        issues.push(
          issue({
            file: entry.file,
            sheet: entry.sheet,
            row: entry.row,
            column: "school_code",
            reason: `School code ${entry.schoolCode} already exists and was skipped.`,
            type: "duplicate",
            value: entry.schoolCode
          })
        );
        continue;
      }
      seen.add(key);

      const result = await client.query(
        `INSERT INTO schools (
           school_code, school_name, school_type, address, district_id,
           school_head, contact_email, contact_phone, student_count, teacher_count,
           performance_score, status
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (school_code) DO NOTHING
         RETURNING id`,
        [
          entry.schoolCode,
          entry.schoolName,
          entry.schoolType,
          entry.address,
          entry.districtId,
          entry.schoolHead,
          entry.contactEmail,
          entry.contactPhone,
          entry.studentCount,
          entry.teacherCount,
          entry.performanceScore,
          entry.status
        ]
      );
      if (!result.rows[0]) {
        duplicates += 1;
        issues.push(
          issue({
            file: entry.file,
            sheet: entry.sheet,
            row: entry.row,
            column: "school_code",
            reason: `School code ${entry.schoolCode} already exists and was skipped.`,
            type: "duplicate",
            value: entry.schoolCode
          })
        );
        continue;
      }
      imported.push({
        id: Number(result.rows[0].id),
        name: entry.schoolName,
        code: entry.schoolCode,
        district: entry.districtName,
        districtCode: entry.districtCode
      });
    }

    // A rejected row can produce several field-level issues; count the rows so
    // the committed summary matches the preview summary instead of inflating it.
    const rejectedRows = new Set();
    issues.forEach((item) => {
      if (item.type === "rejected") {
        rejectedRows.add(`${item.file}|${item.sheet || ""}|${item.row === null || item.row === undefined ? "" : item.row}`);
      }
    });
    const rejected = rejectedRows.size;
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
      `UPDATE school_import_batches
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
      action: "school.imported",
      entityType: "school_import",
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
  const workbook = XLSX.utils.book_new();
  const headerRow = TEMPLATE_HEADERS.slice();
  const exampleRow = [
    "NVD-001",
    "North Valley Central Elementary School",
    "Elementary School",
    "123 Rizal Street, Barangay Poblacion, Sorsogon City",
    "NVD",
    "Maria Santos",
    "school@example.org",
    "+63 2 8000 0000",
    850,
    32,
    88.5,
    "active"
  ];
  const sheet = XLSX.utils.aoa_to_sheet([headerRow]);
  sheet["!cols"] = [
    { wch: 16 },
    { wch: 42 },
    { wch: 22 },
    { wch: 44 },
    { wch: 16 },
    { wch: 26 },
    { wch: 28 },
    { wch: 20 },
    { wch: 16 },
    { wch: 18 },
    { wch: 18 },
    { wch: 12 }
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, "Schools");

  const example = XLSX.utils.aoa_to_sheet([headerRow, exampleRow]);
  example["!cols"] = sheet["!cols"];
  XLSX.utils.book_append_sheet(workbook, example, "Example");

  const instructions = [
    ["School bulk import template"],
    ["Fill the Schools sheet. The Example sheet is for reference only and is never imported."],
    ["Sheet", "Column", "Required", "Limit / rule"],
    ["Schools", "school_code", "Yes", "3–32 characters, letters, numbers, hyphens; unique, case-insensitive"],
    ["Schools", "school_name", "Yes", "2–200 characters"],
    ["Schools", "school_type", "Yes", "Elementary School, High School, Integrated School, or Senior High School"],
    ["Schools", "address", "Yes", "5–500 characters"],
    ["Schools", "district_code", "Yes", "Existing district code. District administrators may leave it blank to use their own district."],
    ["Schools", "school_head", "Yes", "2–160 characters"],
    ["Schools", "contact_email", "No", "Valid email, up to 160 characters"],
    ["Schools", "contact_phone", "No", "Numbers, spaces, + ( ) - . only; up to 32 characters"],
    ["Schools", "student_count", "Yes", "Whole number from 0 to 1,000,000"],
    ["Schools", "teacher_count", "Yes", "Whole number from 0 to 100,000"],
    ["Schools", "performance_score", "No", "Number from 0 to 100"],
    ["Schools", "status", "No", "active or inactive; defaults to active"],
    ["", "", "", ""],
    ["Rules", "", "", "Only the Schools sheet is read. Other sheets are ignored."],
    ["Rules", "", "", "Do not add id, district_id, created_at, updated_at, or archived_at columns; they are database-controlled."],
    ["Rules", "", "", "Existing school codes are skipped, never overwritten."],
    ["Rules", "", "", "Formulas, macros, embedded objects, and external links are rejected."],
    ["Rules", "", "", "Maximum 5 files, 5 MB each, 15 MB total, 1,000 rows per sheet."],
    ["Rules", "", "", "Nothing is saved until an administrator confirms the server-validated preview."]
  ];
  const help = XLSX.utils.aoa_to_sheet(instructions);
  help["!cols"] = [{ wch: 14 }, { wch: 22 }, { wch: 10 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(workbook, help, "Instructions");

  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

function errorWorkbook(batch) {
  const workbook = XLSX.utils.book_new();
  const summary = batch.summary || {};
  const summaryRows = [
    ["School bulk import report"],
    ["Import batch", String(batch.id)],
    ["Status", batch.status],
    ["Created", new Date(batch.created_at).toISOString()],
    ["Files", summary.files || 0],
    ["Records detected", summary.recordsDetected || 0],
    ["Imported", summary.imported || 0],
    ["Valid (preview)", summary.validRecords || 0],
    ["Duplicates", summary.duplicates || 0],
    ["Rejected", summary.rejected || 0],
    ["Duration (ms)", summary.durationMs || 0],
    ["Note", "Values are shown as text. Spreadsheet formulas are never executed."]
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
  summarySheet["!cols"] = [{ wch: 24 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  const fileRows = [["File", "Size", "Status", "Detected", "Valid", "Duplicates", "Rejected", "Error"]];
  (Array.isArray(batch.files) ? batch.files : []).forEach((file) => {
    fileRows.push([
      safeExportValue(file.name),
      safeExportValue(file.sizeLabel),
      safeExportValue(file.status),
      Number(file.detected) || 0,
      Number(file.valid) || 0,
      Number(file.duplicates) || 0,
      Number(file.rejected) || 0,
      safeExportValue(file.error || "")
    ]);
  });
  const fileSheet = XLSX.utils.aoa_to_sheet(fileRows);
  fileSheet["!cols"] = [{ wch: 34 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 70 }];
  XLSX.utils.book_append_sheet(workbook, fileSheet, "Files");

  const issueRows = [["Type", "File", "Sheet", "Row", "Column", "Reason", "Value"]];
  (Array.isArray(batch.issues) ? batch.issues : []).forEach((item) => {
    issueRows.push([
      safeExportValue(item.type),
      safeExportValue(item.file),
      safeExportValue(item.sheet || ""),
      item.row === null || item.row === undefined ? "" : Number(item.row),
      safeExportValue(item.column || ""),
      safeExportValue(item.reason),
      safeExportValue(item.value || "")
    ]);
  });
  const issueSheet = XLSX.utils.aoa_to_sheet(issueRows);
  issueSheet["!cols"] = [{ wch: 12 }, { wch: 30 }, { wch: 18 }, { wch: 8 }, { wch: 20 }, { wch: 80 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(workbook, issueSheet, "Issues");

  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

async function errorReport(user, id) {
  const batch = await loadBatchForUser(user, id);
  return {
    filename: `school-import-${batch.id}-errors.xlsx`,
    buffer: errorWorkbook(batch),
    status: batch.status
  };
}

async function history(user, limit = 10) {
  const result = await query(
    `SELECT id, status, files, summary, created_at, committed_at, expires_at,
            jsonb_array_length(issues) AS issue_count
       FROM school_import_batches
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [user.id, Math.min(Math.max(Number(limit) || 10, 1), 50)]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    status: row.status,
    files: Array.isArray(row.files) ? row.files.map((file) => file.name) : [],
    summary: row.summary || {},
    issueCount: Number(row.issue_count) || 0,
    createdAt: row.created_at,
    committedAt: row.committed_at,
    expiresAt: row.expires_at
  }));
}

module.exports = {
  preview,
  commit,
  templateWorkbook,
  errorReport,
  history,
  FIELD_DEFINITIONS,
  SCHOOL_CODE_PATTERN
};
