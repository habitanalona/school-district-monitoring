"use strict";

const express = require("express");
const auditController = require("../controllers/auditController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireSystemAdmin } = require("../middleware/roleMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireSystemAdmin);
router.get("/", asyncHandler(auditController.list));

module.exports = router;
