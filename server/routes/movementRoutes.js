"use strict";

const express = require("express");
const controller = require("../controllers/movementController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("movements"));

router.get("/", asyncHandler(controller.list));
router.post("/", requireModule("movements", "add"), asyncHandler(controller.create));
router.get("/:id", asyncHandler(controller.detail));
router.patch("/:id/:decision(approved|rejected)", requireModule("movements", "edit"), asyncHandler(controller.decide));
router.delete("/:id", requireModule("movements", "delete"), asyncHandler(controller.remove));

module.exports = router;
