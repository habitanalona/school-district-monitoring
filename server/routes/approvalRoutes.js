"use strict";

const express = require("express");
const approvalController = require("../controllers/approvalController");
const { requireAuth } = require("../middleware/authMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth);

router.get("/", asyncHandler(approvalController.list));
router.post("/:id/approve", asyncHandler(approvalController.approve));
router.post("/:id/reject", asyncHandler(approvalController.reject));

module.exports = router;
