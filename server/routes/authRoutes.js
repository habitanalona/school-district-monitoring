"use strict";

const express = require("express");
const authController = require("../controllers/authController");
const { requireAuth } = require("../middleware/authMiddleware");
const { loginLimiter, passwordResetLimiter, registrationLimiter } = require("../middleware/rateLimiters");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.get("/csrf", asyncHandler(authController.csrf));
router.get("/registration-options", asyncHandler(authController.registrationOptions));
router.post("/register", registrationLimiter, asyncHandler(authController.register));
router.post("/login", loginLimiter, asyncHandler(authController.login));
router.post("/logout", requireAuth, asyncHandler(authController.logout));
router.get("/me", requireAuth, asyncHandler(authController.me));
router.post("/forgot-password", passwordResetLimiter, asyncHandler(authController.forgotPassword));
router.post("/reset-password", passwordResetLimiter, asyncHandler(authController.resetPassword));

module.exports = router;
