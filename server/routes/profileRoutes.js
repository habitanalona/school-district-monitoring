"use strict";

const express = require("express");
const profileController = require("../controllers/profileController");
const photoController = require("../controllers/photoController");
const { requireAuth } = require("../middleware/authMiddleware");
const { photoUpload } = require("../middleware/photoUpload");
const { photoUploadLimiter } = require("../middleware/rateLimiters");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth);
router.put("/", asyncHandler(profileController.update));
router.put("/password", asyncHandler(profileController.changePassword));
router.post(
  "/photo",
  photoUploadLimiter,
  photoUpload,
  asyncHandler(photoController.uploadOwn)
);
router.delete("/photo", asyncHandler(photoController.deleteOwn));

module.exports = router;
