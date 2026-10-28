"use strict";

const express = require("express");
const dashboardController = require("../controllers/dashboardController");
const { requireAuth } = require("../middleware/authMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth);
router.get("/summary", asyncHandler(dashboardController.summary));
router.get("/enrollment", asyncHandler(dashboardController.enrollment));
router.get("/performance", asyncHandler(dashboardController.performance));
router.get("/report-status", asyncHandler(dashboardController.reportStatus));
router.get("/recent-activity", asyncHandler(dashboardController.recentActivity));

module.exports = router;
