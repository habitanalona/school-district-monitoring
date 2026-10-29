"use strict";

const activityService = require("../services/activityService");
const {
  fail,
  requireString,
  optionalString,
  optionalEnum,
  requireInteger,
  requireIdParam
} = require("../utils/validators");

const PARTICIPATION_LEVELS = [
  "classroom",
  "school",
  "district",
  "division",
  "regional",
  "national",
  "international"
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function actorFrom(req) {
  return { ...req.user, ipAddress: req.ip || null };
}

function optionalId(value, field) {
  if (value === undefined || value === null || value === "" || value === 0 || value === "0") {
    return null;
  }
  return requireInteger(value, field, { min: 1 });
}

function optionalDate(value, field) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const text = requireString(value, field, { min: 10, max: 10 });
  if (!DATE_PATTERN.test(text)) {
    fail(`${field} must use the YYYY-MM-DD format.`, { field });
  }
  return text;
}

function readActivity(body) {
  const startDate = optionalDate(body.startDate, "Start date");
  const endDate = optionalDate(body.endDate, "End date");
  if (startDate && endDate && endDate < startDate) {
    fail("End date cannot be before the start date.", { field: "endDate" });
  }
  return {
    schoolId: optionalId(body.schoolId, "School"),
    schoolYearId: requireInteger(body.schoolYearId, "School year", { min: 1 }),
    name: requireString(body.name, "Activity name", { min: 2, max: 160 }),
    category: requireString(body.category, "Category", { min: 1, max: 64 }),
    organization: optionalString(body.organization, "Club or organization", { max: 160 }),
    adviserId: optionalId(body.adviserId, "Adviser or coach"),
    participationLevel: optionalEnum(
      body.participationLevel,
      "Participation level",
      PARTICIPATION_LEVELS
    ) || "school",
    startDate,
    endDate,
    achievement: optionalString(body.achievement, "Achievement", { max: 200 }),
    remarks: optionalString(body.remarks, "Remarks", { max: 2000 })
  };
}

async function list(req, res) {
  const data = await activityService.listActivities(req.user, {
    schoolId: optionalId(req.query.schoolId, "School"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    learnerId: optionalId(req.query.learnerId, "Learner"),
    adviserId: optionalId(req.query.adviserId, "Adviser"),
    category: optionalString(req.query.category, "Category", { max: 64 }) || "",
    level: optionalEnum(req.query.level, "Participation level", PARTICIPATION_LEVELS) || "",
    search: optionalString(req.query.search, "Search", { max: 100 }) || ""
  });
  res.json({ data });
}

async function detail(req, res) {
  res.json({
    data: await activityService.getActivityDetail(
      req.user,
      requireIdParam(req.params.id, "Activity ID")
    )
  });
}

async function create(req, res) {
  const data = await activityService.createActivity(actorFrom(req), readActivity(req.body));
  res.status(201).json({ data });
}

async function update(req, res) {
  const data = await activityService.updateActivity(
    actorFrom(req),
    requireIdParam(req.params.id, "Activity ID"),
    readActivity(req.body)
  );
  res.json({ data });
}

async function remove(req, res) {
  const data = await activityService.deleteActivity(
    actorFrom(req),
    requireIdParam(req.params.id, "Activity ID")
  );
  res.json({ data });
}

async function addParticipant(req, res) {
  const data = await activityService.addParticipant(
    actorFrom(req),
    requireIdParam(req.params.id, "Activity ID"),
    {
      learnerId: requireInteger(req.body.learnerId, "Learner", { min: 1 }),
      role: optionalString(req.body.role, "Role", { max: 80 }),
      achievement: optionalString(req.body.achievement, "Achievement", { max: 200 }),
      remarks: optionalString(req.body.remarks, "Remarks", { max: 2000 })
    }
  );
  res.status(201).json({ data });
}

async function removeParticipant(req, res) {
  const data = await activityService.removeParticipant(
    actorFrom(req),
    requireIdParam(req.params.id, "Activity ID"),
    requireIdParam(req.params.participantId, "Participant ID")
  );
  res.json({ data });
}

module.exports = {
  PARTICIPATION_LEVELS,
  list,
  detail,
  create,
  update,
  remove,
  addParticipant,
  removeParticipant
};
