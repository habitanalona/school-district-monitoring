"use strict";

// Role metadata shared by validation, permissions, registration, and serializers.
const ROLE_DEFINITIONS = [
  {
    value: "system_admin",
    label: "System Administrator",
    short: "System Admin",
    tone: "violet",
    approverRole: null,
    needsSchool: false,
    selfRegister: false
  },
  {
    value: "district_admin",
    label: "District Administrator",
    short: "District Admin",
    tone: "info",
    approverRole: null,
    needsSchool: false,
    selfRegister: false
  },
  {
    value: "psds",
    label: "PSDS",
    fullLabel: "Public Schools District Supervisor",
    short: "PSDS",
    tone: "primary",
    approverRole: "district_admin",
    needsSchool: false,
    selfRegister: true
  },
  {
    value: "school_head",
    label: "School Head",
    short: "School Head",
    tone: "success",
    approverRole: "psds",
    needsSchool: true,
    selfRegister: true
  },
  {
    value: "teacher",
    label: "Teacher",
    short: "Teacher",
    tone: "teal",
    approverRole: "school_head",
    needsSchool: true,
    selfRegister: true
  },
  {
    value: "coordinator",
    label: "Coordinator",
    short: "Coordinator",
    tone: "primary",
    approverRole: "school_head",
    needsSchool: true,
    selfRegister: true
  },
  {
    value: "nt",
    label: "NT",
    fullLabel: "Non-Teaching Personnel",
    short: "NT",
    tone: "warning",
    approverRole: "school_head",
    needsSchool: true,
    selfRegister: true
  },
  {
    value: "adviser",
    label: "Class Adviser",
    short: "Adviser",
    tone: "violet",
    approverRole: "school_head",
    needsSchool: true,
    selfRegister: true
  },
  {
    value: "learner",
    label: "Learner",
    short: "Learner",
    tone: "info",
    approverRole: "adviser",
    needsSchool: true,
    selfRegister: true
  },
  {
    value: "staff",
    label: "Authorized Staff",
    short: "Staff",
    tone: "neutral",
    approverRole: null,
    needsSchool: false,
    selfRegister: false
  }
];

const ROLE_MAP = ROLE_DEFINITIONS.reduce((accumulator, definition) => {
  accumulator[definition.value] = definition;
  return accumulator;
}, {});

const ROLES = ROLE_DEFINITIONS.map((definition) => definition.value);
const SELF_REGISTER_ROLES = ROLE_DEFINITIONS.filter((definition) => definition.selfRegister).map(
  (definition) => definition.value
);
const SCHOOL_ROLES = ["school_head", "teacher", "coordinator", "nt", "adviser", "learner"];
// Roles a district administrator may provision or maintain within their district.
const DISTRICT_MANAGED_ROLES = [
  "staff",
  "psds",
  "school_head",
  "teacher",
  "coordinator",
  "nt",
  "adviser",
  "learner"
];
// Roles that review self-registrations from the next level down.
const APPROVER_ROLES = ["system_admin", "district_admin", "psds", "school_head", "adviser"];
function roleMeta(role) {
  return ROLE_MAP[role] || null;
}

function roleLabel(role) {
  const meta = ROLE_MAP[role];
  return meta ? meta.label : String(role || "");
}

function approverRoleFor(role) {
  const meta = ROLE_MAP[role];
  return meta ? meta.approverRole : null;
}

function needsSchool(role) {
  return SCHOOL_ROLES.includes(role);
}

function canApproveRole(role) {
  return APPROVER_ROLES.includes(role);
}

module.exports = {
  ROLE_DEFINITIONS,
  ROLE_MAP,
  ROLES,
  SELF_REGISTER_ROLES,
  SCHOOL_ROLES,
  DISTRICT_MANAGED_ROLES,
  APPROVER_ROLES,
  roleMeta,
  roleLabel,
  approverRoleFor,
  needsSchool,
  canApproveRole
};
