"use strict";

const express = require("express");
const learnerController = require("../controllers/learnerController");
const importController = require("../controllers/learnerImportController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { documentUpload } = require("../middleware/documentUpload");
const { createSpreadsheetImportUpload } = require("../middleware/spreadsheetImportUpload");
const { learnerImportLimiter } = require("../middleware/rateLimiters");
const { asyncHandler } = require("../utils/asyncHandler");
const { isAdviserScoped } = require("../utils/learnerAccess");
const { HttpError } = require("../utils/httpError");

const router = express.Router();

// Importing spreadsheets, promoting learners, and attaching learner documents
// stay with school record keepers. Class advisers enroll and remove learners
// inside their own advisory section only.
function requireLearnerManager(req, res, next) {
  if (isAdviserScoped(req.user)) {
    return next(
      new HttpError(
        403,
        "Class advisers cannot use this learner management feature.",
        "LEARNER_MANAGER_ONLY"
      )
    );
  }
  next();
}

const importUpload = createSpreadsheetImportUpload({
  action: "learner.import_rejected",
  entityType: "learner_import"
});

router.use(requireAuth, requireModule("learners"));

router.get("/summary", asyncHandler(learnerController.summary));

// Bulk learner import, profiles only. Declared before /:id so literal paths
// are never read as learner identifiers.
router.get(
  "/imports/template",
  requireModule("learners", "add"),
  requireLearnerManager,
  asyncHandler(importController.template)
);
router.get(
  "/imports",
  requireModule("learners", "add"),
  requireLearnerManager,
  asyncHandler(importController.history)
);
router.post(
  "/imports/preview",
  requireModule("learners", "add"),
  requireLearnerManager,
  learnerImportLimiter,
  importUpload,
  asyncHandler(importController.preview)
);
router.get(
  "/imports/:id/errors.xlsx",
  requireModule("learners", "add"),
  requireLearnerManager,
  asyncHandler(importController.errorReport)
);
router.post(
  "/imports/:id/commit",
  requireModule("learners", "add"),
  requireLearnerManager,
  asyncHandler(importController.commit)
);

router.get("/", asyncHandler(learnerController.list));
router.post("/", requireModule("learners", "add"), asyncHandler(learnerController.create));

router.get("/:id", asyncHandler(learnerController.detail));
router.put("/:id", requireModule("learners", "edit"), asyncHandler(learnerController.update));
router.patch("/:id/archive", requireModule("learners", "delete"), asyncHandler(learnerController.archive));
router.patch("/:id/restore", requireModule("learners", "edit"), asyncHandler(learnerController.restore));
router.get("/:id/history", asyncHandler(learnerController.history));

router.post("/:id/guardians", requireModule("learners", "add"), asyncHandler(learnerController.createGuardian));
router.put("/:id/guardians/:guardianId", requireModule("learners", "edit"), asyncHandler(learnerController.updateGuardian));
router.delete("/:id/guardians/:guardianId", requireModule("learners", "delete"), asyncHandler(learnerController.deleteGuardian));

router.post("/:id/enrollments", requireModule("learners", "add"), asyncHandler(learnerController.createEnrollment));
router.put("/:id/enrollments/:enrollmentId", requireModule("learners", "edit"), asyncHandler(learnerController.updateEnrollment));
router.post("/:id/promote", requireModule("learners", "add"), requireLearnerManager, asyncHandler(learnerController.promote));

router.post("/:id/activities", requireModule("activities", "add"), asyncHandler(learnerController.addActivity));
router.delete(
  "/:id/activities/:participationId",
  requireModule("activities", "delete"),
  asyncHandler(learnerController.removeActivity)
);

router.post(
  "/:id/documents",
  requireModule("learners", "add"),
  requireLearnerManager,
  documentUpload,
  asyncHandler(learnerController.uploadDocument)
);
router.get(
  "/:id/documents/:documentId/download",
  asyncHandler(learnerController.downloadDocument)
);
router.delete(
  "/:id/documents/:documentId",
  requireModule("learners", "delete"),
  requireLearnerManager,
  asyncHandler(learnerController.deleteDocument)
);

module.exports = router;
