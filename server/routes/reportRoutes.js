"use strict";

const express = require("express");
const reportController = require("../controllers/reportController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("school_reports"));
router.get("/summary", asyncHandler(reportController.summary));
router.get("/", asyncHandler(reportController.list));
router.get("/:id", asyncHandler(reportController.detail));
router.post("/", requireModule("school_reports", "add"), asyncHandler(reportController.create));
router.put("/:id", requireModule("school_reports", "edit"), asyncHandler(reportController.update));

module.exports = router;
