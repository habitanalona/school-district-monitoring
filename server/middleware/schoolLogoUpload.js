"use strict";

const multer = require("multer");
const { HttpError } = require("../utils/httpError");
const { MAX_INPUT_BYTES } = require("../services/schoolLogoService");

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const HEIC_MIME = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence"
]);
const MAX_INPUT_MB = Math.round(MAX_INPUT_BYTES / (1024 * 1024));

// The upload stays in memory only long enough for sharp to decode and re-encode
// it; no client-supplied filename or bytes ever reach the storage directory.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_INPUT_BYTES,
    files: 1,
    fields: 2
  },
  fileFilter(req, file, callback) {
    const mimeType = String(file.mimetype || "").toLowerCase();
    const name = String(file.originalname || "");
    const dot = name.lastIndexOf(".");
    const extension = dot === -1 ? "" : name.slice(dot).toLowerCase();

    if (HEIC_MIME.has(mimeType)) {
      return callback(
        new HttpError(
          415,
          "HEIC images are not supported. Export the logo as PNG, JPG, or WEBP and try again.",
          "LOGO_TYPE_UNSUPPORTED"
        )
      );
    }
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      return callback(
        new HttpError(415, "Upload a PNG, JPG, JPEG, or WEBP image.", "LOGO_TYPE_UNSUPPORTED")
      );
    }
    if (mimeType && !ALLOWED_MIME.has(mimeType)) {
      return callback(
        new HttpError(415, "Upload a PNG, JPG, JPEG, or WEBP image.", "LOGO_TYPE_UNSUPPORTED")
      );
    }
    return callback(null, true);
  }
});

function schoolLogoUpload(req, res, next) {
  upload.single("logo")(req, res, (error) => {
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
          `The image is larger than ${MAX_INPUT_MB} MB. Choose a smaller file.`,
          "LOGO_TOO_LARGE"
        )
      );
    }
    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return next(
        new HttpError(400, 'Attach the image in a field named "logo".', "LOGO_FIELD_INVALID")
      );
    }
    return next(new HttpError(400, "The image could not be uploaded.", "LOGO_UPLOAD_FAILED"));
  });
}

module.exports = { schoolLogoUpload };
