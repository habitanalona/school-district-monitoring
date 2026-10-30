"use strict";

const express = require("express");
const districtController = require("../controllers/districtController");
const districtImportController = require("../controllers/districtImportController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireSystemAdmin } = require("../middleware/roleMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { districtImportUpload } = require("../middleware/districtImportUpload");
const { districtImportLimiter } = require("../middleware/rateLimiters");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("districts"));
router.get("/", asyncHandler(districtController.list));
router.get("/hierarchy", asyncHandler(districtController.hierarchy));

// Bulk import endpoints are declared before /:id so a literal path is never
// interpreted as a district identifier.
router.get(
  "/imports/template",
  requireSystemAdmin,
  requireModule("districts", "add"),
  asyncHandler(districtImportController.template)
);
router.get(
  "/imports",
  requireSystemAdmin,
  requireModule("districts", "add"),
  asyncHandler(districtImportController.history)
);
router.post(
  "/imports/preview",
  requireSystemAdmin,
  requireModule("districts", "add"),
  districtImportLimiter,
  districtImportUpload,
  asyncHandler(districtImportController.preview)
);
router.get(
  "/imports/:id/errors.xlsx",
  requireSystemAdmin,
  requireModule("districts", "add"),
  asyncHandler(districtImportController.errorReport)
);
router.post(
  "/imports/:id/commit",
  requireSystemAdmin,
  requireModule("districts", "add"),
  asyncHandler(districtImportController.commit)
);

router.get("/:id", asyncHandler(districtController.detail));
router.post("/", requireSystemAdmin, requireModule("districts", "add"), asyncHandler(districtController.create));
router.put("/:id", requireSystemAdmin, requireModule("districts", "edit"), asyncHandler(districtController.update));
router.delete("/:id", requireSystemAdmin, requireModule("districts", "delete"), asyncHandler(districtController.remove));

module.exports = router;
