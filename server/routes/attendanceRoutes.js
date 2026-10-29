"use strict";

const express = require("express");
const controller = require("../controllers/attendanceController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("attendance"));

router.get("/sheet", asyncHandler(controller.sheet));
router.put("/sheet", requireModule("attendance", "edit"), asyncHandler(controller.saveSheet));
router.get("/month", asyncHandler(controller.month));
router.get("/summary", asyncHandler(controller.summary));
router.get("/learner/:learnerId", asyncHandler(controller.learner));
router.get("/calendar", asyncHandler(controller.calendar));
router.post("/calendar", requireModule("attendance", "edit"), asyncHandler(controller.saveCalendar));
router.delete("/calendar/:id", requireModule("attendance", "edit"), asyncHandler(controller.deleteCalendar));

module.exports = router;
