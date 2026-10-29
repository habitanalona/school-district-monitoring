"use strict";

const express = require("express");
const activityController = require("../controllers/activityController");
const { requireAuth } = require("../middleware/authMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth);

router.get("/", asyncHandler(activityController.list));
router.post("/", asyncHandler(activityController.create));
router.get("/:id", asyncHandler(activityController.detail));
router.put("/:id", asyncHandler(activityController.update));
router.delete("/:id", asyncHandler(activityController.remove));
router.post("/:id/participants", asyncHandler(activityController.addParticipant));
router.delete(
  "/:id/participants/:participantId",
  asyncHandler(activityController.removeParticipant)
);

module.exports = router;
