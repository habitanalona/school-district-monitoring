"use strict";

const express = require("express");
const controller = require("../controllers/healthController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

// Access is deliberately restricted to the health module. Teachers, advisers,
// and learners cannot reach these records through the API even if they can
// see the learner profile page.
router.use(requireAuth, requireModule("health"));

router.get("/measurements", asyncHandler(controller.list));
router.post("/measurements", requireModule("health", "add"), asyncHandler(controller.create));
router.get("/measurements/:id", asyncHandler(controller.detail));
router.put("/measurements/:id", requireModule("health", "edit"), asyncHandler(controller.update));
router.get("/learners/:learnerId", asyncHandler(controller.trend));
router.get("/summary", asyncHandler(controller.summary));

module.exports = router;
