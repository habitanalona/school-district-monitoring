"use strict";

const express = require("express");
const controller = require("../controllers/personnelController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("personnel"));

router.get("/", asyncHandler(controller.list));
router.get("/assignments", asyncHandler(controller.assignments));
router.get("/summary", asyncHandler(controller.summary));
router.post("/", requireModule("personnel", "add"), asyncHandler(controller.create));
router.get("/:id", asyncHandler(controller.detail));
router.put("/:id", requireModule("personnel", "edit"), asyncHandler(controller.update));
router.delete("/:id", requireModule("personnel", "delete"), asyncHandler(controller.archive));

module.exports = router;
