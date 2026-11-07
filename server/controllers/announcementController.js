"use strict";

const announcementService = require("../services/announcementService");
const { resolveScope } = require("../utils/scope");
const { HttpError } = require("../utils/httpError");
const {
  requireString,
  requireEnum,
  optionalEnum,
  requireInteger,
  requireIdParam,
  ANNOUNCEMENT_STATUSES
} = require("../utils/validators");

function actorFrom(req) {
  return { ...req.user, ipAddress: req.ip || null };
}

function readSchoolIds(value) {
  if (value === undefined) {
    return null;
  }
  if (!Array.isArray(value)) {
    throw new HttpError(400, "Schools must be a list.", "VALIDATION_ERROR", {
      field: "schoolIds"
    });
  }
  const ids = value.map((entry) => requireInteger(entry, "School", { min: 1 }));
  return Array.from(new Set(ids));
}

function readPayload(body) {
  const districtId =
    body.districtId === undefined || body.districtId === null || body.districtId === ""
      ? null
      : requireInteger(body.districtId, "District", { min: 1 });

  return {
    title: requireString(body.title, "Title", { min: 3, max: 200 }),
    content: requireString(body.content, "Content", { min: 10, max: 5000 }),
    status: requireEnum(body.status, "Status", ANNOUNCEMENT_STATUSES),
    districtId,
    schoolIds: readSchoolIds(body.schoolIds)
  };
}

async function list(req, res) {
  const announcements = await announcementService.listAnnouncements(req.user, {
    status: optionalEnum(req.query.status, "Status", ANNOUNCEMENT_STATUSES) || "",
    districtScopeId: resolveScope(req.user, req.query.districtId)
  });
  res.json({ data: announcements });
}

async function detail(req, res) {
  const announcement = await announcementService.getAnnouncement(
    requireIdParam(req.params.id, "Announcement ID"),
    req.user
  );
  res.json({ data: announcement });
}

async function create(req, res) {
  const announcement = await announcementService.createAnnouncement(
    actorFrom(req),
    readPayload(req.body)
  );
  res.status(201).json({ data: announcement });
}

async function update(req, res) {
  const announcement = await announcementService.updateAnnouncement(
    actorFrom(req),
    requireIdParam(req.params.id, "Announcement ID"),
    readPayload(req.body)
  );
  res.json({ data: announcement });
}

async function remove(req, res) {
  const result = await announcementService.deleteAnnouncement(
    actorFrom(req),
    requireIdParam(req.params.id, "Announcement ID")
  );
  res.json({ data: result });
}

module.exports = { list, detail, create, update, remove };
