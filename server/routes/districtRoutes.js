"use strict";

const express = require("express");
const districtController = require("../controllers/districtController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireSystemAdmin } = require("../middleware/roleMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth);
router.get("/", asyncHandler(districtController.list));
router.get("/hierarchy", asyncHandler(districtController.hierarchy));
router.get("/:id", asyncHandler(districtController.detail));
router.post("/", requireSystemAdmin, asyncHandler(districtController.create));
router.put("/:id", requireSystemAdmin, asyncHandler(districtController.update));
router.delete("/:id", requireSystemAdmin, asyncHandler(districtController.remove));

module.exports = router;
