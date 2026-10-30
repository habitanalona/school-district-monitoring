"use strict";

const XLSX = require("xlsx");
const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const {
  EMAIL_PATTERN,
  PHONE_PATTERN,
  requireString,
  optionalString,
  optionalEmail,
  optionalPhone
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

const DISTRICT_CODE_PATTERN = /^[A-Z0-9-]+$/;
const IMPORT_TTL_MINUTES = 30;

const FIELD_DEFINITIONS = [
  {
    key: "district_name",
    label: "District name",
    required: true,
    aliases: ["district_name", "district name", "name", "district"],
    validate(value) {
      return requireString(value, "District name", { min: 2, max: 160 });
    }
  },
  {
    key: "district_code",
    label: "District code",
    required: true,
    aliases: ["district_code", "district code", "code", "district id code"],
    validate(value) {
      const code = requireString(value, "District code", { min: 2, max: 24 }).toUpperCase();
      if (!DISTRICT_CODE_PATTERN.test(code)) {
        throw new HttpError(
          400,
          "District code may only contain letters, numbers, and hyphens.",
          "VALIDATION_ERROR"
        );
      }
      return code;
    }
  },
  {
    key: "address",
    label: "Office address",
    required: false,
    aliases: ["address", "office address", "district address"],
    validate(value) {
      return optionalString(value, "Office address", { max: 500 });
    }
  },
  {
    key: "contact_email",
    label: "Office email",
    required: false,
    aliases: ["contact_email", "contact email", "office email"],
    validate(value) {
      return optionalEmail(value, "Office email");
    }
  },
  {
    key: "psds_one_name",
    label: "PSDS 1 name",
    required: true,
    aliases: ["psds_one_name", "psds 1 name", "psds one name", "psds1 name", "psds1_name"],
    validate(value) {
      return requireString(value, "PSDS 1 name", { max: 160 });
    }
  },
  {
    key: "psds_one_email",
    label: "PSDS 1 email",
    required: false,
    aliases: ["psds_one_email", "psds 1 email", "psds one email", "psds1 email", "psds1_email"],
    validate(value) {
      return optionalEmail(value, "PSDS 1 email");
    }
  },
  {
    key: "psds_one_phone",
    label: "PSDS 1 phone",
    required: false,
    aliases: ["psds_one_phone", "psds 1 phone", "psds one phone", "psds1 phone", "psds1_phone"],
    validate(value) {
      return optionalPhone(value, "PSDS 1 phone");
    }
  },
  {
    key: "psds_two_name",
    label: "PSDS 2 name",
    required: true,
    aliases: ["psds_two_name", "psds 2 name", "psds two name", "psds2 name", "psds2_name"],
    validate(value) {
      return requireString(value, "PSDS 2 name", { max: 160 });
    }
  },
  {
    key: "psds_two_email",
    label: "PSDS 2 email",
    required: false,
    aliases: ["psds_two_email", "psds 2 email", "psds two email", "psds2 email", "psds2_email"],
    validate(value) {
      return optionalEmail(value, "PSDS 2 email");
    }
  },
  {
    key: "psds_two_phone",
    label: "PSDS 2 phone",
    required: false,
    aliases: ["psds_two_phone", "psds 2 phone", "psds two phone", "psds2 phone", "psds2_phone"],
    validate(value) {
      return optionalPhone(value, "PSDS 2 phone");
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
  "status",
  "school_count",
  "user_count",
  "announcement_count"
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
  const districtName = names.find((name) => normalizeHeader(name) === "districts");
  const selected = districtName || names[0];
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
        `Column “${text}” is not part of the district import template.`,
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

function validateRow(values, headers) {
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

  if (
    record.psds_one_name &&
    record.psds_two_name &&
    record.psds_one_name.toLowerCase() === record.psds_two_name.toLowerCase()
  ) {
    errors.push({
      column: "psds_two_name",
      reason: "The two PSDS assignments must be different people."
    });
  }

  return { record, errors };
}

function toDistrictRecord(row, headers, meta) {
  const { record, errors } = validateRow(row, headers);
  if (errors.length) {
    return { errors };
  }
  return {
    errors: [],
    record: {
      file: meta.file,
      sheet: meta.sheet,
      row: meta.row,
      districtName: record.district_name,
      districtCode: record.district_code,
      address: record.address,
      contactEmail: record.contact_email,
      psds: [
        {
          name: record.psds_one_name,
          email: record.psds_one_email,
          phone: record.psds_one_phone
        },
        {
          name: record.psds_two_name,
          email: record.psds_two_email,
          phone: record.psds_two_phone
        }
      ]
    }
  };
}

function revalidateStoredRow(entry) {
  const errors = [];
  const record = {};
  const fields = [
    ["district_name", entry.districtName, (value) => requireString(value, "District name", { min: 2, max: 160 })],
    ["district_code", entry.districtCode, (value) => {
      const code = requireString(value, "District code", { min: 2, max: 24 }).toUpperCase();
      if (!DISTRICT_CODE_PATTERN.test(code)) {
        throw new HttpError(400, "District code may only contain letters, numbers, and hyphens.");
      }
      return code;
    }],
    ["address", entry.address, (value) => optionalString(value, "Office address", { max: 500 })],
    ["contact_email", entry.contactEmail, (value) => optionalEmail(value, "Office email")],
    ["psds_one_name", entry.psds && entry.psds[0] ? entry.psds[0].name : null, (value) =>
      requireString(value, "PSDS 1 name", { max: 160 })],
    ["psds_one_email", entry.psds && entry.psds[0] ? entry.psds[0].email : null, (value) =>
      optionalEmail(value, "PSDS 1 email")],
    ["psds_one_phone", entry.psds && entry.psds[0] ? entry.psds[0].phone : null, (value) =>
      optionalPhone(value, "PSDS 1 phone")],
    ["psds_two_name", entry.psds && entry.psds[1] ? entry.psds[1].name : null, (value) =>
      requireString(value, "PSDS 2 name", { max: 160 })],
    ["psds_two_email", entry.psds && entry.psds[1] ? entry.psds[1].email : null, (value) =>
      optionalEmail(value, "PSDS 2 email")],
    ["psds_two_phone", entry.psds && entry.psds[1] ? entry.psds[1].phone : null, (value) =>
      optionalPhone(value, "PSDS 2 phone")]
  ];

  fields.forEach(([key, value, validator]) => {
    try {
      record[key] = validator(value);
    } catch (error) {
      errors.push({ column: key, reason: error.message });
    }
  });

  if (
    record.psds_one_name &&
    record.psds_two_name &&
    record.psds_one_name.toLowerCase() === record.psds_two_name.toLowerCase()
  ) {
    errors.push({ column: "psds_two_name", reason: "The two PSDS assignments must be different people." });
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
      districtName: record.district_name,
      districtCode: record.district_code,
      address: record.address,
      contactEmail: record.contact_email,
      psds: [
        { name: record.psds_one_name, email: record.psds_one_email, phone: record.psds_one_phone },
        { name: record.psds_two_name, email: record.psds_two_email, phone: record.psds_two_phone }
      ]
    }
  };
}

async function existingCodes(codes) {
  if (!codes.length) {
    return new Set();
  }
  const result = await query(
    `SELECT lower(district_code) AS code
     FROM districts
     WHERE lower(district_code) = ANY($1::text[])`,
    [Array.from(new Set(codes.map((code) => String(code).toLowerCase())))]
  );
  return new Set(result.rows.map((row) => row.code));
}

async function preview(user, files, ipAddress) {
  const startedAt = Date.now();
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
        const validated = toDistrictRecord(mappedValues, headers, {
          file: summary.name,
          sheet: selected.name,
          row: rowNumber
        });

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

        const code = validated.record.districtCode;
        const key = code.toLowerCase();
        if (localSeen.has(key)) {
          const first = localSeen.get(key);
          summary.duplicates += 1;
          fileIssues.push(
            issue({
              file: summary.name,
              sheet: selected.name,
              row: rowNumber,
              column: "district_code",
              reason: `District code ${code} is duplicated in this upload (first at ${first.file}, row ${first.row}).`,
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
        seenCodes.set(entry.districtCode.toLowerCase(), { file: entry.file, row: entry.row });
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

  const dbCodes = await existingCodes(candidates.map((entry) => entry.districtCode));
  const validRows = [];
  candidates.forEach((entry) => {
    const key = entry.districtCode.toLowerCase();
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
          column: "district_code",
          reason: `District code ${entry.districtCode} already exists in the district directory.`,
          type: "duplicate",
          value: entry.districtCode
        })
      );
      return;
    }
    validRows.push({
      file: entry.file,
      sheet: entry.sheet,
      row: entry.row,
      districtName: entry.districtName,
      districtCode: entry.districtCode,
      address: entry.address,
      contactEmail: entry.contactEmail,
      psds: entry.psds
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
    `INSERT INTO district_import_batches
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
    action: "district.import_previewed",
    entityType: "district_import",
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
      name: entry.districtName,
      code: entry.districtCode,
      address: entry.address,
      contactEmail: entry.contactEmail,
      psds: entry.psds.map((person) => person.name)
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
    `SELECT * FROM district_import_batches WHERE id = $1`,
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
      `SELECT * FROM district_import_batches WHERE id = $1 FOR UPDATE`,
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
        `UPDATE district_import_batches SET status = 'expired' WHERE id = $1`,
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

    const storedRows = Array.isArray(batch.valid_rows) ? batch.valid_rows : [];
    const storedIssues = Array.isArray(batch.issues) ? batch.issues : [];
    const summaries = Array.isArray(batch.files) ? batch.files : [];
    const revalidated = [];
    const issues = storedIssues.slice();

    storedRows.forEach((entry) => {
      const checked = revalidateStoredRow(entry);
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

    const existing = await existingCodes(revalidated.map((entry) => entry.districtCode));
    const seen = new Set();
    const imported = [];
    let duplicates = 0;

    for (const entry of revalidated) {
      const key = entry.districtCode.toLowerCase();
      if (existing.has(key) || seen.has(key)) {
        duplicates += 1;
        issues.push(
          issue({
            file: entry.file,
            sheet: entry.sheet,
            row: entry.row,
            column: "district_code",
            reason: `District code ${entry.districtCode} already exists and was skipped.`,
            type: "duplicate",
            value: entry.districtCode
          })
        );
        continue;
      }
      seen.add(key);

      const result = await client.query(
        `INSERT INTO districts (
           district_name, district_code, address, contact_email,
           psds_one_name, psds_one_email, psds_one_phone,
           psds_two_name, psds_two_email, psds_two_phone
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (district_code) DO NOTHING
         RETURNING id`,
        [
          entry.districtName,
          entry.districtCode,
          entry.address,
          entry.contactEmail,
          entry.psds[0].name,
          entry.psds[0].email,
          entry.psds[0].phone,
          entry.psds[1].name,
          entry.psds[1].email,
          entry.psds[1].phone
        ]
      );
      if (!result.rows[0]) {
        duplicates += 1;
        issues.push(
          issue({
            file: entry.file,
            sheet: entry.sheet,
            row: entry.row,
            column: "district_code",
            reason: `District code ${entry.districtCode} already exists and was skipped.`,
            type: "duplicate",
            value: entry.districtCode
          })
        );
        continue;
      }
      imported.push({
        id: Number(result.rows[0].id),
        name: entry.districtName,
        code: entry.districtCode
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
      `UPDATE district_import_batches
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
      action: "district.imported",
      entityType: "district_import",
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
    "North Valley District",
    "NVD",
    "District office address",
    "district@example.org",
    "PSDS One Name",
    "psds.one@example.org",
    "+63 2 8000 0000",
    "PSDS Two Name",
    "psds.two@example.org",
    "+63 2 8000 0001"
  ];
  const sheet = XLSX.utils.aoa_to_sheet([headerRow]);
  sheet["!cols"] = [
    { wch: 28 },
    { wch: 14 },
    { wch: 32 },
    { wch: 26 },
    { wch: 24 },
    { wch: 26 },
    { wch: 18 },
    { wch: 24 },
    { wch: 26 },
    { wch: 18 }
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, "Districts");

  const example = XLSX.utils.aoa_to_sheet([headerRow, exampleRow]);
  example["!cols"] = sheet["!cols"];
  XLSX.utils.book_append_sheet(workbook, example, "Example");

  const instructions = [
    ["District bulk import template"],
    ["Fill the Districts sheet. The Example sheet is for reference only and is never imported."],
    ["Sheet", "Column", "Required", "Limit / rule"],
    ["Districts", "district_name", "Yes", "2–160 characters"],
    ["Districts", "district_code", "Yes", "2–24 characters, letters, numbers, hyphens; unique, case-insensitive"],
    ["Districts", "address", "No", "Up to 500 characters"],
    ["Districts", "contact_email", "No", "Valid email, up to 160 characters"],
    ["Districts", "psds_one_name", "Yes", "Up to 160 characters; must differ from PSDS 2"],
    ["Districts", "psds_one_email", "No", "Valid email"],
    ["Districts", "psds_one_phone", "No", "Numbers, spaces, + ( ) - . only; up to 32 characters"],
    ["Districts", "psds_two_name", "Yes", "Up to 160 characters; must differ from PSDS 1"],
    ["Districts", "psds_two_email", "No", "Valid email"],
    ["Districts", "psds_two_phone", "No", "Numbers, spaces, + ( ) - . only; up to 32 characters"],
    ["", "", "", ""],
    ["Rules", "", "", "Only the Districts sheet is read. Other sheets are ignored."],
    ["Rules", "", "", "Do not add id, status, created_at, or updated_at columns; they are database-controlled."],
    ["Rules", "", "", "Formulas, macros, embedded objects, and external links are rejected."],
    ["Rules", "", "", "Maximum 5 files, 5 MB each, 15 MB total, 1,000 rows per sheet."],
    ["Rules", "", "", "Nothing is saved until an administrator confirms the server-validated preview."]
  ];
  const help = XLSX.utils.aoa_to_sheet(instructions);
  help["!cols"] = [{ wch: 14 }, { wch: 22 }, { wch: 10 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(workbook, help, "Instructions");

  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

function errorWorkbook(batch) {
  const workbook = XLSX.utils.book_new();
  const summary = batch.summary || {};
  const summaryRows = [
    ["District bulk import report"],
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
    filename: `district-import-${batch.id}-errors.xlsx`,
    buffer: errorWorkbook(batch),
    status: batch.status
  };
}

async function history(user, limit = 10) {
  const result = await query(
    `SELECT id, status, files, summary, created_at, committed_at, expires_at,
            jsonb_array_length(issues) AS issue_count
       FROM district_import_batches
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
  DISTRICT_CODE_PATTERN
};
