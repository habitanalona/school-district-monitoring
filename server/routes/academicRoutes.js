"use strict";

const express = require("express");
const academicController = require("../controllers/academicController");
const { requireAuth } = require("../middleware/authMiddleware");
const { asyncHandler } = require("../utils/asyncHandler");

const router = express.Router();

router.use(requireAuth);

router.get("/school-years", asyncHandler(academicController.listSchoolYears));
router.post("/school-years", asyncHandler(academicController.createSchoolYear));
router.post("/school-years/copy", asyncHandler(academicController.copyStructure));
router.put("/school-years/:id", asyncHandler(academicController.updateSchoolYear));

router.get("/grade-levels", asyncHandler(academicController.listGradeLevels));
router.post("/grade-levels", asyncHandler(academicController.createGradeLevel));
router.put("/grade-levels/:id", asyncHandler(academicController.updateGradeLevel));
router.delete("/grade-levels/:id", asyncHandler(academicController.deleteGradeLevel));

router.get("/sections", asyncHandler(academicController.listSections));
router.post("/sections", asyncHandler(academicController.createSection));
router.put("/sections/:id", asyncHandler(academicController.updateSection));
router.delete("/sections/:id", asyncHandler(academicController.deleteSection));

router.get("/subjects", asyncHandler(academicController.listSubjects));
router.post("/subjects", asyncHandler(academicController.createSubject));
router.put("/subjects/:id", asyncHandler(academicController.updateSubject));
router.delete("/subjects/:id", asyncHandler(academicController.deleteSubject));

router.get("/assignments", asyncHandler(academicController.listAssignments));
router.post("/assignments", asyncHandler(academicController.createAssignment));
router.put("/assignments/:id", asyncHandler(academicController.updateAssignment));
router.delete("/assignments/:id", asyncHandler(academicController.deleteAssignment));

router.get("/schedules", asyncHandler(academicController.listSchedules));
router.get("/timetable", asyncHandler(academicController.timetable));
router.post("/schedules", asyncHandler(academicController.createSchedule));
router.put("/schedules/:id", asyncHandler(academicController.updateSchedule));
router.delete("/schedules/:id", asyncHandler(academicController.deleteSchedule));

router.get("/teachers", asyncHandler(academicController.teachers));

module.exports = router;
