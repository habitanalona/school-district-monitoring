"use strict";

const express = require("express");
const reportController = require("../controllers/reportController");
const { requireAuth } = require("../middleware/authMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth);
router.get("/summary", asyncHandler(reportController.summary));
router.get("/", asyncHandler(reportController.list));
router.get("/:id", asyncHandler(reportController.detail));
router.post("/", asyncHandler(reportController.create));
router.put("/:id", asyncHandler(reportController.update));

module.exports = router;
