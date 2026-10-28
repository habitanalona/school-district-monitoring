"use strict";

const express = require("express");
const notificationController = require("../controllers/notificationController");
const { requireAuth } = require("../middleware/authMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth);
router.get("/", asyncHandler(notificationController.list));
router.patch("/read-all", asyncHandler(notificationController.markAllRead));
router.patch("/:id/read", asyncHandler(notificationController.markRead));

module.exports = router;
