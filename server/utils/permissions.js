"use strict";

const { canApproveRole } = require("./roles");
const {
  MANAGE_LEARNER_ROLES,
  MANAGE_ACADEMIC_ROLES,
  MANAGE_ACTIVITY_ROLES,
  REPORT_ROLES
} = require("./learnerAccess");

function permissionsFor(user) {
  const isSystemAdmin = user.role === "system_admin";
  const isAdmin = isSystemAdmin || user.role === "district_admin";
  const canManageLearners = MANAGE_LEARNER_ROLES.has(user.role);
  const canManageAcademics = MANAGE_ACADEMIC_ROLES.has(user.role);
  return {
    canManageSchools: isAdmin,
    canManageReports: true,
    canManageAnnouncements: isAdmin,
    canManageUsers: isAdmin,
    canManageDistricts: isSystemAdmin,
    canManageStaffOnly: !isSystemAdmin && user.role === "district_admin",
    canViewAuditLogs: isSystemAdmin,
    canSelectDistrict: isSystemAdmin,
    canApproveAccounts: canApproveRole(user.role),
    canViewLearners: true,
    canManageLearners,
    canManageAcademics,
    canManageActivities: MANAGE_ACTIVITY_ROLES.has(user.role),
    canExportLearnerReports: REPORT_ROLES.has(user.role),
    canViewLearnerHistory: canManageLearners || user.role === "psds",
    canManageSchoolYears: canManageAcademics,
    canManageSections: canManageAcademics,
    canManageSubjects: canManageAcademics
  };
}

module.exports = { permissionsFor };

