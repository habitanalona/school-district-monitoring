"use strict";

const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const {
  serializeLearner,
  serializeGuardian,
  serializeEnrollment,
  serializeLearnerActivity,
  serializeLearnerDocument,
  serializeAudit
} = require("../utils/serializers");
const {
  learnerScopeSql,
  assertCanManageLearners,
  assertCanManageActivities,
  assertSchoolScope
} = require("../utils/learnerAccess");
const auditService = require("./auditService");
const { calculateAge } = require("../utils/age");

const ENROLLMENT_STATUSES = [
  "enrolled",
  "transferred_in",
  "transferred_out",
  "promoted",
  "retained",
  "completed",
  "archived"
];

const SORT_COLUMNS = {
  name: "l.last_name",
  lrn: "l.lrn",
  grade: "ce.enrollment_grade_sort",
  section: "ce.enrollment_section_name",
  status: "ce.enrollment_status",
  updated: "l.updated_at"
};

// Mirrors the "missing profile fields" logic in serializeLearner so the list,
// dashboard count, and incomplete-profile report always agree.
const PROFILE_COMPLETE_SQL = `(
  l.barangay IS NOT NULL
  AND l.municipality IS NOT NULL
  AND l.province IS NOT NULL
  AND l.region IS NOT NULL
  AND l.zip_code IS NOT NULL
  AND (l.contact_number IS NOT NULL OR l.email IS NOT NULL)
  AND EXISTS (SELECT 1 FROM guardians g WHERE g.learner_id = l.id)
)`;

const ENROLLMENT_COLUMNS = `e.id, e.learner_id, e.school_id, e.school_year_id,
  y.name AS school_year_name, y.is_current,
  e.grade_level_id, gl.name AS grade_level_name,
  e.section_id, sec.name AS section_name,
  COALESCE(e.adviser_id, sec.adviser_id) AS adviser_id,
  adv.full_name AS adviser_name,
  e.enrollment_date, e.status, e.remarks, e.created_at, e.updated_at`;

const ENROLLMENT_JOINS = `JOIN school_years y ON y.id = e.school_year_id
  JOIN grade_levels gl ON gl.id = e.grade_level_id
  LEFT JOIN sections sec ON sec.id = e.section_id
  LEFT JOIN users adv ON adv.id = COALESCE(e.adviser_id, sec.adviser_id)`;

function isoDateValue(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

async function resolveCurrentSchoolYear() {
  const result = await query(
    `SELECT * FROM school_years ORDER BY is_current DESC, name DESC LIMIT 1`
  );
  return result.rows[0] || null;
}

async function findSchoolYearOrThrow(id) {
  const result = await query(`SELECT * FROM school_years WHERE id = $1`, [id]);
  if (!result.rows[0]) {
    throw new HttpError(404, "School year not found.", "SCHOOL_YEAR_NOT_FOUND");
  }
  return result.rows[0];
}

async function findLearnerRow(id) {
  const result = await query(
    `SELECT l.*, s.district_id
     FROM learners l
     JOIN schools s ON s.id = l.school_id
     WHERE l.id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

function assertLearnerWritable(actor, learner) {
  assertCanManageLearners(actor);
  assertSchoolScope(actor, learner.school_id, learner.district_id);
  if (learner.archived_at) {
    throw new HttpError(
      409,
      "This learner record is archived. Restore it before making changes.",
      "LEARNER_ARCHIVED"
    );
  }
}

async function loadLearnerForWrite(actor, id) {
  const learner = await findLearnerRow(id);
  if (!learner) {
    throw new HttpError(404, "Learner not found.", "LEARNER_NOT_FOUND");
  }
  assertLearnerWritable(actor, learner);
  return learner;
}

async function assertLrnAvailable(lrn, excludeId = null) {
  const result = await query(
    `SELECT id FROM learners
     WHERE lrn = $1 AND ($2::bigint IS NULL OR id <> $2)`,
    [lrn, excludeId]
  );
  if (result.rows[0]) {
    throw new HttpError(
      409,
      "That LRN is already registered to another learner.",
      "LRN_IN_USE"
    );
  }
}

async function schoolForActor(actor, schoolId) {
  const result = await query(
    `SELECT s.id, s.school_name, s.school_code, s.district_id, d.district_name
     FROM schools s
     JOIN districts d ON d.id = s.district_id
     WHERE s.id = $1`,
    [schoolId]
  );
  const school = result.rows[0];
  if (!school) {
    throw new HttpError(404, "School not found.", "SCHOOL_NOT_FOUND");
  }
  assertSchoolScope(actor, school.id, school.district_id);
  return school;
}

function listConditions(actor, filters) {
  const params = [];
  const conditions = [];
  const scope = learnerScopeSql(actor, "l", params);
  if (scope) {
    conditions.push(scope);
  }

  if (filters.status === "archived") {
    conditions.push("l.archived_at IS NOT NULL");
  } else if (filters.status !== "all") {
    conditions.push("l.archived_at IS NULL");
  }

  if (filters.schoolId) {
    params.push(filters.schoolId);
    conditions.push(`l.school_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(l.lrn ILIKE $${params.length}
        OR concat_ws(' ', l.first_name, l.middle_name, l.last_name, l.extension_name) ILIKE $${params.length}
        OR l.email ILIKE $${params.length})`
    );
  }
  if (filters.gradeLevelId) {
    params.push(filters.gradeLevelId);
    conditions.push(`ce.enrollment_grade_level_id = $${params.length}`);
  }
  if (filters.sectionId) {
    params.push(filters.sectionId);
    conditions.push(`ce.enrollment_section_id = $${params.length}`);
  }
  if (filters.adviserId) {
    params.push(filters.adviserId);
    conditions.push(`ce.enrollment_adviser_id = $${params.length}`);
  }
  if (filters.enrollmentStatus) {
    params.push(filters.enrollmentStatus);
    conditions.push(`ce.enrollment_status = $${params.length}`);
  }
  return { params, where: conditions.length ? conditions.join(" AND ") : "TRUE" };
}

async function listLearners(actor, filters) {
  const year = filters.schoolYearId
    ? await findSchoolYearOrThrow(filters.schoolYearId)
    : await resolveCurrentSchoolYear();
  if (!year) {
    throw new HttpError(
      400,
      "Create a school year before viewing learner records.",
      "SCHOOL_YEAR_REQUIRED"
    );
  }

  const { params, where } = listConditions(actor, filters);
  const lateralParams = [Number(year.id), ...params];
  // Rebuild placeholders because the year is bound first.
  const shifted = where.replace(/\$(\d+)/g, (match, index) => `$${Number(index) + 1}`);
  const lateral = `LEFT JOIN LATERAL (
      SELECT e.id AS enrollment_id,
             e.school_year_id AS enrollment_year_id,
             y.name AS enrollment_year_name,
             e.grade_level_id AS enrollment_grade_level_id,
             gl.name AS enrollment_grade_level,
             gl.sort_order AS enrollment_grade_sort,
             e.section_id AS enrollment_section_id,
             sec.name AS enrollment_section_name,
             COALESCE(e.adviser_id, sec.adviser_id) AS enrollment_adviser_id,
             adv.full_name AS enrollment_adviser_name,
             e.status AS enrollment_status
      FROM enrollments e
      JOIN school_years y ON y.id = e.school_year_id
      JOIN grade_levels gl ON gl.id = e.grade_level_id
      LEFT JOIN sections sec ON sec.id = e.section_id
      LEFT JOIN users adv ON adv.id = COALESCE(e.adviser_id, sec.adviser_id)
      WHERE e.learner_id = l.id AND e.school_year_id = $1
      LIMIT 1
    ) ce ON TRUE`;

  const fromSql = `FROM learners l
    JOIN schools s ON s.id = l.school_id
    JOIN districts d ON d.id = l.district_id
    ${lateral}
    WHERE ${shifted}`;

  const sortColumn = SORT_COLUMNS[filters.sort] || SORT_COLUMNS.name;
  const direction = filters.direction === "desc" ? "DESC" : "ASC";
  const orderBy =
    filters.sort === "name" || !filters.sort
      ? `l.last_name ${direction}, l.first_name ${direction}, l.id ASC`
      : `${sortColumn} ${direction} NULLS LAST, l.id ${direction}`;

  const countResult = await query(
    `SELECT COUNT(*)::int AS total ${fromSql}`,
    lateralParams
  );
  const dataResult = await query(
    `SELECT l.*, s.school_name, s.school_code, d.district_name,
            EXISTS (SELECT 1 FROM guardians g WHERE g.learner_id = l.id) AS has_guardian,
            ce.enrollment_id, ce.enrollment_year_id, ce.enrollment_year_name,
            ce.enrollment_grade_level_id, ce.enrollment_grade_level,
            ce.enrollment_section_id, ce.enrollment_section_name,
            ce.enrollment_adviser_id, ce.enrollment_adviser_name, ce.enrollment_status
     ${fromSql}
     ORDER BY ${orderBy}
     LIMIT $${lateralParams.length + 1} OFFSET $${lateralParams.length + 2}`,
    [...lateralParams, filters.pageSize, (filters.page - 1) * filters.pageSize]
  );

  return {
    learners: dataResult.rows.map(serializeLearner),
    total: countResult.rows[0].total,
    page: filters.page,
    pageSize: filters.pageSize,
    schoolYear: {
      id: Number(year.id),
      name: year.name,
      isCurrent: Boolean(year.is_current)
    }
  };
}

async function findLearnerScoped(actor, id) {
  const params = [id];
  const scope = learnerScopeSql(actor, "l", params);
  const result = await query(
    `SELECT l.*, s.school_name, s.school_code, d.district_name,
            EXISTS (SELECT 1 FROM guardians g WHERE g.learner_id = l.id) AS has_guardian,
            u.full_name AS created_by_name
     FROM learners l
     JOIN schools s ON s.id = l.school_id
     JOIN districts d ON d.id = l.district_id
     LEFT JOIN users u ON u.id = l.created_by
     WHERE l.id = $1 ${scope ? `AND ${scope}` : ""}`,
    params
  );
  return result.rows[0] || null;
}

async function getLearnerDetail(actor, id) {
  const row = await findLearnerScoped(actor, id);
  if (!row) {
    throw new HttpError(404, "Learner not found.", "LEARNER_NOT_FOUND");
  }

  const [guardians, enrollments, activities, documents, history] = await Promise.all([
    query(
      `SELECT * FROM guardians WHERE learner_id = $1
       ORDER BY is_primary DESC, created_at ASC`,
      [id]
    ),
    query(
      `SELECT ${ENROLLMENT_COLUMNS}
       FROM enrollments e
       ${ENROLLMENT_JOINS}
       WHERE e.learner_id = $1
       ORDER BY y.name DESC`,
      [id]
    ),
    query(
      `SELECT la.*, a.name, a.category, a.organization, a.school_year_id,
              a.participation_level, a.start_date, a.end_date,
              a.achievement AS activity_achievement, y.name AS school_year_name,
              adv.full_name AS adviser_name
       FROM learner_activities la
       JOIN activities a ON a.id = la.activity_id
       JOIN school_years y ON y.id = a.school_year_id
       LEFT JOIN users adv ON adv.id = a.adviser_id
       WHERE la.learner_id = $1
       ORDER BY y.name DESC, a.start_date DESC NULLS LAST`,
      [id]
    ),
    query(
      `SELECT d.id, d.learner_id, d.school_year_id, d.title, d.document_type,
              d.file_name, d.mime_type, d.byte_size, d.uploaded_by, d.created_at,
              y.name AS school_year_name, u.full_name AS uploaded_by_name
       FROM learner_documents d
       LEFT JOIN school_years y ON y.id = d.school_year_id
       LEFT JOIN users u ON u.id = d.uploaded_by
       WHERE d.learner_id = $1
       ORDER BY d.created_at DESC`,
      [id]
    ),
    query(
      `SELECT a.*, u.full_name AS user_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE (a.entity_type = 'learner' AND a.entity_id = $1::text)
          OR a.details->>'learner_id' = $1::text
       ORDER BY a.created_at DESC, a.id DESC
       LIMIT 100`,
      [id]
    )
  ]);

  const learner = serializeLearner(row);
  const enrollmentList = enrollments.rows.map(serializeEnrollment);
  const current =
    enrollmentList.find((entry) => entry.isCurrentYear) ||
    enrollmentList[0] ||
    null;
  if (current) {
    learner.currentEnrollment = {
      id: current.id,
      schoolYearId: current.schoolYearId,
      schoolYearName: current.schoolYearName,
      gradeLevelId: current.gradeLevelId,
      gradeLevel: current.gradeLevel,
      sectionId: current.sectionId,
      sectionName: current.sectionName,
      adviserId: current.adviserId,
      adviserName: current.adviserName,
      status: current.status
    };
  }

  return {
    learner,
    guardians: guardians.rows.map(serializeGuardian),
    enrollments: enrollmentList,
    activities: activities.rows.map(serializeLearnerActivity),
    documents: documents.rows.map(serializeLearnerDocument),
    history: history.rows.map(serializeAudit)
  };
}

function learnerSnapshot(learner) {
  return {
    lrn: learner.lrn,
    name: [learner.first_name, learner.middle_name, learner.last_name, learner.extension_name]
      .filter(Boolean)
      .join(" ")
  };
}

async function createLearner(actor, payload) {
  assertCanManageLearners(actor);
  const school = await schoolForActor(actor, payload.schoolId);
  await assertLrnAvailable(payload.lrn);

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO learners (
         lrn, last_name, first_name, middle_name, extension_name, birth_date, sex,
         weight_kg, height_cm, house_number, barangay, municipality, province,
         region, zip_code, contact_number, email, school_id, district_id, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING id`,
      [
        payload.lrn,
        payload.lastName,
        payload.firstName,
        payload.middleName,
        payload.extensionName,
        payload.birthDate,
        payload.sex,
        payload.weightKg,
        payload.heightCm,
        payload.houseNumber,
        payload.barangay,
        payload.municipality,
        payload.province,
        payload.region,
        payload.zipCode,
        payload.contactNumber,
        payload.email,
        school.id,
        school.district_id,
        actor.id
      ]
    );
    const id = Number(result.rows[0].id);
    await auditService.record({
      client,
      userId: actor.id,
      action: "learner.created",
      entityType: "learner",
      entityId: id,
      districtId: school.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        learner_id: String(id),
        ...learnerSnapshot({
          lrn: payload.lrn,
          first_name: payload.firstName,
          middle_name: payload.middleName,
          last_name: payload.lastName,
          extension_name: payload.extensionName
        }),
        school_code: school.school_code
      }
    });
    await client.query("COMMIT");
    return getLearnerDetail(actor, id);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "That LRN is already registered to another learner.",
        "LRN_IN_USE"
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

async function updateLearner(actor, id, payload) {
  const existing = await loadLearnerForWrite(actor, id);
  const school = await schoolForActor(actor, payload.schoolId || existing.school_id);
  if (payload.lrn !== existing.lrn) {
    await assertLrnAvailable(payload.lrn, id);
  }

  const changedFields = [
    ["lrn", payload.lrn],
    ["last_name", payload.lastName],
    ["first_name", payload.firstName],
    ["middle_name", payload.middleName],
    ["extension_name", payload.extensionName],
    ["birth_date", payload.birthDate],
    ["sex", payload.sex],
    ["weight_kg", payload.weightKg],
    ["height_cm", payload.heightCm],
    ["house_number", payload.houseNumber],
    ["barangay", payload.barangay],
    ["municipality", payload.municipality],
    ["province", payload.province],
    ["region", payload.region],
    ["zip_code", payload.zipCode],
    ["contact_number", payload.contactNumber],
    ["email", payload.email],
    ["school_id", school.id]
  ]
    .filter(([field, value]) => String(existing[field] ?? "") !== String(value ?? ""))
    .map(([field]) => field);

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE learners SET
         lrn = $1,
         last_name = $2,
         first_name = $3,
         middle_name = $4,
         extension_name = $5,
         birth_date = $6,
         sex = $7,
         weight_kg = $8,
         height_cm = $9,
         house_number = $10,
         barangay = $11,
         municipality = $12,
         province = $13,
         region = $14,
         zip_code = $15,
         contact_number = $16,
         email = $17,
         school_id = $18,
         district_id = $19
       WHERE id = $20`,
      [
        payload.lrn,
        payload.lastName,
        payload.firstName,
        payload.middleName,
        payload.extensionName,
        payload.birthDate,
        payload.sex,
        payload.weightKg,
        payload.heightCm,
        payload.houseNumber,
        payload.barangay,
        payload.municipality,
        payload.province,
        payload.region,
        payload.zipCode,
        payload.contactNumber,
        payload.email,
        school.id,
        school.district_id,
        id
      ]
    );
    await auditService.record({
      client,
      userId: actor.id,
      action: "learner.updated",
      entityType: "learner",
      entityId: id,
      districtId: school.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        learner_id: String(id),
        lrn: payload.lrn,
        fields: changedFields
      }
    });
    await client.query("COMMIT");
    return getLearnerDetail(actor, id);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "That LRN is already registered to another learner.",
        "LRN_IN_USE"
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

async function setArchived(actor, id, archived) {
  const existing = await findLearnerRow(id);
  if (!existing) {
    throw new HttpError(404, "Learner not found.", "LEARNER_NOT_FOUND");
  }
  assertCanManageLearners(actor);
  assertSchoolScope(actor, existing.school_id, existing.district_id);

  if (Boolean(existing.archived_at) === archived) {
    throw new HttpError(
      409,
      archived ? "This learner is already archived." : "This learner is not archived.",
      archived ? "LEARNER_ALREADY_ARCHIVED" : "LEARNER_NOT_ARCHIVED"
    );
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      archived
        ? `UPDATE learners SET archived_at = now() WHERE id = $1`
        : `UPDATE learners SET archived_at = NULL WHERE id = $1`,
      [id]
    );
    await auditService.record({
      client,
      userId: actor.id,
      action: archived ? "learner.archived" : "learner.restored",
      entityType: "learner",
      entityId: id,
      districtId: existing.district_id,
      ipAddress: actor.ipAddress || null,
      details: { learner_id: String(id), lrn: existing.lrn }
    });
    await client.query("COMMIT");
    return getLearnerDetail(actor, id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function archiveLearner(actor, id) {
  return setArchived(actor, id, true);
}

async function restoreLearner(actor, id) {
  return setArchived(actor, id, false);
}

async function getLearnerHistory(actor, id) {
  const row = await findLearnerScoped(actor, id);
  if (!row) {
    throw new HttpError(404, "Learner not found.", "LEARNER_NOT_FOUND");
  }
  const result = await query(
    `SELECT a.*, u.full_name AS user_name
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE (a.entity_type = 'learner' AND a.entity_id = $1::text)
        OR a.details->>'learner_id' = $1::text
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT 200`,
    [id]
  );
  return result.rows.map(serializeAudit);
}

/* -------------------------------------------------------------------------- */
/* Guardians                                                                   */
/* -------------------------------------------------------------------------- */

async function createGuardian(actor, learnerId, payload) {
  const learner = await loadLearnerForWrite(actor, learnerId);
  const client = await getClient();
  try {
    await client.query("BEGIN");
    if (payload.isPrimary) {
      await client.query(`UPDATE guardians SET is_primary = FALSE WHERE learner_id = $1`, [
        learnerId
      ]);
    }
    const result = await client.query(
      `INSERT INTO guardians (
         learner_id, full_name, relationship, contact_number, email, address,
         occupation, is_primary, is_emergency
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        learnerId,
        payload.fullName,
        payload.relationship,
        payload.contactNumber,
        payload.email,
        payload.address,
        payload.occupation,
        payload.isPrimary,
        payload.isEmergency
      ]
    );
    await auditService.record({
      client,
      userId: actor.id,
      action: "guardian.created",
      entityType: "guardian",
      entityId: result.rows[0].id,
      districtId: learner.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        learner_id: String(learnerId),
        lrn: learner.lrn,
        relationship: payload.relationship,
        is_primary: payload.isPrimary
      }
    });
    await client.query("COMMIT");
    return serializeGuardian(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function findGuardian(learnerId, guardianId) {
  const result = await query(
    `SELECT * FROM guardians WHERE id = $1 AND learner_id = $2`,
    [guardianId, learnerId]
  );
  return result.rows[0] || null;
}

async function updateGuardian(actor, learnerId, guardianId, payload) {
  const learner = await loadLearnerForWrite(actor, learnerId);
  const existing = await findGuardian(learnerId, guardianId);
  if (!existing) {
    throw new HttpError(404, "Parent or guardian not found.", "GUARDIAN_NOT_FOUND");
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    if (payload.isPrimary && !existing.is_primary) {
      await client.query(`UPDATE guardians SET is_primary = FALSE WHERE learner_id = $1`, [
        learnerId
      ]);
    }
    const result = await client.query(
      `UPDATE guardians SET
         full_name = $1, relationship = $2, contact_number = $3, email = $4,
         address = $5, occupation = $6, is_primary = $7, is_emergency = $8
       WHERE id = $9 AND learner_id = $10
       RETURNING *`,
      [
        payload.fullName,
        payload.relationship,
        payload.contactNumber,
        payload.email,
        payload.address,
        payload.occupation,
        payload.isPrimary,
        payload.isEmergency,
        guardianId,
        learnerId
      ]
    );
    await auditService.record({
      client,
      userId: actor.id,
      action: "guardian.updated",
      entityType: "guardian",
      entityId: guardianId,
      districtId: learner.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        learner_id: String(learnerId),
        lrn: learner.lrn,
        relationship: payload.relationship,
        is_primary: payload.isPrimary
      }
    });
    await client.query("COMMIT");
    return serializeGuardian(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deleteGuardian(actor, learnerId, guardianId) {
  const learner = await loadLearnerForWrite(actor, learnerId);
  const existing = await findGuardian(learnerId, guardianId);
  if (!existing) {
    throw new HttpError(404, "Parent or guardian not found.", "GUARDIAN_NOT_FOUND");
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM guardians WHERE id = $1 AND learner_id = $2`, [
      guardianId,
      learnerId
    ]);
    await auditService.record({
      client,
      userId: actor.id,
      action: "guardian.removed",
      entityType: "guardian",
      entityId: guardianId,
      districtId: learner.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        learner_id: String(learnerId),
        lrn: learner.lrn,
        full_name: existing.full_name
      }
    });
    await client.query("COMMIT");
    return { id: Number(guardianId) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/* -------------------------------------------------------------------------- */
/* School year folders (enrollments)                                           */
/* -------------------------------------------------------------------------- */

async function resolveEnrollmentTargets(learner, payload) {
  const year = await findSchoolYearOrThrow(payload.schoolYearId);
  const grade = await query(
    `SELECT * FROM grade_levels WHERE id = $1 AND school_id = $2`,
    [payload.gradeLevelId, learner.school_id]
  );
  if (!grade.rows[0]) {
    throw new HttpError(
      400,
      "That grade level does not belong to the learner's school.",
      "GRADE_LEVEL_MISMATCH"
    );
  }

  let section = null;
  if (payload.sectionId) {
    const result = await query(
      `SELECT * FROM sections
       WHERE id = $1 AND school_id = $2 AND school_year_id = $3 AND grade_level_id = $4`,
      [payload.sectionId, learner.school_id, year.id, grade.rows[0].id]
    );
    if (!result.rows[0]) {
      throw new HttpError(
        400,
        "That section does not belong to the selected school year and grade level.",
        "SECTION_MISMATCH"
      );
    }
    section = result.rows[0];
  }

  return { year, grade: grade.rows[0], section };
}

async function createEnrollment(actor, learnerId, payload) {
  const learner = await loadLearnerForWrite(actor, learnerId);
  const targets = await resolveEnrollmentTargets(learner, payload);
  const adviserId = payload.adviserId || (targets.section ? targets.section.adviser_id : null);

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO enrollments (
         learner_id, school_id, school_year_id, grade_level_id, section_id,
         adviser_id, enrollment_date, status, remarks
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        learnerId,
        learner.school_id,
        targets.year.id,
        targets.grade.id,
        targets.section ? targets.section.id : null,
        adviserId,
        payload.enrollmentDate,
        payload.status,
        payload.remarks
      ]
    );
    const id = Number(result.rows[0].id);
    await auditService.record({
      client,
      userId: actor.id,
      action: "enrollment.created",
      entityType: "enrollment",
      entityId: id,
      districtId: learner.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        learner_id: String(learnerId),
        lrn: learner.lrn,
        school_year: targets.year.name,
        grade_level: targets.grade.name,
        section: targets.section ? targets.section.name : null
      }
    });
    await client.query("COMMIT");
    return getLearnerDetail(actor, learnerId);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "This learner already has a school year record for that year.",
        "ENROLLMENT_EXISTS"
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

async function findEnrollmentForLearner(learnerId, enrollmentId) {
  const result = await query(
    `SELECT e.*, y.name AS school_year_name
     FROM enrollments e
     JOIN school_years y ON y.id = e.school_year_id
     WHERE e.id = $1 AND e.learner_id = $2`,
    [enrollmentId, learnerId]
  );
  return result.rows[0] || null;
}

async function updateEnrollment(actor, learnerId, enrollmentId, payload) {
  const learner = await loadLearnerForWrite(actor, learnerId);
  const existing = await findEnrollmentForLearner(learnerId, enrollmentId);
  if (!existing) {
    throw new HttpError(404, "School year record not found.", "ENROLLMENT_NOT_FOUND");
  }

  const targets = await resolveEnrollmentTargets(learner, {
    schoolYearId: existing.school_year_id,
    gradeLevelId: payload.gradeLevelId || existing.grade_level_id,
    sectionId: payload.sectionId === undefined ? existing.section_id : payload.sectionId
  });
  const adviserId =
    payload.adviserId === undefined
      ? targets.section
        ? targets.section.adviser_id
        : existing.adviser_id
      : payload.adviserId;

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE enrollments SET
         grade_level_id = $1, section_id = $2, adviser_id = $3,
         enrollment_date = $4, status = $5, remarks = $6
       WHERE id = $7 AND learner_id = $8`,
      [
        targets.grade.id,
        targets.section ? targets.section.id : null,
        adviserId,
        payload.enrollmentDate || existing.enrollment_date,
        payload.status || existing.status,
        payload.remarks === undefined ? existing.remarks : payload.remarks,
        enrollmentId,
        learnerId
      ]
    );
    await auditService.record({
      client,
      userId: actor.id,
      action: "enrollment.updated",
      entityType: "enrollment",
      entityId: enrollmentId,
      districtId: learner.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        learner_id: String(learnerId),
        lrn: learner.lrn,
        school_year: existing.school_year_name,
        grade_level: targets.grade.name,
        section: targets.section ? targets.section.name : null,
        status: payload.status || existing.status
      }
    });
    await client.query("COMMIT");
    return getLearnerDetail(actor, learnerId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function promoteLearner(actor, learnerId, payload) {
  const learner = await loadLearnerForWrite(actor, learnerId);

  // Resolve the source folder: an explicit enrollment, a named school year, or
  // the learner's most recent folder.
  let sourceEnrollment = null;
  if (payload.sourceEnrollmentId) {
    sourceEnrollment = await findEnrollmentForLearner(learnerId, payload.sourceEnrollmentId);
  } else if (payload.sourceSchoolYearId) {
    const result = await query(
      `SELECT e.*, y.name AS school_year_name
       FROM enrollments e
       JOIN school_years y ON y.id = e.school_year_id
       WHERE e.learner_id = $1 AND e.school_year_id = $2`,
      [learnerId, payload.sourceSchoolYearId]
    );
    sourceEnrollment = result.rows[0] || null;
  } else {
    const result = await query(
      `SELECT e.*, y.name AS school_year_name
       FROM enrollments e
       JOIN school_years y ON y.id = e.school_year_id
       WHERE e.learner_id = $1
       ORDER BY y.is_current DESC, y.name DESC
       LIMIT 1`,
      [learnerId]
    );
    sourceEnrollment = result.rows[0] || null;
  }
  if (!sourceEnrollment) {
    throw new HttpError(
      409,
      "This learner has no school year record to promote from.",
      "ENROLLMENT_NOT_FOUND"
    );
  }

  const targets = await resolveEnrollmentTargets(learner, payload);
  if (Number(targets.year.id) === Number(sourceEnrollment.school_year_id)) {
    throw new HttpError(
      400,
      "Choose a different school year for the promoted record.",
      "SAME_SCHOOL_YEAR"
    );
  }
  const adviserId = payload.adviserId || (targets.section ? targets.section.adviser_id : null);
  const sourceWasCurrent = ["enrolled", "retained"].includes(sourceEnrollment.status);

  const client = await getClient();
  try {
    await client.query("BEGIN");
    if (sourceWasCurrent) {
      await client.query(
        `UPDATE enrollments SET status = 'promoted' WHERE id = $1 AND learner_id = $2`,
        [sourceEnrollment.id, learnerId]
      );
    }
    const result = await client.query(
      `INSERT INTO enrollments (
         learner_id, school_id, school_year_id, grade_level_id, section_id,
         adviser_id, enrollment_date, status, remarks
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'enrolled', $8)
       RETURNING id`,
      [
        learnerId,
        learner.school_id,
        targets.year.id,
        targets.grade.id,
        targets.section ? targets.section.id : null,
        adviserId,
        payload.enrollmentDate,
        payload.remarks
      ]
    );
    await auditService.record({
      client,
      userId: actor.id,
      action: "learner.promoted",
      entityType: "learner",
      entityId: learnerId,
      districtId: learner.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        learner_id: String(learnerId),
        lrn: learner.lrn,
        from_school_year: sourceEnrollment.school_year_name,
        to_school_year: targets.year.name,
        grade_level: targets.grade.name,
        section: targets.section ? targets.section.name : null
      }
    });
    await client.query("COMMIT");
    return getLearnerDetail(actor, learnerId);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "This learner already has a record for the target school year.",
        "ENROLLMENT_EXISTS"
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

/* -------------------------------------------------------------------------- */
/* Curricular activities                                                       */
/* -------------------------------------------------------------------------- */

async function addLearnerActivity(actor, learnerId, payload) {
  assertCanManageActivities(actor);
  const learner = await findLearnerScoped(actor, learnerId);
  if (!learner) {
    throw new HttpError(404, "Learner not found.", "LEARNER_NOT_FOUND");
  }
  if (learner.archived_at) {
    throw new HttpError(
      409,
      "This learner record is archived. Restore it before making changes.",
      "LEARNER_ARCHIVED"
    );
  }

  const activity = await query(
    `SELECT * FROM activities WHERE id = $1 AND school_id = $2`,
    [payload.activityId, learner.school_id]
  );
  if (!activity.rows[0]) {
    throw new HttpError(
      404,
      "Activity not found in this learner's school.",
      "ACTIVITY_NOT_FOUND"
    );
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO learner_activities (activity_id, learner_id, role, achievement, remarks)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [payload.activityId, learnerId, payload.role, payload.achievement, payload.remarks]
    );
    await auditService.record({
      client,
      userId: actor.id,
      action: "activity.participant_added",
      entityType: "activity",
      entityId: payload.activityId,
      districtId: learner.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        learner_id: String(learnerId),
        lrn: learner.lrn,
        activity: activity.rows[0].name,
        role: payload.role
      }
    });
    await client.query("COMMIT");
    return { id: Number(result.rows[0].id) };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new HttpError(
        409,
        "This learner is already recorded in that activity.",
        "ACTIVITY_PARTICIPANT_EXISTS"
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

async function removeLearnerActivity(actor, learnerId, participationId) {
  assertCanManageActivities(actor);
  const learner = await findLearnerScoped(actor, learnerId);
  if (!learner) {
    throw new HttpError(404, "Learner not found.", "LEARNER_NOT_FOUND");
  }
  const row = await query(
    `SELECT la.*, a.name AS activity_name
     FROM learner_activities la
     JOIN activities a ON a.id = la.activity_id
     WHERE la.id = $1 AND la.learner_id = $2`,
    [participationId, learnerId]
  );
  if (!row.rows[0]) {
    throw new HttpError(404, "Activity record not found.", "PARTICIPATION_NOT_FOUND");
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM learner_activities WHERE id = $1`, [participationId]);
    await auditService.record({
      client,
      userId: actor.id,
      action: "activity.participant_removed",
      entityType: "activity",
      entityId: row.rows[0].activity_id,
      districtId: learner.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        learner_id: String(learnerId),
        lrn: learner.lrn,
        activity: row.rows[0].activity_name
      }
    });
    await client.query("COMMIT");
    return { id: Number(participationId) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/* -------------------------------------------------------------------------- */
/* Learner documents                                                           */
/* -------------------------------------------------------------------------- */

function detectDocumentType(buffer) {
  if (!buffer || buffer.length < 8) {
    return null;
  }
  if (buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "application/pdf";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  return null;
}

function safeFileName(name) {
  const base = String(name || "document")
    .replace(/^.*[\\/]/, "")
    .replace(/[\u0000-\u001f\u007f"]/g, "")
    .trim()
    .slice(0, 200);
  return base || "document";
}

async function saveDocument(actor, learnerId, file, payload) {
  const learner = await loadLearnerForWrite(actor, learnerId);
  if (!file || !file.buffer || !file.buffer.length) {
    throw new HttpError(400, "Select a file to upload.", "DOCUMENT_REQUIRED");
  }
  const detected = detectDocumentType(file.buffer);
  if (!detected) {
    throw new HttpError(
      415,
      "Upload a PDF, JPEG, or PNG file. The file contents did not match a supported format.",
      "DOCUMENT_TYPE_INVALID"
    );
  }

  if (payload.schoolYearId) {
    await findSchoolYearOrThrow(payload.schoolYearId);
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO learner_documents (
         learner_id, school_year_id, title, document_type, file_name,
         mime_type, byte_size, document_data, uploaded_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, created_at`,
      [
        learnerId,
        payload.schoolYearId || null,
        payload.title,
        payload.documentType,
        safeFileName(file.originalname),
        detected,
        file.buffer.length,
        file.buffer,
        actor.id
      ]
    );
    await auditService.record({
      client,
      userId: actor.id,
      action: "learner.document_uploaded",
      entityType: "learner",
      entityId: learnerId,
      districtId: learner.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        learner_id: String(learnerId),
        lrn: learner.lrn,
        title: payload.title,
        document_type: payload.documentType,
        file_name: safeFileName(file.originalname),
        byte_size: file.buffer.length
      }
    });
    await client.query("COMMIT");
    return {
      id: Number(result.rows[0].id),
      createdAt: result.rows[0].created_at
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getDocumentFile(actor, learnerId, documentId) {
  const learner = await findLearnerScoped(actor, learnerId);
  if (!learner) {
    throw new HttpError(404, "Learner not found.", "LEARNER_NOT_FOUND");
  }
  const result = await query(
    `SELECT id, learner_id, title, file_name, mime_type, byte_size, document_data
     FROM learner_documents
     WHERE id = $1 AND learner_id = $2`,
    [documentId, learnerId]
  );
  if (!result.rows[0]) {
    throw new HttpError(404, "Document not found.", "DOCUMENT_NOT_FOUND");
  }
  return result.rows[0];
}

async function deleteDocument(actor, learnerId, documentId) {
  const learner = await loadLearnerForWrite(actor, learnerId);
  const result = await query(
    `DELETE FROM learner_documents WHERE id = $1 AND learner_id = $2
     RETURNING id, title, file_name`,
    [documentId, learnerId]
  );
  if (!result.rows[0]) {
    throw new HttpError(404, "Document not found.", "DOCUMENT_NOT_FOUND");
  }
  await auditService.record({
    userId: actor.id,
    action: "learner.document_removed",
    entityType: "learner",
    entityId: learnerId,
    districtId: learner.district_id,
    ipAddress: actor.ipAddress || null,
    details: {
      learner_id: String(learnerId),
      lrn: learner.lrn,
      title: result.rows[0].title,
      file_name: result.rows[0].file_name
    }
  });
  return { id: Number(documentId) };
}

/* -------------------------------------------------------------------------- */
/* Dashboard summary                                                           */
/* -------------------------------------------------------------------------- */

function schoolScopeFilter(actor, schoolColumn, districtColumn, params) {
  if (actor.role === "system_admin") {
    return "";
  }
  if (actor.schoolId) {
    params.push(actor.schoolId);
    return `${schoolColumn} = $${params.length}`;
  }
  if (actor.districtId) {
    params.push(actor.districtId);
    return `${districtColumn} = $${params.length}`;
  }
  return "FALSE";
}

async function getLearnerSummary(actor, schoolYearId) {
  const year = schoolYearId
    ? await findSchoolYearOrThrow(schoolYearId)
    : await resolveCurrentSchoolYear();
  const yearId = year ? Number(year.id) : null;

  const totalsParams = [];
  const totalsScope = learnerScopeSql(actor, "l", totalsParams);
  const totalsResult = await query(
    `SELECT
       COUNT(*) FILTER (WHERE l.archived_at IS NULL)::int AS total,
       COUNT(*) FILTER (WHERE l.archived_at IS NOT NULL)::int AS archived,
       COUNT(*) FILTER (
         WHERE l.archived_at IS NULL AND NOT ${PROFILE_COMPLETE_SQL}
       )::int AS incomplete
     FROM learners l
     WHERE ${totalsScope || "TRUE"}`,
    totalsParams
  );

  let enrolled = 0;
  let notEnrolled = totalsResult.rows[0].total;
  let unassigned = 0;
  let byGrade = [];
  const statuses = {
    enrolled: 0,
    transferred_in: 0,
    transferred_out: 0,
    promoted: 0,
    retained: 0,
    completed: 0,
    archived: 0
  };

  if (yearId) {
    const enrollmentParams = [yearId];
    const enrollmentScope = learnerScopeSql(actor, "l", enrollmentParams);
    const enrollmentResult = await query(
      `SELECT COUNT(DISTINCT e.learner_id)::int AS enrolled,
              COUNT(*) FILTER (WHERE e.section_id IS NULL)::int AS unassigned
       FROM enrollments e
       JOIN learners l ON l.id = e.learner_id
       WHERE e.school_year_id = $1 AND l.archived_at IS NULL
         ${enrollmentScope ? `AND ${enrollmentScope}` : ""}`,
      enrollmentParams
    );
    enrolled = enrollmentResult.rows[0].enrolled;
    unassigned = enrollmentResult.rows[0].unassigned;

    const gradeParams = [yearId];
    const gradeScope = learnerScopeSql(actor, "l", gradeParams);
    const gradeResult = await query(
      `SELECT gl.id, gl.name, COUNT(DISTINCT e.learner_id)::int AS count
       FROM enrollments e
       JOIN learners l ON l.id = e.learner_id
       JOIN grade_levels gl ON gl.id = e.grade_level_id
       WHERE e.school_year_id = $1 AND l.archived_at IS NULL
         ${gradeScope ? `AND ${gradeScope}` : ""}
       GROUP BY gl.id, gl.name, gl.sort_order
       ORDER BY gl.sort_order ASC, gl.name ASC`,
      gradeParams
    );
    byGrade = gradeResult.rows.map((row) => ({
      id: Number(row.id),
      name: row.name,
      count: row.count
    }));

    const statusParams = [yearId];
    const statusScope = learnerScopeSql(actor, "l", statusParams);
    const statusResult = await query(
      `SELECT e.status, COUNT(*)::int AS count
       FROM enrollments e
       JOIN learners l ON l.id = e.learner_id
       WHERE e.school_year_id = $1 AND l.archived_at IS NULL
         ${statusScope ? `AND ${statusScope}` : ""}
       GROUP BY e.status`,
      statusParams
    );
    statusResult.rows.forEach((row) => {
      statuses[row.status] = row.count;
    });

    const notEnrolledParams = [yearId];
    const notEnrolledScope = learnerScopeSql(actor, "l", notEnrolledParams);
    const notEnrolledResult = await query(
      `SELECT COUNT(*)::int AS count
       FROM learners l
       WHERE l.archived_at IS NULL
         ${notEnrolledScope ? `AND ${notEnrolledScope}` : ""}
         AND NOT EXISTS (
           SELECT 1 FROM enrollments e
           WHERE e.learner_id = l.id AND e.school_year_id = $1
         )`,
      notEnrolledParams
    );
    notEnrolled = notEnrolledResult.rows[0].count;
  }

  const sectionParams = [];
  let sectionScope = schoolScopeFilter(
    actor,
    "sec.school_id",
    "sch.district_id",
    sectionParams
  );
  if (actor.role === "teacher" || actor.role === "adviser") {
    sectionParams.push(actor.id);
    sectionScope += `${sectionScope ? " AND" : ""} (
      sec.adviser_id = $${sectionParams.length}
      OR EXISTS (
        SELECT 1 FROM teacher_assignments ta
        WHERE ta.section_id = sec.id AND ta.teacher_id = $${sectionParams.length}
      )
    )`;
  }
  const sectionQueryParams = yearId ? [yearId, ...sectionParams] : sectionParams;
  const sectionYearFilter = yearId ? "sec.school_year_id = $1" : "TRUE";
  const sectionExtra = yearId
    ? sectionScope.replace(/\$(\d+)/g, (match, index) => `$${Number(index) + 1}`)
    : sectionScope;
  const sectionCounts = await query(
    `SELECT COUNT(*)::int AS section_count,
            COUNT(DISTINCT sec.adviser_id)::int AS adviser_count
     FROM sections sec
     JOIN schools sch ON sch.id = sec.school_id
     WHERE ${sectionYearFilter} ${sectionExtra ? `AND ${sectionExtra}` : ""}`,
    sectionQueryParams
  );

  const teacherParams = [];
  const teacherScope = schoolScopeFilter(actor, "u.school_id", "u.district_id", teacherParams);
  const teacherCount = await query(
    `SELECT COUNT(*)::int AS count
     FROM users u
     WHERE u.is_active AND u.approval_status = 'active'
       AND u.role IN ('teacher', 'adviser')
       ${teacherScope ? `AND ${teacherScope}` : ""}`,
    teacherParams
  );

  const activityParams = [];
  const activityScope = schoolScopeFilter(
    actor,
    "a.school_id",
    "sch.district_id",
    activityParams
  );
  const activityQueryParams = yearId ? [yearId, ...activityParams] : activityParams;
  const activityYearFilter = yearId ? "a.school_year_id = $1" : "TRUE";
  const activityExtra = yearId
    ? activityScope.replace(/\$(\d+)/g, (match, index) => `$${Number(index) + 1}`)
    : activityScope;
  const activityCount = await query(
    `SELECT COUNT(*)::int AS count
     FROM activities a
     JOIN schools sch ON sch.id = a.school_id
     WHERE ${activityYearFilter} ${activityExtra ? `AND ${activityExtra}` : ""}`,
    activityQueryParams
  );

  return {
    schoolYear: year
      ? {
          id: Number(year.id),
          name: year.name,
          startsOn: isoDateValue(year.starts_on),
          endsOn: isoDateValue(year.ends_on),
          isCurrent: Boolean(year.is_current)
        }
      : null,
    totals: {
      learners: totalsResult.rows[0].total,
      archived: totalsResult.rows[0].archived,
      incomplete: totalsResult.rows[0].incomplete,
      enrolled,
      notEnrolled,
      unassigned,
      sections: sectionCounts.rows[0].section_count,
      advisers: sectionCounts.rows[0].adviser_count,
      teachers: teacherCount.rows[0].count,
      activities: activityCount.rows[0].count
    },
    byGrade,
    statuses
  };
}

module.exports = {
  ENROLLMENT_STATUSES,
  PROFILE_COMPLETE_SQL,
  SORT_COLUMNS,
  resolveCurrentSchoolYear,
  findSchoolYearOrThrow,
  listLearners,
  getLearnerDetail,
  getLearnerHistory,
  createLearner,
  updateLearner,
  archiveLearner,
  restoreLearner,
  createGuardian,
  updateGuardian,
  deleteGuardian,
  createEnrollment,
  updateEnrollment,
  promoteLearner,
  addLearnerActivity,
  removeLearnerActivity,
  saveDocument,
  getDocumentFile,
  deleteDocument,
  getLearnerSummary,
  findLearnerScoped,
  calculateAge
};
