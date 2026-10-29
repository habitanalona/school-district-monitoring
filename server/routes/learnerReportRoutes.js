"use strict";

const express = require("express");
const learnerReportController = require("../controllers/learnerReportController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("learner_reports"));

router.get("/", asyncHandler(learnerReportController.list));
router.get("/:type", asyncHandler(learnerReportController.download));

module.exports = router;
