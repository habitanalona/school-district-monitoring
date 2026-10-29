"use strict";

const express = require("express");
const schoolController = require("../controllers/schoolController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireAdmin } = require("../middleware/roleMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("schools"));
router.get("/sidebar", asyncHandler(schoolController.sidebar));
router.get("/", asyncHandler(schoolController.list));
router.get("/:id", asyncHandler(schoolController.detail));
router.post("/", requireAdmin, requireModule("schools", "add"), asyncHandler(schoolController.create));
router.put("/:id", requireAdmin, requireModule("schools", "edit"), asyncHandler(schoolController.update));
router.patch("/:id/archive", requireAdmin, requireModule("schools", "delete"), asyncHandler(schoolController.archive));
router.patch("/:id/restore", requireAdmin, requireModule("schools", "delete"), asyncHandler(schoolController.restore));

module.exports = router;
