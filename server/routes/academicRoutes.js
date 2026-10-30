"use strict";

const express = require("express");
const academicController = require("../controllers/academicController");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireModule } = require("../middleware/permissionMiddleware");
const { requireSystemAdmin } = require("../middleware/roleMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth);

router.get("/school-years", requireModule("school_years"), asyncHandler(academicController.listSchoolYears));
router.post("/school-years", requireModule("school_years", "add"), asyncHandler(academicController.createSchoolYear));
router.post("/school-years/copy", requireModule("school_years", "add"), asyncHandler(academicController.copyStructure));
router.put("/school-years/:id", requireModule("school_years", "edit"), asyncHandler(academicController.updateSchoolYear));

router.get("/grade-level-options", requireModule("grade_levels"), asyncHandler(academicController.listGradeLevelOptions));
router.post(
  "/grade-level-options",
  requireSystemAdmin,
  requireModule("grade_levels", "add"),
  asyncHandler(academicController.createGradeLevelOption)
);
router.put(
  "/grade-level-options/:id",
  requireSystemAdmin,
  requireModule("grade_levels", "edit"),
  asyncHandler(academicController.updateGradeLevelOption)
);
router.delete(
  "/grade-level-options/:id",
  requireSystemAdmin,
  requireModule("grade_levels", "delete"),
  asyncHandler(academicController.deleteGradeLevelOption)
);

router.get("/grade-levels", requireModule("grade_levels"), asyncHandler(academicController.listGradeLevels));
router.post("/grade-levels", requireModule("grade_levels", "add"), asyncHandler(academicController.createGradeLevel));
router.put("/grade-levels/:id", requireModule("grade_levels", "edit"), asyncHandler(academicController.updateGradeLevel));
router.delete("/grade-levels/:id", requireModule("grade_levels", "delete"), asyncHandler(academicController.deleteGradeLevel));

router.get("/sections", requireModule("sections"), asyncHandler(academicController.listSections));
router.post("/sections", requireModule("sections", "add"), asyncHandler(academicController.createSection));
router.put("/sections/:id", requireModule("sections", "edit"), asyncHandler(academicController.updateSection));
router.delete("/sections/:id", requireModule("sections", "delete"), asyncHandler(academicController.deleteSection));

router.get("/subject-options", requireModule("subjects"), asyncHandler(academicController.listSubjectOptions));
router.post(
  "/subject-options",
  requireSystemAdmin,
  requireModule("subjects", "add"),
  asyncHandler(academicController.createSubjectOption)
);
router.put(
  "/subject-options/:id",
  requireSystemAdmin,
  requireModule("subjects", "edit"),
  asyncHandler(academicController.updateSubjectOption)
);
router.delete(
  "/subject-options/:id",
  requireSystemAdmin,
  requireModule("subjects", "delete"),
  asyncHandler(academicController.deleteSubjectOption)
);

router.get("/subjects", requireModule("subjects"), asyncHandler(academicController.listSubjects));
router.post("/subjects", requireModule("subjects", "add"), asyncHandler(academicController.createSubject));
router.put("/subjects/:id", requireModule("subjects", "edit"), asyncHandler(academicController.updateSubject));
router.delete("/subjects/:id", requireModule("subjects", "delete"), asyncHandler(academicController.deleteSubject));

router.get("/assignments", requireModule("subjects"), asyncHandler(academicController.listAssignments));
router.post("/assignments", requireModule("subjects", "add"), asyncHandler(academicController.createAssignment));
router.put("/assignments/:id", requireModule("subjects", "edit"), asyncHandler(academicController.updateAssignment));
router.delete("/assignments/:id", requireModule("subjects", "delete"), asyncHandler(academicController.deleteAssignment));

router.get("/schedules", requireModule("subjects"), asyncHandler(academicController.listSchedules));
router.get("/timetable", requireModule("subjects"), asyncHandler(academicController.timetable));
router.post("/schedules", requireModule("subjects", "add"), asyncHandler(academicController.createSchedule));
router.put("/schedules/:id", requireModule("subjects", "edit"), asyncHandler(academicController.updateSchedule));
router.delete("/schedules/:id", requireModule("subjects", "delete"), asyncHandler(academicController.deleteSchedule));

router.get("/teachers", requireModule("teachers"), asyncHandler(academicController.teachers));

module.exports = router;
