"use strict";

const learnerService = require("../services/learnerService");
const {
  fail,
  requireString,
  optionalString,
  optionalEmail,
  optionalPhone,
  requireEnum,
  optionalEnum,
  requireInteger,
  optionalNumber,
  parseBoolean,
  parsePagination,
  parseSort,
  parseDirection,
  requireIdParam
} = require("../utils/validators");

const SEX_VALUES = ["male", "female"];
const LEARNER_STATUS_FILTERS = ["active", "archived", "all"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const ZIP_PATTERN = /^\d{4,10}$/;

function actorFrom(req) {
  return { ...req.user, ipAddress: req.ip || null };
}

function optionalId(value, field) {
  if (value === undefined || value === null || value === "" || value === 0 || value === "0") {
    return null;
  }
  return requireInteger(value, field, { min: 1 });
}

function requireLrn(value) {
  const lrn = requireString(value, "LRN", { min: 12, max: 12 }).replace(/\s+/g, "");
  if (!/^\d{12}$/.test(lrn)) {
    fail("The LRN must be exactly 12 digits.", { field: "lrn" });
  }
  return lrn;
}

function requireDate(value, field, options = {}) {
  const text = requireString(value, field, { min: 10, max: 10 });
  if (!DATE_PATTERN.test(text)) {
    fail(`${field} must use the YYYY-MM-DD format.`, { field });
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    fail(`${field} is not a valid date.`, { field });
  }
  if (options.notFuture && text > new Date().toISOString().slice(0, 10)) {
    fail(`${field} cannot be in the future.`, { field });
  }
  if (options.notBefore && text < options.notBefore) {
    fail(`${field} is out of range.`, { field });
  }
  return text;
}

function optionalDate(value, field, options = {}) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requireDate(value, field, options);
}

function optionalZip(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const zip = requireString(value, "ZIP code", { min: 4, max: 10 });
  if (!ZIP_PATTERN.test(zip)) {
    fail("Enter a valid Philippine ZIP code.", { field: "zipCode" });
  }
  return zip;
}

function readLearnerPayload(body, actor) {
  const schoolId = optionalId(body.schoolId, "School") || actor.schoolId || null;
  const birthDate = requireDate(body.birthDate, "Birth date", {
    notFuture: true,
    notBefore: "1900-01-01"
  });

  return {
    lrn: requireLrn(body.lrn),
    lastName: requireString(body.lastName, "Last name", { min: 1, max: 80 }),
    firstName: requireString(body.firstName, "First name", { min: 1, max: 80 }),
    middleName: optionalString(body.middleName, "Middle name", { max: 80 }),
    extensionName: optionalString(body.extensionName, "Name extension", { max: 16 }),
    birthDate,
    sex: requireEnum(body.sex, "Sex", SEX_VALUES),
    weightKg: optionalNumber(body.weightKg, "Weight", { min: 1, max: 500 }),
    heightCm: optionalNumber(body.heightCm, "Height", { min: 1, max: 300 }),
    houseNumber: optionalString(body.houseNumber, "House number / street", { max: 120 }),
    barangay: optionalString(body.barangay, "Barangay", { max: 120 }),
    municipality: optionalString(body.municipality, "Municipality / city", { max: 120 }),
    province: optionalString(body.province, "Province", { max: 120 }),
    region: optionalString(body.region, "Region", { max: 120 }),
    zipCode: optionalZip(body.zipCode),
    contactNumber: optionalPhone(body.contactNumber, "Contact number"),
    email: optionalEmail(body.email, "Email address"),
    schoolId
  };
}

function readGuardianPayload(body) {
  return {
    fullName: requireString(body.fullName, "Guardian name", { min: 2, max: 160 }),
    relationship: requireString(body.relationship, "Relationship", { min: 1, max: 48 }),
    contactNumber: optionalPhone(body.contactNumber, "Guardian contact number"),
    email: optionalEmail(body.email, "Guardian email"),
    address: optionalString(body.address, "Guardian address", { max: 500 }),
    occupation: optionalString(body.occupation, "Occupation", { max: 120 }),
    isPrimary: parseBoolean(body.isPrimary, false),
    isEmergency: parseBoolean(body.isEmergency, false)
  };
}

function readEnrollmentPayload(body) {
  return {
    schoolYearId: requireInteger(body.schoolYearId, "School year", { min: 1 }),
    gradeLevelId: requireInteger(body.gradeLevelId, "Grade level", { min: 1 }),
    sectionId: optionalId(body.sectionId, "Section"),
    adviserId: optionalId(body.adviserId, "Adviser"),
    enrollmentDate: optionalDate(body.enrollmentDate, "Enrollment date") ||
      new Date().toISOString().slice(0, 10),
    status: optionalEnum(body.status, "Enrollment status", learnerService.ENROLLMENT_STATUSES) ||
      "enrolled",
    remarks: optionalString(body.remarks, "Remarks", { max: 2000 })
  };
}

async function list(req, res) {
  const pagination = parsePagination(req.query);
  const result = await learnerService.listLearners(req.user, {
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    schoolId: optionalId(req.query.schoolId, "School"),
    gradeLevelId: optionalId(req.query.gradeLevelId, "Grade level"),
    sectionId: optionalId(req.query.sectionId, "Section"),
    adviserId: optionalId(req.query.adviserId, "Adviser"),
    search: optionalString(req.query.search, "Search", { max: 100 }) || "",
    status: optionalEnum(req.query.status, "Learner status", LEARNER_STATUS_FILTERS) || "active",
    enrollmentStatus:
      optionalEnum(
        req.query.enrollmentStatus,
        "Enrollment status",
        learnerService.ENROLLMENT_STATUSES
      ) || "",
    sort: parseSort(req.query.sort, Object.keys(learnerService.SORT_COLUMNS), "name"),
    direction: parseDirection(req.query.direction),
    page: pagination.page,
    pageSize: pagination.pageSize
  });

  res.json({
    data: result.learners,
    meta: { schoolYear: result.schoolYear },
    pagination: {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / result.pageSize))
    }
  });
}

async function summary(req, res) {
  const data = await learnerService.getLearnerSummary(
    req.user,
    optionalId(req.query.schoolYearId, "School year")
  );
  res.json({ data });
}

async function detail(req, res) {
  const data = await learnerService.getLearnerDetail(
    req.user,
    requireIdParam(req.params.id, "Learner ID")
  );
  res.json({ data });
}

async function history(req, res) {
  const data = await learnerService.getLearnerHistory(
    req.user,
    requireIdParam(req.params.id, "Learner ID")
  );
  res.json({ data });
}

async function create(req, res) {
  const payload = readLearnerPayload(req.body, req.user);
  if (!payload.schoolId) {
    fail("Choose the school for this learner.", { field: "schoolId" });
  }
  const data = await learnerService.createLearner(actorFrom(req), payload);
  res.status(201).json({ data });
}

async function update(req, res) {
  const data = await learnerService.updateLearner(
    actorFrom(req),
    requireIdParam(req.params.id, "Learner ID"),
    readLearnerPayload(req.body, req.user)
  );
  res.json({ data });
}

async function archive(req, res) {
  const data = await learnerService.archiveLearner(
    actorFrom(req),
    requireIdParam(req.params.id, "Learner ID")
  );
  res.json({ data });
}

async function restore(req, res) {
  const data = await learnerService.restoreLearner(
    actorFrom(req),
    requireIdParam(req.params.id, "Learner ID")
  );
  res.json({ data });
}

async function createGuardian(req, res) {
  const data = await learnerService.createGuardian(
    actorFrom(req),
    requireIdParam(req.params.id, "Learner ID"),
    readGuardianPayload(req.body)
  );
  res.status(201).json({ data });
}

async function updateGuardian(req, res) {
  const data = await learnerService.updateGuardian(
    actorFrom(req),
    requireIdParam(req.params.id, "Learner ID"),
    requireIdParam(req.params.guardianId, "Guardian ID"),
    readGuardianPayload(req.body)
  );
  res.json({ data });
}

async function deleteGuardian(req, res) {
  const data = await learnerService.deleteGuardian(
    actorFrom(req),
    requireIdParam(req.params.id, "Learner ID"),
    requireIdParam(req.params.guardianId, "Guardian ID")
  );
  res.json({ data });
}

async function createEnrollment(req, res) {
  const data = await learnerService.createEnrollment(
    actorFrom(req),
    requireIdParam(req.params.id, "Learner ID"),
    readEnrollmentPayload(req.body)
  );
  res.status(201).json({ data });
}

async function updateEnrollment(req, res) {
  const body = req.body || {};
  const data = await learnerService.updateEnrollment(
    actorFrom(req),
    requireIdParam(req.params.id, "Learner ID"),
    requireIdParam(req.params.enrollmentId, "Enrollment ID"),
    {
      gradeLevelId: optionalId(body.gradeLevelId, "Grade level"),
      sectionId:
        body.sectionId === undefined
          ? undefined
          : optionalId(body.sectionId, "Section"),
      adviserId:
        body.adviserId === undefined ? undefined : optionalId(body.adviserId, "Adviser"),
      enrollmentDate: optionalDate(body.enrollmentDate, "Enrollment date"),
      status: optionalEnum(body.status, "Enrollment status", learnerService.ENROLLMENT_STATUSES),
      remarks: optionalString(body.remarks, "Remarks", { max: 2000 })
    }
  );
  res.json({ data });
}

async function promote(req, res) {
  const body = req.body || {};
  const data = await learnerService.promoteLearner(
    actorFrom(req),
    requireIdParam(req.params.id, "Learner ID"),
    {
      sourceEnrollmentId: optionalId(body.sourceEnrollmentId, "Source enrollment"),
      sourceSchoolYearId: optionalId(body.sourceSchoolYearId, "Source school year"),
      schoolYearId: requireInteger(body.schoolYearId, "Target school year", { min: 1 }),
      gradeLevelId: requireInteger(body.gradeLevelId, "Target grade level", { min: 1 }),
      sectionId: optionalId(body.sectionId, "Target section"),
      adviserId: optionalId(body.adviserId, "Adviser"),
      enrollmentDate: optionalDate(body.enrollmentDate, "Enrollment date") ||
        new Date().toISOString().slice(0, 10),
      remarks: optionalString(body.remarks, "Remarks", { max: 2000 })
    }
  );
  res.status(201).json({ data });
}

async function addActivity(req, res) {
  const data = await learnerService.addLearnerActivity(
    actorFrom(req),
    requireIdParam(req.params.id, "Learner ID"),
    {
      activityId: requireInteger(req.body.activityId, "Activity", { min: 1 }),
      role: optionalString(req.body.role, "Role", { max: 80 }),
      achievement: optionalString(req.body.achievement, "Achievement", { max: 200 }),
      remarks: optionalString(req.body.remarks, "Remarks", { max: 2000 })
    }
  );
  res.status(201).json({ data });
}

async function removeActivity(req, res) {
  const data = await learnerService.removeLearnerActivity(
    actorFrom(req),
    requireIdParam(req.params.id, "Learner ID"),
    requireIdParam(req.params.participationId, "Activity record ID")
  );
  res.json({ data });
}

async function uploadDocument(req, res) {
  const learnerId = requireIdParam(req.params.id, "Learner ID");
  const data = await learnerService.saveDocument(actorFrom(req), learnerId, req.file, {
    title: requireString(req.body.title, "Document title", { min: 2, max: 160 }),
    documentType: requireString(req.body.documentType, "Document type", { min: 2, max: 64 }),
    schoolYearId: optionalId(req.body.schoolYearId, "School year")
  });
  const detail = await learnerService.getLearnerDetail(req.user, learnerId);
  res.status(201).json({ data: { ...data, documents: detail.documents } });
}

async function downloadDocument(req, res) {
  const file = await learnerService.getDocumentFile(
    req.user,
    requireIdParam(req.params.id, "Learner ID"),
    requireIdParam(req.params.documentId, "Document ID")
  );
  const asciiName = file.file_name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  res.setHeader("Content-Type", file.mime_type);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.file_name)}`
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, no-store");
  res.send(file.document_data);
}

async function deleteDocument(req, res) {
  const data = await learnerService.deleteDocument(
    actorFrom(req),
    requireIdParam(req.params.id, "Learner ID"),
    requireIdParam(req.params.documentId, "Document ID")
  );
  res.json({ data });
}

module.exports = {
  list,
  summary,
  detail,
  history,
  create,
  update,
  archive,
  restore,
  createGuardian,
  updateGuardian,
  deleteGuardian,
  createEnrollment,
  updateEnrollment,
  promote,
  addActivity,
  removeActivity,
  uploadDocument,
  downloadDocument,
  deleteDocument
};
