"use strict";

const express = require("express");
const learnerController = require("../controllers/learnerController");
const { requireAuth } = require("../middleware/authMiddleware");
const { documentUpload } = require("../middleware/documentUpload");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth);

router.get("/summary", asyncHandler(learnerController.summary));
router.get("/", asyncHandler(learnerController.list));
router.post("/", asyncHandler(learnerController.create));

router.get("/:id", asyncHandler(learnerController.detail));
router.put("/:id", asyncHandler(learnerController.update));
router.patch("/:id/archive", asyncHandler(learnerController.archive));
router.patch("/:id/restore", asyncHandler(learnerController.restore));
router.get("/:id/history", asyncHandler(learnerController.history));

router.post("/:id/guardians", asyncHandler(learnerController.createGuardian));
router.put("/:id/guardians/:guardianId", asyncHandler(learnerController.updateGuardian));
router.delete("/:id/guardians/:guardianId", asyncHandler(learnerController.deleteGuardian));

router.post("/:id/enrollments", asyncHandler(learnerController.createEnrollment));
router.put("/:id/enrollments/:enrollmentId", asyncHandler(learnerController.updateEnrollment));
router.post("/:id/promote", asyncHandler(learnerController.promote));

router.post("/:id/activities", asyncHandler(learnerController.addActivity));
router.delete(
  "/:id/activities/:participationId",
  asyncHandler(learnerController.removeActivity)
);

router.post(
  "/:id/documents",
  documentUpload,
  asyncHandler(learnerController.uploadDocument)
);
router.get(
  "/:id/documents/:documentId/download",
  asyncHandler(learnerController.downloadDocument)
);
router.delete("/:id/documents/:documentId", asyncHandler(learnerController.deleteDocument));

module.exports = router;
