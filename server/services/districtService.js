"use strict";

const { query, getClient } = require("../config/database");
const { serializeDistrict } = require("../utils/serializers");
const { HttpError } = require("../utils/httpError");
const auditService = require("./auditService");

const DISTRICT_SELECT = `SELECT d.*,
    (SELECT COUNT(*)::int FROM schools s
      WHERE s.district_id = d.id AND s.status <> 'archived') AS school_count,
    (SELECT COUNT(*)::int FROM users u WHERE u.district_id = d.id) AS user_count,
    (SELECT COUNT(*)::int FROM announcements a WHERE a.district_id = d.id) AS announcement_count
  FROM districts d`;

function requireSystemAdministrator(user) {
  if (!user || user.role !== "system_admin") {
    throw new HttpError(403, "Only system administrators can manage districts.", "FORBIDDEN");
  }
}

async function listForUser(user) {
  const result = await query(
    `${DISTRICT_SELECT}
     WHERE ($1::bigint IS NULL OR d.id = $1)
     ORDER BY d.district_name ASC`,
    [user.role === "system_admin" ? null : user.districtId]
  );
  return result.rows.map(serializeDistrict);
}

async function findById(id) {
  const result = await query(`SELECT * FROM districts WHERE id = $1`, [id]);
  return result.rows[0] || null;
}

async function requireDistrict(id) {
  const district = await findById(id);
  if (!district) {
    throw new HttpError(400, "The selected district does not exist.", "DISTRICT_NOT_FOUND");
  }
  return serializeDistrict(district);
}

async function getDistrict(user, id) {
  const result = await query(
    `${DISTRICT_SELECT}
     WHERE d.id = $1
       AND ($2::bigint IS NULL OR d.id = $2)`,
    [id, user.role === "system_admin" ? null : user.districtId]
  );
  if (!result.rows[0]) {
    throw new HttpError(404, "District not found.", "DISTRICT_NOT_FOUND");
  }
  return serializeDistrict(result.rows[0]);
}

async function hierarchyForUser(user) {
  const result = await query(
    `SELECT d.id AS district_id, d.district_name, d.district_code,
            d.psds_one_name, d.psds_one_email, d.psds_one_phone,
            d.psds_two_name, d.psds_two_email, d.psds_two_phone,
            s.id AS school_id, s.school_code, s.school_name, s.school_type, s.status
     FROM districts d
     LEFT JOIN schools s
       ON s.district_id = d.id AND s.status <> 'archived'
     WHERE ($1::bigint IS NULL OR d.id = $1)
     ORDER BY d.district_name ASC, s.school_name ASC`,
    [user.role === "system_admin" ? null : user.districtId]
  );

  const byId = new Map();
  const districts = [];
  let totalSchools = 0;
  let activeSchools = 0;

  result.rows.forEach((row) => {
    let district = byId.get(row.district_id);
    if (!district) {
      district = serializeDistrict({
        id: row.district_id,
        district_name: row.district_name,
        district_code: row.district_code,
        psds_one_name: row.psds_one_name,
        psds_one_email: row.psds_one_email,
        psds_one_phone: row.psds_one_phone,
        psds_two_name: row.psds_two_name,
        psds_two_email: row.psds_two_email,
        psds_two_phone: row.psds_two_phone,
        school_count: 0
      });
      district.schools = [];
      byId.set(row.district_id, district);
      districts.push(district);
    }
    if (row.school_id) {
      district.schools.push({
        id: Number(row.school_id),
        code: row.school_code,
        name: row.school_name,
        type: row.school_type,
        status: row.status
      });
      district.schoolCount += 1;
      totalSchools += 1;
      if (row.status === "active") {
        activeSchools += 1;
      }
    }
  });

  return {
    districts,
    totals: {
      districts: districts.length,
      schools: totalSchools,
      activeSchools
    }
  };
}

async function assertCodeAvailable(districtCode, excludeId = null) {
  const result = await query(
    `SELECT id FROM districts
     WHERE lower(district_code) = lower($1)
       AND ($2::bigint IS NULL OR id <> $2)`,
    [districtCode, excludeId]
  );
  if (result.rows[0]) {
    throw new HttpError(409, "That district code is already in use.", "DISTRICT_CODE_IN_USE");
  }
}

async function createDistrict(user, payload) {
  requireSystemAdministrator(user);
  await assertCodeAvailable(payload.districtCode);
  const client = await getClient();

  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO districts (
         district_name, district_code, address, contact_email,
         psds_one_name, psds_one_email, psds_one_phone,
         psds_two_name, psds_two_email, psds_two_phone
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        payload.districtName,
        payload.districtCode,
        payload.address,
        payload.contactEmail,
        payload.psds[0].name,
        payload.psds[0].email,
        payload.psds[0].phone,
        payload.psds[1].name,
        payload.psds[1].email,
        payload.psds[1].phone
      ]
    );
    const id = Number(result.rows[0].id);
    await auditService.record({
      client,
      userId: user.id,
      action: "district.created",
      entityType: "district",
      entityId: id,
      districtId: id,
      ipAddress: user.ipAddress || null,
      details: {
        district_code: payload.districtCode,
        district_name: payload.districtName,
        psds: payload.psds.map((supervisor) => supervisor.name)
      }
    });
    await client.query("COMMIT");
    return getDistrict(user, id);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new HttpError(409, "That district code is already in use.", "DISTRICT_CODE_IN_USE");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function updateDistrict(user, id, payload) {
  requireSystemAdministrator(user);
  const existing = await findById(id);
  if (!existing) {
    throw new HttpError(404, "District not found.", "DISTRICT_NOT_FOUND");
  }
  await assertCodeAvailable(payload.districtCode, id);

  const changedFields = [
    ["district_name", payload.districtName],
    ["district_code", payload.districtCode],
    ["address", payload.address],
    ["contact_email", payload.contactEmail],
    ["psds_one_name", payload.psds[0].name],
    ["psds_one_email", payload.psds[0].email],
    ["psds_one_phone", payload.psds[0].phone],
    ["psds_two_name", payload.psds[1].name],
    ["psds_two_email", payload.psds[1].email],
    ["psds_two_phone", payload.psds[1].phone]
  ]
    .filter(([field, value]) => String(existing[field] ?? "") !== String(value ?? ""))
    .map(([field]) => field);

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE districts SET
         district_name = $1,
         district_code = $2,
         address = $3,
         contact_email = $4,
         psds_one_name = $5,
         psds_one_email = $6,
         psds_one_phone = $7,
         psds_two_name = $8,
         psds_two_email = $9,
         psds_two_phone = $10
       WHERE id = $11`,
      [
        payload.districtName,
        payload.districtCode,
        payload.address,
        payload.contactEmail,
        payload.psds[0].name,
        payload.psds[0].email,
        payload.psds[0].phone,
        payload.psds[1].name,
        payload.psds[1].email,
        payload.psds[1].phone,
        id
      ]
    );
    await auditService.record({
      client,
      userId: user.id,
      action: "district.updated",
      entityType: "district",
      entityId: id,
      districtId: id,
      ipAddress: user.ipAddress || null,
      details: {
        district_code: payload.districtCode,
        district_name: payload.districtName,
        fields: changedFields
      }
    });
    await client.query("COMMIT");
    return getDistrict(user, id);
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      throw new HttpError(409, "That district code is already in use.", "DISTRICT_CODE_IN_USE");
    }
    throw error;
  } finally {
    client.release();
  }
}

async function deleteDistrict(user, id) {
  requireSystemAdministrator(user);
  const existing = await findById(id);
  if (!existing) {
    throw new HttpError(404, "District not found.", "DISTRICT_NOT_FOUND");
  }

  const usage = await query(
    `SELECT
       (SELECT COUNT(*)::int FROM schools WHERE district_id = $1) AS schools,
       (SELECT COUNT(*)::int FROM users WHERE district_id = $1) AS users,
       (SELECT COUNT(*)::int FROM announcements WHERE district_id = $1) AS announcements`,
    [id]
  );
  const counts = usage.rows[0];
  if (counts.schools || counts.users || counts.announcements) {
    throw new HttpError(
      409,
      "This district still has schools, user accounts, or announcements. Move or remove them before deleting the district.",
      "DISTRICT_IN_USE",
      {
        schools: counts.schools,
        users: counts.users,
        announcements: counts.announcements
      }
    );
  }

  const client = await getClient();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM districts WHERE id = $1`, [id]);
    await auditService.record({
      client,
      userId: user.id,
      action: "district.deleted",
      entityType: "district",
      entityId: id,
      districtId: null,
      ipAddress: user.ipAddress || null,
      details: { district_code: existing.district_code, district_name: existing.district_name }
    });
    await client.query("COMMIT");
    return {
      id: Number(existing.id),
      name: existing.district_name,
      code: existing.district_code
    };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23503") {
      throw new HttpError(
        409,
        "This district still has related records and cannot be deleted.",
        "DISTRICT_IN_USE"
      );
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  listForUser,
  hierarchyForUser,
  getDistrict,
  findById,
  requireDistrict,
  createDistrict,
  updateDistrict,
  deleteDistrict
};
