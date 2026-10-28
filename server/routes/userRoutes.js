"use strict";

const express = require("express");
const userController = require("../controllers/userController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireAdmin } = require("../middleware/roleMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireAdmin);
router.get("/", asyncHandler(userController.list));
router.post("/", asyncHandler(userController.create));
router.put("/:id", asyncHandler(userController.update));
router.patch("/:id/status", asyncHandler(userController.updateStatus));

module.exports = router;
