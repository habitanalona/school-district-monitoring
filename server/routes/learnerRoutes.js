"use strict";

const express = require("express");
const learnerController = require("../controllers/learnerController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { documentUpload } = require("../middleware/documentUpload");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("learners"));

router.get("/summary", asyncHandler(learnerController.summary));
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
router.post("/:id/promote", requireModule("learners", "add"), asyncHandler(learnerController.promote));

router.post("/:id/activities", requireModule("activities", "add"), asyncHandler(learnerController.addActivity));
router.delete(
  "/:id/activities/:participationId",
  requireModule("activities", "delete"),
  asyncHandler(learnerController.removeActivity)
);

router.post(
  "/:id/documents",
  requireModule("learners", "add"),
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
  asyncHandler(learnerController.deleteDocument)
);

module.exports = router;
