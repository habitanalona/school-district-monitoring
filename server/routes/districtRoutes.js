"use strict";

const express = require("express");
const districtController = require("../controllers/districtController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireSystemAdmin } = require("../middleware/roleMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("districts"));
router.get("/", asyncHandler(districtController.list));
router.get("/hierarchy", asyncHandler(districtController.hierarchy));
router.get("/:id", asyncHandler(districtController.detail));
router.post("/", requireSystemAdmin, requireModule("districts", "add"), asyncHandler(districtController.create));
router.put("/:id", requireSystemAdmin, requireModule("districts", "edit"), asyncHandler(districtController.update));
router.delete("/:id", requireSystemAdmin, requireModule("districts", "delete"), asyncHandler(districtController.remove));

module.exports = router;
