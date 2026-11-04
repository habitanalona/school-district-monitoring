"use strict";

// School logo storage.
//
// Every upload is decoded by sharp and re-encoded to WebP before it is stored.
// The file is written under a random name inside a private directory that is
// never registered with express.static, so an uploaded file cannot be executed
// or served without passing through the authenticated API route. PostgreSQL
// only stores the relative reference.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const { query } = require("../config/database");
const { HttpError } = require("../utils/httpError");

const MAX_INPUT_BYTES = 2 * 1024 * 1024;
const MAX_STORED_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 2000;
// Guards against decompression bombs while still letting sharp report the real
// dimensions for the friendlier "too large" message.
const MAX_INPUT_PIXELS = 48 * 1000 * 1000;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);
const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const MIME_BY_FORMAT = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

function storageRoot() {
  const configured = process.env.SCHOOL_LOGO_DIR || path.join("storage", "school-logos");
  return path.resolve(__dirname, "..", "..", configured);
}

function extensionOf(name) {
  return path.extname(String(name || "")).toLowerCase();
}

// Magic-byte detection. The browser-supplied MIME type and the file extension
// are hints only; the bytes decide whether a file is an image.
function detectFormat(buffer) {
  if (!buffer || buffer.length < 12) {
    return null;
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpeg";
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }
  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

function extensionMatches(extension, format) {
  if (format === "jpeg") {
    return extension === ".jpg" || extension === ".jpeg";
  }
  return extension === "." + format;
}

function normalizeUpload(file) {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new HttpError(400, "Select an image to upload.", "LOGO_REQUIRED");
  }
  if (file.buffer.length > MAX_INPUT_BYTES) {
    throw new HttpError(413, "The image is larger than 2 MB. Choose a smaller file.", "LOGO_TOO_LARGE");
  }

  const extension = extensionOf(file.originalname);
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new HttpError(415, "Upload a PNG, JPG, JPEG, or WEBP image.", "LOGO_TYPE_UNSUPPORTED");
  }

  const detected = detectFormat(file.buffer);
  if (!detected || !extensionMatches(extension, detected)) {
    throw new HttpError(
      415,
      "That file is not a valid PNG, JPG, JPEG, or WEBP image.",
      "LOGO_TYPE_UNSUPPORTED"
    );
  }

  return decodeAndEncode(file.buffer, detected);
}

async function decodeAndEncode(buffer, detected) {
  let image;
  try {
    image = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
    const metadata = await image.metadata();

    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format) || metadata.format !== detected) {
      throw new HttpError(415, "That file is not a valid image.", "LOGO_TYPE_UNSUPPORTED");
    }
    if (!metadata.width || !metadata.height) {
      throw new HttpError(415, "The image dimensions could not be read.", "LOGO_INVALID");
    }
    if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
      throw new HttpError(
        413,
        `The image is ${metadata.width}×${metadata.height} px. Maximum dimensions are 2000×2000 px.`,
        "LOGO_DIMENSIONS"
      );
    }
    if (metadata.pages && metadata.pages > 1) {
      throw new HttpError(415, "Animated images are not supported. Upload a still image.", "LOGO_INVALID");
    }

    // rotate() applies the EXIF orientation before the metadata is discarded;
    // sharp strips EXIF, GPS, and other metadata unless withMetadata() is used.
    const normalized = await image
      .rotate()
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    if (!normalized.info.width || !normalized.info.height) {
      throw new HttpError(415, "The image could not be processed.", "LOGO_INVALID");
    }
    if (normalized.info.width > MAX_DIMENSION || normalized.info.height > MAX_DIMENSION) {
      throw new HttpError(413, "The processed image is larger than 2000×2000 px.", "LOGO_DIMENSIONS");
    }
    if (normalized.data.length > MAX_STORED_BYTES) {
      throw new HttpError(413, "The processed image is too large. Choose a smaller file.", "LOGO_TOO_LARGE");
    }

    return {
      data: normalized.data,
      mimeType: "image/webp",
      width: normalized.info.width,
      height: normalized.info.height
    };
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(415, "That file is not a readable image. It may be corrupted.", "LOGO_INVALID");
  }
}

// Resolve a stored reference without ever trusting it as a path. Anything that
// could escape the private storage root is treated as missing.
function resolveStored(relative) {
  if (!relative || typeof relative !== "string") {
    return null;
  }
  const normalized = relative.replace(/\\/g, "/");
  if (normalized.includes("\0") || normalized.includes("..") || path.posix.isAbsolute(normalized)) {
    return null;
  }
  const root = storageRoot();
  const absolute = path.resolve(root, normalized);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return absolute.startsWith(prefix) ? absolute : null;
}

async function writeStored(relative, data) {
  const absolute = resolveStored(relative);
  if (!absolute) {
    throw new Error("Invalid logo storage reference.");
  }
  const directory = path.dirname(absolute);
  await fs.promises.mkdir(directory, { recursive: true });
  const temporary = absolute + ".tmp-" + crypto.randomBytes(6).toString("hex");
  try {
    await fs.promises.writeFile(temporary, data, { flag: "wx", mode: 0o600 });
    await fs.promises.rename(temporary, absolute);
  } catch (error) {
    await fs.promises.unlink(temporary).catch(() => {});
    throw error;
  }
  return absolute;
}

async function deleteStored(relative) {
  const absolute = resolveStored(relative);
  if (!absolute) {
    return;
  }
  try {
    await fs.promises.unlink(absolute);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("School logo cleanup failed:", error.message);
    }
  }
}

async function saveForSchool(schoolId, file) {
  const logo = await normalizeUpload(file);
  const relative = `school-${Number(schoolId)}/${crypto.randomUUID()}.webp`;

  try {
    await writeStored(relative, logo.data);
  } catch (error) {
    console.error("School logo write failed:", error.message);
    throw new HttpError(500, "The logo could not be stored. Please try again.", "LOGO_STORAGE_FAILED");
  }

  let result;
  try {
    result = await query(
      `WITH previous AS (
         SELECT school_logo FROM schools WHERE id = $1 FOR UPDATE
       )
       UPDATE schools s
       SET school_logo = $2, updated_at = now()
       FROM previous p
       WHERE s.id = $1
       RETURNING p.school_logo AS previous_logo, s.school_logo AS new_logo`,
      [schoolId, relative]
    );
  } catch (error) {
    await deleteStored(relative);
    throw error;
  }

  if (!result.rows[0]) {
    await deleteStored(relative);
    throw new HttpError(404, "School not found.", "SCHOOL_NOT_FOUND");
  }

  // The previous file is deleted only after the database points at the new
  // logo, so a failed replacement can never leave the school without an image.
  const previous = result.rows[0].previous_logo;
  if (previous) {
    await deleteStored(previous);
  }

  return {
    replaced: Boolean(previous),
    storedName: relative,
    byteSize: logo.data.length,
    width: logo.width,
    height: logo.height,
    mimeType: logo.mimeType
  };
}

async function removeForSchool(schoolId) {
  const result = await query(
    `WITH previous AS (
       SELECT school_logo FROM schools WHERE id = $1 FOR UPDATE
     )
     UPDATE schools s
     SET school_logo = NULL, updated_at = now()
     FROM previous p
     WHERE s.id = $1
     RETURNING p.school_logo AS previous_logo`,
    [schoolId]
  );

  if (!result.rows[0]) {
    throw new HttpError(404, "School not found.", "SCHOOL_NOT_FOUND");
  }

  const previous = result.rows[0].previous_logo;
  if (previous) {
    await deleteStored(previous);
  }
  return { removed: Boolean(previous), previous };
}

async function readStored(relative) {
  const absolute = resolveStored(relative);
  if (!absolute) {
    return null;
  }
  try {
    return await fs.promises.readFile(absolute);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("School logo read failed:", error.message);
    }
    return null;
  }
}

function etagFor(relative) {
  return `"${crypto.createHash("sha256").update(String(relative)).digest("hex").slice(0, 24)}"`;
}

module.exports = {
  MAX_INPUT_BYTES,
  MAX_DIMENSION,
  storageRoot,
  normalizeUpload,
  saveForSchool,
  removeForSchool,
  readStored,
  deleteStored,
  resolveStored,
  etagFor
};
