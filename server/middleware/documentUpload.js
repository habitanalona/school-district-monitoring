"use strict";

const multer = require("multer");
const { HttpError } = require("../utils/httpError");

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENT_MB = Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024));
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/octet-stream"
]);

// Documents are kept in memory only; learner_documents stores them in Postgres
// so the application directory never holds user uploads. The service re-checks
// the magic bytes before anything is written.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_DOCUMENT_BYTES,
    files: 1,
    fields: 4
  },
  fileFilter(req, file, callback) {
    const mimeType = String(file.mimetype || "").toLowerCase();
    if (!ALLOWED_MIME.has(mimeType)) {
      return callback(
        new HttpError(415, "Upload a PDF, JPEG, or PNG document.", "DOCUMENT_TYPE_INVALID")
      );
    }
    return callback(null, true);
  }
});

function documentUpload(req, res, next) {
  upload.single("document")(req, res, (error) => {
    if (!error) {
      return next();
    }
    if (error instanceof HttpError) {
      return next(error);
    }
    if (error.code === "LIMIT_FILE_SIZE") {
      return next(
        new HttpError(
          413,
          `The document is larger than ${MAX_DOCUMENT_MB} MB. Choose a smaller file.`,
          "DOCUMENT_TOO_LARGE"
        )
      );
    }
    return next(new HttpError(400, "The document could not be uploaded.", "DOCUMENT_UPLOAD_FAILED"));
  });
}

module.exports = { documentUpload, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_MB };
