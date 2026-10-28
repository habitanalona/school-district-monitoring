"use strict";

const { HttpError } = require("./httpError");
const { requireInteger } = require("./validators");

function resolveScope(user, rawDistrictId) {
  if (user.role !== "system_admin") {
    return user.districtId;
  }
  if (rawDistrictId === undefined || rawDistrictId === null || rawDistrictId === "" || rawDistrictId === "all") {
    return null;
  }
  return requireInteger(rawDistrictId, "District", { min: 1 });
}

function assertDistrictAccess(user, districtId) {
  if (user.role !== "system_admin" && Number(districtId) !== Number(user.districtId)) {
    throw new HttpError(403, "You do not have access to that district.", "DISTRICT_FORBIDDEN");
  }
}

module.exports = { resolveScope, assertDistrictAccess };
