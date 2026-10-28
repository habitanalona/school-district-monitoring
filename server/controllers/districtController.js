"use strict";

const districtService = require("../services/districtService");
const { HttpError } = require("../utils/httpError");
const {
  requireString,
  optionalString,
  optionalEmail,
  optionalPhone,
  requireIdParam
} = require("../utils/validators");

const DISTRICT_CODE_PATTERN = /^[A-Z0-9-]+$/;

function readDistrictPayload(body) {
  const name = requireString(body.name, "District name", { min: 2, max: 160 });
  const code = requireString(body.code, "District code", { min: 2, max: 24 }).toUpperCase();
  if (!DISTRICT_CODE_PATTERN.test(code)) {
    throw new HttpError(
      400,
      "District code may only contain letters, numbers, and hyphens.",
      "VALIDATION_ERROR",
      { field: "District code" }
    );
  }
  const address = optionalString(body.address, "Address", { max: 500 });
  const contactEmail = optionalEmail(body.contactEmail, "Contact email");

  if (!Array.isArray(body.psds) || body.psds.length !== 2) {
    throw new HttpError(
      400,
      "Provide both PSDS assignments for this district.",
      "VALIDATION_ERROR",
      { field: "PSDS" }
    );
  }

  const psds = body.psds.map((entry, index) => {
    const source = entry && typeof entry === "object" ? entry : {};
    const label = `PSDS ${index + 1}`;
    return {
      name: requireString(source.name, `${label} name`, { max: 160 }),
      email: optionalEmail(source.email, `${label} email`),
      phone: optionalPhone(source.phone, `${label} phone`)
    };
  });

  if (psds[0].name.toLowerCase() === psds[1].name.toLowerCase()) {
    throw new HttpError(
      400,
      "The two PSDS assignments must be different people.",
      "VALIDATION_ERROR",
      { field: "PSDS" }
    );
  }

  return {
    districtName: name,
    districtCode: code,
    address,
    contactEmail,
    psds
  };
}

async function list(req, res) {
  const districts = await districtService.listForUser(req.user);
  res.json({ data: districts });
}

async function hierarchy(req, res) {
  const data = await districtService.hierarchyForUser(req.user);
  res.json({ data });
}

async function detail(req, res) {
  const id = requireIdParam(req.params.id, "District");
  const district = await districtService.getDistrict(req.user, id);
  res.json({ data: district });
}

async function create(req, res) {
  const payload = readDistrictPayload(req.body);
  const district = await districtService.createDistrict(req.user, payload);
  res.status(201).json({ data: district });
}

async function update(req, res) {
  const id = requireIdParam(req.params.id, "District");
  const payload = readDistrictPayload(req.body);
  const district = await districtService.updateDistrict(req.user, id, payload);
  res.json({ data: district });
}

async function remove(req, res) {
  const id = requireIdParam(req.params.id, "District");
  const district = await districtService.deleteDistrict(req.user, id);
  res.json({
    data: {
      message: `${district.name} was deleted.`,
      district
    }
  });
}

module.exports = { list, hierarchy, detail, create, update, remove };
