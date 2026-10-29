"use strict";

const multer = require("multer");
const { HttpError } = require("../utils/httpError");
const { MAX_INPUT_BYTES } = require("../services/photoService");

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const HEIC_MIME = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence"
]);
const MAX_INPUT_MB = Math.round(MAX_INPUT_BYTES / (1024 * 1024));

// Files are kept in memory only long enough to be normalised by sharp; nothing
// user-supplied is ever written to the application directory.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_INPUT_BYTES,
    files: 1,
    fields: 2
  },
  fileFilter(req, file, callback) {
    const mimeType = String(file.mimetype || "").toLowerCase();
    if (HEIC_MIME.has(mimeType)) {
      return callback(
        new HttpError(
          415,
          "iPhone HEIC photos are not supported. In iPhone Settings, set Camera > Formats to \"Most Compatible\", or export the photo as JPEG, then upload again.",
          "PHOTO_HEIC_UNSUPPORTED"
        )
      );
    }
    if (!ALLOWED_MIME.has(mimeType)) {
      return callback(
        new HttpError(415, "Upload a JPEG, PNG, or WebP image.", "PHOTO_TYPE_UNSUPPORTED")
      );
    }
    return callback(null, true);
  }
});

function photoUpload(req, res, next) {
  upload.single("photo")(req, res, (error) => {
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
          "PHOTO_TOO_LARGE"
        )
      );
    }
    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return next(
        new HttpError(400, 'Attach the image in a field named "photo".', "PHOTO_FIELD_INVALID")
      );
    }
    return next(new HttpError(400, "The image could not be uploaded.", "PHOTO_UPLOAD_FAILED"));
  });
}

module.exports = { photoUpload, MAX_INPUT_BYTES };
