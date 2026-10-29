"use strict";

const express = require("express");
const controller = require("../controllers/bookController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth, requireModule("books"));

router.get("/catalog", asyncHandler(controller.catalog));
router.post("/catalog", requireModule("books", "add"), asyncHandler(controller.createCatalog));
router.put("/catalog/:id", requireModule("books", "edit"), asyncHandler(controller.updateCatalog));
router.delete("/catalog/:id", requireModule("books", "delete"), asyncHandler(controller.archiveCatalog));

router.get("/issuances", asyncHandler(controller.issuances));
router.post("/issuances", requireModule("books", "add"), asyncHandler(controller.issue));
router.post("/issuances/:id/returns", requireModule("books", "edit"), asyncHandler(controller.returnBooks));
router.get("/issuances/:id", asyncHandler(controller.history));

router.get("/summary", asyncHandler(controller.summary));

module.exports = router;
