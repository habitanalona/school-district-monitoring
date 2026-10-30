"use strict";

// Shared primitives for the secure spreadsheet imports.
//
// The verified school importer keeps its own copy of these routines; this
// module lets the newer staff and learner importers reuse the same parsing,
// size, formula, header, and report rules without duplicating them. No cell
// value is ever interpolated into SQL: callers receive plain arrays and bind
// them as parameters.

const XLSX = require("xlsx");
const { HttpError } = require("./httpError");
const {
  SPREADSHEET_LIMITS,
  formatBytes,
  inspectFilename,
  inspectSpreadsheet,
  safeExportValue
} = require("./spreadsheetGuard");

const IMPORT_TTL_MINUTES = 30;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const IMPORT_TABLES = {
  personnel: "personnel_import_batches",
  learner: "learner_import_batches"
};

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

function pickWorksheet(workbook, preferredNames) {
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
  const preferred = (preferredNames || []).map((name) => normalizeHeader(name));
  const match = names.find((name) => preferred.includes(normalizeHeader(name)));
  const selected = match || names[0];
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

// Builds a strict header mapper for one import template. Unknown, reserved,
// duplicated, missing, and gap columns are rejected with a clear message.
function createHeaderResolver({ fields, reservedHeaders, templateLabel }) {
  const lookup = new Map();
  fields.forEach((field) => {
    field.aliases.forEach((alias) => lookup.set(normalizeHeader(alias), field.key));
  });
  const reserved = new Set(reservedHeaders || []);

  return function resolveHeaders(row) {
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
      if (reserved.has(key)) {
        throw new HttpError(
          400,
          `Column “${text}” is database-controlled and cannot be imported.`,
          "SPREADSHEET_RESERVED_COLUMN"
        );
      }
      const fieldKey = lookup.get(key);
      if (!fieldKey) {
        throw new HttpError(
          400,
          `Column “${text}” is not part of the ${templateLabel} template.`,
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

    const missing = fields
      .filter((field) => field.required && !headers.includes(field.key))
      .map((field) => field.label);
    if (missing.length) {
      throw new HttpError(
        400,
        `The header row is missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
        "SPREADSHEET_HEADER_INVALID"
      );
    }

    return { headers, width: lastHeaderIndex + 1 };
  };
}

// Reads every uploaded workbook once and returns normalised rows. Validation
// of individual business fields stays with each import service.
async function scanFiles(files, options) {
  const settings = options || {};
  const resolveHeaders = settings.resolveHeaders;
  const preferredSheets = settings.preferredSheets || [];
  const summaries = [];
  const issues = [];
  const rows = [];
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
    const fileIssues = [];

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
        // CSV has no types: keep every cell as the text the user typed so
        // "2018-06-04" is not silently converted to a date serial and a
        // 12-digit LRN keeps its leading zeros. XLSX/XLS keep native cells.
        raw: inspected.kind === "csv",
        cellFormula: true,
        cellHTML: false,
        cellStyles: false,
        bookVBA: false,
        sheetRows: SPREADSHEET_LIMITS.maxRowsPerSheet + 5,
        WTF: false
      };
      const workbook = XLSX.read(inspected.kind === "csv" ? inspected.text : file.buffer, readOptions);
      const selected = pickWorksheet(workbook, preferredSheets);
      summary.sheet = selected.name;
      const sheetRows = readWorksheetRows(workbook.Sheets[selected.name], selected.name);

      let headerIndex = -1;
      for (let index = 0; index < Math.min(sheetRows.length, 5); index += 1) {
        if (sheetRows[index].some((value) => cellText(value))) {
          headerIndex = index;
          break;
        }
      }
      if (headerIndex === -1) {
        throw new HttpError(400, "The worksheet has no header row.", "SPREADSHEET_HEADER_MISSING");
      }

      const { headers, width } = resolveHeaders(sheetRows[headerIndex]);
      const dataRows = sheetRows.slice(headerIndex + 1);
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

        rows.push({
          file: summary.name,
          sheet: selected.name,
          row: rowNumber,
          summaryIndex,
          headers,
          width,
          values: values.slice(0, width)
        });
      });

      issues.push(...fileIssues);
    } catch (error) {
      summary.status = "failed";
      summary.valid = 0;
      summary.duplicates = 0;
      summary.rejected = 0;
      summary.error =
        error && error.message ? error.message : "The spreadsheet could not be read.";
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

  return { summaries, issues, rows, totalDetected };
}

function buildTemplateWorkbook(options) {
  const settings = options || {};
  const workbook = XLSX.utils.book_new();
  const headers = settings.headers.slice();
  const example = settings.example || [];
  const widths = settings.widths || headers.map(() => 22);

  const sheet = XLSX.utils.aoa_to_sheet([headers]);
  sheet["!cols"] = widths.map((width) => ({ wch: width }));
  XLSX.utils.book_append_sheet(workbook, sheet, settings.sheetName);

  const exampleSheet = XLSX.utils.aoa_to_sheet([headers, example]);
  exampleSheet["!cols"] = sheet["!cols"];
  XLSX.utils.book_append_sheet(workbook, exampleSheet, "Example");

  const help = XLSX.utils.aoa_to_sheet(settings.instructions || []);
  help["!cols"] = [{ wch: 16 }, { wch: 24 }, { wch: 10 }, { wch: 100 }];
  XLSX.utils.book_append_sheet(workbook, help, "Instructions");

  return XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
}

function buildErrorWorkbook({ title, batch }) {
  const workbook = XLSX.utils.book_new();
  const summary = batch.summary || {};
  const summaryRows = [
    [title],
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

function resolveImportTable(key) {
  const table = IMPORT_TABLES[key];
  if (!table) {
    throw new Error(`Unknown import table: ${key}`);
  }
  return table;
}

async function insertImportBatch(key, { token, userId, summaries, summary, validRows, issues, expiresAt }) {
  const table = resolveImportTable(key);
  const { query } = require("../config/database");
  return query(
    `INSERT INTO ${table}
       (token, user_id, status, files, summary, valid_rows, issues, expires_at)
     VALUES ($1, $2, 'previewed', $3, $4, $5, $6, $7)
     RETURNING id, created_at, expires_at`,
    [
      token,
      userId,
      JSON.stringify(summaries),
      JSON.stringify(summary),
      JSON.stringify(validRows),
      JSON.stringify(issues),
      expiresAt
    ]
  );
}

async function loadBatchForUser(key, userId, id, options = {}) {
  const table = resolveImportTable(key);
  const runner = options.client || { query: require("../config/database").query };
  const result = await runner.query(
    `SELECT * FROM ${table} WHERE id = $1${options.forUpdate ? " FOR UPDATE" : ""}`,
    [id]
  );
  const batch = result.rows[0];
  if (!batch || Number(batch.user_id) !== Number(userId)) {
    throw new HttpError(404, "Import batch not found.", "IMPORT_NOT_FOUND");
  }
  return batch;
}

async function importHistory(key, userId, limit = 10) {
  const table = resolveImportTable(key);
  const { query } = require("../config/database");
  const result = await query(
    `SELECT id, status, files, summary, created_at, committed_at, expires_at,
            jsonb_array_length(issues) AS issue_count
       FROM ${table}
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [userId, Math.min(Math.max(Number(limit) || 10, 1), 50)]
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

function countRejectedRows(issues) {
  const rejectedRows = new Set();
  issues.forEach((item) => {
    if (item.type === "rejected") {
      rejectedRows.add(
        `${item.file}|${item.sheet || ""}|${
          item.row === null || item.row === undefined ? "" : item.row
        }`
      );
    }
  });
  return rejectedRows.size;
}

module.exports = {
  IMPORT_TTL_MINUTES,
  IMPORT_TABLES,
  normalizeHeader,
  displayName,
  issue,
  fileSummary,
  cellText,
  pickWorksheet,
  readWorksheetRows,
  createHeaderResolver,
  scanFiles,
  buildTemplateWorkbook,
  buildErrorWorkbook,
  insertImportBatch,
  loadBatchForUser,
  importHistory,
  countRejectedRows
};
