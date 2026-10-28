"use strict";

const express = require("express");
const profileController = require("../controllers/profileController");
const { requireAuth } = require("../middleware/authMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth);
router.put("/", asyncHandler(profileController.update));
router.put("/password", asyncHandler(profileController.changePassword));

module.exports = router;
