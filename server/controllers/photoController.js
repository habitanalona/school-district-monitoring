"use strict";

const photoService = require("../services/photoService");
const auditService = require("../services/auditService");
const userService = require("../services/userService");
const { HttpError } = require("../utils/httpError");
const { requireIdParam } = require("../utils/validators");

async function uploadOwn(req, res) {
  if (!req.file) {
    throw new HttpError(400, "Select an image to upload.", "PHOTO_REQUIRED");
  }

  const saved = await photoService.saveForUser(req.user.id, req.file.buffer);

  await auditService.recordForRequest(req, {
    action: "profile.photo_updated",
    entityType: "user",
    entityId: req.user.id,
    details: {
      username: req.user.username,
      byte_size: saved.byteSize,
      width: saved.width,
      height: saved.height
    }
  });

  res.json({ data: { photoUpdatedAt: saved.updatedAt } });
}

async function deleteOwn(req, res) {
  const removed = await photoService.deleteForUser(req.user.id);

  if (removed) {
    await auditService.recordForRequest(req, {
      action: "profile.photo_removed",
      entityType: "user",
      entityId: req.user.id,
      details: { username: req.user.username }
    });
  }

  res.json({ data: { photoUpdatedAt: null } });
}

async function uploadForUser(req, res) {
  const id = requireIdParam(req.params.id, "User ID");
  const target = await userService.findUserRow(id);
  if (!target) {
    throw new HttpError(404, "User account not found.", "USER_NOT_FOUND");
  }
  userService.assertCanManage(req.user, target);

  if (!req.file) {
    throw new HttpError(400, "Select an image to upload.", "PHOTO_REQUIRED");
  }

  const saved = await photoService.saveForUser(id, req.file.buffer);

  await auditService.recordForRequest(req, {
    action: "user.photo_updated",
    entityType: "user",
    entityId: id,
    districtId: target.district_id || null,
    details: {
      username: target.username,
      byte_size: saved.byteSize,
      width: saved.width,
      height: saved.height
    }
  });

  res.json({ data: { photoUpdatedAt: saved.updatedAt } });
}

async function deleteForUser(req, res) {
  const id = requireIdParam(req.params.id, "User ID");
  const target = await userService.findUserRow(id);
  if (!target) {
    throw new HttpError(404, "User account not found.", "USER_NOT_FOUND");
  }
  userService.assertCanManage(req.user, target);

  const removed = await photoService.deleteForUser(id);

  if (removed) {
    await auditService.recordForRequest(req, {
      action: "user.photo_removed",
      entityType: "user",
      entityId: id,
      districtId: target.district_id || null,
      details: { username: target.username }
    });
  }

  res.json({ data: { photoUpdatedAt: null } });
}

async function serve(req, res) {
  const id = requireIdParam(req.params.id, "User ID");
  await photoService.assertCanView(req.user, id);

  const photo = await photoService.getForUser(id);
  if (!photo) {
    throw new HttpError(404, "This account has no profile photo.", "PHOTO_NOT_FOUND");
  }

  const etag = photoService.etagFor(photo);
  res.set({
    "Content-Type": photo.mime_type,
    "Cache-Control": "private, max-age=60, must-revalidate",
    ETag: etag,
    "X-Content-Type-Options": "nosniff"
  });

  if (req.headers["if-none-match"] === etag) {
    return res.status(304).end();
  }

  return res.send(photo.image_data);
}

module.exports = { uploadOwn, deleteOwn, uploadForUser, deleteForUser, serve };