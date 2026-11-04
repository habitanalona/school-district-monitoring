"use strict";

const express = require("express");
const schoolController = require("../controllers/schoolController");
const schoolImportController = require("../controllers/schoolImportController");
const schoolLogoController = require("../controllers/schoolLogoController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireAdmin } = require("../middleware/roleMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { schoolImportUpload } = require("../middleware/schoolImportUpload");
const { schoolLogoUpload } = require("../middleware/schoolLogoUpload");
const { schoolImportLimiter, schoolLogoLimiter } = require("../middleware/rateLimiters");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("schools"));
router.get("/sidebar", asyncHandler(schoolController.sidebar));
router.get("/", asyncHandler(schoolController.list));

// Bulk import endpoints are declared before /:id so a literal path is never
// interpreted as a school identifier. District administrators are limited to
// schools in their own district by the import service.
router.get(
  "/imports/template",
  requireAdmin,
  requireModule("schools", "add"),
  asyncHandler(schoolImportController.template)
);
router.get(
  "/imports",
  requireAdmin,
  requireModule("schools", "add"),
  asyncHandler(schoolImportController.history)
);
router.post(
  "/imports/preview",
  requireAdmin,
  requireModule("schools", "add"),
  schoolImportLimiter,
  schoolImportUpload,
  asyncHandler(schoolImportController.preview)
);
router.get(
  "/imports/:id/errors.xlsx",
  requireAdmin,
  requireModule("schools", "add"),
  asyncHandler(schoolImportController.errorReport)
);
router.post(
  "/imports/:id/commit",
  requireAdmin,
  requireModule("schools", "add"),
  asyncHandler(schoolImportController.commit)
);

router.get("/:id/logo", asyncHandler(schoolLogoController.serve));
router.post(
  "/:id/logo",
  requireAdmin,
  requireModule("schools", "edit"),
  schoolLogoLimiter,
  schoolLogoUpload,
  asyncHandler(schoolLogoController.upload)
);
router.delete(
  "/:id/logo",
  requireAdmin,
  requireModule("schools", "edit"),
  schoolLogoLimiter,
  asyncHandler(schoolLogoController.remove)
);

router.get("/:id", asyncHandler(schoolController.detail));
router.post("/", requireAdmin, requireModule("schools", "add"), asyncHandler(schoolController.create));
router.put("/:id", requireAdmin, requireModule("schools", "edit"), asyncHandler(schoolController.update));
router.patch("/:id/archive", requireAdmin, requireModule("schools", "delete"), asyncHandler(schoolController.archive));
router.patch("/:id/restore", requireAdmin, requireModule("schools", "delete"), asyncHandler(schoolController.restore));

module.exports = router;
