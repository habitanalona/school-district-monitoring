"use strict";

const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const {
  requireIdParam,
  requireString,
  optionalString,
  requireInteger,
  requireEnum,
  optionalEnum,
  parsePagination,
  fail
} = require("../utils/validators");
const {
  assertCan,
  resolveSchool,
  resolveSchoolYear,
  assertLearnerVisible,
  learnerEnrollment,
  schoolScopeSql
} = require("../utils/formsAccess");
const auditService = require("./auditService");

const CONDITIONS = ["new", "good", "fair", "poor", "for_repair"];
const RETURN_CONDITIONS = ["good", "fair", "damaged", "lost"];
const ISSUANCE_STATUSES = ["issued", "partially_returned", "returned", "lost", "damaged"];

function requireDate(value, field) {
  const text = requireString(value, field, { min: 10, max: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
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

const ISSUED_SQL = `COALESCE((
  SELECT SUM(i.quantity_issued) FROM book_issuances i WHERE i.catalog_id = bc.id
), 0)`;

const RETURNED_SQL = `COALESCE((
  SELECT SUM(r.quantity)
  FROM book_returns r JOIN book_issuances i ON i.id = r.issuance_id
  WHERE i.catalog_id = bc.id
), 0)`;

async function listCatalog(actor, filters) {
  assertCan(actor, "books", "access");
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 50;
  const params = [];
  const conditions = ["bc.archived_at IS NULL"];
  const scope = schoolScopeSql(actor, "s", params, filters.schoolId);
  if (scope) {
    conditions.push(scope);
  }
  if (filters.schoolYearId) {
    params.push(filters.schoolYearId);
    conditions.push(`bc.school_year_id = $${params.length}`);
  }
  if (filters.subjectId) {
    params.push(filters.subjectId);
    conditions.push(`bc.subject_id = $${params.length}`);
  }
  if (filters.gradeLevelId) {
    params.push(filters.gradeLevelId);
    conditions.push(`bc.grade_level_id = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(bc.title ILIKE $${params.length} OR bc.author ILIKE $${params.length}
        OR bc.publisher ILIKE $${params.length} OR bc.isbn ILIKE $${params.length})`
    );
  }
  const where = conditions.join(" AND ");
  const count = await query(
    `SELECT COUNT(*)::int AS total FROM book_catalog bc
     JOIN schools s ON s.id = bc.school_id WHERE ${where}`,
    params
  );
  const result = await query(
    `SELECT bc.*, s.school_name, y.name AS school_year_name,
            sub.name AS subject_name, gl.name AS grade_level_name,
            ${ISSUED_SQL} AS issued_quantity,
            ${RETURNED_SQL} AS returned_quantity,
            GREATEST(${ISSUED_SQL} - ${RETURNED_SQL}, 0) AS outstanding_quantity,
            GREATEST(bc.quantity_total - (${ISSUED_SQL} - ${RETURNED_SQL}), 0) AS available_quantity
     FROM book_catalog bc
     JOIN schools s ON s.id = bc.school_id
     JOIN school_years y ON y.id = bc.school_year_id
     LEFT JOIN subjects sub ON sub.id = bc.subject_id
     LEFT JOIN grade_levels gl ON gl.id = bc.grade_level_id
     WHERE ${where}
     ORDER BY bc.title ASC, bc.id ASC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return {
    items: result.rows.map(serializeCatalog),
    total: count.rows[0].total,
    page,
    pageSize
  };
}

function serializeCatalog(row) {
  return {
    id: Number(row.id),
    schoolId: Number(row.school_id),
    schoolName: row.school_name,
    schoolYearId: Number(row.school_year_id),
    schoolYearName: row.school_year_name,
    title: row.title,
    subjectId: row.subject_id ? Number(row.subject_id) : null,
    subjectName: row.subject_name,
    gradeLevelId: row.grade_level_id ? Number(row.grade_level_id) : null,
    gradeLevelName: row.grade_level_name,
    author: row.author,
    publisher: row.publisher,
    edition: row.edition,
    publicationYear: row.publication_year,
    isbn: row.isbn,
    quantityTotal: Number(row.quantity_total),
    issuedQuantity: Number(row.issued_quantity || 0),
    returnedQuantity: Number(row.returned_quantity || 0),
    outstandingQuantity: Number(row.outstanding_quantity || 0),
    availableQuantity: Number(row.available_quantity || 0),
    condition: row.condition,
    location: row.location,
    remarks: row.remarks,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function readCatalog(payload) {
  return {
    title: requireString(payload.title, "Title", { max: 200 }),
    subjectId: payload.subjectId ? requireIdParam(payload.subjectId, "Subject") : null,
    gradeLevelId: payload.gradeLevelId ? requireIdParam(payload.gradeLevelId, "Grade level") : null,
    author: optionalString(payload.author, "Author", { max: 160 }),
    publisher: optionalString(payload.publisher, "Publisher", { max: 160 }),
    edition: optionalString(payload.edition, "Edition", { max: 64 }),
    publicationYear:
      payload.publicationYear === undefined || payload.publicationYear === ""
        ? null
        : requireInteger(payload.publicationYear, "Publication year", { min: 1900, max: 2200 }),
    isbn: optionalString(payload.isbn, "ISBN", { max: 32 }),
    quantityTotal: requireInteger(payload.quantityTotal, "Total quantity", { min: 0, max: 100000 }),
    condition: payload.condition ? optionalEnum(payload.condition, "Condition", CONDITIONS) : "good",
    location: optionalString(payload.location, "Storage location", { max: 120 }),
    remarks: optionalString(payload.remarks, "Remarks", { max: 2000 })
  };
}

async function createCatalog(actor, payload) {
  assertCan(actor, "books", "add");
  const school = await resolveSchool(actor, payload.schoolId);
  const year = await resolveSchoolYear(payload.schoolYearId);
  const data = readCatalog(payload);
  if (data.subjectId) {
    const subject = await query("SELECT id FROM subjects WHERE id = $1 AND school_id = $2", [
      data.subjectId,
      school.id
    ]);
    if (!subject.rows[0]) {
      throw new HttpError(409, "That subject belongs to another school.", "SUBJECT_SCHOOL_MISMATCH");
    }
  }
  const result = await query(
    `INSERT INTO book_catalog
       (school_id, school_year_id, title, subject_id, grade_level_id, author, publisher,
        edition, publication_year, isbn, quantity_total, condition, location, remarks, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
    [
      school.id,
      year.id,
      data.title,
      data.subjectId,
      data.gradeLevelId,
      data.author,
      data.publisher,
      data.edition,
      data.publicationYear,
      data.isbn,
      data.quantityTotal,
      data.condition,
      data.location,
      data.remarks,
      actor.id
    ]
  );
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "books.catalog.create",
    entityType: "book_catalog",
    entityId: result.rows[0].id,
    details: { title: data.title, quantity: data.quantityTotal, schoolId: Number(school.id) }
  });
  return serializeCatalog({ ...result.rows[0], school_name: school.school_name, school_year_name: year.name });
}

async function updateCatalog(actor, id, payload) {
  assertCan(actor, "books", "edit");
  const existing = await query("SELECT * FROM book_catalog WHERE id = $1 AND archived_at IS NULL", [id]);
  if (!existing.rows[0]) {
    throw new HttpError(404, "Book or material not found.", "BOOK_NOT_FOUND");
  }
  const school = await resolveSchool(actor, existing.rows[0].school_id);
  const data = readCatalog(payload);
  const issued = await query(
    `SELECT COALESCE(SUM(i.quantity_issued) - COALESCE((
       SELECT SUM(r.quantity) FROM book_returns r WHERE r.issuance_id = i.id
     ), 0), 0)::int AS outstanding
     FROM book_issuances i WHERE i.catalog_id = $1`,
    [id]
  );
  if (data.quantityTotal < Number(issued.rows[0].outstanding || 0)) {
    throw new HttpError(
      409,
      `Total quantity cannot be lower than the ${issued.rows[0].outstanding} copies currently outstanding.`,
      "BOOK_QUANTITY_CONFLICT"
    );
  }
  const result = await query(
    `UPDATE book_catalog SET
       title = $1, subject_id = $2, grade_level_id = $3, author = $4, publisher = $5,
       edition = $6, publication_year = $7, isbn = $8, quantity_total = $9,
       condition = $10, location = $11, remarks = $12
     WHERE id = $13 RETURNING *`,
    [
      data.title,
      data.subjectId,
      data.gradeLevelId,
      data.author,
      data.publisher,
      data.edition,
      data.publicationYear,
      data.isbn,
      data.quantityTotal,
      data.condition,
      data.location,
      data.remarks,
      id
    ]
  );
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "books.catalog.update",
    entityType: "book_catalog",
    entityId: id,
    details: { title: data.title, quantity: data.quantityTotal, schoolId: Number(school.id) }
  });
  return serializeCatalog(result.rows[0]);
}

async function archiveCatalog(actor, id) {
  assertCan(actor, "books", "delete");
  const existing = await query("SELECT * FROM book_catalog WHERE id = $1 AND archived_at IS NULL", [id]);
  if (!existing.rows[0]) {
    throw new HttpError(404, "Book or material not found.", "BOOK_NOT_FOUND");
  }
  await resolveSchool(actor, existing.rows[0].school_id);
  const outstanding = await query(
    `SELECT COALESCE(SUM(i.quantity_issued) - COALESCE((
       SELECT SUM(r.quantity) FROM book_returns r WHERE r.issuance_id = i.id
     ), 0), 0)::int AS count FROM book_issuances i WHERE i.catalog_id = $1`,
    [id]
  );
  if (Number(outstanding.rows[0].count) > 0) {
    throw new HttpError(
      409,
      "Resolve all outstanding copies before archiving this title.",
      "BOOK_OUTSTANDING"
    );
  }
  await query("UPDATE book_catalog SET archived_at = now() WHERE id = $1", [id]);
  await auditService.record({
    userId: actor.id,
    districtId: actor.districtId,
    action: "books.catalog.archive",
    entityType: "book_catalog",
    entityId: id,
    details: { title: existing.rows[0].title }
  });
  return { archived: true };
}

async function listIssuances(actor, filters) {
  assertCan(actor, "books", "access");
  const page = filters.page || 1;
  const pageSize = filters.pageSize || 50;
  const params = [];
  const conditions = ["1 = 1"];
  const scope = schoolScopeSql(actor, "s", params, filters.schoolId);
  if (scope) {
    conditions.push(scope);
  }
  if (filters.schoolYearId) {
    params.push(filters.schoolYearId);
    conditions.push(`bi.school_year_id = $${params.length}`);
  }
  if (filters.learnerId) {
    params.push(filters.learnerId);
    conditions.push(`bi.learner_id = $${params.length}`);
  }
  if (filters.sectionId) {
    params.push(filters.sectionId);
    conditions.push(`bi.section_id = $${params.length}`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`bi.status = $${params.length}`);
  }
  if (filters.outstandingOnly) {
    conditions.push(
      `bi.status IN ('issued', 'partially_returned', 'damaged', 'lost')`
    );
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(
      `(l.lrn ILIKE $${params.length}
        OR concat_ws(' ', l.first_name, l.middle_name, l.last_name) ILIKE $${params.length}
        OR bc.title ILIKE $${params.length})`
    );
  }
  const where = conditions.join(" AND ");
  const count = await query(
    `SELECT COUNT(*)::int AS total
     FROM book_issuances bi
     JOIN learners l ON l.id = bi.learner_id
     JOIN book_catalog bc ON bc.id = bi.catalog_id
     JOIN schools s ON s.id = bi.school_id
     WHERE ${where}`,
    params
  );
  const result = await query(
    `SELECT bi.*, bc.title, bc.author, bc.isbn,
            l.lrn, l.last_name, l.first_name, l.middle_name, l.extension_name,
            gl.name AS grade_level_name, sec.name AS section_name,
            y.name AS school_year_name, s.school_name,
            COALESCE((SELECT SUM(r.quantity) FROM book_returns r WHERE r.issuance_id = bi.id), 0)::int
              AS returned_quantity
     FROM book_issuances bi
     JOIN book_catalog bc ON bc.id = bi.catalog_id
     JOIN learners l ON l.id = bi.learner_id
     JOIN grade_levels gl ON gl.id = bi.grade_level_id
     LEFT JOIN sections sec ON sec.id = bi.section_id
     JOIN school_years y ON y.id = bi.school_year_id
     JOIN schools s ON s.id = bi.school_id
     WHERE ${where}
     ORDER BY bi.issued_on DESC, bi.id DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return {
    items: result.rows.map(serializeIssuance),
    total: count.rows[0].total,
    page,
    pageSize
  };
}

function serializeIssuance(row) {
  const returned = Number(row.returned_quantity || 0);
  return {
    id: Number(row.id),
    catalogId: Number(row.catalog_id),
    title: row.title,
    author: row.author,
    isbn: row.isbn,
    learnerId: Number(row.learner_id),
    lrn: row.lrn,
    learnerName: [row.first_name, row.middle_name, row.last_name, row.extension_name]
      .filter(Boolean)
      .join(" "),
    schoolId: Number(row.school_id),
    schoolName: row.school_name,
    schoolYearId: Number(row.school_year_id),
    schoolYearName: row.school_year_name,
    gradeLevelName: row.grade_level_name,
    sectionName: row.section_name,
    quantityIssued: Number(row.quantity_issued),
    quantityReturned: returned,
    outstanding: Math.max(Number(row.quantity_issued) - returned, 0),
    issuedOn: String(row.issued_on).slice(0, 10),
    issuedBy: row.issued_by ? Number(row.issued_by) : null,
    expectedReturnOn: row.expected_return_on ? String(row.expected_return_on).slice(0, 10) : null,
    status: row.status,
    remarks: row.remarks,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function issueBooks(actor, payload) {
  assertCan(actor, "books", "add");
  const catalogId = requireIdParam(payload.catalogId, "Book or material");
  const quantity = requireInteger(payload.quantity, "Quantity", { min: 1, max: 1000 });
  const issuedOn = payload.issuedOn ? requireDate(payload.issuedOn, "Date issued") : new Date().toISOString().slice(0, 10);
  const expectedReturnOn = optionalDate(payload.expectedReturnOn, "Expected return date");
  if (expectedReturnOn && expectedReturnOn < issuedOn) {
    fail("Expected return date cannot be before the date issued.", { field: "expectedReturnOn" });
  }
  const learner = await assertLearnerVisible(actor, requireIdParam(payload.learnerId, "Learner"));
  const year = await resolveSchoolYear(payload.schoolYearId);
  const enrollment = await learnerEnrollment(learner.id, year.id);
  if (!enrollment) {
    throw new HttpError(
      409,
      "The learner has no enrollment for the selected school year.",
      "ENROLLMENT_REQUIRED"
    );
  }
  await resolveSchool(actor, learner.school_id);

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const catalog = await client.query(
      "SELECT * FROM book_catalog WHERE id = $1 AND archived_at IS NULL FOR UPDATE",
      [catalogId]
    );
    if (!catalog.rows[0]) {
      throw new HttpError(404, "Book or material not found.", "BOOK_NOT_FOUND");
    }
    if (Number(catalog.rows[0].school_id) !== Number(learner.school_id)) {
      throw new HttpError(409, "That title belongs to another school.", "BOOK_SCHOOL_MISMATCH");
    }
    if (Number(catalog.rows[0].school_year_id) !== Number(year.id)) {
      throw new HttpError(409, "That title is registered for a different school year.", "BOOK_YEAR_MISMATCH");
    }
    const outstanding = await client.query(
      `SELECT COALESCE(SUM(i.quantity_issued) - COALESCE((
         SELECT SUM(r.quantity) FROM book_returns r WHERE r.issuance_id = i.id
       ), 0), 0)::int AS count FROM book_issuances i WHERE i.catalog_id = $1`,
      [catalogId]
    );
    const available = Number(catalog.rows[0].quantity_total) - Number(outstanding.rows[0].count || 0);
    if (quantity > available) {
      throw new HttpError(
        409,
        `Only ${Math.max(available, 0)} copies are available for issuance.`,
        "BOOK_UNAVAILABLE"
      );
    }
    const result = await client.query(
      `INSERT INTO book_issuances
         (catalog_id, learner_id, enrollment_id, school_id, school_year_id, grade_level_id,
          section_id, quantity_issued, issued_on, issued_by, expected_return_on, remarks, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        catalogId,
        learner.id,
        enrollment.id,
        learner.school_id,
        year.id,
        enrollment.grade_level_id,
        enrollment.section_id,
        quantity,
        issuedOn,
        actor.id,
        expectedReturnOn,
        optionalString(payload.remarks, "Remarks", { max: 2000 }),
        actor.id
      ]
    );
    await client.query("COMMIT");
    await auditService.record({
      userId: actor.id,
      districtId: actor.districtId,
      action: "books.issue",
      entityType: "book_issuance",
      entityId: result.rows[0].id,
      details: {
        catalogId,
        learnerId: Number(learner.id),
        quantity,
        schoolId: Number(learner.school_id)
      }
    });
    return serializeIssuance({
      ...result.rows[0],
      title: catalog.rows[0].title,
      author: catalog.rows[0].author,
      isbn: catalog.rows[0].isbn,
      lrn: learner.lrn,
      first_name: learner.first_name,
      middle_name: learner.middle_name,
      last_name: learner.last_name,
      extension_name: learner.extension_name,
      school_name: learner.school_name,
      school_year_name: year.name,
      grade_level_name: enrollment.grade_level_name,
      section_name: enrollment.section_name,
      returned_quantity: 0
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function returnBooks(actor, issuanceId, payload) {
  assertCan(actor, "books", "edit");
  const quantity = requireInteger(payload.quantity, "Quantity returned", { min: 1, max: 1000 });
  const returnedOn = payload.returnedOn
    ? requireDate(payload.returnedOn, "Date returned")
    : new Date().toISOString().slice(0, 10);
  const condition = requireEnum(payload.condition, "Return condition", RETURN_CONDITIONS);

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const issuanceResult = await client.query(
      `SELECT bi.*, bc.title FROM book_issuances bi
       JOIN book_catalog bc ON bc.id = bi.catalog_id
       WHERE bi.id = $1 FOR UPDATE`,
      [issuanceId]
    );
    const issuance = issuanceResult.rows[0];
    if (!issuance) {
      throw new HttpError(404, "Issuance not found.", "ISSUANCE_NOT_FOUND");
    }
    await resolveSchool(actor, issuance.school_id, { client });
    const returned = await client.query(
      "SELECT COALESCE(SUM(quantity), 0)::int AS count FROM book_returns WHERE issuance_id = $1",
      [issuanceId]
    );
    const remaining = Number(issuance.quantity_issued) - Number(returned.rows[0].count);
    if (quantity > remaining) {
      throw new HttpError(
        409,
        `Only ${remaining} copies remain outstanding on this issuance.`,
        "RETURN_QUANTITY_CONFLICT"
      );
    }
    if (returnedOn < String(issuance.issued_on).slice(0, 10)) {
      fail("Date returned cannot be before the date issued.", { field: "returnedOn" });
    }
    await client.query(
      `INSERT INTO book_returns (issuance_id, quantity, returned_on, condition, received_by, remarks)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        issuanceId,
        quantity,
        returnedOn,
        condition,
        actor.id,
        optionalString(payload.remarks, "Remarks", { max: 2000 })
      ]
    );
    const totalReturned = Number(returned.rows[0].count) + quantity;
    const anyLost = await client.query(
      "SELECT 1 FROM book_returns WHERE issuance_id = $1 AND condition = 'lost' LIMIT 1",
      [issuanceId]
    );
    const anyDamaged = await client.query(
      "SELECT 1 FROM book_returns WHERE issuance_id = $1 AND condition = 'damaged' LIMIT 1",
      [issuanceId]
    );
    let status = "partially_returned";
    if (totalReturned >= Number(issuance.quantity_issued)) {
      status = "returned";
    } else if (anyLost.rows[0]) {
      status = "lost";
    } else if (anyDamaged.rows[0]) {
      status = "damaged";
    }
    await client.query("UPDATE book_issuances SET status = $1 WHERE id = $2", [status, issuanceId]);
    await client.query("COMMIT");
    await auditService.record({
      userId: actor.id,
      districtId: actor.districtId,
      action: "books.return",
      entityType: "book_issuance",
      entityId: issuanceId,
      details: { quantity, condition, status, title: issuance.title }
    });
    const updated = await query("SELECT * FROM book_issuances WHERE id = $1", [issuanceId]);
    return serializeIssuance({
      ...updated.rows[0],
      title: issuance.title,
      returned_quantity: totalReturned
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function issuanceHistory(actor, issuanceId) {
  assertCan(actor, "books", "access");
  const issuance = await query(
    `SELECT bi.*, bc.title, l.lrn, l.first_name, l.middle_name, l.last_name
     FROM book_issuances bi
     JOIN book_catalog bc ON bc.id = bi.catalog_id
     JOIN learners l ON l.id = bi.learner_id
     WHERE bi.id = $1`,
    [issuanceId]
  );
  if (!issuance.rows[0]) {
    throw new HttpError(404, "Issuance not found.", "ISSUANCE_NOT_FOUND");
  }
  await resolveSchool(actor, issuance.rows[0].school_id);
  const returns = await query(
    `SELECT br.*, u.full_name AS received_by_name
     FROM book_returns br LEFT JOIN users u ON u.id = br.received_by
     WHERE br.issuance_id = $1 ORDER BY br.returned_on ASC, br.id ASC`,
    [issuanceId]
  );
  return {
    issuance: serializeIssuance(issuance.rows[0]),
    returns: returns.rows.map((row) => ({
      id: Number(row.id),
      quantity: Number(row.quantity),
      returnedOn: String(row.returned_on).slice(0, 10),
      condition: row.condition,
      receivedBy: row.received_by_name,
      remarks: row.remarks,
      createdAt: row.created_at
    }))
  };
}

async function summary(actor, filters) {
  assertCan(actor, "books", "access");
  const params = [];
  const conditions = ["bc.archived_at IS NULL"];
  const scope = schoolScopeSql(actor, "s", params, filters.schoolId);
  if (scope) {
    conditions.push(scope);
  }
  if (filters.schoolYearId) {
    params.push(filters.schoolYearId);
    conditions.push(`bc.school_year_id = $${params.length}`);
  }
  const result = await query(
    `SELECT
       COUNT(*)::int AS titles,
       COALESCE(SUM(bc.quantity_total), 0)::int AS copies,
       COALESCE(SUM(${ISSUED_SQL}), 0)::int AS issued,
       COALESCE(SUM(${RETURNED_SQL}), 0)::int AS returned,
       COALESCE(SUM(${ISSUED_SQL} - ${RETURNED_SQL}), 0)::int AS outstanding
     FROM book_catalog bc JOIN schools s ON s.id = bc.school_id
     WHERE ${conditions.join(" AND ")}`,
    params
  );
  const row = result.rows[0];
  return {
    titles: Number(row.titles),
    copies: Number(row.copies),
    issued: Number(row.issued),
    returned: Number(row.returned),
    outstanding: Number(row.outstanding),
    available: Math.max(Number(row.copies) - Number(row.outstanding), 0)
  };
}

module.exports = {
  CONDITIONS,
  RETURN_CONDITIONS,
  ISSUANCE_STATUSES,
  requireDate,
  listCatalog,
  createCatalog,
  updateCatalog,
  archiveCatalog,
  listIssuances,
  issueBooks,
  returnBooks,
  issuanceHistory,
  summary
};
