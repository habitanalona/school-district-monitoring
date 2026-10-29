"use strict";

const express = require("express");
const controller = require("../controllers/classRecordController");
const reportCardController = require("../controllers/reportCardController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth);

router.get(
  "/dashboard",
  requireModule("class_records"),
  asyncHandler(controller.dashboard)
);

router.get(
  "/templates",
  requireModule("class_records"),
  asyncHandler(controller.templates)
);
router.put(
  "/templates",
  requireModule("class_record_templates", "edit"),
  asyncHandler(controller.saveTemplate)
);

router.get(
  "/adviser/overview",
  requireModule("grade_submissions"),
  asyncHandler(controller.adviserOverview)
);

router.get(
  "/consolidation",
  requireModule("report_cards"),
  asyncHandler(controller.consolidation)
);

router.get(
  "/report-cards",
  requireModule("report_cards"),
  asyncHandler(reportCardController.list)
);
router.post(
  "/report-cards/generate",
  requireModule("report_cards", "add"),
  asyncHandler(reportCardController.generate)
);
router.get(
  "/report-cards/export",
  requireModule("report_cards"),
  asyncHandler(reportCardController.exportCsv)
);
router.get(
  "/report-cards/batch",
  requireModule("report_cards"),
  asyncHandler(reportCardController.batch)
);
router.get(
  "/report-cards/:id",
  requireModule("report_cards"),
  asyncHandler(reportCardController.detail)
);
router.get(
  "/report-cards/:id/render",
  requireModule("report_cards"),
  asyncHandler(reportCardController.render)
);
router.post(
  "/report-cards/:id/finalize",
  requireModule("report_cards", "edit"),
  asyncHandler(reportCardController.finalize)
);
router.post(
  "/report-cards/:id/reopen",
  requireModule("report_cards", "edit"),
  asyncHandler(reportCardController.reopen)
);

router.get(
  "/submissions/:id",
  requireModule("grade_submissions"),
  asyncHandler(controller.submission)
);
router.post(
  "/submissions/:id/return",
  requireModule("grade_submissions", "edit"),
  asyncHandler(controller.returnForCorrection)
);
router.post(
  "/submissions/:id/accept",
  requireModule("grade_submissions", "edit"),
  asyncHandler(controller.accept)
);

router.post(
  "/",
  requireModule("class_records", "add"),
  asyncHandler(controller.initialize)
);

router.get(
  "/:id",
  requireModule("class_records"),
  asyncHandler(controller.detail)
);
router.post(
  "/:id/assessments",
  requireModule("class_records", "edit"),
  asyncHandler(controller.saveAssessment)
);
router.delete(
  "/:id/assessments/:assessmentId",
  requireModule("class_records", "edit"),
  asyncHandler(controller.archiveAssessment)
);
router.put(
  "/:id/scores",
  requireModule("class_records", "edit"),
  asyncHandler(controller.saveScores)
);
router.post(
  "/:id/submit",
  requireModule("class_records", "add"),
  asyncHandler(controller.submit)
);

module.exports = router;
