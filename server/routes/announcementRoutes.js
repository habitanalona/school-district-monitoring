"use strict";

const express = require("express");
const announcementController = require("../controllers/announcementController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { hasAnyRole } = require("../utils/roles");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();
const ANNOUNCEMENT_MANAGERS = ["system_admin", "district_admin", "psds"];

router.use(requireAuth, requireModule("announcements"));

// PSDS accounts manage notices inside their own district. The service pins the
// district, so this guard grants the role without widening anyone else's rights.
function requireAnnouncementManager(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: "Authentication required.", code: "AUTH_REQUIRED" });
  }
  if (!hasAnyRole(req.user, ANNOUNCEMENT_MANAGERS)) {
    return res.status(403).json({
      error: "You do not have permission to perform this action.",
      code: "FORBIDDEN"
    });
  }
  return next();
}

function requireAnnouncementAction(action) {
  const moduleGuard = requireModule("announcements", action);
  return function announcementActionGuard(req, res, next) {
    if (hasAnyRole(req.user, ["psds"])) {
      return next();
    }
    return moduleGuard(req, res, next);
  };
}

router.get("/", asyncHandler(announcementController.list));
router.get("/:id", asyncHandler(announcementController.detail));
router.post(
  "/",
  requireAnnouncementManager,
  requireAnnouncementAction("add"),
  asyncHandler(announcementController.create)
);
router.put(
  "/:id",
  requireAnnouncementManager,
  requireAnnouncementAction("edit"),
  asyncHandler(announcementController.update)
);
router.delete(
  "/:id",
  requireAnnouncementManager,
  requireAnnouncementAction("delete"),
  asyncHandler(announcementController.remove)
);

module.exports = router;
