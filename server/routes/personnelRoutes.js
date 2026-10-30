"use strict";

const express = require("express");
const controller = require("../controllers/personnelController");
const importController = require("../controllers/personnelImportController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireAdmin } = require("../middleware/roleMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { createSpreadsheetImportUpload } = require("../middleware/spreadsheetImportUpload");
const { personnelImportLimiter } = require("../middleware/rateLimiters");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

const importUpload = createSpreadsheetImportUpload({
  action: "personnel.import_rejected",
  entityType: "personnel_import"
});

router.use(requireAuth, requireModule("personnel"));

// Bulk staff import. One row creates a login account and a personnel profile,
// so the route additionally requires account-management rights. Declared
// before /:id so literal paths are never read as personnel identifiers.
router.get(
  "/imports/template",
  requireAdmin,
  requireModule("personnel", "add"),
  requireModule("users", "add"),
  asyncHandler(importController.template)
);
router.get(
  "/imports",
  requireAdmin,
  requireModule("personnel", "add"),
  requireModule("users", "add"),
  asyncHandler(importController.history)
);
router.post(
  "/imports/preview",
  requireAdmin,
  requireModule("personnel", "add"),
  requireModule("users", "add"),
  personnelImportLimiter,
  importUpload,
  asyncHandler(importController.preview)
);
router.get(
  "/imports/:id/errors.xlsx",
  requireAdmin,
  requireModule("personnel", "add"),
  requireModule("users", "add"),
  asyncHandler(importController.errorReport)
);
router.post(
  "/imports/:id/commit",
  requireAdmin,
  requireModule("personnel", "add"),
  requireModule("users", "add"),
  asyncHandler(importController.commit)
);

router.get("/", asyncHandler(controller.list));
router.get("/assignments", asyncHandler(controller.assignments));
router.get("/summary", asyncHandler(controller.summary));
router.post("/", requireModule("personnel", "add"), asyncHandler(controller.create));
router.get("/:id", asyncHandler(controller.detail));
router.put("/:id", requireModule("personnel", "edit"), asyncHandler(controller.update));
router.delete("/:id", requireModule("personnel", "delete"), asyncHandler(controller.archive));

module.exports = router;
