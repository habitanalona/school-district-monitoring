"use strict";

const express = require("express");
const approvalController = require("../controllers/approvalController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("approvals"));

router.get("/", asyncHandler(approvalController.list));
router.post("/:id/approve", requireModule("approvals", "edit"), asyncHandler(approvalController.approve));
router.post("/:id/reject", requireModule("approvals", "edit"), asyncHandler(approvalController.reject));

module.exports = router;
