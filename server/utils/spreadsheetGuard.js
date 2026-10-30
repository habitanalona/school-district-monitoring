"use strict";

const path = require("path");
const { HttpError } = require("./httpError");

const SPREADSHEET_LIMITS = Object.freeze({
  maxFiles: 5,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalBytes: 15 * 1024 * 1024,
  maxRowsPerSheet: 1000,
  maxColumns: 20,
  maxWorksheets: 5,
  maxRecords: 3000,
  maxZipEntries: 250,
  maxZipUncompressedBytes: 25 * 1024 * 1024,
  maxZipRatio: 100
});

const ALLOWED_EXTENSIONS = new Set([".xlsx", ".xls", ".csv"]);
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const FORMULA_LEADERS = /^[=+@\t\r]/;

function fileError(message, code = "SPREADSHEET_INVALID") {
  return new HttpError(400, message, code);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Validate the client-supplied filename without trusting it for storage.
 * Nothing is written to disk, but a hostile name must not reach logs, headers,
 * or the database. Returns a safe display name and the lower-case extension.
 */
function inspectFilename(originalName) {
  const name = typeof originalName === "string" ? originalName : "";
  if (!name || name.length > 200) {
    return { error: "The filename is missing or too long." };
  }
  if (/[\\/\u0000-\u001f\u007f]/.test(name) || name.includes("..")) {
    return { error: "The filename contains a path or control characters." };
  }
  if (name !== path.basename(name)) {
    return { error: "The filename contains a path." };
  }
  const extension = path.extname(name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return { error: "Only .xlsx, .xls, and .csv files are supported." };
  }
  return {
    name: name.normalize("NFC"),
    extension
  };
}

function readUInt16(buffer, offset) {
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer, offset) {
  return buffer.readUInt32LE(offset);
}

/**
 * Read the ZIP central directory before any spreadsheet parser touches the
 * file. This rejects encrypted archives, macro projects, embedded objects,
 * path-traversal entry names, ZIP64, and compression-ratio bombs.
 */
function assertZipSafe(buffer) {
  if (buffer.length < 22 || !buffer.subarray(0, 4).equals(ZIP_SIGNATURE)) {
    throw fileError("The .xlsx file is not a valid ZIP container.", "SPREADSHEET_INVALID");
  }

  const scanStart = Math.max(0, buffer.length - 65557);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= scanStart; offset -= 1) {
    if (readUInt32(buffer, offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) {
    throw fileError("The .xlsx file is missing its archive directory.", "SPREADSHEET_INVALID");
  }

  const entryCount = readUInt16(buffer, eocd + 10);
  const directorySize = readUInt32(buffer, eocd + 12);
  const directoryOffset = readUInt32(buffer, eocd + 16);

  if (entryCount === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    throw fileError("ZIP64 workbooks are not accepted. Re-save the file as a standard .xlsx.", "SPREADSHEET_INVALID");
  }
  if (entryCount === 0 || entryCount > SPREADSHEET_LIMITS.maxZipEntries) {
    throw fileError("The .xlsx archive contains too many entries.", "SPREADSHEET_INVALID");
  }
  if (directoryOffset + directorySize > buffer.length) {
    throw fileError("The .xlsx archive directory is truncated.", "SPREADSHEET_INVALID");
  }

  let offset = directoryOffset;
  let totalUncompressed = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length || readUInt32(buffer, offset) !== 0x02014b50) {
      throw fileError("The .xlsx archive directory is malformed.", "SPREADSHEET_INVALID");
    }
    const flags = readUInt16(buffer, offset + 8);
    const compression = readUInt16(buffer, offset + 10);
    const compressedSize = readUInt32(buffer, offset + 20);
    const uncompressedSize = readUInt32(buffer, offset + 24);
    const nameLength = readUInt16(buffer, offset + 28);
    const extraLength = readUInt16(buffer, offset + 30);
    const commentLength = readUInt16(buffer, offset + 32);
    const localOffset = readUInt32(buffer, offset + 42);

    if (flags & 0x0001) {
      throw fileError("Encrypted workbooks are not accepted.", "SPREADSHEET_INVALID");
    }
    if (compression !== 0 && compression !== 8) {
      throw fileError("The .xlsx archive uses an unsupported compression method.", "SPREADSHEET_INVALID");
    }
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw fileError("ZIP64 entries are not accepted.", "SPREADSHEET_INVALID");
    }
    if (offset + 46 + nameLength > buffer.length) {
      throw fileError("The .xlsx archive directory is truncated.", "SPREADSHEET_INVALID");
    }
    if (localOffset + 30 > buffer.length || readUInt32(buffer, localOffset) !== 0x04034b50) {
      throw fileError("The .xlsx archive contains an invalid entry.", "SPREADSHEET_INVALID");
    }

    const entryName = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString("utf8");
    const lower = entryName.toLowerCase();

    if (
      entryName.startsWith("/") ||
      entryName.includes("..") ||
      entryName.includes("\\") ||
      CONTROL_CHARACTERS.test(entryName)
    ) {
      throw fileError("The .xlsx archive contains an unsafe entry name.", "SPREADSHEET_INVALID");
    }
    if (
      lower.endsWith("vbaproject.bin") ||
      lower.includes("/embeddings/") ||
      lower.includes("/externallinks/") ||
      lower.includes("/activex/") ||
      lower.includes("/customui/") ||
      lower.endsWith(".xlsm") ||
      lower.endsWith(".xltm") ||
      lower.endsWith(".xlam")
    ) {
      throw fileError(
        "Macros, embedded objects, and external links are not accepted. Remove them and upload a plain workbook.",
        "SPREADSHEET_MACRO_REJECTED"
      );
    }

    totalUncompressed += uncompressedSize;
    if (totalUncompressed > SPREADSHEET_LIMITS.maxZipUncompressedBytes) {
      throw fileError("The workbook expands beyond the allowed size.", "SPREADSHEET_TOO_LARGE");
    }
    if (
      uncompressedSize > 1024 * 1024 &&
      compressedSize > 0 &&
      uncompressedSize / compressedSize > SPREADSHEET_LIMITS.maxZipRatio
    ) {
      throw fileError("The workbook has an unsafe compression ratio.", "SPREADSHEET_TOO_LARGE");
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return { entryCount, uncompressedBytes: totalUncompressed };
}

/**
 * Legacy .xls files are OLE compound documents. Macros live in streams whose
 * UTF-16 names include VBA or _VBA_PROJECT. They are never executed by the
 * parser, and this scan rejects workbooks that carry a macro project at all.
 */
function assertOleSafe(buffer) {
  if (buffer.length < OLE_SIGNATURE.length || !buffer.subarray(0, 8).equals(OLE_SIGNATURE)) {
    throw fileError("The .xls file is not a valid Excel workbook.", "SPREADSHEET_INVALID");
  }
  const markers = ["VBA", "_VBA_PROJECT", "Macros", "ThisWorkbook"];
  for (const marker of markers) {
    if (buffer.indexOf(Buffer.from(marker, "utf16le")) !== -1) {
      throw fileError(
        "Macro-enabled .xls workbooks are not accepted. Save a macro-free copy or upload .xlsx/.csv.",
        "SPREADSHEET_MACRO_REJECTED"
      );
    }
  }
}

function decodeCsv(buffer) {
  let body = buffer;
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) {
    body = body.subarray(3);
  }
  if (body.includes(0)) {
    throw fileError("The CSV file contains binary data.", "SPREADSHEET_INVALID");
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch (error) {
    throw fileError("The CSV file must be UTF-8 encoded.", "SPREADSHEET_INVALID");
  }
  if (CONTROL_CHARACTERS.test(text)) {
    throw fileError("The CSV file contains control characters.", "SPREADSHEET_INVALID");
  }
  if (text.split(/\r?\n/).some((line) => line.length > 32768)) {
    throw fileError("The CSV file contains an excessively long line.", "SPREADSHEET_INVALID");
  }
  return text;
}

/**
 * Identify a file from its actual bytes, not from its name or MIME type.
 * Returns the parser kind and, for CSV, the decoded UTF-8 text.
 */
function inspectSpreadsheet(buffer, extension) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw fileError("The file is empty.", "SPREADSHEET_EMPTY");
  }
  if (extension === ".xlsx") {
    assertZipSafe(buffer);
    return { kind: "xlsx" };
  }
  if (extension === ".xls") {
    assertOleSafe(buffer);
    return { kind: "xls" };
  }
  if (extension === ".csv") {
    return { kind: "csv", text: decodeCsv(buffer) };
  }
  throw fileError("Only .xlsx, .xls, and .csv files are supported.", "SPREADSHEET_TYPE_INVALID");
}

/**
 * Neutralise spreadsheet-formula injection when a value is written to a
 * downloadable workbook or CSV. It never changes database values.
 */
function safeExportValue(value) {
  const text = value === undefined || value === null ? "" : String(value);
  const cleaned = text.replace(CONTROL_CHARACTERS, " ");
  return FORMULA_LEADERS.test(cleaned) ? `'${cleaned}` : cleaned;
}

module.exports = {
  SPREADSHEET_LIMITS,
  ALLOWED_EXTENSIONS,
  formatBytes,
  inspectFilename,
  inspectSpreadsheet,
  assertZipSafe,
  assertOleSafe,
  decodeCsv,
  safeExportValue
};
