"use strict";

const express = require("express");
const activityController = require("../controllers/activityController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("activities"));

router.get("/", asyncHandler(activityController.list));
router.post("/", requireModule("activities", "add"), asyncHandler(activityController.create));
router.get("/:id", asyncHandler(activityController.detail));
router.put("/:id", requireModule("activities", "edit"), asyncHandler(activityController.update));
router.delete("/:id", requireModule("activities", "delete"), asyncHandler(activityController.remove));
router.post("/:id/participants", requireModule("activities", "add"), asyncHandler(activityController.addParticipant));
router.delete(
  "/:id/participants/:participantId",
  requireModule("activities", "delete"),
  asyncHandler(activityController.removeParticipant)
);

module.exports = router;
