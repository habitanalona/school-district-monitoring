"use strict";

const express = require("express");
const learnerReportController = require("../controllers/learnerReportController");
const { requireAuth } = require("../middleware/authMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth);

router.get("/", asyncHandler(learnerReportController.list));
router.get("/:type", asyncHandler(learnerReportController.download));

module.exports = router;
