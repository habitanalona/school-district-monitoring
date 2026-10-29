"use strict";

const express = require("express");
const controller = require("../controllers/schoolFormsController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("school_forms"));

router.get("/definitions", asyncHandler(controller.definitions));
router.get("/cards", asyncHandler(controller.cards));
router.get("/preview/:code", asyncHandler(controller.preview));
router.post("/generate/:code", requireModule("school_forms", "add"), asyncHandler(controller.generate));

router.get("/submissions", asyncHandler(controller.submissions));
router.get("/submissions/:id", asyncHandler(controller.submission));
router.get("/submissions/:id/render", asyncHandler(controller.render));
router.post(
  "/submissions/:id/:action(submit|return|approve|reject|finalize)",
  requireModule("school_forms", "edit"),
  asyncHandler(controller.review)
);

router.get("/templates", asyncHandler(controller.templates));
router.post("/templates", requireModule("school_forms", "edit"), asyncHandler(controller.saveTemplate));
router.post(
  "/templates/:id/activate",
  requireModule("school_forms", "edit"),
  asyncHandler(controller.activateTemplate)
);

router.get("/deadlines", asyncHandler(controller.deadlines));
router.post("/deadlines", requireModule("school_forms", "edit"), asyncHandler(controller.saveDeadline));
router.delete(
  "/deadlines/:id",
  requireModule("school_forms", "edit"),
  asyncHandler(controller.removeDeadline)
);

module.exports = router;
