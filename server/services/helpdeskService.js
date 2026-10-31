"use strict";

// Helpdesk knowledge-base service.
//
// Everything in this module is additive: it reads and writes only the
// helpdesk_categories and helpdesk_articles tables. Existing school, learner,
// reporting, and permission data is never touched.

const { query } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const auditService = require("./auditService");
const {
  PAGE_KEYS
} = require("../data/helpdeskContent");
const {
  requireString,
  optionalString,
  requireInteger,
  requireEnum,
  parseBoolean,
  parsePagination,
  requireIdParam
} = require("../utils/validators");

const ARTICLE_TYPES = ["article", "faq", "procedure", "reference"];
const SLUG_PATTERN = /^[a-z0-9-]{3,100}$/;
const CATEGORY_SLUG_PATTERN = /^[a-z0-9-]{2,80}$/;
const ICON_PATTERN = /^bi-[a-z0-9-]{1,36}$/;

function validation(message, field) {
  throw new HttpError(400, message, "VALIDATION_ERROR", field ? { field } : undefined);
}

function notFound(message = "Help article could not be found.") {
  throw new HttpError(404, message, "NOT_FOUND");
}

function mapDatabaseError(error) {
  if (error && error.code === "23505") {
    throw new HttpError(
      409,
      "An entry with this slug already exists. Choose a different slug.",
      "CONFLICT",
      { field: "slug" }
    );
  }
  if (error && error.code === "23503") {
    throw new HttpError(
      409,
      "This category or account is no longer available. Refresh the page and try again.",
      "CONFLICT"
    );
  }
  throw error;
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function stringArray(value, field, { maxItems = 40, maxLength = 400 } = {}) {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    validation(`${field} must be a list.`, field);
  }
  if (value.length > maxItems) {
    validation(`${field} may contain at most ${maxItems} entries.`, field);
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .map((entry) => entry.slice(0, maxLength));
}

function normalizePagePaths(value) {
  const paths = stringArray(value, "Page paths", { maxItems: 40, maxLength: 60 });
  const unknown = paths.filter((path) => PAGE_KEYS.indexOf(path) === -1);
  if (unknown.length) {
    validation(`Unknown page key: ${unknown[0]}.`, "pagePaths");
  }
  return Array.from(new Set(paths));
}

function serializeArticle(row) {
  return {
    id: Number(row.id),
    categoryId: Number(row.category_id),
    categorySlug: row.category_slug || null,
    categoryTitle: row.category_title || null,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    body: row.body || "",
    articleType: row.article_type,
    steps: Array.isArray(row.steps) ? row.steps : [],
    notes: Array.isArray(row.notes) ? row.notes : [],
    keywords: Array.isArray(row.keywords) ? row.keywords : [],
    pagePaths: Array.isArray(row.page_paths) ? row.page_paths : [],
    isFeatured: Boolean(row.is_featured),
    isPublished: Boolean(row.is_published),
    isDeleted: Boolean(row.is_deleted),
    sortOrder: Number(row.sort_order),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function serializeCategory(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    description: row.description || "",
    icon: row.icon,
    sortOrder: Number(row.sort_order),
    isActive: Boolean(row.is_active),
    isDeleted: Boolean(row.is_deleted),
    articleCount: row.article_count === undefined ? undefined : Number(row.article_count),
    publishedCount:
      row.published_count === undefined ? undefined : Number(row.published_count),
    updatedAt: row.updated_at
  };
}

function adminMeta() {
  return {
    pageKeys: PAGE_KEYS.slice(),
    articleTypes: ARTICLE_TYPES.slice()
  };
}

async function loadContent() {
  const categories = await query(
    `SELECT id, slug, title, description, icon, sort_order, is_active, is_deleted, updated_at
     FROM helpdesk_categories
     WHERE is_active = TRUE AND is_deleted = FALSE
     ORDER BY sort_order ASC, title ASC`
  );
  const articles = await query(
    `SELECT a.*, c.slug AS category_slug, c.title AS category_title
     FROM helpdesk_articles a
     JOIN helpdesk_categories c ON c.id = a.category_id
     WHERE a.is_published = TRUE
       AND a.is_deleted = FALSE
       AND c.is_active = TRUE
       AND c.is_deleted = FALSE
     ORDER BY c.sort_order ASC, a.sort_order ASC, a.title ASC`
  );
  return {
    categories: categories.rows.map(serializeCategory),
    articles: articles.rows.map(serializeArticle)
  };
}

async function requireCategory(categoryId, runner = null) {
  const db = runner || { query };
  const result = await db.query(
    "SELECT id, slug, title FROM helpdesk_categories WHERE id = $1 AND is_deleted = FALSE",
    [categoryId]
  );
  if (!result.rows.length) {
    validation("Choose a valid helpdesk category.", "categoryId");
  }
  return result.rows[0];
}

async function listAdminArticles(params) {
  const pagination = parsePagination(params);
  const search = optionalString(params.search, "Search", { max: 120 });
  const status = optionalEnumValue(params.status, ["all", "published", "draft"]);
  const categoryId = params.categoryId
    ? requireInteger(params.categoryId, "Category", { min: 1 })
    : null;

  const filters = ["a.is_deleted = FALSE"];
  const values = [];
  if (search) {
    values.push(`%${search}%`);
    filters.push(
      `(a.title ILIKE $${values.length} OR a.summary ILIKE $${values.length} OR a.body ILIKE $${values.length} OR a.slug ILIKE $${values.length})`
    );
  }
  if (status === "published") {
    filters.push("a.is_published = TRUE");
  } else if (status === "draft") {
    filters.push("a.is_published = FALSE");
  }
  if (categoryId) {
    values.push(categoryId);
    filters.push(`a.category_id = $${values.length}`);
  }
  const where = filters.join(" AND ");

  const count = await query(
    `SELECT COUNT(*)::int AS total FROM helpdesk_articles a WHERE ${where}`,
    values
  );
  values.push(pagination.pageSize, pagination.offset);
  const rows = await query(
    `SELECT a.*, c.slug AS category_slug, c.title AS category_title
     FROM helpdesk_articles a
     JOIN helpdesk_categories c ON c.id = a.category_id
     WHERE ${where}
     ORDER BY c.sort_order ASC, a.sort_order ASC, a.title ASC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );

  return {
    articles: rows.rows.map(serializeArticle),
    total: count.rows[0].total,
    page: pagination.page,
    pageSize: pagination.pageSize
  };
}

function optionalEnumValue(value, allowed) {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (allowed.indexOf(value) === -1) {
    validation(`Status must be one of: ${allowed.join(", ")}.`, "status");
  }
  return value;
}

async function getAdminArticle(id) {
  const result = await query(
    `SELECT a.*, c.slug AS category_slug, c.title AS category_title
     FROM helpdesk_articles a
     JOIN helpdesk_categories c ON c.id = a.category_id
     WHERE a.id = $1`,
    [id]
  );
  if (!result.rows.length) {
    notFound();
  }
  return serializeArticle(result.rows[0]);
}

function articlePayload(input, current) {
  const existing = current || {};
  const title = requireString(
    input.title === undefined ? existing.title : input.title,
    "Title",
    { min: 3, max: 140 }
  );
  const summary = requireString(
    input.summary === undefined ? existing.summary : input.summary,
    "Summary",
    { min: 10, max: 300 }
  );
  const body =
    optionalString(input.body === undefined ? existing.body : input.body, "Body", {
      max: 50000
    }) || "";
  const articleType = requireEnum(
    input.articleType === undefined ? existing.articleType || "article" : input.articleType,
    "Article type",
    ARTICLE_TYPES
  );
  const categoryId = requireInteger(
    input.categoryId === undefined ? existing.categoryId : input.categoryId,
    "Category",
    { min: 1 }
  );
  const rawSlug =
    input.slug === undefined || input.slug === null || input.slug === ""
      ? slugify(title)
      : String(input.slug).trim().toLowerCase();
  if (!SLUG_PATTERN.test(rawSlug)) {
    validation(
      "Slug must use 3 to 100 lowercase letters, numbers, or hyphens.",
      "slug"
    );
  }
  // A retitled article keeps its published identifier unless a new slug is
  // supplied, so bookmarked and shared links stay stable.
  const slug = input.slug === undefined && existing.slug ? existing.slug : rawSlug;

  return {
    title,
    summary,
    body,
    articleType,
    categoryId,
    slug,
    steps: stringArray(input.steps === undefined ? existing.steps : input.steps, "Steps"),
    notes: stringArray(input.notes === undefined ? existing.notes : input.notes, "Notes"),
    keywords: stringArray(
      input.keywords === undefined ? existing.keywords : input.keywords,
      "Keywords",
      { maxItems: 25, maxLength: 60 }
    ),
    pagePaths: normalizePagePaths(
      input.pagePaths === undefined ? existing.pagePaths : input.pagePaths
    ),
    isFeatured:
      input.isFeatured === undefined
        ? Boolean(existing.isFeatured)
        : parseBoolean(input.isFeatured, false),
    isPublished:
      input.isPublished === undefined
        ? existing.isPublished === undefined
          ? true
          : Boolean(existing.isPublished)
        : parseBoolean(input.isPublished, false),
    sortOrder:
      input.sortOrder === undefined
        ? Number(existing.sortOrder || 0)
        : requireInteger(input.sortOrder, "Sort order", { min: 0, max: 999 })
  };
}

async function createArticle(actor, input, ipAddress) {
  const payload = articlePayload(input, null);
  await requireCategory(payload.categoryId);

  let result;
  try {
    result = await query(
      `INSERT INTO helpdesk_articles
         (category_id, slug, title, summary, body, article_type, steps, notes,
          keywords, page_paths, is_featured, is_published, sort_order,
          created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::text[],
               $10::text[], $11, $12, $13, $14, $14)
       RETURNING id`,
      [
        payload.categoryId,
        payload.slug,
        payload.title,
        payload.summary,
        payload.body,
        payload.articleType,
        JSON.stringify(payload.steps),
        JSON.stringify(payload.notes),
        payload.keywords,
        payload.pagePaths,
        payload.isFeatured,
        payload.isPublished,
        payload.sortOrder,
        actor.id
      ]
    );
  } catch (error) {
    mapDatabaseError(error);
  }

  const article = await getAdminArticle(Number(result.rows[0].id));
  await auditService.recordForRequest(
    { user: actor, ip: ipAddress },
    {
      action: "helpdesk.article_created",
      entityType: "helpdesk_article",
      entityId: article.id,
      details: { slug: article.slug, title: article.title }
    }
  );
  return article;
}

async function updateArticle(actor, id, input, ipAddress) {
  const current = await getAdminArticle(id);
  const payload = articlePayload(input, current);
  await requireCategory(payload.categoryId);

  try {
    const result = await query(
      `UPDATE helpdesk_articles SET
         category_id = $2, slug = $3, title = $4, summary = $5, body = $6,
         article_type = $7, steps = $8::jsonb, notes = $9::jsonb,
         keywords = $10::text[], page_paths = $11::text[],
         is_featured = $12, is_published = $13, sort_order = $14,
         updated_by = $15, updated_at = now()
       WHERE id = $1 AND is_deleted = FALSE`,
      [
        id,
        payload.categoryId,
        payload.slug,
        payload.title,
        payload.summary,
        payload.body,
        payload.articleType,
        JSON.stringify(payload.steps),
        JSON.stringify(payload.notes),
        payload.keywords,
        payload.pagePaths,
        payload.isFeatured,
        payload.isPublished,
        payload.sortOrder,
        actor.id
      ]
    );
    if (!result.rowCount) {
      notFound();
    }
  } catch (error) {
    mapDatabaseError(error);
  }

  const article = await getAdminArticle(id);
  await auditService.recordForRequest(
    { user: actor, ip: ipAddress },
    {
      action: "helpdesk.article_updated",
      entityType: "helpdesk_article",
      entityId: article.id,
      details: {
        slug: article.slug,
        title: article.title,
        published: article.isPublished
      }
    }
  );
  return article;
}

async function deleteArticle(actor, id, ipAddress) {
  const current = await getAdminArticle(id);
  const result = await query(
    `UPDATE helpdesk_articles
     SET is_deleted = TRUE, is_published = FALSE, updated_by = $2, updated_at = now()
     WHERE id = $1 AND is_deleted = FALSE`,
    [id, actor.id]
  );
  if (!result.rowCount) {
    notFound();
  }
  await auditService.recordForRequest(
    { user: actor, ip: ipAddress },
    {
      action: "helpdesk.article_deleted",
      entityType: "helpdesk_article",
      entityId: current.id,
      details: { slug: current.slug, title: current.title }
    }
  );
  return { id: current.id, deleted: true };
}

async function listAdminCategories() {
  const result = await query(
    `SELECT c.*,
            COUNT(a.id) FILTER (WHERE a.is_deleted = FALSE)::int AS article_count,
            COUNT(a.id) FILTER (WHERE a.is_deleted = FALSE AND a.is_published = TRUE)::int AS published_count
     FROM helpdesk_categories c
     LEFT JOIN helpdesk_articles a ON a.category_id = c.id
     WHERE c.is_deleted = FALSE
     GROUP BY c.id
     ORDER BY c.sort_order ASC, c.title ASC`
  );
  return result.rows.map(serializeCategory);
}

function categoryPayload(input, current) {
  const existing = current || {};
  const title = requireString(
    input.title === undefined ? existing.title : input.title,
    "Category title",
    { min: 2, max: 120 }
  );
  const rawSlug =
    input.slug === undefined || input.slug === null || input.slug === ""
      ? existing.slug || slugify(title)
      : String(input.slug).trim().toLowerCase();
  if (!CATEGORY_SLUG_PATTERN.test(rawSlug)) {
    validation(
      "Category slug must use 2 to 80 lowercase letters, numbers, or hyphens.",
      "slug"
    );
  }
  const iconValue =
    input.icon === undefined ? existing.icon || "bi-question-circle" : String(input.icon).trim();
  if (!ICON_PATTERN.test(iconValue)) {
    validation("Icon must be a Bootstrap icon name such as bi-question-circle.", "icon");
  }
  return {
    title,
    slug: rawSlug,
    description:
      optionalString(
        input.description === undefined ? existing.description : input.description,
        "Description",
        { max: 400 }
      ) || "",
    icon: iconValue,
    sortOrder:
      input.sortOrder === undefined
        ? Number(existing.sortOrder || 0)
        : requireInteger(input.sortOrder, "Sort order", { min: 0, max: 999 }),
    isActive:
      input.isActive === undefined
        ? existing.isActive === undefined
          ? true
          : Boolean(existing.isActive)
        : parseBoolean(input.isActive, false)
  };
}

async function getAdminCategory(id) {
  const result = await query(
    "SELECT * FROM helpdesk_categories WHERE id = $1 AND is_deleted = FALSE",
    [id]
  );
  if (!result.rows.length) {
    notFound("Helpdesk category could not be found.");
  }
  return serializeCategory(result.rows[0]);
}

async function createCategory(actor, input, ipAddress) {
  const payload = categoryPayload(input, null);
  let result;
  try {
    result = await query(
      `INSERT INTO helpdesk_categories
         (slug, title, description, icon, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        payload.slug,
        payload.title,
        payload.description,
        payload.icon,
        payload.sortOrder,
        payload.isActive
      ]
    );
  } catch (error) {
    mapDatabaseError(error);
  }
  const category = await getAdminCategory(Number(result.rows[0].id));
  await auditService.recordForRequest(
    { user: actor, ip: ipAddress },
    {
      action: "helpdesk.category_created",
      entityType: "helpdesk_category",
      entityId: category.id,
      details: { slug: category.slug, title: category.title }
    }
  );
  return category;
}

async function updateCategory(actor, id, input, ipAddress) {
  const current = await getAdminCategory(id);
  const payload = categoryPayload(input, current);
  try {
    const result = await query(
      `UPDATE helpdesk_categories SET
         slug = $2, title = $3, description = $4, icon = $5,
         sort_order = $6, is_active = $7, updated_at = now()
       WHERE id = $1 AND is_deleted = FALSE`,
      [
        id,
        payload.slug,
        payload.title,
        payload.description,
        payload.icon,
        payload.sortOrder,
        payload.isActive
      ]
    );
    if (!result.rowCount) {
      notFound("Helpdesk category could not be found.");
    }
  } catch (error) {
    mapDatabaseError(error);
  }
  const category = await getAdminCategory(id);
  await auditService.recordForRequest(
    { user: actor, ip: ipAddress },
    {
      action: "helpdesk.category_updated",
      entityType: "helpdesk_category",
      entityId: category.id,
      details: {
        slug: category.slug,
        title: category.title,
        active: category.isActive
      }
    }
  );
  return category;
}

async function deleteCategory(actor, id, ipAddress) {
  const current = await getAdminCategory(id);
  const inUse = await query(
    `SELECT COUNT(*)::int AS total
     FROM helpdesk_articles
     WHERE category_id = $1 AND is_deleted = FALSE`,
    [id]
  );
  if (inUse.rows[0].total > 0) {
    throw new HttpError(
      409,
      "This category still contains articles. Move or delete them first, or hide the category instead.",
      "CONFLICT"
    );
  }
  // Soft removal keeps the slug reserved, so a later migration cannot restore
  // a category the administrator intentionally removed.
  const result = await query(
    `UPDATE helpdesk_categories
     SET is_deleted = TRUE, is_active = FALSE, updated_at = now()
     WHERE id = $1 AND is_deleted = FALSE`,
    [id]
  );
  if (!result.rowCount) {
    notFound("Helpdesk category could not be found.");
  }
  await auditService.recordForRequest(
    { user: actor, ip: ipAddress },
    {
      action: "helpdesk.category_deleted",
      entityType: "helpdesk_category",
      entityId: current.id,
      details: { slug: current.slug, title: current.title }
    }
  );
  return { id: current.id, deleted: true };
}

module.exports = {
  adminMeta,
  loadContent,
  listAdminArticles,
  getAdminArticle,
  createArticle,
  updateArticle,
  deleteArticle,
  listAdminCategories,
  getAdminCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  ARTICLE_TYPES,
  slugify,
  requireIdParam
};
