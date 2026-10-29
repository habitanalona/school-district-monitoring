"use strict";

const express = require("express");
const controller = require("../controllers/gradeController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("grades"));

router.get("/entry", asyncHandler(controller.entry));
router.put("/entry", requireModule("grades", "add"), asyncHandler(controller.saveEntry));
router.post("/submit", requireModule("grades", "add"), asyncHandler(controller.submit));
router.post("/finalize", requireModule("grades", "edit"), asyncHandler(controller.finalize));
router.post("/correction", requireModule("grades", "edit"), asyncHandler(controller.correct));

router.get("/learners/:learnerId", asyncHandler(controller.learner));
router.get("/policy", asyncHandler(controller.policy));router.put("/policy", requireModule("grades", "edit"), asyncHandler(controller.savePolicy));

router.get("/promotion", asyncHandler(controller.promotion));
router.post("/promotion/compute", requireModule("grades", "edit"), asyncHandler(controller.computePromotion));
router.patch("/promotion/:id", requireModule("grades", "edit"), asyncHandler(controller.decidePromotion));

router.get("/report-cards", asyncHandler(controller.reportCards));
router.post("/report-cards/generate", requireModule("grades", "add"), asyncHandler(controller.generateReportCards));
router.get("/report-cards/:id", asyncHandler(controller.reportCard));
router.post("/report-cards/:id/:action", requireModule("grades", "edit"), asyncHandler(controller.reportCardAction));

module.exports = router;
