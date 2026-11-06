"use strict";

const { HttpError } = require("./httpError");
const { requireInteger } = require("./validators");
const { hasRole, hasAnyRole, rolesOf } = require("./roles");

// Workspace levels, ordered from widest to narrowest. A record may only be
// read when it belongs to the workspace of the signed-in account.
const WORKSPACE = {
  ALL: "all",
  DISTRICT: "district",
  SCHOOL: "school",
  CLASS: "class",
  LEARNER: "learner"
};

const WORKSPACE_RANK = {
  all: 5,
  district: 4,
  school: 3,
  class: 2,
  learner: 1
};

const DISTRICT_ROLES = ["district_admin", "psds", "staff"];
const SCHOOL_WIDE_ROLES = ["school_head", "coordinator", "nt"];
const CLASS_ROLES = ["teacher", "adviser"];
// Roles that keep a non-teaching account out of the view-only rule. The
// coordinator role represents a DepEd program designation (DRRM, SBFP,
// canteen, property custodian, LRMIS, HR, and similar programs).
const NON_TEACHING_OVERRIDE_ROLES = [
  "system_admin",
  "district_admin",
  "psds",
  "staff",
  "school_head",
  "coordinator",
  "teacher",
  "adviser"
];

function workspaceFor(user) {
  if (!user) {
    return WORKSPACE.LEARNER;
  }
  if (hasRole(user, "system_admin")) {
    return WORKSPACE.ALL;
  }
  if (hasAnyRole(user, DISTRICT_ROLES)) {
    return WORKSPACE.DISTRICT;
  }
  if (hasAnyRole(user, SCHOOL_WIDE_ROLES)) {
    return WORKSPACE.SCHOOL;
  }
  if (hasAnyRole(user, CLASS_ROLES)) {
    return WORKSPACE.CLASS;
  }
  if (hasRole(user, "learner")) {
    return WORKSPACE.LEARNER;
  }
  return WORKSPACE.LEARNER;
}

function isDistrictWorkspace(user) {
  const workspace = workspaceFor(user);
  return workspace === WORKSPACE.ALL || workspace === WORKSPACE.DISTRICT;
}

function isSchoolWorkspace(user) {
  const workspace = workspaceFor(user);
  return workspace === WORKSPACE.SCHOOL;
}

function isClassWorkspace(user) {
  const workspace = workspaceFor(user);
  return workspace === WORKSPACE.CLASS || workspace === WORKSPACE.LEARNER;
}

// A non-teaching account is read-only unless it also carries a coordinator or
// other professional role. The rule is evaluated on roles, not on the stored
// permission matrix, so it cannot be widened by an accidental checkbox.
function isNonTeachingReadOnly(user) {
  if (!user || !hasRole(user, "nt")) {
    return false;
  }
  return !hasAnyRole(user, NON_TEACHING_OVERRIDE_ROLES);
}

function workspaceAtLeast(user, minimum) {
  return WORKSPACE_RANK[workspaceFor(user)] >= WORKSPACE_RANK[minimum];
}

function resolveScope(user, rawDistrictId) {
  if (!user || !isDistrictWorkspace(user)) {
    return user && user.districtId ? user.districtId : null;
  }
  if (workspaceFor(user) === WORKSPACE.DISTRICT) {
    return user.districtId;
  }
  if (rawDistrictId === undefined || rawDistrictId === null || rawDistrictId === "" || rawDistrictId === "all") {
    return null;
  }
  return requireInteger(rawDistrictId, "District", { min: 1 });
}

// Returns the school filter a query must apply. District-wide accounts may
// pass an explicit school; school-bound accounts are pinned to their own
// school. -1 matches no row, so a misconfigured account cannot widen its view.
function schoolScopeFor(user, rawSchoolId) {
  const workspace = workspaceFor(user);
  if (workspace === WORKSPACE.ALL) {
    if (rawSchoolId === undefined || rawSchoolId === null || rawSchoolId === "") {
      return null;
    }
    if (rawSchoolId === "all") {
      return null;
    }
    return requireInteger(rawSchoolId, "School", { min: 1 });
  }
  if (workspace === WORKSPACE.DISTRICT) {
    if (rawSchoolId === undefined || rawSchoolId === null || rawSchoolId === "") {
      return null;
    }
    if (rawSchoolId === "all") {
      return null;
    }
    return requireInteger(rawSchoolId, "School", { min: 1 });
  }
  return user && user.schoolId ? Number(user.schoolId) : -1;
}

function assertDistrictAccess(user, districtId) {
  if (user && workspaceFor(user) === WORKSPACE.ALL) {
    return;
  }
  if (!user || Number(districtId) !== Number(user.districtId)) {
    throw new HttpError(403, "You do not have access to that district.", "DISTRICT_FORBIDDEN");
  }
}

function assertSchoolAccess(user, schoolId, districtId) {
  const workspace = workspaceFor(user);
  if (workspace === WORKSPACE.ALL) {
    return;
  }
  if (workspace === WORKSPACE.DISTRICT) {
    if (!user.districtId || Number(user.districtId) !== Number(districtId)) {
      throw new HttpError(403, "You do not have access to that school.", "SCHOOL_FORBIDDEN");
    }
    return;
  }
  if (!user.schoolId || Number(user.schoolId) !== Number(schoolId)) {
    throw new HttpError(403, "You can only work with records in your own school.", "SCHOOL_FORBIDDEN");
  }
}

// True only when the account holds the non-teaching role and nothing wider.
function isReadOnlyAccount(user) {
  return isNonTeachingReadOnly(user);
}

function describeWorkspace(user) {
  return {
    level: workspaceFor(user),
    districtId: user ? user.districtId || null : null,
    schoolId: user ? user.schoolId || null : null,
    readOnly: isNonTeachingReadOnly(user),
    roles: rolesOf(user)
  };
}

module.exports = {
  WORKSPACE,
  workspaceFor,
  workspaceAtLeast,
  isDistrictWorkspace,
  isSchoolWorkspace,
  isClassWorkspace,
  isNonTeachingReadOnly,
  isReadOnlyAccount,
  describeWorkspace,
  resolveScope,
  schoolScopeFor,
  assertDistrictAccess,
  assertSchoolAccess
};
