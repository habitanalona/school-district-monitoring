"use strict";

const academicService = require("../services/academicService");
const {
  fail,
  requireString,
  optionalString,
  requireInteger,
  parseBoolean,
  requireIdParam
} = require("../utils/validators");

const SCHOOL_YEAR_PATTERN = /^[0-9]{4}-[0-9]{4}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;

function actorFrom(req) {
  return { ...req.user, ipAddress: req.ip || null };
}

function optionalId(value, field) {
  if (value === undefined || value === null || value === "" || value === 0 || value === "0") {
    return null;
  }
  return requireInteger(value, field, { min: 1 });
}

function requireDate(value, field) {
  const text = requireString(value, field, { min: 10, max: 10 });
  if (!DATE_PATTERN.test(text)) {
    fail(`${field} must use the YYYY-MM-DD format.`, { field });
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    fail(`${field} is not a valid date.`, { field });
  }
  return text;
}

function optionalDate(value, field) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return requireDate(value, field);
}

function requireTime(value, field) {
  const text = requireString(value, field, { min: 5, max: 8 });
  if (!TIME_PATTERN.test(text)) {
    fail(`${field} must use the HH:MM 24-hour format.`, { field });
  }
  return text;
}

function requireCode(value, field, options = {}) {
  const { max = 32 } = options;
  const code = requireString(value, field, { min: 1, max }).toUpperCase().replace(/\s+/g, "-");
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(code)) {
    fail(`${field} may only contain letters, numbers, dots, underscores, and hyphens.`, {
      field
    });
  }
  return code;
}

function readSchoolYear(body) {
  const name = requireString(body.name, "School year", { min: 9, max: 9 });
  if (!SCHOOL_YEAR_PATTERN.test(name)) {
    fail("School year must use the YYYY-YYYY format.", { field: "name" });
  }
  const startsOn = requireDate(body.startsOn, "Start date");
  const endsOn = requireDate(body.endsOn, "End date");
  if (endsOn <= startsOn) {
    fail("End date must be after the start date.", { field: "endsOn" });
  }
  return {
    name,
    startsOn,
    endsOn,
    isCurrent: parseBoolean(body.isCurrent, false)
  };
}

function readSection(body) {
  return {
    schoolId: optionalId(body.schoolId, "School"),
    schoolYearId: requireInteger(body.schoolYearId, "School year", { min: 1 }),
    gradeLevelId: requireInteger(body.gradeLevelId, "Grade level", { min: 1 }),
    name: requireString(body.name, "Section name", { min: 1, max: 64 }),
    adviserId: optionalId(body.adviserId, "Adviser"),
    room: optionalString(body.room, "Room", { max: 64 })
  };
}

function readSubject(body) {
  return {
    schoolId: optionalId(body.schoolId, "School"),
    code: requireCode(body.code, "Subject code"),
    name: requireString(body.name, "Subject name", { min: 2, max: 160 }),
    gradeLevelId: optionalId(body.gradeLevelId, "Grade level")
  };
}

function readAssignment(body) {
  return {
    schoolId: optionalId(body.schoolId, "School"),
    schoolYearId: requireInteger(body.schoolYearId, "School year", { min: 1 }),
    sectionId: requireInteger(body.sectionId, "Section", { min: 1 }),
    subjectId: requireInteger(body.subjectId, "Subject", { min: 1 }),
    teacherId: optionalId(body.teacherId, "Teacher"),
    employeeNumber: optionalString(body.employeeNumber, "Employee number", { max: 32 }),
    remarks: optionalString(body.remarks, "Remarks", { max: 2000 })
  };
}

/* School years ------------------------------------------------------------ */

async function listSchoolYears(req, res) {
  res.json({ data: await academicService.listSchoolYears(req.user) });
}

async function createSchoolYear(req, res) {
  const data = await academicService.createSchoolYear(actorFrom(req), readSchoolYear(req.body));
  res.status(201).json({ data });
}

async function updateSchoolYear(req, res) {
  const data = await academicService.updateSchoolYear(
    actorFrom(req),
    requireIdParam(req.params.id, "School year ID"),
    readSchoolYear(req.body)
  );
  res.json({ data });
}

async function copyStructure(req, res) {
  const body = req.body || {};
  const data = await academicService.copyStructure(actorFrom(req), {
    schoolId: optionalId(body.schoolId, "School"),
    fromSchoolYearId: requireInteger(body.fromSchoolYearId, "Source school year", { min: 1 }),
    toSchoolYearId: requireInteger(body.toSchoolYearId, "Target school year", { min: 1 }),
    dryRun: parseBoolean(body.dryRun, false)
  });
  res.status(data.dryRun ? 200 : 201).json({ data });
}

/* Grade levels ------------------------------------------------------------ */

async function listGradeLevels(req, res) {
  const data = await academicService.listGradeLevels(req.user, {
    schoolId: optionalId(req.query.schoolId, "School")
  });
  res.json({ data });
}

async function createGradeLevel(req, res) {
  const data = await academicService.createGradeLevel(actorFrom(req), {
    schoolId: optionalId(req.body.schoolId, "School"),
    name: requireString(req.body.name, "Grade level", { min: 1, max: 32 }),
    sortOrder: requireInteger(req.body.sortOrder ?? 0, "Sort order", { min: 0, max: 100 })
  });
  res.status(201).json({ data });
}

async function updateGradeLevel(req, res) {
  const data = await academicService.updateGradeLevel(
    actorFrom(req),
    requireIdParam(req.params.id, "Grade level ID"),
    {
      name: requireString(req.body.name, "Grade level", { min: 1, max: 32 }),
      sortOrder: requireInteger(req.body.sortOrder ?? 0, "Sort order", { min: 0, max: 100 })
    }
  );
  res.json({ data });
}

async function deleteGradeLevel(req, res) {
  const data = await academicService.deleteGradeLevel(
    actorFrom(req),
    requireIdParam(req.params.id, "Grade level ID")
  );
  res.json({ data });
}

/* Sections ---------------------------------------------------------------- */

async function listSections(req, res) {
  const data = await academicService.listSections(req.user, {
    schoolId: optionalId(req.query.schoolId, "School"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    gradeLevelId: optionalId(req.query.gradeLevelId, "Grade level")
  });
  res.json({ data });
}

async function createSection(req, res) {
  const data = await academicService.createSection(actorFrom(req), readSection(req.body));
  res.status(201).json({ data });
}

async function updateSection(req, res) {
  const data = await academicService.updateSection(
    actorFrom(req),
    requireIdParam(req.params.id, "Section ID"),
    readSection(req.body)
  );
  res.json({ data });
}

async function deleteSection(req, res) {
  const data = await academicService.deleteSection(
    actorFrom(req),
    requireIdParam(req.params.id, "Section ID")
  );
  res.json({ data });
}

/* Subjects ---------------------------------------------------------------- */

async function listSubjects(req, res) {
  const data = await academicService.listSubjects(req.user, {
    schoolId: optionalId(req.query.schoolId, "School"),
    gradeLevelId: optionalId(req.query.gradeLevelId, "Grade level")
  });
  res.json({ data });
}

async function createSubject(req, res) {
  const data = await academicService.createSubject(actorFrom(req), readSubject(req.body));
  res.status(201).json({ data });
}

async function updateSubject(req, res) {
  const data = await academicService.updateSubject(
    actorFrom(req),
    requireIdParam(req.params.id, "Subject ID"),
    readSubject(req.body)
  );
  res.json({ data });
}

async function deleteSubject(req, res) {
  const data = await academicService.deleteSubject(
    actorFrom(req),
    requireIdParam(req.params.id, "Subject ID")
  );
  res.json({ data });
}

/* Teacher assignments ----------------------------------------------------- */

async function listAssignments(req, res) {
  const data = await academicService.listAssignments(req.user, {
    schoolId: optionalId(req.query.schoolId, "School"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    sectionId: optionalId(req.query.sectionId, "Section"),
    subjectId: optionalId(req.query.subjectId, "Subject"),
    teacherId: optionalId(req.query.teacherId, "Teacher"),
    search: optionalString(req.query.search, "Search", { max: 100 }) || ""
  });
  res.json({ data });
}

async function createAssignment(req, res) {
  const data = await academicService.createAssignment(
    actorFrom(req),
    readAssignment(req.body)
  );
  res.status(201).json({ data });
}

async function updateAssignment(req, res) {
  const data = await academicService.updateAssignment(
    actorFrom(req),
    requireIdParam(req.params.id, "Assignment ID"),
    readAssignment(req.body)
  );
  res.json({ data });
}

async function deleteAssignment(req, res) {
  const data = await academicService.deleteAssignment(
    actorFrom(req),
    requireIdParam(req.params.id, "Assignment ID")
  );
  res.json({ data });
}

/* Class schedules --------------------------------------------------------- */

async function listSchedules(req, res) {
  const data = await academicService.listSchedules(req.user, {
    schoolId: optionalId(req.query.schoolId, "School"),
    schoolYearId: optionalId(req.query.schoolYearId, "School year"),
    sectionId: optionalId(req.query.sectionId, "Section"),
    teacherId: optionalId(req.query.teacherId, "Teacher"),
    dayOfWeek: optionalId(req.query.dayOfWeek, "Day")
  });
  res.json({ data });
}

async function timetable(req, res) {
  const data = await academicService.getTimetable(
    req.user,
    requireInteger(req.query.sectionId, "Section", { min: 1 })
  );
  res.json({ data });
}

async function createSchedule(req, res) {
  const data = await academicService.createSchedule(actorFrom(req), {
    assignmentId: requireInteger(req.body.assignmentId, "Teaching assignment", { min: 1 }),
    dayOfWeek: requireInteger(req.body.dayOfWeek, "Day of week", { min: 1, max: 7 }),
    startTime: requireTime(req.body.startTime, "Start time"),
    endTime: requireTime(req.body.endTime, "End time"),
    room: optionalString(req.body.room, "Room", { max: 64 }),
    remarks: optionalString(req.body.remarks, "Remarks", { max: 2000 })
  });
  res.status(201).json({ data });
}

async function updateSchedule(req, res) {
  const data = await academicService.updateSchedule(
    actorFrom(req),
    requireIdParam(req.params.id, "Schedule ID"),
    {
      dayOfWeek: requireInteger(req.body.dayOfWeek, "Day of week", { min: 1, max: 7 }),
      startTime: requireTime(req.body.startTime, "Start time"),
      endTime: requireTime(req.body.endTime, "End time"),
      room: optionalString(req.body.room, "Room", { max: 64 }),
      remarks: optionalString(req.body.remarks, "Remarks", { max: 2000 })
    }
  );
  res.json({ data });
}

async function deleteSchedule(req, res) {
  const data = await academicService.deleteSchedule(
    actorFrom(req),
    requireIdParam(req.params.id, "Schedule ID")
  );
  res.json({ data });
}

/* Teaching personnel ------------------------------------------------------ */

async function teachers(req, res) {
  const data = await academicService.listTeachers(req.user, {
    schoolId: optionalId(req.query.schoolId, "School")
  });
  res.json({ data });
}

module.exports = {
  listSchoolYears,
  createSchoolYear,
  updateSchoolYear,
  copyStructure,
  listGradeLevels,
  createGradeLevel,
  updateGradeLevel,
  deleteGradeLevel,
  listSections,
  createSection,
  updateSection,
  deleteSection,
  listSubjects,
  createSubject,
  updateSubject,
  deleteSubject,
  listAssignments,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  listSchedules,
  timetable,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  teachers
};
