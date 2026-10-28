"use strict";

const express = require("express");
const userController = require("../controllers/userController");
const photoController = require("../controllers/photoController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireAdmin } = require("../middleware/roleMiddleware");
const { photoUpload } = require("../middleware/photoUpload");
const { photoUploadLimiter } = require("../middleware/rateLimiters");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

// Any signed-in user may view a photo inside their own district; the service
// enforces that scope. Uploading or removing another account's photo stays
// behind the administrator guard below.
router.get("/:id/photo", requireAuth, asyncHandler(photoController.serve));

router.use(requireAuth, requireAdmin);
router.get("/", asyncHandler(userController.list));
router.post("/", asyncHandler(userController.create));
router.put("/:id", asyncHandler(userController.update));
router.patch("/:id/status", asyncHandler(userController.updateStatus));
router.put(
  "/:id/photo",
  photoUploadLimiter,
  photoUpload,
  asyncHandler(photoController.uploadForUser)
);
router.delete("/:id/photo", asyncHandler(photoController.deleteForUser));

module.exports = router;
