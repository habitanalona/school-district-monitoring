"use strict";

const express = require("express");
const controller = require("../controllers/attendanceController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("attendance"));

router.get("/sheet", asyncHandler(controller.sheet));
router.put("/sheet", requireModule("attendance", "edit"), asyncHandler(controller.saveSheet));
router.get("/month", asyncHandler(controller.month));
router.get("/summary", asyncHandler(controller.summary));
router.get("/learner/:learnerId", asyncHandler(controller.learner));
router.get("/calendar", asyncHandler(controller.calendar));
router.post("/calendar", requireModule("attendance", "edit"), asyncHandler(controller.saveCalendar));
router.delete("/calendar/:id", requireModule("attendance", "edit"), asyncHandler(controller.deleteCalendar));

// Academic terms and configurable class periods
router.get("/terms", asyncHandler(controller.terms));
router.post("/terms", requireModule("attendance", "edit"), asyncHandler(controller.provisionTerms));
router.put("/terms", requireModule("attendance", "edit"), asyncHandler(controller.saveTerms));
router.post("/terms/approve", requireModule("attendance", "edit"), asyncHandler(controller.approveTerms));
router.get("/periods", asyncHandler(controller.periods));
router.put("/periods", requireModule("attendance", "edit"), asyncHandler(controller.savePeriods));
router.delete("/periods/:id", requireModule("attendance", "edit"), asyncHandler(controller.deletePeriod));

// Subject teacher period attendance
router.get("/teacher-loads", asyncHandler(controller.teacherLoads));
router.get("/subject/options", asyncHandler(controller.sectionSubjects));
router.get("/subject/matrix", asyncHandler(controller.subjectMatrix));
router.put("/subject/matrix", requireModule("attendance", "edit"), asyncHandler(controller.saveSubjectMatrix));
router.post(
  "/subject/submissions/:id/reopen",
  requireModule("attendance", "edit"),
  asyncHandler(controller.reopenSubmission)
);

// Class adviser consolidation and official daily validation
router.get("/adviser/consolidation", asyncHandler(controller.consolidation));
router.post("/adviser/validate", requireModule("attendance", "edit"), asyncHandler(controller.validateDay));
router.post(
  "/adviser/reopen-validation",
  requireModule("attendance", "edit"),
  asyncHandler(controller.reopenValidation)
);
router.get("/corrections", asyncHandler(controller.corrections));
router.post("/corrections", requireModule("attendance", "add"), asyncHandler(controller.requestCorrection));
router.post(
  "/corrections/:id/review",
  requireModule("attendance", "edit"),
  asyncHandler(controller.reviewCorrection)
);

// Term and year summaries derived from validated daily attendance
router.get("/term-summary", asyncHandler(controller.termSummary));

module.exports = router;
