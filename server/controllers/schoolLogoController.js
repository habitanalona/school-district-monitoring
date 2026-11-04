"use strict";

const path = require("path");
const schoolService = require("../services/schoolService");
const schoolLogoService = require("../services/schoolLogoService");
const auditService = require("../services/auditService");
const { HttpError } = require("../utils/httpError");
const { assertDistrictAccess } = require("../utils/scope");
const { requireIdParam } = require("../utils/validators");

async function findManageableSchool(req) {
  const id = requireIdParam(req.params.id, "School ID");
  const school = await schoolService.findSchoolRow(id);
  if (!school) {
    throw new HttpError(404, "School not found.", "SCHOOL_NOT_FOUND");
  }
  assertDistrictAccess(req.user, school.district_id);
  if (school.status === "archived") {
    throw new HttpError(409, "Restore this school before changing its logo.", "SCHOOL_ARCHIVED");
  }
  return { id, school };
}

async function upload(req, res) {
  const { id, school } = await findManageableSchool(req);

  if (!req.file) {
    throw new HttpError(400, "Select an image to upload.", "LOGO_REQUIRED");
  }

  const saved = await schoolLogoService.saveForSchool(id, req.file);

  await auditService.recordForRequest(req, {
    action: saved.replaced ? "school.logo_replaced" : "school.logo_uploaded",
    entityType: "school",
    entityId: id,
    districtId: school.district_id,
    details: {
      school_code: school.school_code,
      school_name: school.school_name,
      stored_name: path.basename(saved.storedName),
      mime_type: saved.mimeType,
      byte_size: saved.byteSize,
      width: saved.width,
      height: saved.height,
      outcome: saved.replaced ? "replaced" : "uploaded"
    }
  });

  const updated = await schoolService.getSchool(id, null, null);
  res.json({ data: updated });
}

async function remove(req, res) {
  const { id, school } = await findManageableSchool(req);
  const result = await schoolLogoService.removeForSchool(id);

  if (result.removed) {
    await auditService.recordForRequest(req, {
      action: "school.logo_removed",
      entityType: "school",
      entityId: id,
      districtId: school.district_id,
      details: {
        school_code: school.school_code,
        school_name: school.school_name,
        stored_name: path.basename(result.previous || ""),
        outcome: "removed"
      }
    });
  }

  const updated = await schoolService.getSchool(id, null, null);
  res.json({ data: updated });
}

async function serve(req, res) {
  const id = requireIdParam(req.params.id, "School ID");
  const school = await schoolService.findSchoolRow(id);
  if (!school) {
    throw new HttpError(404, "School not found.", "SCHOOL_NOT_FOUND");
  }
  assertDistrictAccess(req.user, school.district_id);

  if (!school.school_logo) {
    throw new HttpError(404, "This school has no logo.", "LOGO_NOT_FOUND");
  }

  const etag = schoolLogoService.etagFor(school.school_logo);
  res.set({
    "Cache-Control": "private, max-age=300, must-revalidate",
    ETag: etag,
    "X-Content-Type-Options": "nosniff"
  });

  if (req.headers["if-none-match"] === etag) {
    return res.status(304).end();
  }

  const image = await schoolLogoService.readStored(school.school_logo);
  if (!image) {
    throw new HttpError(404, "This school has no logo.", "LOGO_NOT_FOUND");
  }

  // Set the image content type only after the file is known to exist, so an
  // error response is still serialized as JSON.
  res.set({
    "Content-Type": "image/webp",
    "Content-Disposition": 'inline; filename="school-logo.webp"'
  });
  return res.send(image);
}

module.exports = { upload, remove, serve };
