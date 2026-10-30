"use strict";

const multer = require("multer");
const { HttpError } = require("../utils/httpError");
const { SPREADSHEET_LIMITS, formatBytes } = require("../utils/spreadsheetGuard");
const auditService = require("../services/auditService");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: SPREADSHEET_LIMITS.maxFileBytes,
    files: SPREADSHEET_LIMITS.maxFiles,
    fields: 2,
    parts: SPREADSHEET_LIMITS.maxFiles + 3
  }
});

function translateMulterError(error) {
  if (error instanceof HttpError) {
    return error;
  }
  switch (error.code) {
    case "LIMIT_FILE_SIZE":
      return new HttpError(
        413,
        `Each file must be ${formatBytes(SPREADSHEET_LIMITS.maxFileBytes)} or smaller.`,
        "SPREADSHEET_TOO_LARGE"
      );
    case "LIMIT_FILE_COUNT":
      return new HttpError(
        400,
        `Upload no more than ${SPREADSHEET_LIMITS.maxFiles} files at once.`,
        "TOO_MANY_FILES"
      );
    case "LIMIT_UNEXPECTED_FILE":
      return new HttpError(400, "Use the file field for spreadsheet uploads.", "UPLOAD_FIELD_INVALID");
    case "LIMIT_PART_COUNT":
      return new HttpError(400, "The upload contains too many parts.", "UPLOAD_INVALID");
    default:
      return new HttpError(400, "The files could not be uploaded.", "SPREADSHEET_UPLOAD_FAILED");
  }
}

function districtImportUpload(req, res, next) {
  upload.array("files", SPREADSHEET_LIMITS.maxFiles)(req, res, async (error) => {
    if (error) {
      const translated = translateMulterError(error);
      if (req.user) {
        await auditService.record({
          userId: req.user.id,
          districtId: req.user.districtId || null,
          action: "district.import_rejected",
          entityType: "district_import",
          ipAddress: req.ip || null,
          details: { code: translated.code, reason: translated.message }
        });
      }
      return next(translated);
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) {
      return next(new HttpError(400, "Choose at least one spreadsheet file.", "NO_FILES"));
    }

    const totalBytes = files.reduce((sum, file) => sum + Number(file.size || 0), 0);
    if (totalBytes > SPREADSHEET_LIMITS.maxTotalBytes) {
      if (req.user) {
        await auditService.record({
          userId: req.user.id,
          districtId: req.user.districtId || null,
          action: "district.import_rejected",
          entityType: "district_import",
          ipAddress: req.ip || null,
          details: {
            code: "TOTAL_TOO_LARGE",
            files: files.length,
            totalBytes
          }
        });
      }
      return next(
        new HttpError(
          413,
          `The combined upload must be ${formatBytes(SPREADSHEET_LIMITS.maxTotalBytes)} or smaller.`,
          "TOTAL_TOO_LARGE"
        )
      );
    }

    return next();
  });
}

module.exports = { districtImportUpload };
