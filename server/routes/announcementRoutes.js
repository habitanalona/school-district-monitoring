"use strict";

const express = require("express");
const announcementController = require("../controllers/announcementController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireAdmin } = require("../middleware/roleMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("announcements"));
router.get("/", asyncHandler(announcementController.list));
router.get("/:id", asyncHandler(announcementController.detail));
router.post("/", requireAdmin, requireModule("announcements", "add"), asyncHandler(announcementController.create));
router.put("/:id", requireAdmin, requireModule("announcements", "edit"), asyncHandler(announcementController.update));

module.exports = router;
