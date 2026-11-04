"use strict";

const express = require("express");
const databaseBackupController = require("../controllers/databaseBackupController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireSystemAdmin } = require("../middleware/roleMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.post("/", requireAuth, requireSystemAdmin, asyncHandler(databaseBackupController.download));

module.exports = router;
