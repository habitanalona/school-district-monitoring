"use strict";

// Run with NODE_ENV=test before the app (and its session store) is loaded.
process.env.NODE_ENV = "test";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const request = require("supertest");

const app = require("../server/app");
const { pool } = require("../server/config/database");
const { PAGE_KEYS } = require("../server/data/helpdeskContent");

const PREFIX = "hdt";
const CATEGORY_SLUG = `${PREFIX}-test-category`;
const ARTICLE_SLUG = `${PREFIX}-test-article`;
const DEMO = {
  system: { username: "sysadmin", password: "Admin@2026" },
  districtAdmin: { username: "northadmin", password: "District@2026" }
};

let system = null;
let districtAdmin = null;
let categoryId = null;
let articleId = null;

async function cleanup() {
  await pool.query("DELETE FROM helpdesk_articles WHERE slug LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM helpdesk_categories WHERE slug LIKE $1", [`${PREFIX}-%`]);
  await pool.query("DELETE FROM audit_logs WHERE details::text ILIKE $1", [`%${PREFIX}-%`]);
}

async function fetchCsrf(agent) {
  const response = await agent.get("/api/auth/csrf");
  assert.equal(response.status, 200);
  assert.ok(response.body.data.csrfToken);
  return response.body.data.csrfToken;
}

async function login(credentials) {
  const agent = request.agent(app);
  const token = await fetchCsrf(agent);
  const response = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", token)
    .send({ identifier: credentials.username, password: credentials.password });
  assert.equal(
    response.status,
    200,
    `login for ${credentials.username} should succeed: ${JSON.stringify(response.body)}`
  );
  return {
    agent,
    csrfToken: response.body.data.csrfToken || token,
    user: response.body.data.user
  };
}

function articlePayload(overrides = {}) {
  return {
    categoryId,
    title: "Helpdesk test article",
    slug: ARTICLE_SLUG,
    summary: "A test summary that is long enough for validation.",
    body: "First paragraph explains the behaviour.\n\nSecond paragraph adds detail.",
    articleType: "procedure",
    steps: ["Open the page.", "Complete the field.", "Save the record."],
    notes: ["This is a reminder."],
    keywords: ["hdt", "helpdesk", "test"],
    pagePaths: ["learners", "reports"],
    isFeatured: true,
    isPublished: true,
    sortOrder: 5,
    ...overrides
  };
}

before(async () => {
  await cleanup();
  system = await login(DEMO.system);
  districtAdmin = await login(DEMO.districtAdmin);
});

after(async () => {
  await cleanup();
  await pool.end();
});

test("public content is readable without a session and is well formed", async () => {
  const response = await request(app).get("/api/helpdesk/content");
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.body.data.categories));
  assert.ok(Array.isArray(response.body.data.articles));
  assert.ok(response.body.data.categories.length > 0);
  assert.ok(response.body.data.articles.length > 0);
  assert.ok(
    response.body.data.articles.some((article) => article.slug === "welcome-to-sdms"),
    "the seeded welcome article should be present"
  );
  response.body.data.articles.forEach((article) => {
    assert.ok(article.id && article.title && article.summary);
    assert.ok(["article", "faq", "procedure", "reference"].includes(article.articleType));
    assert.equal(article.isPublished, true);
    assert.equal(article.isDeleted, false);
  });

  const tagged = new Set();
  response.body.data.articles.forEach((article) => {
    (article.pagePaths || []).forEach((page) => tagged.add(page));
  });
  PAGE_KEYS.forEach((page) => {
    assert.ok(
      tagged.has(page),
      `the helpdesk catalogue should contain context help for the ${page} page`
    );
  });
});

test("every page loads the floating Helpdesk assets", async () => {
  const clientDir = path.join(process.cwd(), "client");
  const pages = fs.readdirSync(clientDir).filter((file) => file.endsWith(".html"));
  assert.ok(pages.length >= 35);
  pages.forEach((page) => {
    const html = fs.readFileSync(path.join(clientDir, page), "utf8");
    assert.match(html, /css\/helpdesk\.css/, `${page} should include helpdesk.css`);
    assert.match(html, /js\/helpdesk\.js/, `${page} should include helpdesk.js`);
  });

  const publicPage = await request(app).get("/index.html");
  assert.equal(publicPage.status, 200);
  assert.match(publicPage.text, /js\/helpdesk\.js/);

  const dashboard = await system.agent.get("/dashboard.html");
  assert.equal(dashboard.status, 200);
  assert.match(dashboard.text, /js\/helpdesk\.js/);
});

test("only Helpdesk Content managers can open the administration page and API", async () => {
  const deniedPage = await districtAdmin.agent.get("/helpdesk-admin.html");
  assert.equal(deniedPage.status, 403);

  const deniedApi = await districtAdmin.agent.get("/api/helpdesk/admin/articles");
  assert.equal(deniedApi.status, 403);
  assert.equal(deniedApi.body.code, "FORBIDDEN");

  const page = await system.agent.get("/helpdesk-admin.html");
  assert.equal(page.status, 200);
  assert.match(page.text, /Helpdesk content/);

  const meta = await system.agent.get("/api/helpdesk/admin/meta");
  assert.equal(meta.status, 200);
  assert.ok(meta.body.data.pageKeys.includes("learners"));
  assert.ok(meta.body.data.articleTypes.includes("faq"));

  const categories = await system.agent.get("/api/helpdesk/admin/categories");
  assert.equal(categories.status, 200);
  assert.ok(categories.body.data.length > 0);
});

test("administrators can create, publish, hide, and remove a category and article", async () => {
  const categoryResponse = await system.agent
    .post("/api/helpdesk/admin/categories")
    .set("X-CSRF-Token", system.csrfToken)
    .send({
      title: "Helpdesk test category",
      slug: CATEGORY_SLUG,
      description: "A temporary category created by the automated helpdesk test.",
      icon: "bi-question-circle",
      sortOrder: 90,
      isActive: true
    });
  assert.equal(categoryResponse.status, 201, JSON.stringify(categoryResponse.body));
  categoryId = Number(categoryResponse.body.data.id);

  const createArticle = await system.agent
    .post("/api/helpdesk/admin/articles")
    .set("X-CSRF-Token", system.csrfToken)
    .send(articlePayload());
  assert.equal(createArticle.status, 201, JSON.stringify(createArticle.body));
  articleId = Number(createArticle.body.data.id);
  assert.equal(createArticle.body.data.slug, ARTICLE_SLUG);
  assert.deepEqual(createArticle.body.data.steps, articlePayload().steps);
  assert.equal(createArticle.body.data.isPublished, true);

  const publicAfterCreate = await request(app).get("/api/helpdesk/content");
  assert.ok(
    publicAfterCreate.body.data.articles.some((article) => article.slug === ARTICLE_SLUG)
  );
  assert.ok(
    publicAfterCreate.body.data.categories.some((category) => category.slug === CATEGORY_SLUG)
  );

  const categoryInUse = await system.agent
    .delete(`/api/helpdesk/admin/categories/${categoryId}`)
    .set("X-CSRF-Token", system.csrfToken);
  assert.equal(categoryInUse.status, 409);
  assert.equal(categoryInUse.body.code, "CONFLICT");

  const hideCategory = await system.agent
    .put(`/api/helpdesk/admin/categories/${categoryId}`)
    .set("X-CSRF-Token", system.csrfToken)
    .send({ isActive: false });
  assert.equal(hideCategory.status, 200);
  assert.equal(hideCategory.body.data.isActive, false);

  const publicWhileHidden = await request(app).get("/api/helpdesk/content");
  assert.ok(
    !publicWhileHidden.body.data.articles.some((article) => article.slug === ARTICLE_SLUG)
  );
  assert.ok(
    !publicWhileHidden.body.data.categories.some((category) => category.slug === CATEGORY_SLUG)
  );

  const showCategory = await system.agent
    .put(`/api/helpdesk/admin/categories/${categoryId}`)
    .set("X-CSRF-Token", system.csrfToken)
    .send({ isActive: true });
  assert.equal(showCategory.status, 200);
  assert.equal(showCategory.body.data.isActive, true);

  const unpublish = await system.agent
    .put(`/api/helpdesk/admin/articles/${articleId}`)
    .set("X-CSRF-Token", system.csrfToken)
    .send({ isPublished: false });
  assert.equal(unpublish.status, 200);
  assert.equal(unpublish.body.data.isPublished, false);
  assert.equal(unpublish.body.data.title, "Helpdesk test article");

  const publicWhileDraft = await request(app).get("/api/helpdesk/content");
  assert.ok(
    !publicWhileDraft.body.data.articles.some((article) => article.slug === ARTICLE_SLUG)
  );

  const adminDrafts = await system.agent.get(
    `/api/helpdesk/admin/articles?search=${ARTICLE_SLUG}&status=draft`
  );
  assert.equal(adminDrafts.status, 200);
  assert.equal(adminDrafts.body.data.length, 1);

  const republish = await system.agent
    .put(`/api/helpdesk/admin/articles/${articleId}`)
    .set("X-CSRF-Token", system.csrfToken)
    .send({ isPublished: true });
  assert.equal(republish.status, 200);

  const deleteArticle = await system.agent
    .delete(`/api/helpdesk/admin/articles/${articleId}`)
    .set("X-CSRF-Token", system.csrfToken);
  assert.equal(deleteArticle.status, 200);
  assert.equal(deleteArticle.body.data.deleted, true);

  const publicAfterDelete = await request(app).get("/api/helpdesk/content");
  assert.ok(
    !publicAfterDelete.body.data.articles.some((article) => article.slug === ARTICLE_SLUG)
  );

  const adminAfterDelete = await system.agent.get(
    `/api/helpdesk/admin/articles?search=${ARTICLE_SLUG}`
  );
  assert.equal(adminAfterDelete.status, 200);
  assert.equal(adminAfterDelete.body.data.length, 0);

  const deleteCategory = await system.agent
    .delete(`/api/helpdesk/admin/categories/${categoryId}`)
    .set("X-CSRF-Token", system.csrfToken);
  assert.equal(deleteCategory.status, 200);
  assert.equal(deleteCategory.body.data.deleted, true);

  const publicCategories = await request(app).get("/api/helpdesk/content");
  assert.ok(
    !publicCategories.body.data.categories.some((category) => category.slug === CATEGORY_SLUG)
  );

  const audit = await pool.query(
    "SELECT action FROM audit_logs WHERE details->>'slug' IN ($1, $2)",
    [CATEGORY_SLUG, ARTICLE_SLUG]
  );
  const actions = audit.rows.map((row) => row.action);
  ["helpdesk.category_created", "helpdesk.article_created", "helpdesk.article_updated", "helpdesk.article_deleted", "helpdesk.category_deleted"].forEach(
    (action) => {
      assert.ok(actions.includes(action), `${action} should be audited`);
    }
  );
});

test("invalid helpdesk input is rejected without changing content", async () => {
  const category = await system.agent
    .post("/api/helpdesk/admin/categories")
    .set("X-CSRF-Token", system.csrfToken)
    .send({
      title: "Helpdesk validation category",
      slug: `${PREFIX}-validation`,
      icon: "bi-question-circle",
      sortOrder: 95
    });
  assert.equal(category.status, 201);
  const validationCategoryId = Number(category.body.data.id);

  const shortSummary = await system.agent
    .post("/api/helpdesk/admin/articles")
    .set("X-CSRF-Token", system.csrfToken)
    .send(
      articlePayload({
        slug: `${PREFIX}-short-summary`,
        categoryId: validationCategoryId,
        summary: "too short"
      })
    );
  assert.equal(shortSummary.status, 400);
  assert.equal(shortSummary.body.code, "VALIDATION_ERROR");

  const badType = await system.agent
    .post("/api/helpdesk/admin/articles")
    .set("X-CSRF-Token", system.csrfToken)
    .send(
      articlePayload({
        slug: `${PREFIX}-bad-type`,
        categoryId: validationCategoryId,
        articleType: "announcement"
      })
    );
  assert.equal(badType.status, 400);

  const badPage = await system.agent
    .post("/api/helpdesk/admin/articles")
    .set("X-CSRF-Token", system.csrfToken)
    .send(
      articlePayload({
        slug: `${PREFIX}-bad-page`,
        categoryId: validationCategoryId,
        pagePaths: ["not-a-real-page"]
      })
    );
  assert.equal(badPage.status, 400);

  const missingArticle = await system.agent
    .delete("/api/helpdesk/admin/articles/999999999")
    .set("X-CSRF-Token", system.csrfToken);
  assert.equal(missingArticle.status, 404);

  const cleanupCategory = await system.agent
    .delete(`/api/helpdesk/admin/categories/${validationCategoryId}`)
    .set("X-CSRF-Token", system.csrfToken);
  assert.equal(cleanupCategory.status, 200);
});

test("duplicate slugs are rejected with a conflict", async () => {
  const first = await system.agent
    .post("/api/helpdesk/admin/categories")
    .set("X-CSRF-Token", system.csrfToken)
    .send({
      title: "Helpdesk duplicate category",
      slug: `${PREFIX}-duplicate`,
      icon: "bi-question-circle",
      sortOrder: 96
    });
  assert.equal(first.status, 201);
  const duplicateCategoryId = Number(first.body.data.id);

  const article = await system.agent
    .post("/api/helpdesk/admin/articles")
    .set("X-CSRF-Token", system.csrfToken)
    .send(
      articlePayload({
        categoryId: duplicateCategoryId,
        slug: `${PREFIX}-duplicate-article`
      })
    );
  assert.equal(article.status, 201);

  const duplicate = await system.agent
    .post("/api/helpdesk/admin/articles")
    .set("X-CSRF-Token", system.csrfToken)
    .send(
      articlePayload({
        categoryId: duplicateCategoryId,
        slug: `${PREFIX}-duplicate-article`,
        title: "Another article with the same slug"
      })
    );
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, "CONFLICT");
});
