"use strict";

const express = require("express");
const userRightsController = require("../controllers/userRightsController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireSystemAdmin } = require("../middleware/roleMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireSystemAdmin, requireModule("user_rights", "access"));
router.get("/catalog", asyncHandler(userRightsController.catalog));
router.get("/users", asyncHandler(userRightsController.listUsers));
router.get("/users/:id", asyncHandler(userRightsController.detail));
router.get("/users/:id/history", asyncHandler(userRightsController.history));
router.put(
  "/users/:id",
  requireModule("user_rights", "edit"),
  asyncHandler(userRightsController.save)
);

module.exports = router;
