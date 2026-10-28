"use strict";

const express = require("express");
const schoolController = require("../controllers/schoolController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireAdmin } = require("../middleware/roleMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth);
router.get("/sidebar", asyncHandler(schoolController.sidebar));
router.get("/", asyncHandler(schoolController.list));
router.get("/:id", asyncHandler(schoolController.detail));
router.post("/", requireAdmin, asyncHandler(schoolController.create));
router.put("/:id", requireAdmin, asyncHandler(schoolController.update));
router.patch("/:id/archive", requireAdmin, asyncHandler(schoolController.archive));
router.patch("/:id/restore", requireAdmin, asyncHandler(schoolController.restore));

module.exports = router;
