"use strict";

const express = require("express");
const announcementController = require("../controllers/announcementController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireAdmin } = require("../middleware/roleMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth);
router.get("/", asyncHandler(announcementController.list));
router.get("/:id", asyncHandler(announcementController.detail));
router.post("/", requireAdmin, asyncHandler(announcementController.create));
router.put("/:id", requireAdmin, asyncHandler(announcementController.update));

module.exports = router;
