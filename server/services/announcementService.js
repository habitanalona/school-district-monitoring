"use strict";

const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const { serializeAnnouncement } = require("../utils/serializers");
const { assertDistrictAccess } = require("../utils/scope");
const { hasRole, hasAnyRole } = require("../utils/roles");
const { requireDistrict } = require("./districtService");
const auditService = require("./auditService");

const ANNOUNCEMENT_SELECT = `SELECT a.*, u.full_name AS created_by_name, d.district_name,
       t.school_ids, t.school_names, t.school_codes
  FROM announcements a
  LEFT JOIN users u ON u.id = a.created_by
  LEFT JOIN districts d ON d.id = a.district_id
  LEFT JOIN LATERAL (
    SELECT array_agg(s.id ORDER BY s.school_name) AS school_ids,
           array_agg(s.school_name ORDER BY s.school_name) AS school_names,
           array_agg(s.school_code ORDER BY s.school_name) AS school_codes
    FROM announcement_schools ans
    JOIN schools s ON s.id = ans.school_id
    WHERE ans.announcement_id = a.id
  ) t ON TRUE`;

function isSystemAdmin(actor) {
  return hasRole(actor, "system_admin");
}

function isDistrictManager(actor) {
  return isSystemAdmin(actor) || hasAnyRole(actor, ["district_admin", "psds"]);
}

async function listAnnouncements(actor, { status = "", districtScopeId = null } = {}) {
  const params = [];
  const filters = [];
  let index = 1;

  if (isSystemAdmin(actor)) {
    if (districtScopeId !== null) {
      filters.push(`a.district_id = $${index++}`);
      params.push(districtScopeId);
    }
    if (status) {
      filters.push(`a.status = $${index++}`);
      params.push(status);
    } else {
      filters.push(`a.status <> 'archived'`);
    }
  } else if (hasAnyRole(actor, ["district_admin", "psds"])) {
    if (status) {
      filters.push(
        `((a.district_id = $${index} AND a.status = $${index + 1}) OR (a.district_id IS NULL AND a.status = 'published'))`
      );
      params.push(actor.districtId, status);
      index += 2;
    } else {
      filters.push(
        `((a.district_id = $${index} AND a.status <> 'archived') OR (a.district_id IS NULL AND a.status = 'published'))`
      );
      params.push(actor.districtId);
      index += 1;
    }
  } else if (hasRole(actor, "staff")) {
    filters.push(
      `(a.status = 'published' AND (a.district_id = $${index} OR a.district_id IS NULL))`
    );
    params.push(actor.districtId);
    index += 1;
  } else {
    filters.push(
      `(a.status = 'published' AND (a.district_id = $${index} OR a.district_id IS NULL))`
    );
    params.push(actor.districtId);
    index += 1;
    if (actor.schoolId) {
      filters.push(
        `(a.district_id IS NULL
          OR NOT EXISTS (SELECT 1 FROM announcement_schools ans WHERE ans.announcement_id = a.id)
          OR EXISTS (
            SELECT 1 FROM announcement_schools ans
            WHERE ans.announcement_id = a.id AND ans.school_id = $${index}
          ))`
      );
      params.push(actor.schoolId);
      index += 1;
    }
  }

  const result = await query(
    `${ANNOUNCEMENT_SELECT}
     WHERE ${filters.join(" AND ")}
     ORDER BY a.published_at DESC NULLS LAST, a.created_at DESC
     LIMIT 100`,
    params
  );
  return result.rows.map(serializeAnnouncement);
}

async function findAnnouncementRow(id) {
  const result = await query(`SELECT a.* FROM announcements a WHERE a.id = $1`, [id]);
  return result.rows[0] || null;
}

async function isTargetedToSchool(announcementId, schoolId) {
  const targets = await query(
    `SELECT school_id FROM announcement_schools WHERE announcement_id = $1`,
    [announcementId]
  );
  if (!targets.rows.length) {
    return true;
  }
  return targets.rows.some((row) => Number(row.school_id) === Number(schoolId));
}

async function assertAnnouncementReadable(actor, row) {
  const notFound = () =>
    new HttpError(404, "Announcement not found.", "ANNOUNCEMENT_NOT_FOUND");

  if (isSystemAdmin(actor)) {
    return;
  }
  const sameDistrict =
    row.district_id && Number(row.district_id) === Number(actor.districtId);
  const systemWide = !row.district_id;

  if (hasAnyRole(actor, ["district_admin", "psds"])) {
    if (sameDistrict || (systemWide && row.status === "published")) {
      return;
    }
    throw notFound();
  }
  if (hasRole(actor, "staff")) {
    if (row.status === "published" && (sameDistrict || systemWide)) {
      return;
    }
    throw notFound();
  }
  if (row.status !== "published" || (!sameDistrict && !systemWide)) {
    throw notFound();
  }
  if (!systemWide && !(await isTargetedToSchool(row.id, actor.schoolId))) {
    throw notFound();
  }
}

async function getAnnouncement(id, actor) {
  const result = await query(`${ANNOUNCEMENT_SELECT} WHERE a.id = $1`, [id]);
  const row = result.rows[0];
  if (!row) {
    throw new HttpError(404, "Announcement not found.", "ANNOUNCEMENT_NOT_FOUND");
  }
  await assertAnnouncementReadable(actor, row);
  return serializeAnnouncement(row);
}

function resolveDistrict(actor, requestedDistrictId) {
  if (!isSystemAdmin(actor)) {
    return actor.districtId;
  }
  if (requestedDistrictId === null || requestedDistrictId === undefined || requestedDistrictId === "") {
    return null;
  }
  assertDistrictAccess(actor, requestedDistrictId);
  return requestedDistrictId;
}

function assertManageAccess(actor, existing) {
  if (!isDistrictManager(actor)) {
    throw new HttpError(
      403,
      "Only administrators or district supervisors can manage announcements.",
      "FORBIDDEN"
    );
  }
  if (isSystemAdmin(actor)) {
    return;
  }
  if (!existing.district_id || Number(existing.district_id) !== Number(actor.districtId)) {
    throw new HttpError(
      403,
      "You can only manage announcements for your own district.",
      "DISTRICT_FORBIDDEN"
    );
  }
}

async function resolveTargetSchools(runner, districtId, requested) {
  const ids = Array.from(new Set((requested || []).map(Number)));
  if (!ids.length) {
    return [];
  }
  if (!districtId) {
    throw new HttpError(
      400,
      "Choose a district before targeting specific schools.",
      "VALIDATION_ERROR",
      { field: "schoolIds" }
    );
  }
  const result = await runner.query(
    `SELECT id FROM schools
     WHERE id = ANY($1::bigint[]) AND district_id = $2 AND status <> 'archived'`,
    [ids, districtId]
  );
  if (result.rows.length !== ids.length) {
    throw new HttpError(
      400,
      "Every selected school must belong to the announcement district.",
      "VALIDATION_ERROR",
      { field: "schoolIds" }
    );
  }
  return ids;
}

async function writeTargetSchools(client, announcementId, schoolIds) {
  await client.query(`DELETE FROM announcement_schools WHERE announcement_id = $1`, [
    announcementId
  ]);
  if (!schoolIds.length) {
    return;
  }
  await client.query(
    `INSERT INTO announcement_schools (announcement_id, school_id)
     SELECT $1, unnest($2::bigint[])`,
    [announcementId, schoolIds]
  );
}

async function createAnnouncement(actor, payload) {
  if (!isDistrictManager(actor)) {
    throw new HttpError(
      403,
      "Only administrators or district supervisors can manage announcements.",
      "FORBIDDEN"
    );
  }
  const districtId = resolveDistrict(actor, payload.districtId);
  if (districtId !== null) {
    await requireDistrict(districtId);
  }

  const publishedAt = payload.status === "published" ? new Date() : null;
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const schoolIds = await resolveTargetSchools(
      client,
      districtId,
      payload.schoolIds || []
    );
    const result = await client.query(
      `INSERT INTO announcements (title, content, created_by, district_id, published_at, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [payload.title, payload.content, actor.id, districtId, publishedAt, payload.status]
    );
    const id = Number(result.rows[0].id);
    await writeTargetSchools(client, id, schoolIds);
    await auditService.record({
      client,
      userId: actor.id,
      action: "announcement.created",
      entityType: "announcement",
      entityId: id,
      districtId,
      ipAddress: actor.ipAddress || null,
      details: { title: payload.title, status: payload.status, schoolIds }
    });
    await client.query("COMMIT");
    return getAnnouncement(id, actor);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateAnnouncement(actor, id, payload) {
  const existing = await findAnnouncementRow(id);
  if (!existing) {
    throw new HttpError(404, "Announcement not found.", "ANNOUNCEMENT_NOT_FOUND");
  }
  assertManageAccess(actor, existing);

  let districtId = existing.district_id;
  if (isSystemAdmin(actor)) {
    districtId = resolveDistrict(actor, payload.districtId);
    if (districtId !== null) {
      await requireDistrict(districtId);
    }
  }

  const replaceTargets = payload.schoolIds !== null && payload.schoolIds !== undefined;
  const districtChanged =
    Number(existing.district_id || 0) !== Number(districtId || 0);
  const publishedAt =
    payload.status === "published" ? existing.published_at || new Date() : existing.published_at;
  const client = await getClient();
  try {
    await client.query("BEGIN");
    let schoolIds = null;
    if (replaceTargets) {
      schoolIds = await resolveTargetSchools(client, districtId, payload.schoolIds);
    } else if (districtChanged) {
      // Targets from the previous district cannot follow the announcement.
      schoolIds = [];
    }
    await client.query(
      `UPDATE announcements
       SET title = $1, content = $2, district_id = $3, published_at = $4, status = $5, updated_at = now()
       WHERE id = $6`,
      [payload.title, payload.content, districtId, publishedAt, payload.status, id]
    );
    if (schoolIds !== null) {
      await writeTargetSchools(client, id, schoolIds);
    }
    await auditService.record({
      client,
      userId: actor.id,
      action: "announcement.updated",
      entityType: "announcement",
      entityId: Number(id),
      districtId,
      ipAddress: actor.ipAddress || null,
      details: {
        title: payload.title,
        status: payload.status,
        schoolIds
      }
    });
    await client.query("COMMIT");
    return getAnnouncement(id, actor);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deleteAnnouncement(actor, id) {
  const existing = await findAnnouncementRow(id);
  if (!existing) {
    throw new HttpError(404, "Announcement not found.", "ANNOUNCEMENT_NOT_FOUND");
  }
  assertManageAccess(actor, existing);

  const client = await getClient();
  try {
    await client.query("BEGIN");
    const targets = await client.query(
      `SELECT school_id FROM announcement_schools WHERE announcement_id = $1`,
      [id]
    );
    await client.query(`DELETE FROM announcements WHERE id = $1`, [id]);
    await auditService.record({
      client,
      userId: actor.id,
      action: "announcement.deleted",
      entityType: "announcement",
      entityId: Number(id),
      districtId: existing.district_id,
      ipAddress: actor.ipAddress || null,
      details: {
        title: existing.title,
        schoolIds: targets.rows.map((row) => Number(row.school_id))
      }
    });
    await client.query("COMMIT");
    return { id: Number(id), title: existing.title };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  listAnnouncements,
  getAnnouncement,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement
};
