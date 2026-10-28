"use strict";

const { canApproveRole } = require("./roles");

function permissionsFor(user) {
  const isSystemAdmin = user.role === "system_admin";
  const isAdmin = isSystemAdmin || user.role === "district_admin";
  return {
    canManageSchools: isAdmin,
    canManageReports: true,
    canManageAnnouncements: isAdmin,
    canManageUsers: isAdmin,
    canManageDistricts: isSystemAdmin,
    canManageStaffOnly: !isSystemAdmin && user.role === "district_admin",
    canViewAuditLogs: isSystemAdmin,
    canSelectDistrict: isSystemAdmin,
    canApproveAccounts: canApproveRole(user.role)
  };
}

module.exports = { permissionsFor };
