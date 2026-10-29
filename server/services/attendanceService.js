"use strict";

const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const {
  requireIdParam,
  requireEnum,
  requireString,
  optionalString,
  requirePeriod,
  fail
} = require("../utils/validators");
const {
  assertCan,
  resolveSchool,
  sectionForActor,
  resolveSchoolYear,
  assertLearnerVisible
} = require("../utils/formsAccess");
const auditService = require("./auditService");

const STATUSES = ["present", "absent", "tardy", "excused", "half_day"];
const DAY_TYPES = ["school_day", "holiday", "suspension", "no_class", "orientation"];

function requireDate(value, field = "Date") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`${field} must use the YYYY-MM-DD format.`, { field });
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    fail(`${field} is not a valid date.`, { field });
  }
  return value;
}

function monthBounds(month) {
  const period = requirePeriod(month, "Month");
  const [year, monthNumber] = period.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    period,
    start: `${period}-01`,
    end: `${period}-${String(daysInMonth).padStart(2, "0")}`,
    daysInMonth
  };
}

function defaultSchoolDay(dateString) {
  const day = new Date(`${dateString}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

async function roster(section, schoolYearId, runner = { query }) {
  const result = await runner.query(
    `SELECT e.id AS enrollment_id, e.learner_id, e.status AS enrollment_status,
            e.enrollment_date, l.lrn, l.last_name, l.first_name, l.middle_name,
            l.extension_name, l.sex, l.birth_date
     FROM enrollments e
     JOIN learners l ON l.id = e.learner_id
     WHERE e.section_id = $1 AND e.school_year_id = $2
       AND l.archived_at IS NULL
       AND e.status NOT IN ('transferred_out', 'archived')
     ORDER BY l.last_name ASC, l.first_name ASC, l.id ASC`,
    [section.id, schoolYearId]
  );
  return result.rows;
}

async function ensureSectionYear(actor, sectionId, schoolYearId) {
  const section = await sectionForActor(actor, sectionId);
  const year = await resolveSchoolYear(schoolYearId);
  if (Number(section.school_year_id) !== Number(year.id)) {
    throw new HttpError(
      409,
      "That section belongs to a different school year.",
      "SECTION_YEAR_MISMATCH"
    );
  }
  return { section, year };
}

async function getSheet(actor, options) {
  assertCan(actor, "attendance", "access");
  const { section, year } = await ensureSectionYear(actor, options.sectionId, options.schoolYearId);
  const date = requireDate(options.date, "Attendance date");
  const learners = await roster(section, year.id);
  const records = await query(
    `SELECT id, enrollment_id, learner_id, status, remarks, recorded_by, updated_by, updated_at
     FROM attendance_records
     WHERE section_id = $1 AND school_year_id = $2 AND attendance_date = $3`,
    [section.id, year.id, date]
  );
  const calendar = await query(
    `SELECT day_type, label FROM school_calendar_days
     WHERE school_id = $1 AND school_year_id = $2 AND calendar_date = $3`,
    [section.school_id, year.id, date]
  );
  const byEnrollment = new Map(records.rows.map((row) => [String(row.enrollment_id), row]));
  return {
    section: {
      id: Number(section.id),
      name: section.name,
      gradeLevelId: Number(section.grade_level_id),
      gradeLevelName: section.grade_level_name,
      adviserId: section.adviser_id ? Number(section.adviser_id) : null,
      adviserName: section.adviser_name,
      schoolId: Number(section.school_id),
      schoolName: section.school_name,
      schoolYearId: Number(year.id),
      schoolYearName: year.name
    },
    date,
    dayType: calendar.rows[0] ? calendar.rows[0].day_type : defaultSchoolDay(date) ? "school_day" : "no_class",
    dayLabel: calendar.rows[0] ? calendar.rows[0].label : null,
    learners: learners.map((learner) => {
      const record = byEnrollment.get(String(learner.enrollment_id));
      return {
        enrollmentId: Number(learner.enrollment_id),
        learnerId: Number(learner.learner_id),
        lrn: learner.lrn,
        fullName: [learner.last_name, learner.first_name, learner.middle_name, learner.extension_name]
          .filter(Boolean)
          .join(", ")
          .replace(", ", ", "),
        displayName: [learner.last_name, learner.first_name, learner.middle_name, learner.extension_name]
          .filter(Boolean)
          .join(" "),
        sex: learner.sex,
        status: record ? record.status : null,
        remarks: record ? record.remarks : null,
        recordId: record ? Number(record.id) : null
      };
    }),
    entered: records.rows.length,
    total: learners.length
  };
}

async function saveSheet(actor, payload, meta) {
  assertCan(actor, "attendance", "edit");
  const { section, year } = await ensureSectionYear(actor, payload.sectionId, payload.schoolYearId);
  const date = requireDate(payload.date, "Attendance date");
  if (!Array.isArray(payload.records) || !payload.records.length) {
    fail("Provide at least one attendance record.");
  }
  const learners = await roster(section, year.id);
  const allowed = new Set(learners.map((row) => String(row.enrollment_id)));
  const prepared = payload.records.map((entry) => {
    const enrollmentId = requireIdParam(entry.enrollmentId, "Enrollment");
    if (!allowed.has(String(enrollmentId))) {
      throw new HttpError(
        409,
        "A learner in this attendance sheet is not enrolled in the selected section.",
        "ATTENDANCE_ROSTER_MISMATCH"
      );
    }
    return {
      enrollmentId,
      status: requireEnum(entry.status, "Attendance status", STATUSES),
      remarks: optionalString(entry.remarks, "Remarks", { max: 255 })
    };
  });

  const client = await getClient();
  let changes = 0;
  try {
    await client.query("BEGIN");
    for (const entry of prepared) {
      const learnerRow = learners.find((row) => String(row.enrollment_id) === String(entry.enrollmentId));
      const before = await client.query(
        `SELECT id, status, remarks FROM attendance_records
         WHERE enrollment_id = $1 AND attendance_date = $2`,
        [entry.enrollmentId, date]
      );
      await client.query(
        `INSERT INTO attendance_records
           (learner_id, enrollment_id, school_id, school_year_id, grade_level_id,
            section_id, attendance_date, status, remarks, recorded_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         ON CONFLICT (enrollment_id, attendance_date) DO UPDATE SET
           status = EXCLUDED.status,
           remarks = EXCLUDED.remarks,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()`,
        [
          learnerRow.learner_id,
          entry.enrollmentId,
          section.school_id,
          year.id,
          section.grade_level_id,
          section.id,
          date,
          entry.status,
          entry.remarks,
          actor.id
        ]
      );
      if (!before.rows[0] || before.rows[0].status !== entry.status || before.rows[0].remarks !== entry.remarks) {
        changes += 1;
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  if (changes) {
    await auditService.record({
      userId: actor.id,
      districtId: actor.districtId,
      ipAddress: meta && meta.ip,
      action: "attendance.save",
      entityType: "attendance",
      entityId: section.id,
      details: { sectionId: Number(section.id), date, changed: changes, entries: prepared.length }
    });
  }
  return getSheet(actor, { sectionId: section.id, schoolYearId: year.id, date });
}

async function monthSheet(actor, options) {
  assertCan(actor, "attendance", "access");
  const { section, year } = await ensureSectionYear(actor, options.sectionId, options.schoolYearId);
  const bounds = monthBounds(options.month);
  const learners = await roster(section, year.id);
  const records = await query(
    `SELECT enrollment_id, learner_id, attendance_date, status, remarks
     FROM attendance_records
     WHERE section_id = $1 AND school_year_id = $2
       AND attendance_date BETWEEN $3 AND $4
     ORDER BY attendance_date ASC`,
    [section.id, year.id, bounds.start, bounds.end]
  );
  const calendarRows = await query(
    `SELECT calendar_date, day_type, label FROM school_calendar_days
     WHERE school_id = $1 AND school_year_id = $2
       AND calendar_date BETWEEN $3 AND $4`,
    [section.school_id, year.id, bounds.start, bounds.end]
  );
  const calendarMap = new Map(
    calendarRows.rows.map((row) => [
      row.calendar_date instanceof Date
        ? row.calendar_date.toISOString().slice(0, 10)
        : String(row.calendar_date).slice(0, 10),
      row
    ])
  );

  const days = [];
  for (let day = 1; day <= bounds.daysInMonth; day += 1) {
    const date = `${bounds.period}-${String(day).padStart(2, "0")}`;
    const calendar = calendarMap.get(date);
    days.push({
      date,
      day,
      weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
      dayType: calendar ? calendar.day_type : defaultSchoolDay(date) ? "school_day" : "no_class",
      label: calendar ? calendar.label : null,
      source: calendar ? "calendar" : "default"
    });
  }

  const recordMap = new Map();
  records.rows.forEach((record) => {
    const key = `${record.enrollment_id}:${String(record.attendance_date).slice(0, 10)}`;
    recordMap.set(key, record);
  });

  const learnersOut = learners.map((learner) => {
    const cells = {};
    const totals = { present: 0, absent: 0, tardy: 0, excused: 0, half_day: 0, recorded: 0 };
    days.forEach((day) => {
      const record = recordMap.get(`${learner.enrollment_id}:${day.date}`);
      if (record) {
        cells[day.date] = record.status;
        totals[record.status] += 1;
        totals.recorded += 1;
      }
    });
    return {
      enrollmentId: Number(learner.enrollment_id),
      learnerId: Number(learner.learner_id),
      lrn: learner.lrn,
      fullName: [learner.last_name, learner.first_name, learner.middle_name, learner.extension_name]
        .filter(Boolean)
        .join(" "),
      sex: learner.sex,
      cells,
      totals
    };
  });

  const schoolDays = days.filter((day) => day.dayType === "school_day");
  const missingDates = schoolDays
    .filter((day) => !records.rows.some((record) => String(record.attendance_date).slice(0, 10) === day.date))
    .map((day) => day.date);
  const partialDates = schoolDays
    .filter((day) => {
      const count = records.rows.filter(
        (record) => String(record.attendance_date).slice(0, 10) === day.date
      ).length;
      return count > 0 && count < learners.length;
    })
    .map((day) => day.date);

  return {
    section: {
      id: Number(section.id),
      name: section.name,
      gradeLevelId: Number(section.grade_level_id),
      gradeLevelName: section.grade_level_name,
      adviserName: section.adviser_name,
      schoolId: Number(section.school_id),
      schoolName: section.school_name,
      schoolYearId: Number(year.id),
      schoolYearName: year.name
    },
    month: bounds.period,
    days,
    schoolDays: schoolDays.length,
    learners: learnersOut,
    totals: learnersOut.reduce(
      (accumulator, learner) => {
        Object.keys(accumulator).forEach((key) => {
          accumulator[key] += learner.totals[key];
        });
        return accumulator;
      },
      { present: 0, absent: 0, tardy: 0, excused: 0, half_day: 0, recorded: 0 }
    ),
    missingDates,
    partialDates,
    complete: missingDates.length === 0 && partialDates.length === 0 && learners.length > 0
  };
}

async function attendanceRate(actor, options) {
  assertCan(actor, "attendance", "access");
  const sheet = await monthSheet(actor, options);
  const recorded = sheet.totals.recorded;
  const effectivePresent = sheet.totals.present + sheet.totals.tardy + sheet.totals.half_day * 0.5;
  const rate = recorded ? Math.round((effectivePresent / recorded) * 1000) / 10 : null;
  return {
    month: sheet.month,
    sectionId: sheet.section.id,
    schoolDays: sheet.schoolDays,
    recorded: recorded,
    present: sheet.totals.present,
    absent: sheet.totals.absent,
    tardy: sheet.totals.tardy,
    excused: sheet.totals.excused,
    halfDay: sheet.totals.half_day,
    attendanceRate: rate,
    missingDates: sheet.missingDates,
    partialDates: sheet.partialDates
  };
}

async function learnerHistory(actor, learnerId, options) {
  assertCan(actor, "attendance", "access");
  const learner = await assertLearnerVisible(actor, learnerId);
  const year = await resolveSchoolYear(options.schoolYearId);
  const result = await query(
    `SELECT attendance_date, status, remarks
     FROM attendance_records
     WHERE learner_id = $1 AND school_year_id = $2
     ORDER BY attendance_date ASC`,
    [learner.id, year.id]
  );
  const monthly = {};
  result.rows.forEach((row) => {
    const month = String(row.attendance_date).slice(0, 7);
    monthly[month] = monthly[month] || {
      month,
      present: 0,
      absent: 0,
      tardy: 0,
      excused: 0,
      half_day: 0,
      recorded: 0
    };
    monthly[month][row.status] += 1;
    monthly[month].recorded += 1;
  });
  return {
    learner: {
      id: Number(learner.id),
      lrn: learner.lrn,
      fullName: [learner.last_name, learner.first_name, learner.middle_name]
        .filter(Boolean)
        .join(" ")
    },
    schoolYear: { id: Number(year.id), name: year.name },
    records: result.rows.map((row) => ({
      date: String(row.attendance_date).slice(0, 10),
      status: row.status,
      remarks: row.remarks
    })),
    monthly: Object.values(monthly)
  };
}

async function listCalendar(actor, options) {
  assertCan(actor, "attendance", "access");
  const school = await resolveSchool(actor, options.schoolId);
  const year = await resolveSchoolYear(options.schoolYearId);
  const bounds = monthBounds(options.month);
  const result = await query(
    `SELECT * FROM school_calendar_days
     WHERE school_id = $1 AND school_year_id = $2
       AND calendar_date BETWEEN $3 AND $4
     ORDER BY calendar_date ASC`,
    [school.id, year.id, bounds.start, bounds.end]
  );
  return {
    schoolId: Number(school.id),
    schoolName: school.school_name,
    schoolYearId: Number(year.id),
    schoolYearName: year.name,
    month: bounds.period,
    days: result.rows.map((row) => ({
      id: Number(row.id),
      date: String(row.calendar_date).slice(0, 10),
      dayType: row.day_type,
      label: row.label
    }))
  };
}

async function saveCalendarDay(actor, payload) {
  assertCan(actor, "attendance", "edit");
  const school = await resolveSchool(actor, payload.schoolId);
  const year = await resolveSchoolYear(payload.schoolYearId);
  const date = requireDate(payload.date, "Calendar date");
  const dayType = requireEnum(payload.dayType, "Day type", DAY_TYPES);
  const label = optionalString(payload.label, "Label", { max: 160 });
  const result = await query(
    `INSERT INTO school_calendar_days
       (school_id, school_year_id, calendar_date, day_type, label, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (school_id, school_year_id, calendar_date) DO UPDATE SET
       day_type = EXCLUDED.day_type,
       label = EXCLUDED.label,
       updated_at = now()
     RETURNING *`,
    [school.id, year.id, date, dayType, label, actor.id]
  );
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "attendance.calendar",
    entityType: "school_calendar_day",
    entityId: result.rows[0].id,
    details: { date, dayType, label }
  });
  return {
    id: Number(result.rows[0].id),
    date: String(result.rows[0].calendar_date).slice(0, 10),
    dayType: result.rows[0].day_type,
    label: result.rows[0].label
  };
}

async function deleteCalendarDay(actor, id) {
  assertCan(actor, "attendance", "edit");
  const result = await query("SELECT * FROM school_calendar_days WHERE id = $1", [id]);
  const row = result.rows[0];
  if (!row) {
    throw new HttpError(404, "Calendar day not found.", "CALENDAR_NOT_FOUND");
  }
  const school = await resolveSchool(actor, row.school_id);
  await query("DELETE FROM school_calendar_days WHERE id = $1", [id]);
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "attendance.calendar.delete",
    entityType: "school_calendar_day",
    entityId: id,
    details: { schoolId: Number(school.id), date: String(row.calendar_date).slice(0, 10) }
  });
  return { deleted: true };
}

module.exports = {
  STATUSES,
  DAY_TYPES,
  requireDate,
  monthBounds,
  getSheet,
  saveSheet,
  monthSheet,
  attendanceRate,
  learnerHistory,
  listCalendar,
  saveCalendarDay,
  deleteCalendarDay,
  defaultSchoolDay,
  roster,
  ensureSectionYear
};
