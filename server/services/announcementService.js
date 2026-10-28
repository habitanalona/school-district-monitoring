"use strict";

const { query, getClient } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const { serializeAnnouncement } = require("../utils/serializers");
const { assertDistrictAccess } = require("../utils/scope");
const { requireDistrict } = require("./districtService");
const auditService = require("./auditService");

const ANNOUNCEMENT_SELECT = `SELECT a.*, u.full_name AS created_by_name, d.district_name
  FROM announcements a
  LEFT JOIN users u ON u.id = a.created_by
  LEFT JOIN districts d ON d.id = a.district_id`;

async function listAnnouncements(actor, { status = "", districtScopeId = null } = {}) {
  const params = [];
  const filters = [];
  let index = 1;

  if (actor.role === "system_admin") {
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
  } else if (actor.role === "district_admin") {
    filters.push(
      `((a.district_id = $${index} AND a.status <> 'archived') OR (a.district_id IS NULL AND a.status = 'published'))`
    );
    params.push(actor.districtId);
    index += 1;
  } else {
    filters.push(
      `(a.status = 'published' AND (a.district_id = $${index} OR a.district_id IS NULL))`
    );
    params.push(actor.districtId);
    index += 1;
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

async function getAnnouncement(id, actor) {
  const result = await query(`${ANNOUNCEMENT_SELECT} WHERE a.id = $1`, [id]);
  const row = result.rows[0];
  if (!row) {
    throw new HttpError(404, "Announcement not found.", "ANNOUNCEMENT_NOT_FOUND");
  }
  if (actor.role === "staff" && (row.status !== "published" || (row.district_id && Number(row.district_id) !== Number(actor.districtId)))) {
    throw new HttpError(404, "Announcement not found.", "ANNOUNCEMENT_NOT_FOUND");
  }
  if (actor.role === "district_admin" && row.district_id && Number(row.district_id) !== Number(actor.districtId)) {
    throw new HttpError(404, "Announcement not found.", "ANNOUNCEMENT_NOT_FOUND");
  }
  return serializeAnnouncement(row);
}

function resolveDistrict(actor, requestedDistrictId) {
  if (actor.role !== "system_admin") {
    return actor.districtId;
  }
  if (requestedDistrictId === null || requestedDistrictId === undefined || requestedDistrictId === "") {
    return null;
  }
  assertDistrictAccess(actor, requestedDistrictId);
  return requestedDistrictId;
}

async function createAnnouncement(actor, payload) {
  const districtId = resolveDistrict(actor, payload.districtId);
  if (districtId !== null) {
    await requireDistrict(districtId);
  }

  const publishedAt = payload.status === "published" ? new Date() : null;
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO announcements (title, content, created_by, district_id, published_at, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [payload.title, payload.content, actor.id, districtId, publishedAt, payload.status]
    );
    const id = Number(result.rows[0].id);
    await auditService.record({
      client,
      userId: actor.id,
      action: "announcement.created",
      entityType: "announcement",
      entityId: id,
      districtId,
      ipAddress: actor.ipAddress || null,
      details: { title: payload.title, status: payload.status }
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
  if (actor.role !== "system_admin" && Number(existing.district_id) !== Number(actor.districtId)) {
    throw new HttpError(403, "You can only edit announcements for your own district.", "DISTRICT_FORBIDDEN");
  }

  let districtId = existing.district_id;
  if (actor.role === "system_admin") {
    districtId = resolveDistrict(actor, payload.districtId);
    if (districtId !== null) {
      await requireDistrict(districtId);
    }
  }

  const publishedAt =
    payload.status === "published" ? existing.published_at || new Date() : existing.published_at;
  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE announcements
       SET title = $1, content = $2, district_id = $3, published_at = $4, status = $5
       WHERE id = $6`,
      [payload.title, payload.content, districtId, publishedAt, payload.status, id]
    );
    await auditService.record({
      client,
      userId: actor.id,
      action: "announcement.updated",
      entityType: "announcement",
      entityId: id,
      districtId,
      ipAddress: actor.ipAddress || null,
      details: { title: payload.title, status: payload.status }
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

module.exports = { listAnnouncements, getAnnouncement, createAnnouncement, updateAnnouncement };
