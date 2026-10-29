"use strict";

const { query } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const {
  requireIdParam,
  requirePeriod,
  requireEnum,
  optionalString,
  requireInteger,
  fail
} = require("../utils/validators");
const {
  assertCan,
  canDo,
  resolveSchool,
  sectionForActor,
  resolveSchoolYear,
  assertLearnerVisible,
  learnerEnrollment
} = require("../utils/formsAccess");
const { calculateAge } = require("../utils/age");
const attendanceService = require("./attendanceService");
const personnelService = require("./personnelService");
const healthService = require("./healthService");
const gradeService = require("./gradeService");

const FORM_DEFINITIONS = [
  {
    code: "sf1",
    title: "School Register",
    purpose: "Official register of learners enrolled for the school year",
    description:
      "Generated from permanent learner profiles and school-year enrollment records. Supports section and school-wide registers.",
    orientation: "landscape",
    paperSize: "Legal",
    requiresSection: false,
    month: false,
    learner: false,
    module: "learners"
  },
  {
    code: "sf2",
    title: "Daily Attendance Report of Learners",
    purpose: "Monthly daily attendance record for a class",
    description:
      "Built only from saved daily attendance entries. Missing and partial attendance days are flagged before submission.",
    orientation: "landscape",
    paperSize: "Legal",
    requiresSection: true,
    month: true,
    learner: false,
    module: "attendance"
  },
  {
    code: "sf3",
    title: "Books Issued and Returned",
    purpose: "Textbook and instructional material issuance and returns",
    description:
      "Built from the book catalog and append-only issuance and return transactions. Past transactions are never rewritten.",
    orientation: "landscape",
    paperSize: "Legal",
    requiresSection: false,
    month: false,
    learner: false,
    module: "books"
  },
  {
    code: "sf4",
    title: "Monthly Learner Movement and Attendance",
    purpose: "Monthly transfers, dropouts, and attendance summary",
    description:
      "Reconciles enrollment, approved movement records, and saved attendance. An absence is never counted as a dropout.",
    orientation: "portrait",
    paperSize: "Legal",
    requiresSection: false,
    month: true,
    learner: false,
    module: "movements"
  },
  {
    code: "sf5",
    title: "Report on Promotion and Level of Progress",
    purpose: "Class promotion and progress report",
    description:
      "Uses finalized subject grades and authorized promotion decisions. Missing grades are flagged; decisions are never silently finalized.",
    orientation: "landscape",
    paperSize: "Legal",
    requiresSection: true,
    month: false,
    learner: false,
    module: "grades"
  },
  {
    code: "sf6",
    title: "Summarized Report on Promotion and Level of Progress",
    purpose: "School-wide promotion summary",
    description:
      "Aggregates only approved or finalized promotion decisions and identifies classes whose SF 5 is incomplete.",
    orientation: "portrait",
    paperSize: "Legal",
    requiresSection: false,
    month: false,
    learner: false,
    module: "grades"
  },
  {
    code: "sf7",
    title: "Personnel Assignment List and Basic Profile",
    purpose: "Teaching and non-teaching personnel assignments",
    description:
      "Combines personnel profiles, existing accounts, teaching assignments, and class schedules. Contact details are restricted.",
    orientation: "landscape",
    paperSize: "Legal",
    requiresSection: false,
    month: false,
    learner: false,
    module: "personnel"
  },
  {
    code: "sf8",
    title: "Learner Health and Nutrition Profile",
    purpose: "Restricted height, weight, BMI, and nutritional assessment",
    description:
      "Visible only to authorized health personnel. BMI is computed from valid measurements; nutritional status is an authorized assessment.",
    orientation: "portrait",
    paperSize: "Legal",
    requiresSection: false,
    month: false,
    learner: false,
    module: "health",
    restricted: true
  },
  {
    code: "sf9",
    title: "Learner Progress Report Card",
    purpose: "Quarterly grades, final grades, and promotion status",
    description:
      "Uses finalized grade records. Missing or unfinalized grades block issuance. One card is produced per learner and school year.",
    orientation: "portrait",
    paperSize: "A4",
    requiresSection: false,
    month: false,
    learner: false,
    module: "grades"
  },
  {
    code: "sf10",
    title: "Learner Permanent Academic Record",
    purpose: "Cumulative academic history across school years and schools",
    description:
      "Combines verified historical records with proposals from finalized system grades. Unverified information is clearly marked.",
    orientation: "portrait",
    paperSize: "Legal",
    requiresSection: false,
    month: false,
    learner: true,
    module: "permanent_records"
  }
];

const FORM_MAP = FORM_DEFINITIONS.reduce((accumulator, definition) => {
  accumulator[definition.code] = definition;
  return accumulator;
}, {});

const ENROLLMENT_STATUS_LABEL = {
  enrolled: "Enrolled",
  transferred_in: "Transferred in",
  transferred_out: "Transferred out",
  promoted: "Promoted",
  retained: "Retained",
  completed: "Completed",
  archived: "Archived"
};

function definitionFor(code) {
  const definition = FORM_MAP[String(code || "").toLowerCase()];
  if (!definition) {
    throw new HttpError(404, "School form not found.", "FORM_NOT_FOUND");
  }
  return definition;
}

function fullName(row) {
  return [row.first_name, row.middle_name, row.last_name, row.extension_name]
    .filter(Boolean)
    .join(" ");
}

function sexLabel(value) {
  return value === "male" ? "M" : value === "female" ? "F" : value || "";
}

function addressOf(row) {
  const parts = [row.house_number, row.barangay, row.municipality, row.province, row.region, row.zip_code]
    .filter(Boolean);
  return parts.length ? parts.join(", ") : "";
}

function isoDate(value) {
  if (!value) return "";
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function pct(part, total) {
  if (!total) return null;
  return Math.round((part / total) * 1000) / 10;
}

function finalizeData(data, errors, warnings, checked) {
  const completeness =
    checked > 0
      ? Math.max(0, Math.round(((checked - Math.min(errors.length, checked)) / checked) * 100))
      : errors.length
        ? 0
        : 100;
  data.validation = {
    errors,
    warnings,
    checked,
    completeness,
    complete: errors.length === 0,
    generatedAt: data.generatedAt
  };
  data.completeness = completeness;
  return data;
}

function issue(message, source) {
  return { message, source: source || null };
}

async function templateFor(code, runner = { query }) {
  const result = await runner.query(
    `SELECT * FROM form_templates WHERE form_code = $1 AND is_active = TRUE
     ORDER BY created_at DESC LIMIT 1`,
    [code]
  );
  const row = result.rows[0];
  if (!row) {
    const def = definitionFor(code);
    return {
      id: null,
      name: `System ${def.title}`,
      version: "system-1",
      orientation: def.orientation,
      paperSize: def.paperSize,
      isOfficial: false,
      sourceNote:
        "No template row is configured. This system layout is not a verified official DepEd template.",
      config: {}
    };
  }
  return {
    id: Number(row.id),
    name: row.name,
    version: row.version,
    orientation: row.orientation,
    paperSize: row.paper_size,
    isOfficial: row.is_official,
    sourceNote: row.source_note,
    config: row.config || {}
  };
}

async function resolveContext(actor, code, params = {}) {
  const definition = definitionFor(code);
  if (definition.restricted) {
    assertCan(actor, "health", "access", "You do not have access to health and nutrition records.");
  }
  if (definition.module) {
    assertCan(
      actor,
      definition.module,
      "access",
      `You do not have access to the source records required for ${definition.code.toUpperCase()}.`
    );
  }
  const year = await resolveSchoolYear(params.schoolYearId);
  let school = params.schoolId
    ? await resolveSchool(actor, params.schoolId)
    : await resolveSchool(actor, null);
  let learner = null;
  if (definition.learner) {
    learner = await assertLearnerVisible(actor, requireIdParam(params.learnerId, "Learner"));
    school = await resolveSchool(actor, learner.school_id);
  }
  let gradeLevel = null;
  if (params.gradeLevelId) {
    const result = await query(
      "SELECT * FROM grade_levels WHERE id = $1 AND school_id = $2",
      [params.gradeLevelId, school.id]
    );
    if (!result.rows[0]) {
      throw new HttpError(409, "That grade level belongs to another school.", "GRADE_SCHOOL_MISMATCH");
    }
    gradeLevel = result.rows[0];
  }
  let section = null;
  if (params.sectionId) {
    section = await sectionForActor(actor, params.sectionId);
    if (Number(section.school_id) !== Number(school.id)) {
      throw new HttpError(409, "That section belongs to another school.", "SECTION_SCHOOL_MISMATCH");
    }
    if (Number(section.school_year_id) !== Number(year.id)) {
      throw new HttpError(409, "That section belongs to a different school year.", "SECTION_YEAR_MISMATCH");
    }
    if (gradeLevel && Number(section.grade_level_id) !== Number(gradeLevel.id)) {
      throw new HttpError(409, "That section belongs to another grade level.", "SECTION_GRADE_MISMATCH");
    }
    gradeLevel = gradeLevel || {
      id: section.grade_level_id,
      name: section.grade_level_name,
      sort_order: section.sort_order
    };
  }
  if (!section && learner) {
    const enrollment = await learnerEnrollment(learner.id, year.id);
    if (enrollment && enrollment.section_id) {
      section = await sectionForActor(actor, enrollment.section_id);
      gradeLevel = gradeLevel || { id: enrollment.grade_level_id, name: enrollment.grade_level_name };
    }
  }
  if (definition.requiresSection && !section) {
    throw new HttpError(400, "Select a section for this form.", "SECTION_REQUIRED");
  }
  let month = null;
  if (definition.month) {
    month = requirePeriod(params.month || params.period, "Reporting month");
  }
  if (params.learnerId && !definition.learner) {
    learner = await assertLearnerVisible(actor, params.learnerId);
  }
  const district = await query("SELECT * FROM districts WHERE id = $1", [school.district_id]);
  return {
    actor,
    definition,
    year,
    school,
    district: district.rows[0] || {},
    gradeLevel,
    section,
    month,
    learner,
    template: await templateFor(definition.code)
  };
}

function baseScope(ctx) {
  return {
    school: {
      id: Number(ctx.school.id),
      name: ctx.school.school_name,
      code: ctx.school.school_code,
      address: ctx.school.address,
      type: ctx.school.school_type,
      head: ctx.school.school_head
    },
    district: {
      id: Number(ctx.school.district_id),
      name: ctx.district.district_name || ctx.school.district_name,
      code: ctx.district.district_code
    },
    schoolYear: { id: Number(ctx.year.id), name: ctx.year.name },
    gradeLevel: ctx.gradeLevel
      ? { id: Number(ctx.gradeLevel.id), name: ctx.gradeLevel.name }
      : null,
    section: ctx.section
      ? { id: Number(ctx.section.id), name: ctx.section.name, adviser: ctx.section.adviser_name }
      : null,
    period: ctx.month || null,
    learner: ctx.learner
      ? { id: Number(ctx.learner.id), name: fullName(ctx.learner), lrn: ctx.learner.lrn }
      : null
  };
}

function baseData(ctx) {
  return {
    code: ctx.definition.code,
    title: ctx.definition.title,
    purpose: ctx.definition.purpose,
    description: ctx.definition.description,
    isOfficial: Boolean(ctx.template.isOfficial),
    template: {
      id: ctx.template.id,
      name: ctx.template.name,
      version: ctx.template.version,
      orientation: ctx.template.orientation,
      paperSize: ctx.template.paperSize
    },
    sourceNote: ctx.template.sourceNote,
    generatedAt: new Date().toISOString(),
    scope: baseScope(ctx),
    summary: [],
    tables: [],
    signatures: [],
    notes: []
  };
}

function enrollmentScopeSql(ctx, alias, params) {
  let sql = `${alias}.school_id = $${params.push(ctx.school.id)} AND ${alias}.school_year_id = $${params.push(ctx.year.id)}`;
  if (ctx.gradeLevel) {
    sql += ` AND ${alias}.grade_level_id = $${params.push(ctx.gradeLevel.id)}`;
  }
  if (ctx.section) {
    sql += ` AND ${alias}.section_id = $${params.push(ctx.section.id)}`;
  }
  return sql;
}

async function enrollmentRows(ctx) {
  const params = [];
  const where = enrollmentScopeSql(ctx, "e", params);
  const result = await query(
    `SELECT e.id, e.learner_id, e.enrollment_date, e.status, e.remarks, e.grade_level_id, e.section_id,
            l.lrn, l.last_name, l.first_name, l.middle_name, l.extension_name, l.sex,
            l.birth_date, l.house_number, l.barangay, l.municipality, l.province, l.region,
            l.zip_code, l.contact_number, l.email,
            gl.name AS grade_level_name, sec.name AS section_name,
            y.name AS school_year_name, s.school_name, s.school_code,
            (SELECT g.full_name FROM guardians g WHERE g.learner_id = l.id AND g.is_primary LIMIT 1)
              AS guardian_name,
            (SELECT g.contact_number FROM guardians g WHERE g.learner_id = l.id AND g.is_primary LIMIT 1)
              AS guardian_contact,
            (SELECT g.relationship FROM guardians g WHERE g.learner_id = l.id AND g.is_primary LIMIT 1)
              AS guardian_relationship
     FROM enrollments e
     JOIN learners l ON l.id = e.learner_id
     JOIN grade_levels gl ON gl.id = e.grade_level_id
     LEFT JOIN sections sec ON sec.id = e.section_id
     JOIN school_years y ON y.id = e.school_year_id
     JOIN schools s ON s.id = e.school_id
     WHERE ${where} AND l.archived_at IS NULL
     ORDER BY gl.sort_order ASC, sec.name ASC, l.last_name ASC, l.first_name ASC`,
    params
  );
  return result.rows;
}

/* -------------------------------------------------------------------------- */
/* SF 1 — School Register                                                     */
/* -------------------------------------------------------------------------- */

async function buildSf1(ctx) {
  const data = baseData(ctx);
  const rows = await enrollmentRows(ctx);
  const errors = [];
  const warnings = [];
  let checked = rows.length * 7;
  const duplicateMap = new Map();
  rows.forEach((row) => {
    const key = `${row.last_name}|${row.first_name}|${isoDate(row.birth_date)}`;
    duplicateMap.set(key, (duplicateMap.get(key) || 0) + 1);
    if (!row.guardian_name) {
      warnings.push(issue(`No parent or guardian is recorded for ${fullName(row)} (${row.lrn}).`, {
        type: "learner",
        id: Number(row.learner_id),
        label: row.lrn
      }));
    }
    if (!addressOf(row)) {
      warnings.push(issue(`The address of ${fullName(row)} is incomplete in the permanent profile.`, {
        type: "learner",
        id: Number(row.learner_id),
        label: row.lrn
      }));
    }
    if (!row.section_id) {
      errors.push(issue(`${fullName(row)} has no section for ${ctx.year.name}.`, {
        type: "enrollment",
        id: Number(row.id),
        label: row.lrn
      }));
    }
    if (!row.enrollment_date) {
      errors.push(issue(`${fullName(row)} has no admission date.`, {
        type: "enrollment",
        id: Number(row.id),
        label: row.lrn
      }));
    }
  });
  duplicateMap.forEach((count, key) => {
    if (count > 1) {
      const [last, first, birth] = key.split("|");
      warnings.push(issue(
        `Possible duplicate learner: ${first} ${last} with birth date ${birth} appears ${count} times. Check LRNs and profiles.`
      ));
    }
  });
  if (!rows.length) {
    errors.push(issue("No enrollments match the selected school, school year, grade, and section."));
  }
  data.tables.push({
    key: "register",
    title: "Official School Register",
    columns: [
      { key: "lrn", label: "LRN", width: 7 },
      { key: "name", label: "Learner Name", width: 16 },
      { key: "sex", label: "Sex", width: 3, align: "center" },
      { key: "birthDate", label: "Date of Birth", width: 7 },
      { key: "age", label: "Age", width: 3, align: "center" },
      { key: "address", label: "Complete Address", width: 17 },
      { key: "guardian", label: "Parent / Guardian", width: 12 },
      { key: "guardianContact", label: "Contact", width: 8 },
      { key: "admission", label: "Admission", width: 7 },
      { key: "grade", label: "Grade", width: 5 },
      { key: "section", label: "Section", width: 6 },
      { key: "status", label: "Status", width: 6 },
      { key: "remarks", label: "Remarks", width: 8 }
    ],
    rows: rows.map((row) => ({
      lrn: row.lrn,
      name: fullName(row),
      sex: sexLabel(row.sex),
      birthDate: isoDate(row.birth_date),
      age: calculateAge(row.birth_date, ctx.year.starts_on),
      address: addressOf(row),
      guardian: row.guardian_name || "",
      guardianContact: row.guardian_contact || row.contact_number || "",
      admission: isoDate(row.enrollment_date),
      grade: row.grade_level_name,
      section: row.section_name || "",
      status: ENROLLMENT_STATUS_LABEL[row.status] || row.status,
      remarks: row.remarks || ""
    })),
    emptyText: "No learners are enrolled for this scope."
  });
  data.summary = [
    { label: "Learners", value: rows.length },
    { label: "Male", value: rows.filter((row) => row.sex === "male").length },
    { label: "Female", value: rows.filter((row) => row.sex === "female").length },
    { label: "Sections", value: new Set(rows.map((row) => row.section_id).filter(Boolean)).size },
    { label: "With guardian", value: rows.filter((row) => row.guardian_name).length }
  ];
  data.signatures = [
    { name: "", label: "Prepared by — Registrar / Records Officer" },
    { name: ctx.school.school_head || "", label: "Certified correct — School Head" },
    { name: "", label: "District Supervisor / PSDS" }
  ];
  data.notes.push(
    `Age is calculated as of the school year start (${isoDate(ctx.year.starts_on)}) from the permanent birth date.`,
    "Possible duplicate names are flagged for review; LRN uniqueness is enforced by the database."
  );
  return finalizeData(data, errors, warnings, checked);
}

/* -------------------------------------------------------------------------- */
/* SF 2 — Daily Attendance                                                    */
/* -------------------------------------------------------------------------- */

async function buildSf2(ctx) {
  const data = baseData(ctx);
  const bounds = attendanceService.monthBounds(ctx.month);
  const roster = await attendanceService.roster(ctx.section, ctx.year.id);
  const records = await query(
    `SELECT enrollment_id, attendance_date, status FROM attendance_records
     WHERE section_id = $1 AND school_year_id = $2 AND attendance_date BETWEEN $3 AND $4`,
    [ctx.section.id, ctx.year.id, bounds.start, bounds.end]
  );
  const calendar = await query(
    `SELECT calendar_date, day_type, label FROM school_calendar_days
     WHERE school_id = $1 AND school_year_id = $2 AND calendar_date BETWEEN $3 AND $4`,
    [ctx.school.id, ctx.year.id, bounds.start, bounds.end]
  );
  const calendarMap = new Map(
    calendar.rows.map((row) => [isoDate(row.calendar_date), row])
  );
  const recordMap = new Map(
    records.rows.map((row) => [`${row.enrollment_id}:${isoDate(row.attendance_date)}`, row.status])
  );
  const days = [];
  for (let day = 1; day <= bounds.daysInMonth; day += 1) {
    const date = `${bounds.period}-${String(day).padStart(2, "0")}`;
    const entry = calendarMap.get(date);
    days.push({
      date,
      day,
      dayType: entry
        ? entry.day_type
        : attendanceService.defaultSchoolDay(date)
          ? "school_day"
          : "no_class",
      label: entry ? entry.label : null
    });
  }
  const schoolDays = days.filter((day) => day.dayType === "school_day");
  const code = { present: "P", absent: "A", tardy: "T", excused: "E", half_day: "H" };
  const rows = roster.map((learner) => {
    const row = {
      lrn: learner.lrn,
      name: fullName(learner),
      sex: sexLabel(learner.sex),
      present: 0,
      absent: 0,
      tardy: 0,
      remarks: ""
    };
    days.forEach((day) => {
      const status = recordMap.get(`${learner.enrollment_id}:${day.date}`);
      row[`d${day.day}`] = day.dayType === "school_day" ? (status ? code[status] : "") : "";
      if (status) {
        row[status] += 1;
      }
    });
    return row;
  });
  const errors = [];
  const warnings = [];
  let expected = roster.length * schoolDays.length;
  let recorded = 0;
  roster.forEach((learner) => {
    schoolDays.forEach((day) => {
      if (recordMap.has(`${learner.enrollment_id}:${day.date}`)) {
        recorded += 1;
      }
    });
  });
  const missingDates = schoolDays
    .filter((day) => !records.rows.some((record) => isoDate(record.attendance_date) === day.date))
    .map((day) => day.date);
  const partialDates = schoolDays
    .filter((day) => {
      const count = records.rows.filter((record) => isoDate(record.attendance_date) === day.date).length;
      return count > 0 && count < roster.length;
    })
    .map((day) => day.date);
  missingDates.forEach((date) => {
    errors.push(issue(`No attendance was saved for ${date}. Enter the daily attendance before generating SF 2.`, {
      type: "attendance",
      date
    }));
  });
  partialDates.forEach((date) => {
    errors.push(issue(`Attendance for ${date} is incomplete: some learners have no entry.`, {
      type: "attendance",
      date
    }));
  });
  if (!roster.length) {
    errors.push(issue("The selected section has no active learners for this school year."));
  }
  if (!schoolDays.length) {
    errors.push(issue("No school days are configured or derived for this month."));
  }
  const present = rows.reduce((sum, row) => sum + row.present, 0);
  const absent = rows.reduce((sum, row) => sum + row.absent, 0);
  const tardy = rows.reduce((sum, row) => sum + row.tardy, 0);
  const columns = [
    { key: "lrn", label: "LRN", width: 6 },
    { key: "name", label: "Learner Name", width: 15 },
    { key: "sex", label: "Sex", width: 3, align: "center" }
  ].concat(
    days.map((day) => ({
      key: `d${day.day}`,
      label: String(day.day),
      width: 1.35,
      align: "center"
    }))
  ).concat([
    { key: "present", label: "P", width: 2.4, align: "center" },
    { key: "absent", label: "A", width: 2.4, align: "center" },
    { key: "tardy", label: "T", width: 2.4, align: "center" }
  ]);
  data.tables.push({
    key: "attendance",
    title: `${ctx.month} Daily Attendance`,
    note:
      "P = present, A = absent, T = tardy, E = excused, H = half day. Blank shaded days are non-school days. Totals are derived only from saved attendance entries.",
    columns,
    rows,
    emptyText: "No attendance entries for this section and month."
  });
  data.summary = [
    { label: "Learners", value: roster.length },
    { label: "School days", value: schoolDays.length },
    { label: "Entries saved", value: recorded },
    { label: "Present", value: present },
    { label: "Absent", value: absent },
    { label: "Tardy", value: tardy },
    { label: "Attendance rate", value: `${pct(present + tardy, recorded) || 0}%` }
  ];
  data.signatures = [
    { name: ctx.section.adviser_name || "", label: "Class Adviser" },
    { name: ctx.school.school_head || "", label: "School Head" }
  ];
  data.notes.push(
    "School days come from the configured school calendar; days without a calendar entry default to Monday–Friday.",
    "No learner is marked present automatically. A blank cell means no attendance was saved."
  );
  return finalizeData(data, errors, warnings, expected);
}

/* -------------------------------------------------------------------------- */
/* SF 3 — Books                                                               */
/* -------------------------------------------------------------------------- */

async function buildSf3(ctx) {
  const data = baseData(ctx);
  const params = [ctx.school.id, ctx.year.id];
  let filters = "";
  if (ctx.gradeLevel) {
    params.push(ctx.gradeLevel.id);
    filters += ` AND bi.grade_level_id = $${params.length}`;
  }
  if (ctx.section) {
    params.push(ctx.section.id);
    filters += ` AND bi.section_id = $${params.length}`;
  }
  const catalog = await query(
    `SELECT bc.*, sub.name AS subject_name, gl.name AS grade_level_name,
       COALESCE((SELECT SUM(i.quantity_issued) FROM book_issuances i WHERE i.catalog_id = bc.id), 0)::int
         AS issued,
       COALESCE((SELECT SUM(r.quantity) FROM book_returns r
         JOIN book_issuances i ON i.id = r.issuance_id WHERE i.catalog_id = bc.id), 0)::int
         AS returned
     FROM book_catalog bc
     LEFT JOIN subjects sub ON sub.id = bc.subject_id
     LEFT JOIN grade_levels gl ON gl.id = bc.grade_level_id
     WHERE bc.school_id = $1 AND bc.school_year_id = $2 AND bc.archived_at IS NULL
     ORDER BY bc.title ASC`,
    [ctx.school.id, ctx.year.id]
  );
  const issuanceRows = await query(
    `SELECT bi.*, bc.title, bc.author, l.lrn, l.last_name, l.first_name, l.middle_name,
            l.extension_name, gl.name AS grade_level_name, sec.name AS section_name,
            COALESCE((SELECT SUM(r.quantity) FROM book_returns r WHERE r.issuance_id = bi.id), 0)::int
              AS returned_quantity
     FROM book_issuances bi
     JOIN book_catalog bc ON bc.id = bi.catalog_id
     JOIN learners l ON l.id = bi.learner_id
     JOIN grade_levels gl ON gl.id = bi.grade_level_id
     LEFT JOIN sections sec ON sec.id = bi.section_id
     WHERE bi.school_id = $1 AND bi.school_year_id = $2 ${filters}
     ORDER BY l.last_name ASC, bc.title ASC, bi.issued_on ASC`,
    params
  );
  const errors = [];
  const warnings = [];
  let checked = catalog.rows.length + issuanceRows.rows.length;
  catalog.rows.forEach((row) => {
    const available = Number(row.quantity_total) - (Number(row.issued) - Number(row.returned));
    if (Number(row.quantity_total) === 0) {
      warnings.push(issue(`"${row.title}" has no copies recorded in the inventory.`, {
        type: "book",
        id: Number(row.id)
      }));
    }
    if (available < 0) {
      errors.push(issue(`"${row.title}" has more copies issued than its recorded inventory. Correct the inventory or returns.`, {
        type: "book",
        id: Number(row.id)
      }));
    }
  });
  issuanceRows.rows.forEach((row) => {
    const outstanding = Number(row.quantity_issued) - Number(row.returned_quantity);
    if (outstanding > 0) {
      warnings.push(issue(
        `${fullName(row)} still has ${outstanding} outstanding copy/copies of "${row.title}".`,
        { type: "issuance", id: Number(row.id), label: row.lrn }
      ));
    }
  });
  if (!catalog.rows.length) {
    warnings.push(issue("No book inventory is recorded for this school year."));
  }
  data.tables.push({
    key: "inventory",
    title: "Book and Material Inventory",
    columns: [
      { key: "title", label: "Title", width: 24 },
      { key: "subject", label: "Subject", width: 11 },
      { key: "grade", label: "Grade", width: 6 },
      { key: "author", label: "Author / Publisher", width: 17 },
      { key: "isbn", label: "ISBN / Code", width: 9 },
      { key: "total", label: "Copies", width: 5, align: "right" },
      { key: "issued", label: "Issued", width: 5, align: "right" },
      { key: "returned", label: "Returned", width: 5, align: "right" },
      { key: "available", label: "Available", width: 6, align: "right" },
      { key: "condition", label: "Condition", width: 7 },
      { key: "location", label: "Location", width: 8 }
    ],
    rows: catalog.rows.map((row) => ({
      title: row.title,
      subject: row.subject_name || "",
      grade: row.grade_level_name || "All",
      author: [row.author, row.publisher].filter(Boolean).join(" / "),
      isbn: row.isbn || "",
      total: Number(row.quantity_total),
      issued: Number(row.issued),
      returned: Number(row.returned),
      available: Math.max(Number(row.quantity_total) - (Number(row.issued) - Number(row.returned)), 0),
      condition: String(row.condition || "").replace(/_/g, " "),
      location: row.location || ""
    })),
    emptyText: "No titles are registered for this school year."
  });
  data.tables.push({
    key: "issuances",
    title: "Issuance and Return Transactions",
    columns: [
      { key: "lrn", label: "LRN", width: 7 },
      { key: "learner", label: "Learner", width: 17 },
      { key: "grade", label: "Grade / Section", width: 10 },
      { key: "title", label: "Title", width: 20 },
      { key: "issuedOn", label: "Issued", width: 7 },
      { key: "issued", label: "Qty", width: 3, align: "right" },
      { key: "returned", label: "Returned", width: 5, align: "right" },
      { key: "outstanding", label: "Outstanding", width: 6, align: "right" },
      { key: "status", label: "Status", width: 7 },
      { key: "remarks", label: "Remarks", width: 10 }
    ],
    rows: issuanceRows.rows.map((row) => ({
      lrn: row.lrn,
      learner: fullName(row),
      grade: [row.grade_level_name, row.section_name].filter(Boolean).join(" / "),
      title: row.title,
      issuedOn: isoDate(row.issued_on),
      issued: Number(row.quantity_issued),
      returned: Number(row.returned_quantity),
      outstanding: Math.max(Number(row.quantity_issued) - Number(row.returned_quantity), 0),
      status: String(row.status).replace(/_/g, " "),
      remarks: row.remarks || ""
    })),
    emptyText: "No books or materials have been issued for this scope."
  });
  const totals = catalog.rows.reduce(
    (accumulator, row) => {
      accumulator.copies += Number(row.quantity_total);
      accumulator.issued += Number(row.issued);
      accumulator.returned += Number(row.returned);
      return accumulator;
    },
    { copies: 0, issued: 0, returned: 0 }
  );
  data.summary = [
    { label: "Titles", value: catalog.rows.length },
    { label: "Copies", value: totals.copies },
    { label: "Issued", value: totals.issued },
    { label: "Returned", value: totals.returned },
    { label: "Outstanding", value: Math.max(totals.issued - totals.returned, 0) }
  ];
  data.signatures = [
    { name: "", label: "Library / Property Custodian" },
    { name: ctx.school.school_head || "", label: "School Head" }
  ];
  data.notes.push(
    "Issuance and return rows are append-only. A transfer or section change does not rewrite a past transaction."
  );
  return finalizeData(data, errors, warnings, checked);
}

/* -------------------------------------------------------------------------- */
/* SF 4 — Monthly Movement                                                    */
/* -------------------------------------------------------------------------- */

async function buildSf4(ctx) {
  const data = baseData(ctx);
  const bounds = attendanceService.monthBounds(ctx.month);
  const params = [ctx.school.id, ctx.year.id, bounds.start, bounds.end];
  let gradeFilter = "";
  if (ctx.gradeLevel) {
    params.push(ctx.gradeLevel.id);
    gradeFilter = ` AND m.grade_level_id = $${params.length}`;
  }
  const movements = await query(
    `SELECT m.*, l.lrn, l.last_name, l.first_name, l.middle_name, l.extension_name,
            gl.name AS grade_level_name, sec.name AS section_name
     FROM learner_movements m
     JOIN learners l ON l.id = m.learner_id
     LEFT JOIN grade_levels gl ON gl.id = m.grade_level_id
     LEFT JOIN sections sec ON sec.id = m.section_id
     WHERE m.school_id = $1 AND m.school_year_id = $2
       AND m.effective_date BETWEEN $3 AND $4 ${gradeFilter}
     ORDER BY m.effective_date ASC, l.last_name ASC`,
    params
  );
  const gradeParams = [ctx.school.id, ctx.year.id, bounds.start];
  let gradeLevelFilter = "";
  if (ctx.gradeLevel) {
    gradeParams.push(ctx.gradeLevel.id);
    gradeLevelFilter = ` AND e.grade_level_id = $${gradeParams.length}`;
  }
  const gradeRows = await query(
    `SELECT gl.id AS grade_level_id, gl.name AS grade_level_name,
       COUNT(*)::int AS enrolled,
       COUNT(*) FILTER (WHERE e.enrollment_date < $3::date)::int AS before_month
     FROM enrollments e JOIN grade_levels gl ON gl.id = e.grade_level_id
     WHERE e.school_id = $1 AND e.school_year_id = $2 ${gradeLevelFilter}
     GROUP BY gl.id, gl.name, gl.sort_order
     ORDER BY gl.sort_order`,
    gradeParams
  );
  const attendance = await query(
    `SELECT e.grade_level_id, ar.status, COUNT(*)::int AS count
     FROM attendance_records ar JOIN enrollments e ON e.id = ar.enrollment_id
     WHERE ar.school_id = $1 AND ar.school_year_id = $2
       AND ar.attendance_date BETWEEN $3 AND $4
     GROUP BY e.grade_level_id, ar.status`,
    [ctx.school.id, ctx.year.id, bounds.start, bounds.end]
  );
  const attendanceMap = new Map();
  attendance.rows.forEach((row) => {
    const key = String(row.grade_level_id);
    if (!attendanceMap.has(key)) {
      attendanceMap.set(key, { present: 0, absent: 0, tardy: 0, excused: 0, half_day: 0 });
    }
    attendanceMap.get(key)[row.status] = Number(row.count);
  });
  const approved = movements.rows.filter((row) => row.status === "approved");
  const byGrade = gradeRows.rows.map((row) => {
    const key = String(row.grade_level_id);
    const relevant = approved.filter((movement) => String(movement.grade_level_id) === key);
    const counts = relevant.reduce(
      (accumulator, movement) => {
        accumulator[movement.movement_type] = (accumulator[movement.movement_type] || 0) + 1;
        return accumulator;
      },
      { transferred_in: 0, transferred_out: 0, dropped_out: 0, reinstated: 0, completed: 0, other: 0 }
    );
    let beginning = Number(row.before_month);
    const ending = Math.max(
      beginning + counts.transferred_in + counts.reinstated - counts.transferred_out - counts.dropped_out,
      0
    );
    const att = attendanceMap.get(key) || { present: 0, absent: 0, tardy: 0, excused: 0, half_day: 0 };
    return {
      grade: row.grade_level_name,
      enrolled: Number(row.enrolled),
      beginning,
      transferredIn: counts.transferred_in,
      transferredOut: counts.transferred_out,
      droppedOut: counts.dropped_out,
      reinstated: counts.reinstated,
      ending,
      present: att.present,
      absent: att.absent,
      tardy: att.tardy
    };
  });
  const totals = byGrade.reduce(
    (accumulator, row) => {
      ["beginning", "transferredIn", "transferredOut", "droppedOut", "reinstated", "ending", "present", "absent", "tardy"].forEach(
        (key) => {
          accumulator[key] += Number(row[key] || 0);
        }
      );
      return accumulator;
    },
    {
      beginning: 0,
      transferredIn: 0,
      transferredOut: 0,
      droppedOut: 0,
      reinstated: 0,
      ending: 0,
      present: 0,
      absent: 0,
      tardy: 0
    }
  );
  const currentParams = [ctx.school.id, ctx.year.id];
  let currentFilter = "";
  if (ctx.gradeLevel) {
    currentParams.push(ctx.gradeLevel.id);
    currentFilter = ` AND e.grade_level_id = $${currentParams.length}`;
  }
  const currentRows = await query(
    `SELECT COUNT(*)::int AS count FROM enrollments e
     WHERE e.school_id = $1 AND e.school_year_id = $2
       AND e.status NOT IN ('transferred_out', 'archived') ${currentFilter}`,
    currentParams
  );
  const current = Number(currentRows.rows[0].count);
  const discrepancy = current - totals.ending;
  const errors = [];
  const warnings = [];
  const pending = movements.rows.filter((row) => row.status === "pending");
  pending.forEach((row) => {
    warnings.push(issue(
      `A ${String(row.movement_type).replace(/_/g, " ")} for ${fullName(row)} on ${isoDate(row.effective_date)} is still pending approval and is excluded from the totals.`,
      { type: "movement", id: Number(row.id), label: row.lrn }
    ));
  });
  if (discrepancy !== 0) {
    warnings.push(issue(
      `The current active enrollment (${current}) differs from the computed ending enrollment (${totals.ending}) by ${discrepancy}. Review approved movement records and enrollment statuses.`
    ));
  }
  if (!attendance.rows.length) {
    warnings.push(issue("No attendance records exist for this month, so attendance columns are blank."));
  }
  if (!movements.rows.length) {
    warnings.push(issue("No learner movement was recorded this month. The summary therefore reflects beginning enrollment only."));
  }
  data.tables.push({
    key: "movement-summary",
    title: `Monthly Learner Movement — ${ctx.month}`,
    note:
      "Beginning enrollment counts learners enrolled before the first day of the month and not yet recorded as transferred out or dropped out. Ending enrollment = beginning + transfers in + reinstatements − transfers out − dropouts.",
    columns: [
      { key: "grade", label: "Grade Level", width: 16 },
      { key: "enrolled", label: "Enrolled Now", width: 10, align: "right" },
      { key: "beginning", label: "Beginning", width: 10, align: "right" },
      { key: "transferredIn", label: "Transferred In", width: 10, align: "right" },
      { key: "transferredOut", label: "Transferred Out", width: 10, align: "right" },
      { key: "droppedOut", label: "Dropped Out", width: 10, align: "right" },
      { key: "reinstated", label: "Reinstated", width: 9, align: "right" },
      { key: "ending", label: "Ending", width: 9, align: "right" },
      { key: "present", label: "Present", width: 8, align: "right" },
      { key: "absent", label: "Absent", width: 8, align: "right" },
      { key: "tardy", label: "Tardy", width: 8, align: "right" }
    ],
    rows: byGrade.concat([
      {
        grade: "TOTAL",
        enrolled: current,
        beginning: totals.beginning,
        transferredIn: totals.transferredIn,
        transferredOut: totals.transferredOut,
        droppedOut: totals.droppedOut,
        reinstated: totals.reinstated,
        ending: totals.ending,
        present: totals.present,
        absent: totals.absent,
        tardy: totals.tardy
      }
    ]),
    emptyText: "No enrollment or movement rows for this scope."
  });
  data.tables.push({
    key: "movement-detail",
    title: "Movement Transactions",
    columns: [
      { key: "date", label: "Effective Date", width: 9 },
      { key: "lrn", label: "LRN", width: 9 },
      { key: "learner", label: "Learner", width: 20 },
      { key: "type", label: "Movement", width: 12 },
      { key: "gradeSection", label: "Grade / Section", width: 13 },
      { key: "otherSchool", label: "Other School", width: 16 },
      { key: "reference", label: "Reference", width: 9 },
      { key: "status", label: "Status", width: 7 },
      { key: "reason", label: "Reason", width: 15 }
    ],
    rows: movements.rows.map((row) => ({
      date: isoDate(row.effective_date),
      lrn: row.lrn,
      learner: fullName(row),
      type: String(row.movement_type).replace(/_/g, " "),
      gradeSection: [row.grade_level_name, row.section_name].filter(Boolean).join(" / "),
      otherSchool: row.counterpart_school_name || "",
      reference: row.reference_no || "",
      status: row.status,
      reason: row.reason || ""
    })),
    emptyText: "No movement transactions were recorded this month."
  });
  data.summary = [
    { label: "Beginning", value: totals.beginning },
    { label: "Transferred in", value: totals.transferredIn },
    { label: "Transferred out", value: totals.transferredOut },
    { label: "Dropped out", value: totals.droppedOut },
    { label: "Ending", value: totals.ending },
    { label: "Present", value: totals.present },
    { label: "Absent", value: totals.absent }
  ];
  data.signatures = [
    { name: "", label: "Prepared by — Registrar / Records Officer" },
    { name: ctx.school.school_head || "", label: "School Head" }
  ];
  data.notes.push(
    "Absences are counted from saved attendance only and are never treated as dropouts or transfers.",
    discrepancy !== 0
      ? "The current enrollment and computed ending enrollment differ; correct the source enrollment or movement records before approval."
      : "Current enrollment reconciles with the movement totals."
  );
  return finalizeData(data, errors, warnings, Math.max(byGrade.length, 1) * 7);
}

/* -------------------------------------------------------------------------- */
/* SF 5 — Promotion and Level of Progress                                     */
/* -------------------------------------------------------------------------- */

const DECISION_LABEL = {
  pending: "Pending",
  promoted: "Promoted",
  retained: "Retained",
  conditional: "Conditional",
  completed: "Completed",
  other: "Other"
};

const WORKFLOW_LABEL = {
  draft: "Draft",
  recommended: "Recommended",
  approved: "Approved",
  finalized: "Finalized"
};

async function buildSf5(ctx) {
  const data = baseData(ctx);
  const subjects = await gradeService.subjectsForSection(ctx.section);
  const rows = await gradeService.promotionRows(ctx.actor, {
    sectionId: ctx.section.id,
    schoolYearId: ctx.year.id
  });
  const policy = await gradeService.policyFor(
    ctx.school.id,
    ctx.year.id,
    ctx.section.grade_level_id
  );
  const errors = [];
  const warnings = [];
  const columns = [
    { key: "index", label: "No.", width: 4, align: "center" },
    { key: "lrn", label: "LRN", width: 8 },
    { key: "name", label: "Learner Name", width: 18 }
  ].concat(
    subjects.map((subject) => ({
      key: `s${subject.id}`,
      label: subject.code || subject.name,
      width: 6,
      align: "center"
    }))
  ).concat([
    { key: "average", label: "General Average", width: 8, align: "center" },
    { key: "decision", label: "Decision", width: 9 },
    { key: "workflow", label: "Status", width: 9 },
    { key: "remarks", label: "Remarks", width: 12 }
  ]);
  const tableRows = rows.map((row, index) => {
    const gradeMap = new Map(row.finalGrades.map((grade) => [String(grade.subjectId), grade.grade]));
    const entry = {
      index: index + 1,
      lrn: row.lrn,
      name: row.fullName,
      average: row.generalAverage === null ? "" : row.generalAverage,
      decision: row.decision ? DECISION_LABEL[row.decision.decision] || row.decision.decision : "No decision",
      workflow: row.decision ? WORKFLOW_LABEL[row.decision.workflowStatus] || row.decision.workflowStatus : "—",
      remarks: row.decision ? row.decision.adviserRemarks || row.decision.headRemarks || "" : ""
    };
    subjects.forEach((subject) => {
      const grade = gradeMap.get(String(subject.id));
      entry[`s${subject.id}`] = grade === undefined ? "" : grade;
    });
    return entry;
  });
  rows.forEach((row) => {
    if (row.missingSubjects.length) {
      errors.push(issue(
        `${row.fullName} (${row.lrn}) is missing finalized grades for: ${row.missingSubjects.join(", ")}.`,
        { type: "learner", id: row.learnerId, label: row.lrn }
      ));
    }
    if (row.decision && row.decision.decision === "pending") {
      warnings.push(issue(
        `${row.fullName} has no promotion outcome yet. The decision must be approved before SF 5 is finalized.`,
        { type: "enrollment", id: row.enrollmentId, label: row.lrn }
      ));
    }
    if (!row.decision) {
      warnings.push(issue(
        `${row.fullName} has no promotion decision. Compute or record a recommendation before submitting SF 5.`,
        { type: "enrollment", id: row.enrollmentId, label: row.lrn }
      ));
    } else if (!["approved", "finalized"].includes(row.decision.workflowStatus)) {
      warnings.push(issue(
        `The promotion decision for ${row.fullName} is ${row.decision.workflowStatus} and has not been approved.`,
        { type: "enrollment", id: row.enrollmentId, label: row.lrn }
      ));
    }
  });
  if (!subjects.length) {
    errors.push(issue(
      "No subjects are configured for this grade level. Add subjects and teacher assignments before SF 5."
    ));
  }
  if (!rows.length) {
    errors.push(issue("The selected section has no active learners for this school year."));
  }
  const complete = rows.filter((row) => !row.missingSubjects.length).length;
  const approved = rows.filter(
    (row) => row.decision && ["approved", "finalized"].includes(row.decision.workflowStatus)
  ).length;
  const promoted = rows.filter((row) => row.decision && row.decision.decision === "promoted").length;
  const retained = rows.filter((row) => row.decision && row.decision.decision === "retained").length;
  data.tables.push({
    key: "promotion",
    title: `Promotion Report — ${ctx.section.name}`,
    note:
      "Only finalized subject grades appear in the subject columns. Promotion outcomes are shown with their workflow status and are not treated as final until approved.",
    columns,
    rows: tableRows,
    emptyText: "No learners are assigned to this section."
  });
  data.summary = [
    { label: "Learners", value: rows.length },
    { label: "Grades complete", value: complete },
    { label: "Decisions approved", value: approved },
    { label: "Promoted", value: promoted },
    { label: "Retained", value: retained },
    { label: "Passing grade", value: policy.passingGrade }
  ];
  data.signatures = [
    { name: ctx.section.adviser_name || "", label: "Class Adviser" },
    { name: ctx.school.school_head || "", label: "School Head" }
  ];
  data.notes.push(
    `Grading policy in effect: passing grade ${policy.passingGrade}; final grade formula "${policy.finalFormula}".${
      policy.isDefault ? " This is the default policy — configure the school's approved policy." : ""
    }`,
    "A learner is never marked promoted or retained automatically by generating this form."
  );
  return finalizeData(data, errors, warnings, Math.max(rows.length * (subjects.length + 2), 1));
}

/* -------------------------------------------------------------------------- */
/* SF 6 — School-wide Promotion Summary                                       */
/* -------------------------------------------------------------------------- */

async function buildSf6(ctx) {
  const data = baseData(ctx);
  const params = [ctx.school.id, ctx.year.id];
  let gradeFilter = "";
  if (ctx.gradeLevel) {
    params.push(ctx.gradeLevel.id);
    gradeFilter = ` AND e.grade_level_id = $${params.length}`;
  }
  const result = await query(
    `SELECT gl.id AS grade_level_id, gl.name AS grade_level_name, gl.sort_order,
            sec.id AS section_id, sec.name AS section_name,
            COUNT(*)::int AS learners,
            COUNT(pd.id)::int AS decided,
            COUNT(*) FILTER (
              WHERE pd.id IS NOT NULL
                AND pd.workflow_status IN ('approved', 'finalized')
                AND pd.decision = 'promoted'
            )::int AS promoted,
            COUNT(*) FILTER (
              WHERE pd.id IS NOT NULL
                AND pd.workflow_status IN ('approved', 'finalized')
                AND pd.decision = 'retained'
            )::int AS retained,
            COUNT(*) FILTER (
              WHERE pd.id IS NOT NULL
                AND pd.workflow_status IN ('approved', 'finalized')
                AND pd.decision = 'completed'
            )::int AS completed,
            COUNT(*) FILTER (
              WHERE pd.id IS NOT NULL
                AND pd.workflow_status NOT IN ('approved', 'finalized')
            )::int AS unapproved,
            COUNT(*) FILTER (
              WHERE NOT EXISTS (
                SELECT 1 FROM grade_records gr
                WHERE gr.enrollment_id = e.id AND gr.period = 'final' AND gr.status = 'finalized'
              )
            )::int AS missing_grades
     FROM enrollments e
     JOIN grade_levels gl ON gl.id = e.grade_level_id
     LEFT JOIN sections sec ON sec.id = e.section_id
     LEFT JOIN promotion_decisions pd ON pd.enrollment_id = e.id
     WHERE e.school_id = $1 AND e.school_year_id = $2
       AND e.status NOT IN ('transferred_out', 'archived')
       ${gradeFilter}
     GROUP BY gl.id, gl.name, gl.sort_order, sec.id, sec.name
     ORDER BY gl.sort_order ASC, sec.name ASC`,
    params
  );
  const errors = [];
  const warnings = [];
  const rows = result.rows.map((row) => {
    const counted = Number(row.promoted) + Number(row.retained) + Number(row.completed);
    const incomplete = Number(row.learners) - counted;
    if (Number(row.missing_grades) > 0) {
      errors.push(issue(
        `${row.grade_level_name}${row.section_name ? ` — ${row.section_name}` : ""} has ${row.missing_grades} learner(s) without finalized final grades. Complete and finalize SF 5 first.`,
        { type: "section", id: row.section_id ? Number(row.section_id) : null, label: row.section_name }
      ));
    }
    if (incomplete > 0) {
      errors.push(issue(
        `${row.grade_level_name}${row.section_name ? ` — ${row.section_name}` : ""} has ${incomplete} learner(s) whose promotion decision is not approved or finalized. These are excluded from the totals.`,
        { type: "section", id: row.section_id ? Number(row.section_id) : null, label: row.section_name }
      ));
    }
    return {
      grade: row.grade_level_name,
      section: row.section_name || "—",
      learners: Number(row.learners),
      promoted: Number(row.promoted),
      retained: Number(row.retained),
      completed: Number(row.completed),
      incomplete,
      status: incomplete === 0 ? "Complete" : "Incomplete"
    };
  });
  const totals = rows.reduce(
    (accumulator, row) => {
      accumulator.learners += row.learners;
      accumulator.promoted += row.promoted;
      accumulator.retained += row.retained;
      accumulator.completed += row.completed;
      accumulator.incomplete += row.incomplete;
      return accumulator;
    },
    { learners: 0, promoted: 0, retained: 0, completed: 0, incomplete: 0 }
  );
  if (!rows.length) {
    errors.push(issue("No active enrollments match this school, school year, and grade."));
  }
  data.tables.push({
    key: "summary",
    title: "Summary of Promotion and Level of Progress",
    note:
      "Only promotion decisions with approved or finalized workflow status are counted. Learners without an approved decision are reported as incomplete, never estimated.",
    columns: [
      { key: "grade", label: "Grade Level", width: 18 },
      { key: "section", label: "Section", width: 14 },
      { key: "learners", label: "Learners", width: 8, align: "right" },
      { key: "promoted", label: "Promoted", width: 9, align: "right" },
      { key: "retained", label: "Retained", width: 9, align: "right" },
      { key: "completed", label: "Completed", width: 10, align: "right" },
      { key: "incomplete", label: "Incomplete", width: 10, align: "right" },
      { key: "status", label: "Status", width: 10 }
    ],
    rows: rows.concat([
      {
        grade: "TOTAL",
        section: "",
        learners: totals.learners,
        promoted: totals.promoted,
        retained: totals.retained,
        completed: totals.completed,
        incomplete: totals.incomplete,
        status: totals.incomplete === 0 ? "Complete" : "Incomplete"
      }
    ]),
    emptyText: "No enrollments are available for this scope."
  });
  data.summary = [
    { label: "Classes", value: rows.length },
    { label: "Learners", value: totals.learners },
    { label: "Promoted", value: totals.promoted },
    { label: "Retained", value: totals.retained },
    { label: "Completed", value: totals.completed },
    { label: "Incomplete", value: totals.incomplete }
  ];
  data.signatures = [
    { name: "", label: "Prepared by — Registrar / Records Officer" },
    { name: ctx.school.school_head || "", label: "School Head" }
  ];
  data.notes.push(
    "This summary is built from approved or finalized promotion decisions only; generating it does not approve any pending decision.",
    totals.incomplete
      ? "Resolve the incomplete classes before submitting the school-wide summary to the district."
      : "All classes in scope have approved promotion decisions."
  );
  return finalizeData(data, errors, warnings, Math.max(rows.length * 4, 1));
}

/* -------------------------------------------------------------------------- */
/* SF 7 — Personnel Assignment                                                */
/* -------------------------------------------------------------------------- */

async function buildSf7(ctx) {
  const data = baseData(ctx);
  const summary = await personnelService.assignmentSummary(ctx.actor, {
    schoolId: ctx.school.id,
    schoolYearId: ctx.year.id
  });
  const errors = [];
  const warnings = [];
  summary.items.forEach((item) => {
    if (item.conflicts.length) {
      item.conflicts.forEach((conflict) => {
        errors.push(issue(`${item.fullName}: ${conflict.message}`, {
          type: "personnel",
          id: item.profileId || item.userId,
          label: item.fullName
        }));
      });
    }
    if (item.missing.length) {
      warnings.push(issue(
        `${item.fullName} is missing: ${item.missing.join(", ")}.`,
        { type: "personnel", id: item.profileId || item.userId, label: item.fullName }
      ));
    }
  });
  if (!summary.items.length) {
    errors.push(issue("No active teaching or non-teaching personnel are recorded for this school."));
  }
  data.tables.push({
    key: "personnel",
    title: "Personnel Assignment List",
    columns: [
      { key: "index", label: "No.", width: 4, align: "center" },
      { key: "employeeNo", label: "Employee No.", width: 8 },
      { key: "name", label: "Name", width: 16 },
      { key: "position", label: "Position", width: 12 },
      { key: "category", label: "Category", width: 7 },
      { key: "employment", label: "Employment", width: 9 },
      { key: "assignments", label: "Grade / Section / Subject", width: 22 },
      { key: "loadHours", label: "Load (hrs)", width: 6, align: "right" },
      { key: "schedules", label: "Schedules", width: 6, align: "center" },
      { key: "status", label: "Record", width: 8 }
    ],
    rows: summary.items.map((item, index) => ({
      index: index + 1,
      employeeNo: item.employeeNo || "",
      name: item.fullName,
      position: item.position || "",
      category: item.isTeaching ? "Teaching" : "Non-teaching",
      employment: [item.employmentType, item.employmentStatus].filter(Boolean).join(" / "),
      assignments: item.assignments.length
        ? item.assignments
            .map((assignment) =>
              [assignment.gradeLevelName, assignment.sectionName, assignment.subjectName]
                .filter(Boolean)
                .join(" / ")
            )
            .join("; ")
        : "No assignment recorded",
      loadHours: item.loadHours || 0,
      schedules: item.schedules.length,
      status: item.complete ? "Complete" : `Missing ${item.missing.join(", ")}`
    })),
    emptyText: "No personnel records are available for this school year."
  });
  data.summary = [
    { label: "Personnel", value: summary.counts.total },
    { label: "Teaching", value: summary.counts.teaching },
    { label: "Non-teaching", value: summary.counts.nonTeaching },
    { label: "Incomplete records", value: summary.counts.incomplete },
    { label: "Schedule conflicts", value: summary.counts.conflicts }
  ];
  data.signatures = [
    { name: "", label: "Prepared by — School Head / Administrative Officer" },
    { name: ctx.school.school_head || "", label: "School Head" }
  ];
  data.notes.push(
    "Assignments and schedules come from the current school-year teacher assignment and class schedule records.",
    "Contact details are limited to personnel authorized to view confidential profile information."
  );
  return finalizeData(data, errors, warnings, Math.max(summary.items.length * 4, 1));
}

/* -------------------------------------------------------------------------- */
/* SF 8 — Health and Nutrition (restricted)                                   */
/* -------------------------------------------------------------------------- */

async function buildSf8(ctx) {
  const data = baseData(ctx);
  const params = [ctx.school.id, ctx.year.id];
  let filters = "";
  if (ctx.gradeLevel) {
    params.push(ctx.gradeLevel.id);
    filters += ` AND e.grade_level_id = $${params.length}`;
  }
  if (ctx.section) {
    params.push(ctx.section.id);
    filters += ` AND e.section_id = $${params.length}`;
  }
  const measurements = await query(
    `SELECT DISTINCT ON (h.learner_id)
            h.*, l.lrn, l.last_name, l.first_name, l.middle_name, l.extension_name, l.sex AS learner_sex,
            l.birth_date, gl.name AS grade_level_name, sec.name AS section_name,
            u.full_name AS assessed_by_name
     FROM health_measurements h
     JOIN learners l ON l.id = h.learner_id
     LEFT JOIN enrollments e ON e.id = h.enrollment_id
     LEFT JOIN grade_levels gl ON gl.id = e.grade_level_id
     LEFT JOIN sections sec ON sec.id = e.section_id
     LEFT JOIN users u ON u.id = h.assessed_by
     WHERE h.school_id = $1 AND h.school_year_id = $2 ${filters}
     ORDER BY h.learner_id ASC, h.measured_on DESC, h.id DESC`,
    params
  );
  const roster = await enrollmentRows(ctx);
  const errors = [];
  const warnings = [];
  const measuredIds = new Set(measurements.rows.map((row) => String(row.learner_id)));
  roster.forEach((learner) => {
    if (!measuredIds.has(String(learner.learner_id))) {
      warnings.push(issue(
        `${fullName(learner)} (${learner.lrn}) has no health measurement for this school year.`,
        { type: "learner", id: Number(learner.learner_id), label: learner.lrn }
      ));
    }
  });
  measurements.rows.forEach((row) => {
    if (!row.nutritional_status || row.nutritional_status === "not_assessed") {
      warnings.push(issue(
        `${fullName(row)} has a measurement dated ${isoDate(row.measured_on)} but no authorized nutritional assessment.`,
        { type: "health", id: Number(row.id), label: row.lrn }
      ));
    }
    if (row.bmi === null && row.weight_kg && row.height_cm) {
      warnings.push(issue(
        `${fullName(row)} has height and weight but no valid BMI could be computed.`,
        { type: "health", id: Number(row.id), label: row.lrn }
      ));
    }
  });
  const tidy = (value) => String(value || "").replace(/_/g, " ");
  data.tables.push({
    key: "health",
    title: "Learner Health and Nutrition Profile",
    note:
      "Restricted document. Shows the latest measurement per learner for this school year. BMI is computed from valid height and weight; the nutritional status is the authorized assessor's recorded assessment.",
    columns: [
      { key: "lrn", label: "LRN", width: 8 },
      { key: "name", label: "Learner Name", width: 17 },
      { key: "sex", label: "Sex", width: 3, align: "center" },
      { key: "age", label: "Age", width: 3, align: "center" },
      { key: "gradeSection", label: "Grade / Section", width: 11 },
      { key: "measuredOn", label: "Measured", width: 7 },
      { key: "height", label: "Height (cm)", width: 6, align: "right" },
      { key: "weight", label: "Weight (kg)", width: 6, align: "right" },
      { key: "bmi", label: "BMI", width: 4, align: "right" },
      { key: "status", label: "Nutritional Status", width: 12 },
      { key: "assessor", label: "Assessed By", width: 11 },
      { key: "remarks", label: "Remarks", width: 12 }
    ],
    rows: measurements.rows.map((row) => ({
      lrn: row.lrn,
      name: fullName(row),
      sex: sexLabel(row.sex || row.learner_sex),
      age: row.age_at_measurement === null ? calculateAge(row.birth_date, row.measured_on) : Number(row.age_at_measurement),
      gradeSection: [row.grade_level_name, row.section_name].filter(Boolean).join(" / "),
      measuredOn: isoDate(row.measured_on),
      height: row.height_cm === null ? "" : Number(row.height_cm),
      weight: row.weight_kg === null ? "" : Number(row.weight_kg),
      bmi: row.bmi === null ? "" : Number(row.bmi),
      status: tidy(row.nutritional_status || "not assessed"),
      assessor: row.assessor_name || row.assessed_by_name || "",
      remarks: row.remarks || row.assessment || ""
    })),
    emptyText: "No health measurements are recorded for this scope."
  });
  const countStatus = (value) =>
    measurements.rows.filter((row) => row.nutritional_status === value).length;
  data.summary = [
    { label: "Learners", value: roster.length },
    { label: "Measured", value: measurements.rows.length },
    { label: "Not measured", value: Math.max(roster.length - measuredIds.size, 0) },
    { label: "Severely wasted", value: countStatus("severely_wasted") },
    { label: "Wasted", value: countStatus("wasted") },
    { label: "Normal", value: countStatus("normal") },
    { label: "Overweight / obese", value: countStatus("overweight") + countStatus("obese") }
  ];
  data.signatures = [
    { name: "", label: "School Health Personnel" },
    { name: ctx.school.school_head || "", label: "School Head" }
  ];
  data.notes.push(
    "This form is restricted to authorized health personnel and school administrators.",
    "No nutritional status is inferred by this system. BMI alone is not a diagnosis, and adult cut-offs are never applied to children."
  );
  return finalizeData(data, errors, warnings, Math.max(roster.length, 1));
}

/* -------------------------------------------------------------------------- */
/* SF 9 — Learner Report Card                                                 */
/* -------------------------------------------------------------------------- */

async function buildSf9(ctx) {
  const data = baseData(ctx);
  const errors = [];
  const warnings = [];
  if (ctx.learner) {
    const enrollment = await learnerEnrollment(ctx.learner.id, ctx.year.id);
    if (!enrollment) {
      errors.push(issue(
        `${fullName(ctx.learner)} has no enrollment for ${ctx.year.name}. Create the enrollment before generating a report card.`,
        { type: "learner", id: Number(ctx.learner.id), label: ctx.learner.lrn }
      ));
      data.tables.push({
        key: "empty",
        title: "Learner Progress Report Card",
        columns: [{ key: "message", label: "Status", width: 100 }],
        rows: [],
        emptyText: "No enrollment record matches this learner and school year."
      });
      return finalizeData(data, errors, warnings, 1);
    }
    const card = await gradeService.reportCardData(enrollment.id);
    if (!card) {
      errors.push(issue("The report card data could not be assembled for this enrollment."));
      return finalizeData(data, errors, warnings, 1);
    }
    const learnerName = card.enrollment.learnerName;
    const finalizedSubjects = card.subjects.filter((subject) => subject.status === "finalized");
    if (!finalizedSubjects.length) {
      errors.push(issue(
        `${learnerName} has no finalized final grades. SF 9 cannot be issued until the grades are finalized.`,
        { type: "learner", id: card.enrollment.learnerId, label: card.enrollment.lrn }
      ));
    }
    card.subjects
      .filter((subject) => subject.status !== "finalized")
      .forEach((subject) => {
        errors.push(issue(
          `The final grade for ${subject.subjectName} is ${subject.status} and cannot appear on an issued report card.`,
          { type: "learner", id: card.enrollment.learnerId, label: card.enrollment.lrn }
        ));
      });
    if (card.promotion && !["approved", "finalized"].includes(card.promotion.workflowStatus)) {
      warnings.push(issue(
        `The promotion decision is ${card.promotion.workflowStatus}; the report card may be prepared but should not be issued as final.`,
        { type: "learner", id: card.enrollment.learnerId, label: card.enrollment.lrn }
      ));
    }
    data.summary = [
      { label: "Learner", value: learnerName },
      { label: "LRN", value: card.enrollment.lrn },
      { label: "Grade / Section", value: [card.enrollment.gradeLevelName, card.enrollment.sectionName].filter(Boolean).join(" / ") },
      { label: "School Year", value: card.enrollment.schoolYearName },
      { label: "General Average", value: card.generalAverage === null ? "—" : card.generalAverage },
      { label: "Promotion", value: card.promotion ? DECISION_LABEL[card.promotion.decision] || card.promotion.decision : "—" }
    ];
    data.tables.push({
      key: "grades",
      title: "Subject Grades",
      columns: [
        { key: "index", label: "No.", width: 5, align: "center" },
        { key: "subject", label: "Learning Area / Subject", width: 38 },
        { key: "q1", label: "Q1", width: 8, align: "center" },
        { key: "q2", label: "Q2", width: 8, align: "center" },
        { key: "q3", label: "Q3", width: 8, align: "center" },
        { key: "q4", label: "Q4", width: 8, align: "center" },
        { key: "final", label: "Final", width: 8, align: "center" },
        { key: "status", label: "Status", width: 10 }
      ],
      rows: card.subjects.map((subject, index) => ({
        index: index + 1,
        subject: subject.subjectName,
        q1: subject.q1 === null ? "" : subject.q1,
        q2: subject.q2 === null ? "" : subject.q2,
        q3: subject.q3 === null ? "" : subject.q3,
        q4: subject.q4 === null ? "" : subject.q4,
        final: subject.final === null ? "" : subject.final,
        status: subject.status
      })),
      emptyText: "No final grades are recorded for this learner."
    });
    const attendance = card.attendance;
    data.tables.push({
      key: "attendance",
      title: "Attendance and Promotion",
      columns: [
        { key: "metric", label: "Metric", width: 40 },
        { key: "value", label: "Value", width: 20, align: "center" }
      ],
      rows: [
        { metric: "Days present", value: attendance.present },
        { metric: "Days absent", value: attendance.absent },
        { metric: "Days tardy", value: attendance.tardy },
        { metric: "Excused", value: attendance.excused },
        { metric: "Half day", value: attendance.half_day },
        {
          metric: "Promotion status",
          value: card.promotion ? DECISION_LABEL[card.promotion.decision] || card.promotion.decision : "Not yet decided"
        },
        { metric: "General average", value: card.generalAverage === null ? "—" : card.generalAverage }
      ],
      emptyText: "No attendance or promotion data."
    });
    data.signatures = [
      { name: card.enrollment.adviserName || "", label: "Class Adviser" },
      { name: ctx.school.school_head || "", label: "School Head" },
      { name: "", label: "Parent / Guardian Signature" }
    ];
    data.notes.push(
      "Only finalized final grades appear on an issuable report card. Blank quarters indicate grades that were not recorded; they are never filled in automatically.",
      "One report card is generated per learner per school year. Previously issued cards are preserved and reissues are versioned."
    );
    return finalizeData(
      data,
      errors,
      warnings,
      Math.max(card.subjects.length + 6, 1)
    );
  }

  const params = [ctx.school.id, ctx.year.id];
  let filters = "";
  if (ctx.gradeLevel) {
    params.push(ctx.gradeLevel.id);
    filters += ` AND e.grade_level_id = $${params.length}`;
  }
  if (ctx.section) {
    params.push(ctx.section.id);
    filters += ` AND e.section_id = $${params.length}`;
  }
  const cards = await query(
    `SELECT rc.*, l.lrn, l.last_name, l.first_name, l.middle_name, l.extension_name,
            gl.name AS grade_level_name, sec.name AS section_name
     FROM report_cards rc
     JOIN enrollments e ON e.id = rc.enrollment_id
     JOIN learners l ON l.id = rc.learner_id
     JOIN grade_levels gl ON gl.id = e.grade_level_id
     LEFT JOIN sections sec ON sec.id = e.section_id
     WHERE rc.school_id = $1 AND rc.school_year_id = $2 ${filters}
     ORDER BY gl.sort_order ASC, sec.name ASC, l.last_name ASC`,
    params
  );
  const expected = await query(
    `SELECT COUNT(*)::int AS count FROM enrollments e
     WHERE e.school_id = $1 AND e.school_year_id = $2
       AND e.status NOT IN ('transferred_out', 'archived') ${filters}`,
    params
  );
  const missingCards = await query(
    `SELECT l.lrn, l.last_name, l.first_name, e.id AS enrollment_id
     FROM enrollments e JOIN learners l ON l.id = e.learner_id
     WHERE e.school_id = $1 AND e.school_year_id = $2
       AND e.status NOT IN ('transferred_out', 'archived') ${filters}
       AND NOT EXISTS (SELECT 1 FROM report_cards rc WHERE rc.enrollment_id = e.id)
     ORDER BY l.last_name ASC`,
    params
  );
  missingCards.rows.forEach((row) => {
    warnings.push(issue(
      `No report card has been generated for ${fullName(row)} (${row.lrn}).`,
      { type: "enrollment", id: Number(row.enrollment_id), label: row.lrn }
    ));
  });
  const draftCards = cards.rows.filter((row) => !["approved", "issued"].includes(row.status));
  if (draftCards.length) {
    warnings.push(issue(
      `${draftCards.length} report card(s) for this scope are not yet approved or issued.`,
      { type: "section", id: ctx.section ? Number(ctx.section.id) : null }
    ));
  }
  if (!cards.rows.length) {
    errors.push(issue("No report cards exist for this scope. Generate report cards for the section first."));
  }
  data.tables.push({
    key: "cards",
    title: "Report Card Register",
    note: "Select a learner to print an individual report card. Batch printing uses approved or issued cards.",
    columns: [
      { key: "lrn", label: "LRN", width: 9 },
      { key: "name", label: "Learner Name", width: 22 },
      { key: "gradeSection", label: "Grade / Section", width: 14 },
      { key: "average", label: "General Average", width: 10, align: "right" },
      { key: "promotion", label: "Promotion", width: 10 },
      { key: "status", label: "Card Status", width: 9 },
      { key: "version", label: "Version", width: 6, align: "center" },
      { key: "issuedOn", label: "Issued", width: 8 }
    ],
    rows: cards.rows.map((row) => ({
      lrn: row.lrn,
      name: fullName(row),
      gradeSection: [row.grade_level_name, row.section_name].filter(Boolean).join(" / "),
      average: row.general_average === null ? "—" : Number(row.general_average),
      promotion: row.promotion_status ? DECISION_LABEL[row.promotion_status] || row.promotion_status : "—",
      status: row.status,
      version: Number(row.version),
      issuedOn: isoDate(row.issued_on)
    })),
    emptyText: "No report cards have been generated for this scope."
  });
  data.summary = [
    { label: "Enrolled learners", value: Number(expected.rows[0].count) },
    { label: "Cards generated", value: cards.rows.length },
    { label: "Approved / issued", value: cards.rows.length - draftCards.length },
    { label: "Not approved", value: draftCards.length },
    { label: "Without a card", value: missingCards.rows.length }
  ];
  data.signatures = [
    { name: ctx.section ? ctx.section.adviser_name || "" : "", label: "Class Adviser" },
    { name: ctx.school.school_head || "", label: "School Head" }
  ];
  return finalizeData(data, errors, warnings, Math.max(cards.rows.length, 1));
}

/* -------------------------------------------------------------------------- */
/* SF 10 — Permanent Academic Record                                          */
/* -------------------------------------------------------------------------- */

async function buildSf10(ctx) {
  const data = baseData(ctx);
  const errors = [];
  const warnings = [];
  const learner = ctx.learner;
  const records = await query(
    `SELECT par.*, y.name AS school_year_name, y.starts_on, gl.name AS grade_level_name,
            gl.sort_order, u.full_name AS verified_by_name
     FROM permanent_academic_records par
     LEFT JOIN school_years y ON y.id = par.school_year_id
     LEFT JOIN grade_levels gl ON gl.id = par.grade_level_id
     LEFT JOIN users u ON u.id = par.verified_by
     WHERE par.learner_id = $1
     ORDER BY y.starts_on ASC NULLS LAST, gl.sort_order ASC NULLS LAST, par.id ASC`,
    [learner.id]
  );
  const subjects = records.rows.length
    ? await query(
        `SELECT * FROM permanent_academic_subjects
         WHERE record_id = ANY($1::bigint[]) ORDER BY sort_order ASC, id ASC`,
        [records.rows.map((row) => row.id)]
      )
    : { rows: [] };
  const subjectsByRecord = new Map();
  subjects.rows.forEach((row) => {
    const key = String(row.record_id);
    if (!subjectsByRecord.has(key)) subjectsByRecord.set(key, []);
    subjectsByRecord.get(key).push(row);
  });
  const proposals = await query(
    `SELECT e.id AS enrollment_id, e.school_id, y.id AS school_year_id, y.name AS school_year_name,
            y.starts_on, gl.id AS grade_level_id, gl.name AS grade_level_name, gl.sort_order,
            s.school_name, s.school_code, sec.name AS section_name,
            (SELECT ROUND(AVG(gr.grade), 2) FROM grade_records gr
              WHERE gr.enrollment_id = e.id AND gr.period = 'final' AND gr.status = 'finalized')
              AS general_average,
            (SELECT COUNT(*) FROM grade_records gr
              WHERE gr.enrollment_id = e.id AND gr.period = 'final' AND gr.status <> 'finalized')::int
              AS unfinalized,
            (SELECT COUNT(*) FROM grade_records gr
              WHERE gr.enrollment_id = e.id AND gr.period = 'final' AND gr.status = 'finalized')::int
              AS finalized,
            pd.decision, pd.workflow_status
     FROM enrollments e
     JOIN school_years y ON y.id = e.school_year_id
     JOIN grade_levels gl ON gl.id = e.grade_level_id
     JOIN schools s ON s.id = e.school_id
     LEFT JOIN sections sec ON sec.id = e.section_id
     LEFT JOIN promotion_decisions pd ON pd.enrollment_id = e.id
     WHERE e.learner_id = $1
     ORDER BY y.starts_on ASC, gl.sort_order ASC`,
    [learner.id]
  );
  const covered = new Set(
    records.rows
      .filter((row) => row.school_year_id && row.grade_level_id && row.verification_status === "verified")
      .map((row) => `${row.school_year_id}:${row.grade_level_id}`)
  );
  const proposed = proposals.rows.filter(
    (row) => row.finalized > 0 && !covered.has(`${row.school_year_id}:${row.grade_level_id}`)
  );
  proposed.forEach((row) => {
    warnings.push(issue(
      `${row.school_year_name} ${row.grade_level_name} has finalized grades that are not yet part of a verified permanent record. Review and verify the proposed entry.`,
      { type: "enrollment", id: Number(row.enrollment_id) }
    ));
  });
  proposals.rows
    .filter((row) => row.unfinalized > 0)
    .forEach((row) => {
      warnings.push(issue(
        `${row.school_year_name} ${row.grade_level_name} still has ${row.unfinalized} unfinalized final grade(s) and is excluded from proposed entries.`,
        { type: "enrollment", id: Number(row.enrollment_id) }
      ));
    });
  records.rows
    .filter((row) => row.verification_status !== "verified")
    .forEach((row) => {
      warnings.push(issue(
        `The ${row.school_year_name || "undated"} ${row.grade_level_name || ""} record from ${row.school_name} is not verified. It is shown as unverified and must not be certified.`.trim(),
        { type: "permanent_record", id: Number(row.id) }
      ));
    });
  const ordered = records.rows.filter((row) => row.sort_order !== null);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (Number(current.sort_order) - Number(previous.sort_order) > 1) {
      warnings.push(issue(
        `A gap exists in the academic history: no record covers the grade level(s) between ${previous.grade_level_name} and ${current.grade_level_name}.`
      ));
    }
  }
  if (!records.rows.length) {
    errors.push(issue(
      `${fullName(learner)} has no permanent academic record entries. Verified historical records must be entered or imported before SF 10 can be certified.`,
      { type: "learner", id: Number(learner.id), label: learner.lrn }
    ));
  }
  data.summary = [
    { label: "Learner", value: fullName(learner) },
    { label: "LRN", value: learner.lrn },
    { label: "Verified records", value: records.rows.filter((row) => row.verification_status === "verified").length },
    { label: "Unverified records", value: records.rows.filter((row) => row.verification_status !== "verified").length },
    { label: "Proposed from system", value: proposed.length }
  ];
  data.tables.push({
    key: "permanent",
    title: "Verified Permanent Academic Record",
    note:
      "This cumulative record is not a copy of the current report card. Unverified or imported entries are marked and must not be certified as verified without review.",
    columns: [
      { key: "schoolYear", label: "School Year", width: 9 },
      { key: "grade", label: "Grade Level", width: 9 },
      { key: "school", label: "School", width: 18 },
      { key: "section", label: "Section", width: 8 },
      { key: "average", label: "General Average", width: 8, align: "right" },
      { key: "promotion", label: "Promotion / Completion", width: 12 },
      { key: "awards", label: "Awards", width: 10 },
      { key: "transfer", label: "Transfer Information", width: 12 },
      { key: "source", label: "Source", width: 7 },
      { key: "verified", label: "Verification", width: 8 }
    ],
    rows: records.rows.map((row) => ({
      schoolYear: row.school_year_name || "",
      grade: row.grade_level_name || "",
      school: [row.school_name, row.school_id_no].filter(Boolean).join(" / "),
      section: row.section_name || "",
      average: row.general_average === null ? "" : Number(row.general_average),
      promotion: row.promotion_status || "",
      awards: row.awards || "",
      transfer: row.transfer_info || "",
      source: row.source,
      verified:
        row.verification_status === "verified"
          ? `Verified${row.verified_by_name ? ` — ${row.verified_by_name}` : ""}`
          : "Unverified"
    })),
    emptyText: "No permanent academic records have been entered for this learner."
  });
  const subjectRows = records.rows.flatMap((record) =>
    (subjectsByRecord.get(String(record.id)) || []).map((subject) => ({
      schoolYear: record.school_year_name || "",
      grade: record.grade_level_name || "",
      subject: subject.subject_name,
      gradeValue: subject.final_grade === null ? "" : Number(subject.final_grade),
      remarks: subject.remarks || ""
    }))
  );
  if (subjectRows.length) {
    data.tables.push({
      key: "subjects",
      title: "Recorded Subject Grades",
      columns: [
        { key: "schoolYear", label: "School Year", width: 14 },
        { key: "grade", label: "Grade Level", width: 16 },
        { key: "subject", label: "Subject / Learning Area", width: 42 },
        { key: "gradeValue", label: "Final Grade", width: 12, align: "right" },
        { key: "remarks", label: "Remarks", width: 16 }
      ],
      rows: subjectRows,
      emptyText: "No subject grades are attached to the permanent records."
    });
  }
  if (proposed.length) {
    data.tables.push({
      key: "proposed",
      title: "System-Proposed Entries — Not Yet Verified",
      note:
        "These entries are derived from finalized grades and approved promotion decisions. They must be reviewed and verified by authorized records personnel before they become part of the permanent record.",
      columns: [
        { key: "schoolYear", label: "School Year", width: 10 },
        { key: "grade", label: "Grade Level", width: 10 },
        { key: "school", label: "School", width: 24 },
        { key: "section", label: "Section", width: 10 },
        { key: "average", label: "General Average", width: 10, align: "right" },
        { key: "decision", label: "Promotion Decision", width: 14 },
        { key: "workflow", label: "Workflow", width: 12 }
      ],
      rows: proposed.map((row) => ({
        schoolYear: row.school_year_name,
        grade: row.grade_level_name,
        school: row.school_name,
        section: row.section_name || "",
        average: row.general_average === null ? "" : Number(row.general_average),
        decision: row.decision ? DECISION_LABEL[row.decision] || row.decision : "No decision",
        workflow: row.workflow_status ? WORKFLOW_LABEL[row.workflow_status] || row.workflow_status : "—"
      })),
      emptyText: "No system-proposed entries are pending verification."
    });
  }
  data.signatures = [
    { name: "", label: "Prepared by — Registrar / Records Officer" },
    { name: ctx.school.school_head || "", label: "Certified correct — School Head" }
  ];
  data.notes.push(
    "This record is cumulative and preserved. Finalized historical entries are never replaced automatically.",
    "Corrections to verified records require an authorized correction workflow with an audit trail.",
    "Imported records retain their source and verification status."
  );
  return finalizeData(
    data,
    errors,
    warnings,
    Math.max(records.rows.length * 6, proposed.length * 2, 1)
  );
}

const BUILDERS = {
  sf1: buildSf1,
  sf2: buildSf2,
  sf3: buildSf3,
  sf4: buildSf4,
  sf5: buildSf5,
  sf6: buildSf6,
  sf7: buildSf7,
  sf8: buildSf8,
  sf9: buildSf9,
  sf10: buildSf10
};

async function buildForm(actor, code, params = {}) {
  const definition = definitionFor(code);
  const ctx = await resolveContext(actor, definition.code, params);
  const builder = BUILDERS[definition.code];
  const data = await builder(ctx);
  data.source = {
    generatedBy: actor ? Number(actor.id) : null,
    generatedByName: actor ? actor.fullName : null,
    context: {
      schoolId: Number(ctx.school.id),
      schoolYearId: Number(ctx.year.id),
      gradeLevelId: ctx.gradeLevel ? Number(ctx.gradeLevel.id) : null,
      sectionId: ctx.section ? Number(ctx.section.id) : null,
      learnerId: ctx.learner ? Number(ctx.learner.id) : null,
      month: ctx.month
    }
  };
  return { data, ctx };
}

module.exports = {
  FORM_DEFINITIONS,
  FORM_MAP,
  definitionFor,
  templateFor,
  resolveContext,
  baseScope,
  baseData,
  enrollmentRows,
  fullName,
  addressOf,
  isoDate,
  sexLabel,
  pct,
  buildSf1,
  buildSf2,
  buildSf3,
  buildSf4,
  buildSf5,
  buildSf6,
  buildSf7,
  buildSf8,
  buildSf9,
  buildSf10,
  buildForm,
  finalizeData,
  issue
};
