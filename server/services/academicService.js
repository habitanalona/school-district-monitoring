"use strict";

const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const {
  serializeSchoolYear,
  serializeGradeLevel,
  serializeSection,
  serializeSubject,
  serializeTeacherAssignment,
  serializeClassSchedule
} = require("../utils/serializers");
const {
  assertCanManageAcademics,
  assertSchoolScope,
  resolveSchoolId
} = require("../utils/learnerAccess");
const auditService = require("./auditService");

const DAY_NAMES = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday"
};
const TEACHING_ROLES = ["teacher", "adviser", "school_head"];

async function schoolForActor(actor, rawSchoolId) {
  const schoolId = resolveSchoolId(actor, rawSchoolId);
  if (!schoolId) {
    throw new HttpError(
      400,
      "Choose the school for this record.",
      "SCHOOL_REQUIRED"
    );
  }
  const result = await query(
    `SELECT s.id, s.school_name, s.school_code, s.school_type, s.district_id,
            d.district_name
     FROM schools s
     JOIN districts d ON d.id = s.district_id
     WHERE s.id = $1`,
    [schoolId]
  );
  if (!result.rows[0]) {
    throw new HttpError(404, "School not found.", "SCHOOL_NOT_FOUND");
  }
  assertSchoolScope(actor, result.rows[0].id, result.rows[0].district_id);
  return result.rows[0];
}

// Read-side scope for academic tables. Every query using this joins schools
// (sch) and districts (d).
function academicScope(actor, params, requestedSchoolId = null) {
  if (actor.role === "system_admin") {
    if (requestedSchoolId) {
      params.push(requestedSchoolId);
      return `sch.id = $${params.length}`;
    }
    return "";
  }
  if (actor.schoolId) {
    params.push(actor.schoolId);
    return `sch.id = $${params.length}`;
  }
  if (actor.districtId) {
    params.push(actor.districtId);
    return `d.id = $${params.length}`;
  }
  return "FALSE";
}

async function assertTeacher(actor, userId, schoolId, field = "Adviser") {
  if (!userId) {
    return null;
  }
  const result = await query(
    `SELECT id, full_name, role FROM users
     WHERE id = $1 AND school_id = $2 AND is_active AND approval_status = 'active'`,
    [userId, schoolId]
  );
  const user = result.rows[0];
  if (!user) {
    throw new HttpError(
      400,
      `${field} must be an active account in this school.`,
      "TEACHER_INVALID"
    );
  }
  return user;
}

/* -------------------------------------------------------------------------- */
/* School years                                                                */
/* -------------------------------------------------------------------------- */

async function listSchoolYears(actor) {
  const yearsResult = await query(`SELECT * FROM school_years ORDER BY name DESC`);
  if (!yearsResult.rows.length) {
    return [];
  }

  const params = [];
  const scope = academicScope(actor, params);
  const counts = await query(
    `SELECT sec.school_year_id,
            COUNT(*)::int AS section_count
     FROM sections sec
     JOIN schools sch ON sch.id = sec.school_id
     JOIN districts d ON d.id = sch.district_id
     WHERE ${scope || "TRUE"}
     GROUP BY sec.school_year_id`,
    params
  );

  const learnerParams = [];
  const learnerScope = academicScope(actor, learnerParams);
  const learnerCounts = await query(
    `SELECT e.school_year_id, COUNT(DISTINCT e.learner_id)::int AS learner_count
     FROM enrollments e
     JOIN schools sch ON sch.id = e.school_id
     JOIN districts d ON d.id = sch.district_id
     WHERE ${learnerScope || "TRUE"}
     GROUP BY e.school_year_id`,
    learnerParams
  );

  const sectionsByYear = new Map(
    counts.rows.map((row) => [Number(row.school_year_id), row.section_count])
  );
  const learnersByYear = new Map(
    learnerCounts.rows.map((row) => [Number(row.school_year_id), row.learner_count])
  );

  return yearsResult.rows.map((row) => {
    const year = serializeSchoolYear(row);
    year.sectionCount = sectionsByYear.get(year.id) || 0;
    year.learnerCount = learnersByYear.get(year.id) || 0;
    return year;
  });
}

async function createSchoolYear(actor, payload) {
  assertCanManageAcademics(actor);
  const client = await getClient();
  try {
    await client.query("BEGIN");
    if (payload.isCurrent) {
      await client.query(`UPDATE school_years SET is_current = FALSE WHERE is_current`);
    }
    const result = await client.query(
      `INSERT INTO school_years (name, starts_on, ends_on, is_current)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [payload.name, payload.startsOn, payload.endsOn, payload.isCurrent]
    );
    await auditService.record({
      client,
      userId: actor.id,
      action: "school_year.created",
      entityType: "school_year",
      entityId: result.rows[0].id,
      districtId: actor.districtId || null,
      ipAddress: actor.ipAddress || null,
      details: {
        name: payload.name,
        starts_on: payload.startsOn,
        ends_on: payload.endsOn,
        is_current: payload.isCurrent
      }
    });
    await client.query("COMMIT");
    return serializeSchoolYear(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "That school year already exists.",
        "SCHOOL_YEAR_EXISTS"
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

async function updateSchoolYear(actor, id, payload) {
  assertCanManageAcademics(actor);
  const existing = await query(`SELECT * FROM school_years WHERE id = $1`, [id]);
  if (!existing.rows[0]) {
    throw new HttpError(404, "School year not found.", "SCHOOL_YEAR_NOT_FOUND");
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    if (payload.isCurrent) {
      await client.query(
        `UPDATE school_years SET is_current = FALSE WHERE is_current AND id <> $1`,
        [id]
      );
    }
    const result = await client.query(
      `UPDATE school_years
       SET name = $1, starts_on = $2, ends_on = $3, is_current = $4
       WHERE id = $5
       RETURNING *`,
      [payload.name, payload.startsOn, payload.endsOn, payload.isCurrent, id]
    );
    await auditService.record({
      client,
      userId: actor.id,
      action: "school_year.updated",
      entityType: "school_year",
      entityId: id,
      districtId: actor.districtId || null,
      ipAddress: actor.ipAddress || null,
      details: {
        name: payload.name,
        is_current: payload.isCurrent,
        previous_name: existing.rows[0].name
      }
    });
    await client.query("COMMIT");
    return serializeSchoolYear(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "That school year already exists.",
        "SCHOOL_YEAR_EXISTS"
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

async function copyStructure(actor, payload) {
  assertCanManageAcademics(actor);
  const school = await schoolForActor(actor, payload.schoolId);
  const fromYear = await query(`SELECT * FROM school_years WHERE id = $1`, [
    payload.fromSchoolYearId
  ]);
  const toYear = await query(`SELECT * FROM school_years WHERE id = $1`, [
    payload.toSchoolYearId
  ]);
  if (!fromYear.rows[0] || !toYear.rows[0]) {
    throw new HttpError(404, "School year not found.", "SCHOOL_YEAR_NOT_FOUND");
  }
  if (Number(fromYear.rows[0].id) === Number(toYear.rows[0].id)) {
    throw new HttpError(
      400,
      "Choose two different school years.",
      "SAME_SCHOOL_YEAR"
    );
  }

  const source = await query(
    `SELECT sec.id, sec.name, sec.room, sec.grade_level_id, gl.name AS grade_level_name,
            sec.adviser_id, u.full_name AS adviser_name
     FROM sections sec
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     LEFT JOIN users u ON u.id = sec.adviser_id
     WHERE sec.school_id = $1 AND sec.school_year_id = $2
     ORDER BY gl.sort_order ASC, sec.name ASC`,
    [school.id, fromYear.rows[0].id]
  );
  const existing = await query(
    `SELECT grade_level_id, name FROM sections
     WHERE school_id = $1 AND school_year_id = $2`,
    [school.id, toYear.rows[0].id]
  );
  const existingKeys = new Set(
    existing.rows.map((row) => `${row.grade_level_id}:${row.name.toLowerCase()}`)
  );

  const preview = source.rows.map((row) => ({
    gradeLevelId: Number(row.grade_level_id),
    gradeLevel: row.grade_level_name,
    name: row.name,
    room: row.room || null,
    adviserId: row.adviser_id ? Number(row.adviser_id) : null,
    adviserName: row.adviser_name || null,
    exists: existingKeys.has(`${row.grade_level_id}:${row.name.toLowerCase()}`)
  }));

  if (payload.dryRun) {
    return {
      dryRun: true,
      fromSchoolYear: serializeSchoolYear(fromYear.rows[0]),
      toSchoolYear: serializeSchoolYear(toYear.rows[0]),
      school: { id: Number(school.id), name: school.school_name },
      sections: preview,
      toCreate: preview.filter((section) => !section.exists).length
    };
  }

  const client = await getClient();
  const created = [];
  try {
    await client.query("BEGIN");
    for (const section of preview) {
      if (section.exists) {
        continue;
      }
      const inserted = await client.query(
        `INSERT INTO sections (
           school_id, school_year_id, grade_level_id, name, adviser_id, room
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          school.id,
          toYear.rows[0].id,
          section.gradeLevelId,
          section.name,
          section.adviserId,
          section.room
        ]
      );
      created.push(Number(inserted.rows[0].id));
      section.exists = true;
    }
    await auditService.record({
      client,
      userId: actor.id,
      action: "school_year.structure_copied",
      entityType: "school_year",
      entityId: toYear.rows[0].id,
      districtId: school.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        school_id: String(school.id),
        school_code: school.school_code,
        from_school_year: fromYear.rows[0].name,
        to_school_year: toYear.rows[0].name,
        created_sections: created.length
      }
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return {
    dryRun: false,
    fromSchoolYear: serializeSchoolYear(fromYear.rows[0]),
    toSchoolYear: serializeSchoolYear(toYear.rows[0]),
    school: { id: Number(school.id), name: school.school_name },
    sections: preview,
    createdCount: created.length
  };
}

/* -------------------------------------------------------------------------- */
/* Grade levels                                                                */
/* -------------------------------------------------------------------------- */

async function listGradeLevels(actor, { schoolId = null } = {}) {
  const params = [];
  const scope = academicScope(actor, params, schoolId);
  const result = await query(
    `SELECT gl.*, sch.school_name,
            (SELECT COUNT(*)::int FROM sections sec WHERE sec.grade_level_id = gl.id) AS section_count,
            (SELECT COUNT(*)::int FROM enrollments e WHERE e.grade_level_id = gl.id) AS learner_count
     FROM grade_levels gl
     JOIN schools sch ON sch.id = gl.school_id
     JOIN districts d ON d.id = sch.district_id
     WHERE ${scope || "TRUE"}
     ORDER BY sch.school_name ASC, gl.sort_order ASC, gl.name ASC`,
    params
  );
  return result.rows.map(serializeGradeLevel);
}

async function createGradeLevel(actor, payload) {
  assertCanManageAcademics(actor);
  const school = await schoolForActor(actor, payload.schoolId);
  try {
    const result = await query(
      `INSERT INTO grade_levels (school_id, name, sort_order)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [school.id, payload.name, payload.sortOrder]
    );
    await auditService.record({
      userId: actor.id,
      action: "grade_level.created",
      entityType: "grade_level",
      entityId: result.rows[0].id,
      districtId: school.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        school_code: school.school_code,
        name: payload.name,
        sort_order: payload.sortOrder
      }
    });
    return serializeGradeLevel(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "That grade level already exists in this school.",
        "GRADE_LEVEL_EXISTS"
      );
    }
    throw error;
  }
}

async function updateGradeLevel(actor, id, payload) {
  assertCanManageAcademics(actor);
  const existing = await query(
    `SELECT gl.*, s.district_id FROM grade_levels gl
     JOIN schools s ON s.id = gl.school_id WHERE gl.id = $1`,
    [id]
  );
  if (!existing.rows[0]) {
    throw new HttpError(404, "Grade level not found.", "GRADE_LEVEL_NOT_FOUND");
  }
  assertSchoolScope(actor, existing.rows[0].school_id, existing.rows[0].district_id);
  try {
    const result = await query(
      `UPDATE grade_levels SET name = $1, sort_order = $2 WHERE id = $3 RETURNING *`,
      [payload.name, payload.sortOrder, id]
    );
    await auditService.record({
      userId: actor.id,
      action: "grade_level.updated",
      entityType: "grade_level",
      entityId: id,
      districtId: existing.rows[0].district_id,
      ipAddress: actor.ipAddress || null,
      details: { name: payload.name, sort_order: payload.sortOrder }
    });
    return serializeGradeLevel(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "That grade level already exists in this school.",
        "GRADE_LEVEL_EXISTS"
      );
    }
    throw error;
  }
}

async function deleteGradeLevel(actor, id) {
  assertCanManageAcademics(actor);
  const existing = await query(
    `SELECT gl.*, s.district_id FROM grade_levels gl
     JOIN schools s ON s.id = gl.school_id WHERE gl.id = $1`,
    [id]
  );
  if (!existing.rows[0]) {
    throw new HttpError(404, "Grade level not found.", "GRADE_LEVEL_NOT_FOUND");
  }
  assertSchoolScope(actor, existing.rows[0].school_id, existing.rows[0].district_id);

  const used = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM sections WHERE grade_level_id = $1) AS sections,
       (SELECT COUNT(*)::int FROM enrollments WHERE grade_level_id = $1) AS enrollments`,
    [id]
  );
  if (used.rows[0].sections > 0 || used.rows[0].enrollments > 0) {
    throw new HttpError(
      409,
      "This grade level is used by sections or learner records and cannot be removed.",
      "GRADE_LEVEL_IN_USE"
    );
  }

  await query(`DELETE FROM grade_levels WHERE id = $1`, [id]);
  await auditService.record({
    userId: actor.id,
    action: "grade_level.removed",
    entityType: "grade_level",
    entityId: id,
    districtId: existing.rows[0].district_id,
    ipAddress: actor.ipAddress || null,
    details: { name: existing.rows[0].name }
  });
  return { id: Number(id) };
}

/* -------------------------------------------------------------------------- */
/* Sections                                                                    */
/* -------------------------------------------------------------------------- */

async function listSections(actor, { schoolId, schoolYearId, gradeLevelId } = {}) {
  const params = [];
  const conditions = [];
  const scope = academicScope(actor, params, schoolId);
  if (scope) {
    conditions.push(scope);
  }
  if (schoolYearId) {
    params.push(schoolYearId);
    conditions.push(`sec.school_year_id = $${params.length}`);
  }
  if (gradeLevelId) {
    params.push(gradeLevelId);
    conditions.push(`sec.grade_level_id = $${params.length}`);
  }
  if (actor.role === "teacher" || actor.role === "adviser") {
    params.push(actor.id);
    conditions.push(`(
      sec.adviser_id = $${params.length}
      OR EXISTS (
        SELECT 1 FROM teacher_assignments ta
        WHERE ta.section_id = sec.id AND ta.teacher_id = $${params.length}
      )
    )`);
  }

  const result = await query(
    `SELECT sec.*, sch.school_name, y.name AS school_year_name,
            gl.name AS grade_level_name, adv.full_name AS adviser_name,
            (SELECT COUNT(*)::int FROM enrollments e
             WHERE e.section_id = sec.id AND e.school_year_id = sec.school_year_id) AS learner_count
     FROM sections sec
     JOIN schools sch ON sch.id = sec.school_id
     JOIN districts d ON d.id = sch.district_id
     JOIN school_years y ON y.id = sec.school_year_id
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     LEFT JOIN users adv ON adv.id = sec.adviser_id
     WHERE ${conditions.length ? conditions.join(" AND ") : "TRUE"}
     ORDER BY y.name DESC, gl.sort_order ASC, sec.name ASC`,
    params
  );
  return result.rows.map(serializeSection);
}

async function sectionForWrite(actor, rawSchoolId, payload) {
  const school = await schoolForActor(actor, rawSchoolId);
  const year = await query(`SELECT * FROM school_years WHERE id = $1`, [
    payload.schoolYearId
  ]);
  if (!year.rows[0]) {
    throw new HttpError(404, "School year not found.", "SCHOOL_YEAR_NOT_FOUND");
  }
  const grade = await query(
    `SELECT * FROM grade_levels WHERE id = $1 AND school_id = $2`,
    [payload.gradeLevelId, school.id]
  );
  if (!grade.rows[0]) {
    throw new HttpError(
      400,
      "That grade level does not belong to the selected school.",
      "GRADE_LEVEL_MISMATCH"
    );
  }
  let adviser = null;
  if (payload.adviserId) {
    adviser = await assertTeacher(actor, payload.adviserId, school.id);
  }
  return { school, year: year.rows[0], grade: grade.rows[0], adviser };
}

async function createSection(actor, payload) {
  assertCanManageAcademics(actor);
  const { school, year, grade, adviser } = await sectionForWrite(
    actor,
    payload.schoolId,
    payload
  );
  try {
    const result = await query(
      `INSERT INTO sections (
         school_id, school_year_id, grade_level_id, name, adviser_id, room
       ) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [school.id, year.id, grade.id, payload.name, adviser ? adviser.id : null, payload.room]
    );
    await auditService.record({
      userId: actor.id,
      action: "section.created",
      entityType: "section",
      entityId: result.rows[0].id,
      districtId: school.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        school_code: school.school_code,
        school_year: year.name,
        grade_level: grade.name,
        name: payload.name
      }
    });
    return serializeSection({
      ...result.rows[0],
      school_name: school.school_name,
      school_year_name: year.name,
      grade_level_name: grade.name,
      adviser_name: adviser ? adviser.full_name : null,
      learner_count: 0
    });
  } catch (error) {
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "A section with that name already exists for this grade level and school year.",
        "SECTION_EXISTS"
      );
    }
    throw error;
  }
}

async function loadSection(actor, id) {
  const result = await query(
    `SELECT sec.*, sch.district_id, sch.school_name
     FROM sections sec
     JOIN schools sch ON sch.id = sec.school_id
     WHERE sec.id = $1`,
    [id]
  );
  const section = result.rows[0];
  if (!section) {
    throw new HttpError(404, "Section not found.", "SECTION_NOT_FOUND");
  }
  assertSchoolScope(actor, section.school_id, section.district_id);
  return section;
}

async function updateSection(actor, id, payload) {
  assertCanManageAcademics(actor);
  const existing = await loadSection(actor, id);
  if (Number(payload.schoolYearId) !== Number(existing.school_year_id)) {
    throw new HttpError(
      400,
      "A section belongs to one school year. Create a new section for another year.",
      "SECTION_YEAR_FIXED"
    );
  }
  if (Number(payload.gradeLevelId) !== Number(existing.grade_level_id)) {
    const { grade } = await sectionForWrite(actor, existing.school_id, {
      schoolYearId: existing.school_year_id,
      gradeLevelId: payload.gradeLevelId
    });
    payload.gradeLevelId = grade.id;
  }
  let adviser = null;
  if (payload.adviserId) {
    adviser = await assertTeacher(actor, payload.adviserId, existing.school_id);
  }

  try {
    await query(
      `UPDATE sections SET
         grade_level_id = $1, name = $2, adviser_id = $3, room = $4
       WHERE id = $5`,
      [payload.gradeLevelId, payload.name, adviser ? adviser.id : null, payload.room, id]
    );
    await auditService.record({
      userId: actor.id,
      action: "section.updated",
      entityType: "section",
      entityId: id,
      districtId: existing.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        school: existing.school_name,
        name: payload.name,
        previous_name: existing.name
      }
    });
    return getSectionById(id);
  } catch (error) {
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "A section with that name already exists for this grade level and school year.",
        "SECTION_EXISTS"
      );
    }
    throw error;
  }
}

async function getSectionById(id) {
  const result = await query(
    `SELECT sec.*, sch.school_name, y.name AS school_year_name,
            gl.name AS grade_level_name, adv.full_name AS adviser_name,
            (SELECT COUNT(*)::int FROM enrollments e
             WHERE e.section_id = sec.id AND e.school_year_id = sec.school_year_id) AS learner_count
     FROM sections sec
     JOIN schools sch ON sch.id = sec.school_id
     JOIN school_years y ON y.id = sec.school_year_id
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     LEFT JOIN users adv ON adv.id = sec.adviser_id
     WHERE sec.id = $1`,
    [id]
  );
  return serializeSection(result.rows[0]);
}

async function deleteSection(actor, id) {
  assertCanManageAcademics(actor);
  const existing = await loadSection(actor, id);
  const used = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM enrollments WHERE section_id = $1) AS enrollments,
       (SELECT COUNT(*)::int FROM teacher_assignments WHERE section_id = $1) AS assignments`,
    [id]
  );
  if (used.rows[0].enrollments > 0 || used.rows[0].assignments > 0) {
    throw new HttpError(
      409,
      "This section has learner records or teacher assignments. Remove those first.",
      "SECTION_IN_USE"
    );
  }
  await query(`DELETE FROM sections WHERE id = $1`, [id]);
  await auditService.record({
    userId: actor.id,
    action: "section.removed",
    entityType: "section",
    entityId: id,
    districtId: existing.district_id,
    ipAddress: actor.ipAddress || null,
    details: { name: existing.name, school_year_id: String(existing.school_year_id) }
  });
  return { id: Number(id) };
}

/* -------------------------------------------------------------------------- */
/* Subjects                                                                    */
/* -------------------------------------------------------------------------- */

async function listSubjects(actor, { schoolId, gradeLevelId } = {}) {
  const params = [];
  const conditions = [];
  const scope = academicScope(actor, params, schoolId);
  if (scope) {
    conditions.push(scope);
  }
  if (gradeLevelId) {
    params.push(gradeLevelId);
    conditions.push(`(subj.grade_level_id = $${params.length} OR subj.grade_level_id IS NULL)`);
  }
  const result = await query(
    `SELECT subj.*, sch.school_name, gl.name AS grade_level_name,
            (SELECT COUNT(*)::int FROM teacher_assignments ta WHERE ta.subject_id = subj.id) AS assignment_count
     FROM subjects subj
     JOIN schools sch ON sch.id = subj.school_id
     JOIN districts d ON d.id = sch.district_id
     LEFT JOIN grade_levels gl ON gl.id = subj.grade_level_id
     WHERE ${conditions.length ? conditions.join(" AND ") : "TRUE"}
     ORDER BY sch.school_name ASC, subj.code ASC`,
    params
  );
  return result.rows.map(serializeSubject);
}

async function subjectForWrite(actor, rawSchoolId, gradeLevelId, schoolIdOverride = null) {
  const school = await schoolForActor(actor, schoolIdOverride || rawSchoolId);
  let grade = null;
  if (gradeLevelId) {
    const result = await query(
      `SELECT * FROM grade_levels WHERE id = $1 AND school_id = $2`,
      [gradeLevelId, school.id]
    );
    if (!result.rows[0]) {
      throw new HttpError(
        400,
        "That grade level does not belong to the selected school.",
        "GRADE_LEVEL_MISMATCH"
      );
    }
    grade = result.rows[0];
  }
  return { school, grade };
}

async function createSubject(actor, payload) {
  assertCanManageAcademics(actor);
  const { school, grade } = await subjectForWrite(
    actor,
    payload.schoolId,
    payload.gradeLevelId
  );
  try {
    const result = await query(
      `INSERT INTO subjects (school_id, code, name, grade_level_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [school.id, payload.code, payload.name, grade ? grade.id : null]
    );
    await auditService.record({
      userId: actor.id,
      action: "subject.created",
      entityType: "subject",
      entityId: result.rows[0].id,
      districtId: school.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        school_code: school.school_code,
        code: payload.code,
        name: payload.name,
        grade_level: grade ? grade.name : null
      }
    });
    return serializeSubject({
      ...result.rows[0],
      school_name: school.school_name,
      grade_level_name: grade ? grade.name : null,
      assignment_count: 0
    });
  } catch (error) {
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "That subject code already exists in this school.",
        "SUBJECT_EXISTS"
      );
    }
    throw error;
  }
}

async function loadSubject(actor, id) {
  const result = await query(
    `SELECT subj.*, sch.district_id, sch.school_name
     FROM subjects subj
     JOIN schools sch ON sch.id = subj.school_id
     WHERE subj.id = $1`,
    [id]
  );
  const subject = result.rows[0];
  if (!subject) {
    throw new HttpError(404, "Subject not found.", "SUBJECT_NOT_FOUND");
  }
  assertSchoolScope(actor, subject.school_id, subject.district_id);
  return subject;
}

async function updateSubject(actor, id, payload) {
  assertCanManageAcademics(actor);
  const existing = await loadSubject(actor, id);
  const { grade } = await subjectForWrite(
    actor,
    existing.school_id,
    payload.gradeLevelId,
    existing.school_id
  );
  try {
    const result = await query(
      `UPDATE subjects SET code = $1, name = $2, grade_level_id = $3
       WHERE id = $4 RETURNING *`,
      [payload.code, payload.name, grade ? grade.id : null, id]
    );
    await auditService.record({
      userId: actor.id,
      action: "subject.updated",
      entityType: "subject",
      entityId: id,
      districtId: existing.district_id,
      ipAddress: actor.ipAddress || null,
      details: { code: payload.code, name: payload.name, previous_code: existing.code }
    });
    return serializeSubject({
      ...result.rows[0],
      school_name: existing.school_name,
      grade_level_name: grade ? grade.name : null
    });
  } catch (error) {
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "That subject code already exists in this school.",
        "SUBJECT_EXISTS"
      );
    }
    throw error;
  }
}

async function deleteSubject(actor, id) {
  assertCanManageAcademics(actor);
  const existing = await loadSubject(actor, id);
  const used = await query(
    `SELECT COUNT(*)::int AS count FROM teacher_assignments WHERE subject_id = $1`,
    [id]
  );
  if (used.rows[0].count > 0) {
    throw new HttpError(
      409,
      "This subject has teacher assignments and cannot be removed.",
      "SUBJECT_IN_USE"
    );
  }
  await query(`DELETE FROM subjects WHERE id = $1`, [id]);
  await auditService.record({
    userId: actor.id,
    action: "subject.removed",
    entityType: "subject",
    entityId: id,
    districtId: existing.district_id,
    ipAddress: actor.ipAddress || null,
    details: { code: existing.code, name: existing.name }
  });
  return { id: Number(id) };
}

/* -------------------------------------------------------------------------- */
/* Teacher assignments                                                         */
/* -------------------------------------------------------------------------- */

const ASSIGNMENT_FROM = `FROM teacher_assignments ta
  JOIN schools sch ON sch.id = ta.school_id
  JOIN districts d ON d.id = sch.district_id
  JOIN school_years y ON y.id = ta.school_year_id
  JOIN sections sec ON sec.id = ta.section_id
  JOIN grade_levels gl ON gl.id = sec.grade_level_id
  JOIN subjects subj ON subj.id = ta.subject_id
  LEFT JOIN users t ON t.id = ta.teacher_id`;

async function listAssignments(actor, filters = {}) {
  const params = [];
  const conditions = [];
  const scope = academicScope(actor, params, filters.schoolId);
  if (scope) {
    conditions.push(scope);
  }
  if (filters.schoolYearId) {
    params.push(filters.schoolYearId);
    conditions.push(`ta.school_year_id = $${params.length}`);
  }
  if (filters.sectionId) {
    params.push(filters.sectionId);
    conditions.push(`ta.section_id = $${params.length}`);
  }
  if (filters.subjectId) {
    params.push(filters.subjectId);
    conditions.push(`ta.subject_id = $${params.length}`);
  }
  if (filters.teacherId) {
    params.push(filters.teacherId);
    conditions.push(`ta.teacher_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(subj.name ILIKE $${params.length} OR subj.code ILIKE $${params.length}
        OR t.full_name ILIKE $${params.length} OR sec.name ILIKE $${params.length})`
    );
  }
  if (actor.role === "teacher" || actor.role === "adviser") {
    params.push(actor.id);
    conditions.push(`(ta.teacher_id = $${params.length} OR sec.adviser_id = $${params.length})`);
  }

  const result = await query(
    `SELECT ta.*, sch.school_name, y.name AS school_year_name,
            sec.name AS section_name, gl.name AS grade_level_name,
            subj.code AS subject_code, subj.name AS subject_name,
            t.full_name AS teacher_name,
            (SELECT COUNT(*)::int FROM class_schedules cs WHERE cs.assignment_id = ta.id) AS schedule_count
     ${ASSIGNMENT_FROM}
     WHERE ${conditions.length ? conditions.join(" AND ") : "TRUE"}
     ORDER BY y.name DESC, gl.sort_order ASC, sec.name ASC, subj.code ASC`,
    params
  );
  return result.rows.map(serializeTeacherAssignment);
}

async function loadAssignment(actor, id) {
  const result = await query(
    `SELECT ta.*, sch.district_id FROM teacher_assignments ta
     JOIN schools sch ON sch.id = ta.school_id
     WHERE ta.id = $1`,
    [id]
  );
  const assignment = result.rows[0];
  if (!assignment) {
    throw new HttpError(404, "Teaching assignment not found.", "ASSIGNMENT_NOT_FOUND");
  }
  assertSchoolScope(actor, assignment.school_id, assignment.district_id);
  return assignment;
}

async function assignmentTargets(actor, payload, existing = null) {
  const school = await schoolForActor(actor, existing ? existing.school_id : payload.schoolId);
  const section = await query(
    `SELECT * FROM sections WHERE id = $1 AND school_id = $2 AND school_year_id = $3`,
    [
      payload.sectionId !== undefined && payload.sectionId !== null
        ? payload.sectionId
        : existing.section_id,
      school.id,
      payload.schoolYearId !== undefined && payload.schoolYearId !== null
        ? payload.schoolYearId
        : existing.school_year_id
    ]
  );
  if (!section.rows[0]) {
    throw new HttpError(
      400,
      "That section does not belong to the selected school year.",
      "SECTION_MISMATCH"
    );
  }
  const subjectId =
    payload.subjectId !== undefined && payload.subjectId !== null
      ? payload.subjectId
      : existing.subject_id;
  const subject = await query(
    `SELECT * FROM subjects WHERE id = $1 AND school_id = $2`,
    [subjectId, school.id]
  );
  if (!subject.rows[0]) {
    throw new HttpError(
      400,
      "That subject does not belong to the selected school.",
      "SUBJECT_MISMATCH"
    );
  }
  let teacher = null;
  if (payload.teacherId) {
    teacher = await assertTeacher(
      actor,
      payload.teacherId,
      school.id,
      "Teacher"
    );
    if (!TEACHING_ROLES.includes(teacher.role)) {
      throw new HttpError(
        400,
        "Teaching assignments can only be given to teaching accounts.",
        "TEACHER_INVALID"
      );
    }
  }
  return { school, section: section.rows[0], subject: subject.rows[0], teacher };
}

async function createAssignment(actor, payload) {
  assertCanManageAcademics(actor);
  const { school, section, subject, teacher } = await assignmentTargets(actor, payload);
  try {
    const result = await query(
      `INSERT INTO teacher_assignments (
         school_id, school_year_id, section_id, subject_id, teacher_id,
         employee_number, remarks
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        school.id,
        section.school_year_id,
        section.id,
        subject.id,
        teacher ? teacher.id : null,
        payload.employeeNumber,
        payload.remarks
      ]
    );
    await auditService.record({
      userId: actor.id,
      action: "assignment.created",
      entityType: "teacher_assignment",
      entityId: result.rows[0].id,
      districtId: school.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        school_code: school.school_code,
        section: section.name,
        subject: subject.code,
        teacher: teacher ? teacher.full_name : null,
        employee_number: payload.employeeNumber
      }
    });
    return serializeTeacherAssignment({
      ...result.rows[0],
      school_name: school.school_name,
      section_name: section.name,
      subject_code: subject.code,
      subject_name: subject.name,
      teacher_name: teacher ? teacher.full_name : null,
      schedule_count: 0
    });
  } catch (error) {
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "That subject is already assigned to this teacher in this section.",
        "ASSIGNMENT_EXISTS"
      );
    }
    throw error;
  }
}

async function updateAssignment(actor, id, payload) {
  assertCanManageAcademics(actor);
  const existing = await loadAssignment(actor, id);
  const { school, section, subject, teacher } = await assignmentTargets(
    actor,
    payload,
    existing
  );
  try {
    const result = await query(
      `UPDATE teacher_assignments SET
         section_id = $1, subject_id = $2, teacher_id = $3,
         employee_number = $4, remarks = $5, school_year_id = $6
       WHERE id = $7
       RETURNING *`,
      [
        section.id,
        subject.id,
        teacher ? teacher.id : null,
        payload.employeeNumber,
        payload.remarks,
        section.school_year_id,
        id
      ]
    );
    await auditService.record({
      userId: actor.id,
      action: "assignment.updated",
      entityType: "teacher_assignment",
      entityId: id,
      districtId: school.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        school_code: school.school_code,
        section: section.name,
        subject: subject.code,
        teacher: teacher ? teacher.full_name : null
      }
    });
    return serializeTeacherAssignment({
      ...result.rows[0],
      school_name: school.school_name,
      section_name: section.name,
      subject_code: subject.code,
      subject_name: subject.name,
      teacher_name: teacher ? teacher.full_name : null
    });
  } catch (error) {
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "That subject is already assigned to this teacher in this section.",
        "ASSIGNMENT_EXISTS"
      );
    }
    throw error;
  }
}

async function deleteAssignment(actor, id) {
  assertCanManageAcademics(actor);
  const existing = await loadAssignment(actor, id);
  const schedules = await query(
    `SELECT COUNT(*)::int AS count FROM class_schedules WHERE assignment_id = $1`,
    [id]
  );
  if (schedules.rows[0].count > 0) {
    throw new HttpError(
      409,
      "Remove this assignment's class schedule first.",
      "ASSIGNMENT_IN_USE"
    );
  }
  await query(`DELETE FROM teacher_assignments WHERE id = $1`, [id]);
  await auditService.record({
    userId: actor.id,
    action: "assignment.removed",
    entityType: "teacher_assignment",
    entityId: id,
    districtId: existing.district_id,
    ipAddress: actor.ipAddress || null,
    details: {
      section_id: String(existing.section_id),
      subject_id: String(existing.subject_id),
      teacher_id: existing.teacher_id ? String(existing.teacher_id) : null
    }
  });
  return { id: Number(id) };
}

/* -------------------------------------------------------------------------- */
/* Class schedules                                                             */
/* -------------------------------------------------------------------------- */

const SCHEDULE_FROM = `FROM class_schedules cs
  JOIN teacher_assignments ta ON ta.id = cs.assignment_id
  JOIN schools sch ON sch.id = ta.school_id
  JOIN districts d ON d.id = sch.district_id
  JOIN school_years y ON y.id = ta.school_year_id
  JOIN sections sec ON sec.id = ta.section_id
  JOIN grade_levels gl ON gl.id = sec.grade_level_id
  JOIN subjects subj ON subj.id = ta.subject_id
  LEFT JOIN users t ON t.id = ta.teacher_id`;

async function listSchedules(actor, filters = {}) {
  const params = [];
  const conditions = [];
  const scope = academicScope(actor, params, filters.schoolId);
  if (scope) {
    conditions.push(scope);
  }
  if (filters.schoolYearId) {
    params.push(filters.schoolYearId);
    conditions.push(`ta.school_year_id = $${params.length}`);
  }
  if (filters.sectionId) {
    params.push(filters.sectionId);
    conditions.push(`ta.section_id = $${params.length}`);
  }
  if (filters.teacherId) {
    params.push(filters.teacherId);
    conditions.push(`ta.teacher_id = $${params.length}`);
  }
  if (filters.dayOfWeek) {
    params.push(filters.dayOfWeek);
    conditions.push(`cs.day_of_week = $${params.length}`);
  }
  if (actor.role === "teacher" || actor.role === "adviser") {
    params.push(actor.id);
    conditions.push(`(ta.teacher_id = $${params.length} OR sec.adviser_id = $${params.length})`);
  }

  const result = await query(
    `SELECT cs.*, ta.school_id, ta.school_year_id, ta.section_id, ta.subject_id,
            ta.teacher_id, sch.school_name, y.name AS school_year_name,
            sec.name AS section_name, gl.name AS grade_level_name,
            subj.code AS subject_code, subj.name AS subject_name,
            t.full_name AS teacher_name
     ${SCHEDULE_FROM}
     WHERE ${conditions.length ? conditions.join(" AND ") : "TRUE"}
     ORDER BY cs.day_of_week ASC, cs.start_time ASC`,
    params
  );
  return result.rows.map(serializeClassSchedule);
}

async function assertSectionAccess(actor, section) {
  assertSchoolScope(actor, section.school_id, section.district_id);
  if (actor.role === "teacher" || actor.role === "adviser") {
    const allowed = await query(
      `SELECT 1 FROM sections sec
       WHERE sec.id = $1
         AND (sec.adviser_id = $2 OR EXISTS (
           SELECT 1 FROM teacher_assignments ta
           WHERE ta.section_id = sec.id AND ta.teacher_id = $2
         ))`,
      [section.id, actor.id]
    );
    if (!allowed.rows[0]) {
      throw new HttpError(
        403,
        "You can only view timetables for sections you advise or teach.",
        "SECTION_FORBIDDEN"
      );
    }
  }
  if (actor.role === "learner") {
    const allowed = await query(
      `SELECT 1 FROM enrollments e
       JOIN learners l ON l.id = e.learner_id
       WHERE l.user_id = $1 AND e.section_id = $2`,
      [actor.id, section.id]
    );
    if (!allowed.rows[0]) {
      throw new HttpError(
        403,
        "You can only view the timetable of your own section.",
        "SECTION_FORBIDDEN"
      );
    }
  }
}

async function getTimetable(actor, sectionId) {
  const sectionResult = await query(
    `SELECT sec.*, sch.school_name, sch.district_id, y.name AS school_year_name,
            gl.name AS grade_level_name, adv.full_name AS adviser_name
     FROM sections sec
     JOIN schools sch ON sch.id = sec.school_id
     JOIN school_years y ON y.id = sec.school_year_id
     JOIN grade_levels gl ON gl.id = sec.grade_level_id
     LEFT JOIN users adv ON adv.id = sec.adviser_id
     WHERE sec.id = $1`,
    [sectionId]
  );
  const section = sectionResult.rows[0];
  if (!section) {
    throw new HttpError(404, "Section not found.", "SECTION_NOT_FOUND");
  }
  await assertSectionAccess(actor, section);
  const schedules = await listSchedules(actor, { sectionId });
  const days = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
    dayOfWeek: day,
    dayName: DAY_NAMES[day],
    entries: schedules
      .filter((entry) => entry.dayOfWeek === day)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
  }));
  return {
    section: serializeSection({
      ...section,
      school_name: section.school_name,
      school_year_name: section.school_year_name,
      grade_level_name: section.grade_level_name,
      adviser_name: section.adviser_name
    }),
    days
  };
}

function normalizeTime(value, field) {
  const text = String(value || "").trim();
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/.test(text)) {
    throw new HttpError(400, `${field} must use the HH:MM 24-hour format.`, "VALIDATION_ERROR", {
      field
    });
  }
  return text.length === 5 ? `${text}:00` : text;
}

async function findScheduleConflicts({
  dayOfWeek,
  startTime,
  endTime,
  sectionId,
  teacherId,
  excludeId = null
}) {
  const params = [dayOfWeek, startTime, endTime, sectionId];
  let teacherClause = "";
  if (teacherId) {
    params.push(teacherId);
    teacherClause = ` OR ta.teacher_id = $${params.length}`;
  }
  if (excludeId) {
    params.push(excludeId);
  }
  const result = await query(
    `SELECT cs.id, cs.day_of_week, cs.start_time, cs.end_time,
            sec.name AS section_name, subj.code AS subject_code,
            t.full_name AS teacher_name
     FROM class_schedules cs
     JOIN teacher_assignments ta ON ta.id = cs.assignment_id
     JOIN sections sec ON sec.id = ta.section_id
     JOIN subjects subj ON subj.id = ta.subject_id
     LEFT JOIN users t ON t.id = ta.teacher_id
     WHERE cs.day_of_week = $1
       AND cs.start_time < $3::time
       AND cs.end_time > $2::time
       AND (ta.section_id = $4${teacherClause})
       ${excludeId ? `AND cs.id <> $${params.length}` : ""}`,
    params
  );
  return result.rows;
}

async function scheduleTargets(actor, assignmentId) {
  const result = await query(
    `SELECT ta.*, sec.name AS section_name, sec.school_id, sch.district_id,
            subj.code AS subject_code
     FROM teacher_assignments ta
     JOIN sections sec ON sec.id = ta.section_id
     JOIN schools sch ON sch.id = sec.school_id
     JOIN subjects subj ON subj.id = ta.subject_id
     WHERE ta.id = $1`,
    [assignmentId]
  );
  const assignment = result.rows[0];
  if (!assignment) {
    throw new HttpError(404, "Teaching assignment not found.", "ASSIGNMENT_NOT_FOUND");
  }
  assertSchoolScope(actor, assignment.school_id, assignment.district_id);
  return assignment;
}

async function createSchedule(actor, payload) {
  assertCanManageAcademics(actor);
  const assignment = await scheduleTargets(actor, payload.assignmentId);
  const startTime = normalizeTime(payload.startTime, "Start time");
  const endTime = normalizeTime(payload.endTime, "End time");
  if (endTime <= startTime) {
    throw new HttpError(400, "End time must be after the start time.", "VALIDATION_ERROR", {
      field: "endTime"
    });
  }
  const conflicts = await findScheduleConflicts({
    dayOfWeek: payload.dayOfWeek,
    startTime,
    endTime,
    sectionId: assignment.section_id,
    teacherId: assignment.teacher_id
  });
  if (conflicts.length) {
    throw new HttpError(
      409,
      "That time overlaps an existing class for this section or teacher.",
      "SCHEDULE_CONFLICT",
      { conflicts }
    );
  }
  const result = await query(
    `INSERT INTO class_schedules (
       assignment_id, day_of_week, start_time, end_time, room, remarks
     ) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      payload.assignmentId,
      payload.dayOfWeek,
      startTime,
      endTime,
      payload.room,
      payload.remarks
    ]
  );
  await auditService.record({
    userId: actor.id,
    action: "schedule.created",
    entityType: "class_schedule",
    entityId: result.rows[0].id,
    districtId: assignment.district_id,
    ipAddress: actor.ipAddress || null,
    details: {
      section: assignment.section_name,
      subject: assignment.subject_code,
      day_of_week: payload.dayOfWeek,
      start_time: startTime,
      end_time: endTime
    }
  });
  return result.rows[0];
}

async function updateSchedule(actor, id, payload) {
  assertCanManageAcademics(actor);
  const existing = await query(
    `SELECT cs.*, ta.section_id, ta.teacher_id, ta.school_id, sch.district_id,
            sec.name AS section_name, subj.code AS subject_code
     FROM class_schedules cs
     JOIN teacher_assignments ta ON ta.id = cs.assignment_id
     JOIN sections sec ON sec.id = ta.section_id
     JOIN schools sch ON sch.id = ta.school_id
     JOIN subjects subj ON subj.id = ta.subject_id
     WHERE cs.id = $1`,
    [id]
  );
  if (!existing.rows[0]) {
    throw new HttpError(404, "Class schedule not found.", "SCHEDULE_NOT_FOUND");
  }
  const current = existing.rows[0];
  assertSchoolScope(actor, current.school_id, current.district_id);

  const startTime = normalizeTime(payload.startTime, "Start time");
  const endTime = normalizeTime(payload.endTime, "End time");
  if (endTime <= startTime) {
    throw new HttpError(400, "End time must be after the start time.", "VALIDATION_ERROR", {
      field: "endTime"
    });
  }
  const conflicts = await findScheduleConflicts({
    dayOfWeek: payload.dayOfWeek,
    startTime,
    endTime,
    sectionId: current.section_id,
    teacherId: current.teacher_id,
    excludeId: id
  });
  if (conflicts.length) {
    throw new HttpError(
      409,
      "That time overlaps an existing class for this section or teacher.",
      "SCHEDULE_CONFLICT",
      { conflicts }
    );
  }

  const result = await query(
    `UPDATE class_schedules SET
       day_of_week = $1, start_time = $2, end_time = $3, room = $4, remarks = $5
     WHERE id = $6
     RETURNING *`,
    [payload.dayOfWeek, startTime, endTime, payload.room, payload.remarks, id]
  );
  await auditService.record({
    userId: actor.id,
    action: "schedule.updated",
    entityType: "class_schedule",
    entityId: id,
    districtId: current.district_id,
    ipAddress: actor.ipAddress || null,
    details: {
      section: current.section_name,
      subject: current.subject_code,
      day_of_week: payload.dayOfWeek,
      start_time: startTime,
      end_time: endTime
    }
  });
  return result.rows[0];
}

async function deleteSchedule(actor, id) {
  assertCanManageAcademics(actor);
  const existing = await query(
    `SELECT cs.*, sch.district_id, sec.name AS section_name, subj.code AS subject_code
     FROM class_schedules cs
     JOIN teacher_assignments ta ON ta.id = cs.assignment_id
     JOIN sections sec ON sec.id = ta.section_id
     JOIN schools sch ON sch.id = ta.school_id
     JOIN subjects subj ON subj.id = ta.subject_id
     WHERE cs.id = $1`,
    [id]
  );
  if (!existing.rows[0]) {
    throw new HttpError(404, "Class schedule not found.", "SCHEDULE_NOT_FOUND");
  }
  const current = existing.rows[0];
  assertSchoolScope(actor, current.school_id, current.district_id);
  await query(`DELETE FROM class_schedules WHERE id = $1`, [id]);
  await auditService.record({
    userId: actor.id,
    action: "schedule.removed",
    entityType: "class_schedule",
    entityId: id,
    districtId: current.district_id,
    ipAddress: actor.ipAddress || null,
    details: {
      section: current.section_name,
      subject: current.subject_code,
      day_of_week: current.day_of_week
    }
  });
  return { id: Number(id) };
}

/* -------------------------------------------------------------------------- */
/* Teaching personnel picker                                                   */
/* -------------------------------------------------------------------------- */

async function listTeachers(actor, { schoolId } = {}) {
  const school = await schoolForActor(actor, schoolId);
  const result = await query(
    `SELECT u.id, u.full_name, u.role, u.email, u.username,
            (SELECT ta.employee_number FROM teacher_assignments ta
             WHERE ta.teacher_id = u.id AND ta.employee_number IS NOT NULL
             ORDER BY ta.updated_at DESC LIMIT 1) AS employee_number,
            (SELECT COUNT(*)::int FROM teacher_assignments ta
             WHERE ta.teacher_id = u.id) AS assignment_count
     FROM users u
     WHERE u.school_id = $1
       AND u.is_active AND u.approval_status = 'active'
       AND u.role IN ('teacher', 'adviser', 'school_head')
     ORDER BY u.full_name ASC`,
    [school.id]
  );
  return result.rows.map((row) => ({
    id: Number(row.id),
    fullName: row.full_name,
    role: row.role,
    email: row.email,
    username: row.username,
    employeeNumber: row.employee_number || null,
    assignmentCount: row.assignment_count
  }));
}

module.exports = {
  DAY_NAMES,
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
  getTimetable,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  listTeachers
};
