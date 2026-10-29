"use strict";

const { canApproveRole } = require("./roles");
const { can } = require("../services/permissionService");

function allows(matrix, moduleKey, action) {
  return can(matrix, moduleKey, action);
}

function permissionsFor(user) {
  const matrix = user && user.permissionMatrix ? user.permissionMatrix : null;
  const isSystemAdmin = user.role === "system_admin";
  const isAdmin = isSystemAdmin || user.role === "district_admin";

  const schoolsWrite =
    allows(matrix, "schools", "add") ||
    allows(matrix, "schools", "edit") ||
    allows(matrix, "schools", "delete");
  const learnerWrite =
    allows(matrix, "learners", "add") ||
    allows(matrix, "learners", "edit") ||
    allows(matrix, "learners", "delete");
  const academicWrite = [
    "school_years",
    "grade_levels",
    "sections",
    "subjects"
  ].some(
    (key) =>
      allows(matrix, key, "add") ||
      allows(matrix, key, "edit") ||
      allows(matrix, key, "delete")
  );
  const activityWrite =
    allows(matrix, "activities", "add") ||
    allows(matrix, "activities", "edit") ||
    allows(matrix, "activities", "delete");
  const reportWrite =
    allows(matrix, "school_reports", "add") || allows(matrix, "school_reports", "edit");
  const userWrite =
    allows(matrix, "users", "add") || allows(matrix, "users", "edit");

  return {
    canManageSchools: allows(matrix, "schools", "access") && schoolsWrite,
    canManageReports: allows(matrix, "school_reports", "access") && reportWrite,
    canManageAnnouncements:
      allows(matrix, "announcements", "access") &&
      (allows(matrix, "announcements", "add") || allows(matrix, "announcements", "edit")),
    canManageUsers: allows(matrix, "users", "access") && userWrite,
    canManageDistricts:
      allows(matrix, "districts", "access") &&
      (allows(matrix, "districts", "add") || allows(matrix, "districts", "edit")),
    canManageStaffOnly: !isSystemAdmin && user.role === "district_admin",
    canViewAuditLogs: allows(matrix, "audit_logs", "access"),
    canSelectDistrict: isSystemAdmin,
    canApproveAccounts:
      allows(matrix, "approvals", "access") &&
      allows(matrix, "approvals", "edit") &&
      canApproveRole(user.role),
    canViewLearners: allows(matrix, "learners", "access"),
    canManageLearners: allows(matrix, "learners", "access") && learnerWrite,
    canManageAcademics: academicWrite,
    canManageActivities: allows(matrix, "activities", "access") && activityWrite,
    canExportLearnerReports: allows(matrix, "learner_reports", "access"),
    canViewLearnerHistory: allows(matrix, "learners", "access"),
    canManageSchoolYears:
      allows(matrix, "school_years", "add") || allows(matrix, "school_years", "edit"),
    canManageSections:
      allows(matrix, "sections", "add") || allows(matrix, "sections", "edit"),
    canManageSubjects:
      allows(matrix, "subjects", "add") || allows(matrix, "subjects", "edit"),
    canManageUserRights: allows(matrix, "user_rights", "access"),
    canViewSchools: allows(matrix, "schools", "access"),
    canViewReports: allows(matrix, "district_reports", "access"),
    canViewSubjects: allows(matrix, "subjects", "access"),
    canViewActivities: allows(matrix, "activities", "access"),
    modules: matrix || {}
  };
}

module.exports = { permissionsFor };
