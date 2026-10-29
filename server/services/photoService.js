"use strict";

const sharp = require("sharp");
const { query } = require("../config/database");
const { HttpError } = require("../utils/httpError");

// Phone cameras routinely produce 2-8 MB files. The upload limit is generous
// because the stored copy is always re-encoded to a small 512x512 WebP.
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_STORED_BYTES = 2 * 1024 * 1024;
const MAX_INPUT_PIXELS = 48 * 1000 * 1000;
const OUTPUT_SIZE = 512;
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

// Decode and re-encode every upload. Re-encoding normalises the format, crops it
// to a square, caps the dimensions, and strips EXIF/GPS metadata, so a crafted
// file cannot smuggle a second payload or leak the uploader's location.
async function normalizeUpload(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new HttpError(400, "Select an image to upload.", "PHOTO_REQUIRED");
  }

  let image;
  try {
    image = sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
    const metadata = await image.metadata();
    if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
      throw new HttpError(415, "Upload a JPEG, PNG, or WebP image.", "PHOTO_TYPE_UNSUPPORTED");
    }

    const normalized = await image
      .rotate()
      .resize({ width: OUTPUT_SIZE, height: OUTPUT_SIZE, fit: "cover", position: "centre" })
      .webp({ quality: 82, effort: 4 })
      .toBuffer({ resolveWithObject: true });

    if (normalized.data.length > MAX_STORED_BYTES) {
      throw new HttpError(413, "The processed image is too large. Choose a smaller photo.", "PHOTO_TOO_LARGE");
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
    throw new HttpError(415, "That file is not a readable JPEG, PNG, or WebP image.", "PHOTO_INVALID");
  }
}

async function saveForUser(userId, buffer) {
  const photo = await normalizeUpload(buffer);
  const result = await query(
    `INSERT INTO user_photos (user_id, mime_type, byte_size, width, height, image_data, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (user_id) DO UPDATE SET
       mime_type = EXCLUDED.mime_type,
       byte_size = EXCLUDED.byte_size,
       width = EXCLUDED.width,
       height = EXCLUDED.height,
       image_data = EXCLUDED.image_data,
       updated_at = now()
     RETURNING updated_at`,
    [userId, photo.mimeType, photo.data.length, photo.width, photo.height, photo.data]
  );

  return {
    updatedAt: result.rows[0].updated_at,
    byteSize: photo.data.length,
    width: photo.width,
    height: photo.height
  };
}

async function getForUser(userId) {
  const result = await query(
    `SELECT user_id, mime_type, byte_size, width, height, image_data, updated_at
     FROM user_photos
     WHERE user_id = $1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function deleteForUser(userId) {
  const result = await query(
    `DELETE FROM user_photos WHERE user_id = $1 RETURNING user_id`,
    [userId]
  );
  return result.rowCount > 0;
}

// Photos are only shared inside the account's own district. System
// administrators can reach every district; everyone else can always see their
// own photo. This keeps learner images from leaking across districts.
async function assertCanView(actor, targetUserId) {
  if (Number(actor.id) === Number(targetUserId)) {
    return;
  }

  const result = await query(`SELECT id, district_id FROM users WHERE id = $1`, [targetUserId]);
  const target = result.rows[0];
  if (!target) {
    throw new HttpError(404, "User account not found.", "USER_NOT_FOUND");
  }

  if (actor.role === "system_admin") {
    return;
  }
  if (actor.districtId && Number(target.district_id) === Number(actor.districtId)) {
    return;
  }

  throw new HttpError(403, "You do not have access to that profile photo.", "PHOTO_FORBIDDEN");
}

function etagFor(row) {
  const stamp = row.updated_at ? new Date(row.updated_at).getTime().toString(36) : "0";
  return `"${stamp}-${Number(row.byte_size)}"`;
}

module.exports = {
  MAX_INPUT_BYTES,
  MAX_STORED_BYTES,
  normalizeUpload,
  saveForUser,
  getForUser,
  deleteForUser,
  assertCanView,
  etagFor
};