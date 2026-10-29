"use strict";

const express = require("express");
const controller = require("../controllers/monitoringController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("monitoring"));

router.get("/", asyncHandler(controller.summary));
router.get("/discrepancies", asyncHandler(controller.discrepancies));
router.get("/audit-trail", asyncHandler(controller.auditTrail));

module.exports = router;
