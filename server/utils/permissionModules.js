"use strict";

// Canonical module catalog for the User Rights and Permissions module.
// The catalog is synchronised into permission_modules and role_permissions on
// application start. Defaults mirror the capabilities the system had before
// the module was introduced; administrators may then revoke them per role or
// grant them per user within the allowed role sets below.
//
// `grantRoles` is a security boundary: a checkbox may only be enabled for a
// role when the corresponding API operation is designed to work for that role.
// For example, user management remains an administrator operation, so it can
// never be granted to a teacher through the permissions screen.

const ADMIN_ROLES = ["system_admin", "district_admin"];
const SCHOOL_STAFF_ROLES = [
  "system_admin",
  "district_admin",
  "staff",
  "school_head",
  "teacher",
  "coordinator",
  "adviser",
  "nt"
];
const ALL_ROLES = [
  "system_admin",
  "district_admin",
  "psds",
  "staff",
  "school_head",
  "teacher",
  "coordinator",
  "adviser",
  "nt",
  "learner"
];

const MODULE_DEFINITIONS = [
  {
    key: "dashboard",
    label: "Dashboard",
    group: "Overview",
    description: "District and learner summary, charts, and quick actions.",
    actions: ["access"],
    defaults: { access: ALL_ROLES },
    grantRoles: { access: ALL_ROLES }
  },
  {
    key: "schools",
    label: "School Records",
    group: "Monitoring",
    description: "School register, school profiles, enrollment, and performance views.",
    actions: ["access", "add", "edit", "delete"],
    defaults: {
      access: ALL_ROLES,
      add: ADMIN_ROLES,
      edit: ADMIN_ROLES,
      delete: ADMIN_ROLES
    },
    grantRoles: {
      access: ALL_ROLES,
      add: ADMIN_ROLES,
      edit: ADMIN_ROLES,
      delete: ADMIN_ROLES
    }
  },
  {
    key: "school_reports",
    label: "School Monitoring and Submissions",
    group: "Monitoring",
    description: "Monthly school report submissions, review, and compliance status.",
    actions: ["access", "add", "edit", "delete"],
    defaults: {
      access: ALL_ROLES,
      add: ["system_admin", "district_admin", "staff", "school_head"],
      edit: ["system_admin", "district_admin", "staff", "school_head"]
    },
    grantRoles: {
      access: ALL_ROLES,
      add: SCHOOL_STAFF_ROLES,
      edit: SCHOOL_STAFF_ROLES
    }
  },
  {
    key: "district_reports",
    label: "District Reports and Analytics",
    group: "Monitoring",
    description: "District-level reports, trends, and printable summaries.",
    actions: ["access"],
    defaults: { access: ALL_ROLES },
    grantRoles: { access: ALL_ROLES }
  },
  {
    key: "learners",
    label: "Learner and Enrollment Records",
    group: "Learner records",
    description: "Permanent learner profiles, guardians, enrollment folders, and documents.",
    actions: ["access", "add", "edit", "delete"],
    defaults: {
      access: ALL_ROLES,
      add: ["system_admin", "district_admin", "staff", "school_head"],
      edit: ["system_admin", "district_admin", "staff", "school_head"],
      delete: ["system_admin", "district_admin", "staff", "school_head"]
    },
    grantRoles: {
      access: ALL_ROLES,
      add: SCHOOL_STAFF_ROLES,
      edit: SCHOOL_STAFF_ROLES,
      delete: SCHOOL_STAFF_ROLES
    }
  },
  {
    key: "learner_reports",
    label: "Learner Reports and Exports",
    group: "Learner records",
    description: "Printable learner lists, profile sheets, directories, and CSV exports.",
    actions: ["access"],
    defaults: {
      access: [
        "system_admin",
        "district_admin",
        "psds",
        "staff",
        "school_head",
        "teacher",
        "coordinator",
        "adviser",
        "nt"
      ]
    },
    grantRoles: { access: ALL_ROLES }
  },
  {
    key: "school_years",
    label: "School Years",
    group: "Academic setup",
    description: "School-year calendar, current year, and structure rollover.",
    actions: ["access", "add", "edit", "delete"],
    defaults: {
      access: ALL_ROLES,
      add: ["system_admin", "district_admin", "staff", "school_head"],
      edit: ["system_admin", "district_admin", "staff", "school_head"]
    },
    grantRoles: {
      access: ALL_ROLES,
      add: SCHOOL_STAFF_ROLES,
      edit: SCHOOL_STAFF_ROLES
    }
  },
  {
    key: "grade_levels",
    label: "Grade Levels",
    group: "Academic setup",
    description: "Grade levels offered by each school and their display order.",
    actions: ["access", "add", "edit", "delete"],
    defaults: {
      access: ALL_ROLES,
      add: ["system_admin", "district_admin", "staff", "school_head"],
      edit: ["system_admin", "district_admin", "staff", "school_head"],
      delete: ["system_admin", "district_admin", "staff", "school_head"]
    },
    grantRoles: {
      access: ALL_ROLES,
      add: SCHOOL_STAFF_ROLES,
      edit: SCHOOL_STAFF_ROLES,
      delete: SCHOOL_STAFF_ROLES
    }
  },
  {
    key: "sections",
    label: "Sections and Advisers",
    group: "Academic setup",
    description: "Class sections, adviser assignment, and learner placement.",
    actions: ["access", "add", "edit", "delete"],
    defaults: {
      access: ALL_ROLES,
      add: ["system_admin", "district_admin", "staff", "school_head"],
      edit: ["system_admin", "district_admin", "staff", "school_head"],
      delete: ["system_admin", "district_admin", "staff", "school_head"]
    },
    grantRoles: {
      access: ALL_ROLES,
      add: SCHOOL_STAFF_ROLES,
      edit: SCHOOL_STAFF_ROLES,
      delete: SCHOOL_STAFF_ROLES
    }
  },
  {
    key: "teachers",
    label: "Teacher and Personnel Records",
    group: "Academic setup",
    description: "Read-only view of teachers, advisers, and their assignment loads.",
    actions: ["access"],
    defaults: { access: ALL_ROLES },
    grantRoles: { access: ALL_ROLES }
  },
  {
    key: "subjects",
    label: "Subjects, Assignments, and Schedules",
    group: "Academic setup",
    description: "Subject catalog, teaching assignments, class schedules, and timetables.",
    actions: ["access", "add", "edit", "delete"],
    defaults: {
      access: ALL_ROLES,
      add: ["system_admin", "district_admin", "staff", "school_head"],
      edit: ["system_admin", "district_admin", "staff", "school_head"],
      delete: ["system_admin", "district_admin", "staff", "school_head"]
    },
    grantRoles: {
      access: ALL_ROLES,
      add: SCHOOL_STAFF_ROLES,
      edit: SCHOOL_STAFF_ROLES,
      delete: SCHOOL_STAFF_ROLES
    }
  },
  {
    key: "activities",
    label: "Curricular and Extracurricular Activities",
    group: "Learner records",
    description: "Activity catalog, learner participation, roles, and achievements.",
    actions: ["access", "add", "edit", "delete"],
    defaults: {
      access: ALL_ROLES,
      add: [
        "system_admin",
        "district_admin",
        "staff",
        "school_head",
        "teacher",
        "adviser"
      ],
      edit: [
        "system_admin",
        "district_admin",
        "staff",
        "school_head",
        "teacher",
        "adviser"
      ],
      delete: ["system_admin", "district_admin", "staff", "school_head"]
    },
    grantRoles: {
      access: ALL_ROLES,
      add: SCHOOL_STAFF_ROLES,
      edit: SCHOOL_STAFF_ROLES,
      delete: SCHOOL_STAFF_ROLES
    }
  },
  {
    key: "announcements",
    label: "Announcements",
    group: "Communication",
    description: "District announcements published to schools and personnel.",
    actions: ["access", "add", "edit", "delete"],
    defaults: { access: ALL_ROLES, add: ADMIN_ROLES, edit: ADMIN_ROLES },
    grantRoles: { access: ALL_ROLES, add: ADMIN_ROLES, edit: ADMIN_ROLES }
  },
  {
    key: "users",
    label: "User Account Management",
    group: "Administration",
    description: "Create and maintain user accounts, roles, and account status.",
    actions: ["access", "add", "edit", "delete"],
    defaults: {
      access: ADMIN_ROLES,
      add: ADMIN_ROLES,
      edit: ADMIN_ROLES,
      delete: ADMIN_ROLES
    },
    grantRoles: {
      access: ADMIN_ROLES,
      add: ADMIN_ROLES,
      edit: ADMIN_ROLES,
      delete: ADMIN_ROLES
    }
  },
  {
    key: "approvals",
    label: "Account Approvals",
    group: "Administration",
    description: "Confirm or reject self-registered accounts in your scope.",
    actions: ["access", "add", "edit", "delete"],
    defaults: {
      access: ["system_admin", "district_admin", "psds", "school_head", "adviser"],
      edit: ["system_admin", "district_admin", "psds", "school_head", "adviser"]
    },
    grantRoles: {
      access: ["system_admin", "district_admin", "psds", "school_head", "adviser"],
      edit: ["system_admin", "district_admin", "psds", "school_head", "adviser"]
    }
  },
  {
    key: "audit_logs",
    label: "Audit Logs",
    group: "Administration",
    description: "Security and administrative audit trail.",
    actions: ["access"],
    defaults: { access: ["system_admin"] },
    grantRoles: { access: ["system_admin", "district_admin"] }
  },
  {
    key: "districts",
    label: "Districts",
    group: "Administration",
    description: "District records and PSDS assignments.",
    actions: ["access", "add", "edit", "delete"],
    defaults: {
      access: ALL_ROLES,
      add: ["system_admin"],
      edit: ["system_admin"],
      delete: ["system_admin"]
    },
    grantRoles: {
      access: ALL_ROLES,
      add: ["system_admin"],
      edit: ["system_admin"],
      delete: ["system_admin"]
    }
  },
  {
    key: "settings",
    label: "Settings and Profile",
    group: "System",
    description: "Personal profile, password, and photo settings.",
    actions: ["access"],
    defaults: { access: ALL_ROLES },
    grantRoles: { access: ALL_ROLES }
  },
  {
    key: "user_rights",
    label: "User Rights and Permissions",
    group: "System",
    description: "Administrator-only control of who may open the console and change other accounts' rights.",
    actions: ["access", "edit"],
    defaults: {
      access: ["system_admin"],
      edit: ["system_admin"]
    },
    grantRoles: {
      access: ["system_admin"],
      edit: ["system_admin"]
    }
  }
];

const MODULE_KEYS = MODULE_DEFINITIONS.map((definition) => definition.key);
const MODULE_MAP = MODULE_DEFINITIONS.reduce((accumulator, definition) => {
  accumulator[definition.key] = definition;
  return accumulator;
}, {});

const ACTIONS = ["access", "add", "edit", "delete"];

function sanitizeRow(row) {
  if (!row) {
    return null;
  }
  const access = Boolean(row.can_access);
  return {
    access,
    add: access && Boolean(row.can_add),
    edit: access && Boolean(row.can_edit),
    delete: access && Boolean(row.can_delete)
  };
}

function defaultsForRole(role) {
  const matrix = {};
  MODULE_DEFINITIONS.forEach((definition) => {
    const entry = { access: false, add: false, edit: false, delete: false };
    definition.actions.forEach((action) => {
      const roles = definition.defaults[action] || [];
      entry[action] = roles.includes(role);
    });
    if (!entry.access) {
      entry.add = false;
      entry.edit = false;
      entry.delete = false;
    }
    matrix[definition.key] = entry;
  });
  return matrix;
}

module.exports = {
  MODULE_DEFINITIONS,
  MODULE_KEYS,
  MODULE_MAP,
  ACTIONS,
  ADMIN_ROLES,
  ALL_ROLES,
  sanitizeRow,
  defaultsForRole
};
