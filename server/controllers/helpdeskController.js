"use strict";

const helpdeskService = require("../services/helpdeskService");
const { requireIdParam } = require("../utils/validators");

async function content(req, res) {
  const data = await helpdeskService.loadContent();
  res.json({ data });
}

async function meta(req, res) {
  res.json({ data: helpdeskService.adminMeta() });
}

async function listArticles(req, res) {
  const result = await helpdeskService.listAdminArticles(req.query);
  res.json({
    data: result.articles,
    pagination: {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: Math.max(1, Math.ceil(result.total / result.pageSize))
    }
  });
}

async function articleDetail(req, res) {
  const data = await helpdeskService.getAdminArticle(
    requireIdParam(req.params.id, "Article ID")
  );
  res.json({ data });
}

async function createArticle(req, res) {
  const data = await helpdeskService.createArticle(req.user, req.body || {}, req.ip);
  res.status(201).json({ data });
}

async function updateArticle(req, res) {
  const data = await helpdeskService.updateArticle(
    req.user,
    requireIdParam(req.params.id, "Article ID"),
    req.body || {},
    req.ip
  );
  res.json({ data });
}

async function deleteArticle(req, res) {
  const data = await helpdeskService.deleteArticle(
    req.user,
    requireIdParam(req.params.id, "Article ID"),
    req.ip
  );
  res.json({ data });
}

async function listCategories(req, res) {
  const data = await helpdeskService.listAdminCategories();
  res.json({ data });
}

async function categoryDetail(req, res) {
  const data = await helpdeskService.getAdminCategory(
    requireIdParam(req.params.id, "Category ID")
  );
  res.json({ data });
}

async function createCategory(req, res) {
  const data = await helpdeskService.createCategory(req.user, req.body || {}, req.ip);
  res.status(201).json({ data });
}

async function updateCategory(req, res) {
  const data = await helpdeskService.updateCategory(
    req.user,
    requireIdParam(req.params.id, "Category ID"),
    req.body || {},
    req.ip
  );
  res.json({ data });
}

async function deleteCategory(req, res) {
  const data = await helpdeskService.deleteCategory(
    req.user,
    requireIdParam(req.params.id, "Category ID"),
    req.ip
  );
  res.json({ data });
}

module.exports = {
  content,
  meta,
  listArticles,
  articleDetail,
  createArticle,
  updateArticle,
  deleteArticle,
  listCategories,
  categoryDetail,
  createCategory,
  updateCategory,
  deleteCategory
};
