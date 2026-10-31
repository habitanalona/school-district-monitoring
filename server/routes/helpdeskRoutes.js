"use strict";

const express = require("express");
const helpdeskController = require("../controllers/helpdeskController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

// Read-only knowledge base. Every page, including the public sign-in and
// registration screens, loads this content for the floating Helpdesk panel.
router.get("/content", asyncHandler(helpdeskController.content));

// Content administration. Only accounts granted the helpdesk module may list
// drafts or change knowledge-base entries.
router.use("/admin", requireAuth, requireModule("helpdesk", "access"));

router.get("/admin/meta", asyncHandler(helpdeskController.meta));
router.get("/admin/articles", asyncHandler(helpdeskController.listArticles));
router.get("/admin/articles/:id", asyncHandler(helpdeskController.articleDetail));
router.post(
  "/admin/articles",
  requireModule("helpdesk", "add"),
  asyncHandler(helpdeskController.createArticle)
);
router.put(
  "/admin/articles/:id",
  requireModule("helpdesk", "edit"),
  asyncHandler(helpdeskController.updateArticle)
);
router.delete(
  "/admin/articles/:id",
  requireModule("helpdesk", "delete"),
  asyncHandler(helpdeskController.deleteArticle)
);

router.get("/admin/categories", asyncHandler(helpdeskController.listCategories));
router.get("/admin/categories/:id", asyncHandler(helpdeskController.categoryDetail));
router.post(
  "/admin/categories",
  requireModule("helpdesk", "add"),
  asyncHandler(helpdeskController.createCategory)
);
router.put(
  "/admin/categories/:id",
  requireModule("helpdesk", "edit"),
  asyncHandler(helpdeskController.updateCategory)
);
router.delete(
  "/admin/categories/:id",
  requireModule("helpdesk", "delete"),
  asyncHandler(helpdeskController.deleteCategory)
);

module.exports = router;
