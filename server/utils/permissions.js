"use strict";

const { canApproveRole, rolesOf, hasRole } = require("./roles");
const { can } = require("../services/permissionService");
const { workspaceFor, isNonTeachingReadOnly } = require("./scope");

function allows(matrix, moduleKey, action) {
  return can(matrix, moduleKey, action);
}

function permissionsFor(user) {
  const matrix = user && user.permissionMatrix ? user.permissionMatrix : null;
  const isSystemAdmin = hasRole(user, "system_admin");

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
  const moduleWrite = function (key) {
    return (
      allows(matrix, key, "add") ||
      allows(matrix, key, "edit") ||
      allows(matrix, key, "delete")
    );
  };
  const reviewerRoles = ["system_admin", "district_admin", "psds", "school_head"];

  return {
    canManageSchools: allows(matrix, "schools", "access") && schoolsWrite,
    canManageReports: allows(matrix, "school_reports", "access") && reportWrite,
    canManageAnnouncements:
      allows(matrix, "announcements", "access") &&
      (allows(matrix, "announcements", "add") ||
        allows(matrix, "announcements", "edit") ||
        hasRole(user, "psds")),
    canDeleteAnnouncements:
      allows(matrix, "announcements", "access") &&
      (allows(matrix, "announcements", "delete") || hasRole(user, "psds")),
    canManageUsers: allows(matrix, "users", "access") && userWrite,
    canManageDistricts:
      allows(matrix, "districts", "access") &&
      (allows(matrix, "districts", "add") || allows(matrix, "districts", "edit")),
    canManageStaffOnly: !isSystemAdmin && hasRole(user, "district_admin"),
    canViewAuditLogs: allows(matrix, "audit_logs", "access"),
    canSelectDistrict: isSystemAdmin,
    canApproveAccounts:
      allows(matrix, "approvals", "access") &&
      allows(matrix, "approvals", "edit") &&
      rolesOf(user).some((role) => canApproveRole(role)),    canViewLearners: allows(matrix, "learners", "access"),
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
    canViewAttendance: allows(matrix, "attendance", "access"),
    canManageAttendance: allows(matrix, "attendance", "access") && moduleWrite("attendance"),
    canConfigureAttendance:
      allows(matrix, "attendance", "access") &&
      allows(matrix, "attendance", "edit") &&
      ["system_admin", "district_admin", "staff", "school_head"].some((role) => hasRole(user, role)),
    canValidateAttendance:
      allows(matrix, "attendance", "access") &&
      allows(matrix, "attendance", "edit") &&
      ["system_admin", "district_admin", "school_head", "adviser"].some((role) => hasRole(user, role)),
    canViewGrades: allows(matrix, "grades", "access"),
    canManageGrades: allows(matrix, "grades", "access") && moduleWrite("grades"),
    canViewBooks: allows(matrix, "books", "access"),
    canManageBooks: allows(matrix, "books", "access") && moduleWrite("books"),
    canViewMovements: allows(matrix, "movements", "access"),
    canManageMovements: allows(matrix, "movements", "access") && moduleWrite("movements"),
    canViewHealth: allows(matrix, "health", "access"),
    canManageHealth: allows(matrix, "health", "access") && moduleWrite("health"),
    canViewPersonnel: allows(matrix, "personnel", "access"),
    canManagePersonnel: allows(matrix, "personnel", "access") && moduleWrite("personnel"),
    canViewSchoolForms: allows(matrix, "school_forms", "access"),
    canManageSchoolForms: allows(matrix, "school_forms", "access") && moduleWrite("school_forms"),
    canReviewSchoolForms:
      allows(matrix, "school_forms", "access") &&
      allows(matrix, "school_forms", "edit") &&
      reviewerRoles.some((role) => hasRole(user, role)),
    canFinalizeSchoolForms:
      allows(matrix, "school_forms", "access") &&
      allows(matrix, "school_forms", "edit") &&
      ["system_admin", "district_admin"].some((role) => hasRole(user, role)),
    canViewMonitoring: allows(matrix, "monitoring", "access"),
    canViewPermanentRecords: allows(matrix, "permanent_records", "access"),
    canManageHelpdesk:
      allows(matrix, "helpdesk", "access") &&
      (allows(matrix, "helpdesk", "add") ||
        allows(matrix, "helpdesk", "edit") ||
        allows(matrix, "helpdesk", "delete")),
    workspace: workspaceFor(user),
    readOnly: isNonTeachingReadOnly(user),
    modules: matrix || {}
  };
}

module.exports = { permissionsFor };
