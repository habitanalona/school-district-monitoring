"use strict";

const { query } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const { calculateAge } = require("../utils/age");
const { learnerScopeSql } = require("../utils/learnerAccess");
const { PROFILE_COMPLETE_SQL, resolveCurrentSchoolYear, findSchoolYearOrThrow } =
  require("./learnerService");
const academicService = require("./academicService");
const activityService = require("./activityService");

const REPORT_DEFINITIONS = {
  "master-list": { label: "Learner master list", scope: "school-year" },
  "profile-sheet": { label: "Learner profile sheet", scope: "learner" },
  "section-list": { label: "Section list", scope: "section" },
  "guardian-directory": { label: "Parent and guardian directory", scope: "school" },
  "enrollment-list": { label: "Enrollment list", scope: "school-year" },
  "adviser-list": { label: "Section adviser list", scope: "school-year" },
  "assignment-list": { label: "Subject and teacher assignment list", scope: "school-year" },
  "weekly-schedule": { label: "Weekly class schedule", scope: "section" },
  "activity-report": { label: "Curricular and extracurricular activity report", scope: "school-year" },
  "enrollment-history": { label: "Learner enrollment history", scope: "school-year" },
  "incomplete-profiles": { label: "Incomplete learner profile report", scope: "school-year" }
};

const CATEGORY_LABELS = {
  classroom: "Classroom",
  school: "School",
  district: "District",
  division: "Division",
  regional: "Regional",
  national: "National",
  international: "International"
};

function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  // Spreadsheet formula injection guard: Excel/Sheets treat these prefixes as
  // formulas even inside comma-separated files.
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(headers, rows) {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(","));
  // Excel on Windows needs the BOM to read UTF-8 names correctly.
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

function safeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function personName(row) {
  return [row.first_name, row.middle_name, row.last_name, row.extension_name]
    .filter(Boolean)
    .join(" ");
}

async function resolveYear(schoolYearId) {
  const year = schoolYearId
    ? await findSchoolYearOrThrow(schoolYearId)
    : await resolveCurrentSchoolYear();
  return year || null;
}

async function learnerRows(actor, options = {}) {
  const year = await resolveYear(options.schoolYearId);
  if (!year) {
    throw new HttpError(
      400,
      "Create a school year before exporting learner reports.",
      "SCHOOL_YEAR_REQUIRED"
    );
  }
  const params = [Number(year.id)];
  const conditions = [];
  const scope = learnerScopeSql(actor, "l", params);
  if (scope) {
    conditions.push(scope);
  }
  if (options.schoolId) {
    params.push(options.schoolId);
    conditions.push(`l.school_id = $${params.length}`);
  }
  if (options.sectionId) {
    params.push(options.sectionId);
    conditions.push(`e.section_id = $${params.length}`);
  }
  if (options.gradeLevelId) {
    params.push(options.gradeLevelId);
    conditions.push(`e.grade_level_id = $${params.length}`);
  }
  if (options.learnerId) {
    params.push(options.learnerId);
    conditions.push(`l.id = $${params.length}`);
  }
  if (options.search) {
    params.push(`%${options.search}%`);
    conditions.push(
      `(l.lrn ILIKE $${params.length}
        OR concat_ws(' ', l.first_name, l.middle_name, l.last_name, l.extension_name) ILIKE $${params.length})`
    );
  }

  const result = await query(
    `SELECT l.*, s.school_name, s.school_code, d.district_name,
            e.grade_level_id, gl.name AS grade_level_name, e.section_id,
            sec.name AS section_name, COALESCE(e.adviser_id, sec.adviser_id) AS adviser_id,
            adv.full_name AS adviser_name, e.status AS enrollment_status,
            e.enrollment_date, e.remarks AS enrollment_remarks, y.name AS school_year_name,
            EXISTS (SELECT 1 FROM guardians g WHERE g.learner_id = l.id) AS has_guardian,
            (SELECT g.full_name FROM guardians g
             WHERE g.learner_id = l.id AND g.is_primary LIMIT 1) AS primary_guardian,
            (SELECT g.contact_number FROM guardians g
             WHERE g.learner_id = l.id AND g.is_primary LIMIT 1) AS primary_guardian_contact
     FROM learners l
     JOIN schools s ON s.id = l.school_id
     JOIN districts d ON d.id = l.district_id
     JOIN school_years y ON y.id = $1
     LEFT JOIN enrollments e ON e.learner_id = l.id AND e.school_year_id = $1
     LEFT JOIN grade_levels gl ON gl.id = e.grade_level_id
     LEFT JOIN sections sec ON sec.id = e.section_id
     LEFT JOIN users adv ON adv.id = COALESCE(e.adviser_id, sec.adviser_id)
     WHERE l.archived_at IS NULL ${conditions.length ? `AND ${conditions.join(" AND ")}` : ""}
     ORDER BY l.last_name ASC, l.first_name ASC, l.id ASC`,
    params
  );
  return { year, rows: result.rows };
}

function missingFields(row) {
  const missing = [];
  if (!row.barangay) missing.push("Barangay");
  if (!row.municipality) missing.push("Municipality / city");
  if (!row.province) missing.push("Province");
  if (!row.region) missing.push("Region");
  if (!row.zip_code) missing.push("ZIP code");
  if (!row.contact_number && !row.email) missing.push("Contact number");
  if (!row.has_guardian) missing.push("Parent or guardian");
  return missing;
}

function learnerAddress(row) {
  return [row.house_number, row.barangay, row.municipality, row.province, row.region, row.zip_code]
    .filter(Boolean)
    .join(", ");
}

/* -------------------------------------------------------------------------- */
/* Report builders                                                             */
/* -------------------------------------------------------------------------- */

async function masterList(actor, options) {
  const { year, rows } = await learnerRows(actor, options);
  return {
    filename: `learner-master-list-${safeName(year.name)}.csv`,
    csv: toCsv(
      [
        "LRN",
        "Last Name",
        "First Name",
        "Middle Name",
        "Extension",
        "Sex",
        "Birth Date",
        "Age",
        "Grade Level",
        "Section",
        "Adviser",
        "Enrollment Status",
        "Contact Number",
        "Address",
        "School Year"
      ],
      rows.map((row) => [
        row.lrn,
        row.last_name,
        row.first_name,
        row.middle_name || "",
        row.extension_name || "",
        row.sex,
        row.birth_date,
        calculateAge(row.birth_date),
        row.grade_level_name || "Not enrolled",
        row.section_name || "",
        row.adviser_name || "",
        row.enrollment_status || "not enrolled",
        row.contact_number || "",
        learnerAddress(row),
        year.name
      ])
    )
  };
}

async function profileSheet(actor, options) {
  if (!options.learnerId) {
    throw new HttpError(400, "Choose a learner for the profile sheet.", "LEARNER_REQUIRED");
  }
  const learnerService = require("./learnerService");
  const detail = await learnerService.getLearnerDetail(actor, options.learnerId);
  const { learner } = detail;
  const rows = [
    ["LRN", learner.lrn],
    ["Learner name", learner.formalName],
    ["Sex", learner.sex],
    ["Birth date", learner.birthDate],
    ["Age (derived)", learner.age],
    ["Weight (kg)", learner.weightKg],
    ["Height (cm)", learner.heightCm],
    ["House number / street", learner.houseNumber],
    ["Barangay", learner.barangay],
    ["Municipality / city", learner.municipality],
    ["Province", learner.province],
    ["Region", learner.region],
    ["ZIP code", learner.zipCode],
    ["Contact number", learner.contactNumber],
    ["Email", learner.email],
    ["School", learner.schoolName],
    ["Profile status", learner.profileComplete ? "Complete" : `Missing: ${learner.missingFields.join(", ")}`]
  ];

  detail.guardians.forEach((guardian, index) => {
    rows.push([
      `Guardian ${index + 1}`,
      [
        guardian.fullName,
        guardian.relationship,
        guardian.contactNumber,
        guardian.isPrimary ? "primary" : "",
        guardian.isEmergency ? "emergency" : ""
      ]
        .filter(Boolean)
        .join(" | ")
    ]);
  });

  detail.enrollments.forEach((enrollment) => {
    rows.push([
      `School year ${enrollment.schoolYearName}`,
      [
        enrollment.gradeLevel,
        enrollment.sectionName,
        enrollment.adviserName,
        enrollment.status,
        enrollment.enrollmentDate
      ]
        .filter(Boolean)
        .join(" | ")
    ]);
  });

  return {
    filename: `learner-profile-${safeName(learner.lrn)}.csv`,
    csv: toCsv(["Field", "Value"], rows)
  };
}

async function sectionList(actor, options) {
  if (!options.sectionId) {
    throw new HttpError(400, "Choose a section for this report.", "SECTION_REQUIRED");
  }
  const { year, rows } = await learnerRows(actor, options);
  return {
    filename: `section-list-${safeName(year.name)}-${options.sectionId}.csv`,
    csv: toCsv(
      ["#", "LRN", "Learner Name", "Sex", "Birth Date", "Age", "Primary Guardian", "Guardian Contact", "Address"],
      rows.map((row, index) => [
        index + 1,
        row.lrn,
        personName(row),
        row.sex,
        row.birth_date,
        calculateAge(row.birth_date),
        row.primary_guardian || "",
        row.primary_guardian_contact || "",
        learnerAddress(row)
      ])
    )
  };
}

async function guardianDirectory(actor, options) {
  const params = [];
  const scope = learnerScopeSql(actor, "l", params);
  const conditions = ["l.archived_at IS NULL"];
  if (scope) {
    conditions.push(scope);
  }
  if (options.learnerId) {
    params.push(options.learnerId);
    conditions.push(`l.id = $${params.length}`);
  }
  if (options.schoolId) {
    params.push(options.schoolId);
    conditions.push(`l.school_id = $${params.length}`);
  }
  if (options.sectionId) {
    params.push(options.sectionId);
    conditions.push(
      `EXISTS (SELECT 1 FROM enrollments e2
               WHERE e2.learner_id = l.id AND e2.section_id = $${params.length})`
    );
  }

  const result = await query(
    `SELECT g.*, l.lrn, l.first_name, l.middle_name, l.last_name, l.extension_name,
            s.school_name
     FROM guardians g
     JOIN learners l ON l.id = g.learner_id
     JOIN schools s ON s.id = l.school_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY l.last_name ASC, l.first_name ASC, g.is_primary DESC, g.full_name ASC`,
    params
  );

  return {
    filename: "parent-guardian-directory.csv",
    csv: toCsv(
      [
        "Learner",
        "LRN",
        "School",
        "Guardian",
        "Relationship",
        "Contact Number",
        "Email",
        "Address",
        "Occupation",
        "Primary",
        "Emergency Contact"
      ],
      result.rows.map((row) => [
        personName(row),
        row.lrn,
        row.school_name,
        row.full_name,
        row.relationship,
        row.contact_number || "",
        row.email || "",
        row.address || "",
        row.occupation || "",
        row.is_primary ? "Yes" : "No",
        row.is_emergency ? "Yes" : "No"
      ])
    )
  };
}

async function enrollmentList(actor, options) {
  const { year } = await learnerRows(actor, { ...options, schoolYearId: options.schoolYearId });
  const params = [Number(year.id)];
  const conditions = [];
  const scope = learnerScopeSql(actor, "l", params);
  if (scope) {
    conditions.push(scope);
  }
  if (options.schoolId) {
    params.push(options.schoolId);
    conditions.push(`e.school_id = $${params.length}`);
  }
  if (options.gradeLevelId) {
    params.push(options.gradeLevelId);
    conditions.push(`e.grade_level_id = $${params.length}`);
  }
  if (options.sectionId) {
    params.push(options.sectionId);
    conditions.push(`e.section_id = $${params.length}`);
  }

  const result = await query(
    `SELECT e.*, l.lrn, l.first_name, l.middle_name, l.last_name, l.extension_name,
            s.school_name, gl.name AS grade_level_name, sec.name AS section_name,
            COALESCE(e.adviser_id, sec.adviser_id) AS adviser_id,
            adv.full_name AS adviser_name, y.name AS school_year_name
     FROM enrollments e
     JOIN learners l ON l.id = e.learner_id
     JOIN schools s ON s.id = e.school_id
     JOIN school_years y ON y.id = e.school_year_id
     JOIN grade_levels gl ON gl.id = e.grade_level_id
     LEFT JOIN sections sec ON sec.id = e.section_id
     LEFT JOIN users adv ON adv.id = COALESCE(e.adviser_id, sec.adviser_id)
     WHERE e.school_year_id = $1 ${conditions.length ? `AND ${conditions.join(" AND ")}` : ""}
     ORDER BY l.last_name ASC, l.first_name ASC`,
    params
  );

  return {
    filename: `enrollment-list-${safeName(year.name)}.csv`,
    csv: toCsv(
      [
        "School Year",
        "School",
        "LRN",
        "Learner Name",
        "Grade Level",
        "Section",
        "Adviser",
        "Status",
        "Enrollment Date",
        "Remarks"
      ],
      result.rows.map((row) => [
        row.school_year_name,
        row.school_name,
        row.lrn,
        personName(row),
        row.grade_level_name,
        row.section_name || "",
        row.adviser_name || "",
        row.status,
        row.enrollment_date,
        row.remarks || ""
      ])
    )
  };
}

async function adviserList(actor, options) {
  const year = await resolveYear(options.schoolYearId);
  if (!year) {
    throw new HttpError(400, "Create a school year first.", "SCHOOL_YEAR_REQUIRED");
  }
  const params = [Number(year.id)];
  const conditions = [];
  if (actor.role !== "system_admin") {
    if (actor.schoolId) {
      params.push(actor.schoolId);
      conditions.push(`sec.school_id = $${params.length}`);
    } else if (actor.districtId) {
      params.push(actor.districtId);
      conditions.push(`s.district_id = $${params.length}`);
    } else {
      conditions.push("FALSE");
    }
  }
  if (options.schoolId && actor.role === "system_admin") {
    params.push(options.schoolId);
    conditions.push(`sec.school_id = $${params.length}`);
  }

  const result = await query(
    `SELECT s.school_name, y.name AS school_year_name, gl.name AS grade_level_name,
            sec.name AS section_name, sec.room, adv.full_name AS adviser_name,
            adv.email AS adviser_email,
            COUNT(DISTINCT e.learner_id) FILTER (WHERE l.archived_at IS NULL)::int AS learner_count
     FROM sections sec
     JOIN schools s ON s.id = sec.school_id
     JOIN school_years y ON y.id = sec.school_year_id
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     LEFT JOIN users adv ON adv.id = sec.adviser_id
     LEFT JOIN enrollments e ON e.section_id = sec.id AND e.school_year_id = sec.school_year_id
     LEFT JOIN learners l ON l.id = e.learner_id
     WHERE sec.school_year_id = $1 ${conditions.length ? `AND ${conditions.join(" AND ")}` : ""}
     GROUP BY s.school_name, y.name, gl.name, gl.sort_order, sec.name, sec.room,
              adv.full_name, adv.email
     ORDER BY s.school_name ASC, gl.sort_order ASC, sec.name ASC`,
    params
  );

  return {
    filename: `section-adviser-list-${safeName(year.name)}.csv`,
    csv: toCsv(
      ["School", "School Year", "Grade Level", "Section", "Room", "Adviser", "Adviser Email", "Learners"],
      result.rows.map((row) => [
        row.school_name,
        row.school_year_name,
        row.grade_level_name,
        row.section_name,
        row.room || "",
        row.adviser_name || "Unassigned",
        row.adviser_email || "",
        row.learner_count
      ])
    )
  };
}

async function assignmentList(actor, options) {
  const assignments = await academicService.listAssignments(actor, {
    schoolId: options.schoolId,
    schoolYearId: options.schoolYearId
  });
  return {
    filename: "subject-teacher-assignments.csv",
    csv: toCsv(
      [
        "School Year",
        "Grade Level",
        "Section",
        "Subject Code",
        "Subject",
        "Teacher",
        "Employee Number",
        "Scheduled Classes",
        "Remarks"
      ],
      assignments.map((row) => [
        row.schoolYearName,
        row.gradeLevel,
        row.sectionName,
        row.subjectCode,
        row.subjectName,
        row.teacherName || "Unassigned",
        row.employeeNumber || "",
        row.scheduleCount || 0,
        row.remarks || ""
      ])
    )
  };
}

async function weeklySchedule(actor, options) {
  if (!options.sectionId) {
    throw new HttpError(400, "Choose a section for the weekly schedule.", "SECTION_REQUIRED");
  }
  const timetable = await academicService.getTimetable(actor, options.sectionId);
  const rows = [];
  timetable.days.forEach((day) => {
    day.entries.forEach((entry) => {
      rows.push([
        day.dayName,
        entry.startTime,
        entry.endTime,
        entry.subjectCode,
        entry.subjectName,
        entry.teacherName || "",
        entry.room || "",
        entry.remarks || ""
      ]);
    });
  });

  return {
    filename: `weekly-schedule-${safeName(timetable.section.name)}.csv`,
    csv: toCsv(
      ["Day", "Start Time", "End Time", "Subject Code", "Subject", "Teacher", "Room", "Remarks"],
      rows
    )
  };
}

async function activityReport(actor, options) {
  const activities = await activityService.listActivities(actor, {
    schoolId: options.schoolId,
    schoolYearId: options.schoolYearId,
    learnerId: options.learnerId
  });
  const activityIds = activities.map((activity) => activity.id);
  let participants = [];
  if (activityIds.length) {
    const params = [activityIds];
    const scope = learnerScopeSql(actor, "l", params);
    const result = await query(
      `SELECT la.activity_id, la.role, la.achievement, la.remarks,
              l.lrn, l.first_name, l.middle_name, l.last_name, l.extension_name,
              gl.name AS grade_level_name, sec.name AS section_name
       FROM learner_activities la
       JOIN learners l ON l.id = la.learner_id
       LEFT JOIN activities a ON a.id = la.activity_id
       LEFT JOIN enrollments e ON e.learner_id = l.id AND e.school_year_id = a.school_year_id
       LEFT JOIN grade_levels gl ON gl.id = e.grade_level_id
       LEFT JOIN sections sec ON sec.id = e.section_id
       WHERE la.activity_id = ANY($1::bigint[]) ${scope ? `AND ${scope}` : ""}
       ORDER BY l.last_name ASC, l.first_name ASC`,
      params
    );
    participants = result.rows;
  }

  const byActivity = new Map();
  participants.forEach((row) => {
    const key = Number(row.activity_id);
    if (!byActivity.has(key)) {
      byActivity.set(key, []);
    }
    byActivity.get(key).push(row);
  });

  const rows = [];
  activities.forEach((activity) => {
    const people = byActivity.get(activity.id) || [];
    if (!people.length) {
      rows.push([
        activity.name,
        activity.category,
        CATEGORY_LABELS[activity.participationLevel] || activity.participationLevel,
        activity.organization || "",
        activity.schoolYearName,
        activity.adviserName || "",
        activity.startDate || "",
        activity.endDate || "",
        activity.achievement || "",
        "",
        "",
        "",
        "",
        ""
      ]);
      return;
    }
    people.forEach((person) => {
      rows.push([
        activity.name,
        activity.category,
        CATEGORY_LABELS[activity.participationLevel] || activity.participationLevel,
        activity.organization || "",
        activity.schoolYearName,
        activity.adviserName || "",
        activity.startDate || "",
        activity.endDate || "",
        person.achievement || activity.achievement || "",
        personName(person),
        person.lrn,
        person.grade_level_name || "",
        person.section_name || "",
        person.role || ""
      ]);
    });
  });

  return {
    filename: "activity-report.csv",
    csv: toCsv(
      [
        "Activity",
        "Category",
        "Participation Level",
        "Club / Organization",
        "School Year",
        "Adviser / Coach",
        "Start Date",
        "End Date",
        "Achievement",
        "Learner",
        "LRN",
        "Grade Level",
        "Section",
        "Role"
      ],
      rows
    )
  };
}

async function enrollmentHistory(actor, options) {
  const params = [];
  const conditions = [];
  const scope = learnerScopeSql(actor, "l", params);
  if (scope) {
    conditions.push(scope);
  }
  if (options.learnerId) {
    params.push(options.learnerId);
    conditions.push(`l.id = $${params.length}`);
  }
  if (options.schoolYearId) {
    params.push(options.schoolYearId);
    conditions.push(`e.school_year_id = $${params.length}`);
  }
  if (options.schoolId) {
    params.push(options.schoolId);
    conditions.push(`l.school_id = $${params.length}`);
  }
  if (options.sectionId) {
    params.push(options.sectionId);
    conditions.push(`e.section_id = $${params.length}`);
  }

  const result = await query(
    `SELECT l.lrn, l.first_name, l.middle_name, l.last_name, l.extension_name,
            y.name AS school_year_name, gl.name AS grade_level_name,
            sec.name AS section_name, COALESCE(e.adviser_id, sec.adviser_id) AS adviser_id,
            adv.full_name AS adviser_name, e.status, e.enrollment_date, e.remarks
     FROM enrollments e
     JOIN learners l ON l.id = e.learner_id
     JOIN school_years y ON y.id = e.school_year_id
     JOIN grade_levels gl ON gl.id = e.grade_level_id
     LEFT JOIN sections sec ON sec.id = e.section_id
     LEFT JOIN users adv ON adv.id = COALESCE(e.adviser_id, sec.adviser_id)
     WHERE ${conditions.length ? conditions.join(" AND ") : "TRUE"}
     ORDER BY l.last_name ASC, l.first_name ASC, y.name DESC`,
    params
  );

  return {
    filename: "learner-enrollment-history.csv",
    csv: toCsv(
      [
        "LRN",
        "Learner Name",
        "School Year",
        "Grade Level",
        "Section",
        "Adviser",
        "Status",
        "Enrollment Date",
        "Remarks"
      ],
      result.rows.map((row) => [
        row.lrn,
        personName(row),
        row.school_year_name,
        row.grade_level_name,
        row.section_name || "",
        row.adviser_name || "",
        row.status,
        row.enrollment_date,
        row.remarks || ""
      ])
    )
  };
}

async function incompleteProfiles(actor, options) {
  const { year, rows } = await learnerRows(actor, options);
  const incomplete = rows.filter((row) => missingFields(row).length > 0);
  return {
    filename: `incomplete-profiles-${safeName(year.name)}.csv`,
    csv: toCsv(
      [
        "LRN",
        "Learner Name",
        "Grade Level",
        "Section",
        "Missing Information",
        "Contact Number",
        "Guardians on File",
        "School"
      ],
      incomplete.map((row) => [
        row.lrn,
        personName(row),
        row.grade_level_name || "Not enrolled",
        row.section_name || "",
        missingFields(row).join("; "),
        row.contact_number || row.email || "",
        row.has_guardian ? "Recorded" : "None",
        row.school_name
      ])
    )
  };
}

const BUILDERS = {
  "master-list": masterList,
  "profile-sheet": profileSheet,
  "section-list": sectionList,
  "guardian-directory": guardianDirectory,
  "enrollment-list": enrollmentList,
  "adviser-list": adviserList,
  "assignment-list": assignmentList,
  "weekly-schedule": weeklySchedule,
  "activity-report": activityReport,
  "enrollment-history": enrollmentHistory,
  "incomplete-profiles": incompleteProfiles
};

function parseType(rawType) {
  const type = String(rawType || "").replace(/\.csv$/i, "");
  if (!REPORT_DEFINITIONS[type]) {
    throw new HttpError(404, "That learner report does not exist.", "REPORT_TYPE_UNKNOWN");
  }
  return type;
}

async function buildReport(actor, rawType, options = {}) {
  const type = parseType(rawType);
  const builder = BUILDERS[type];
  const result = await builder(actor, options);
  return {
    type,
    label: REPORT_DEFINITIONS[type].label,
    filename: result.filename,
    csv: result.csv
  };
}

module.exports = {
  REPORT_DEFINITIONS,
  buildReport,
  parseType,
  toCsv
};
