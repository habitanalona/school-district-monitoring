"use strict";

// Starter knowledge base for the Helpdesk module.
//
// Every article below describes behaviour that exists in this repository:
// routes, page controls, database rules, and documented policies. The seed
// runner inserts each example once and never overwrites an administrator's
// later edits. Keep new entries factual; the panel is presented as the
// system's built-in documentation, not as marketing copy.

// Page identifiers come from <body data-page="..."> or the public page name.
// Articles may be offered as "Help for this page" on any listed page.
const PAGE_KEYS = [
  "dashboard",
  "schools",
  "reports",
  "announcements",
  "approvals",
  "districts",
  "users",
  "user-rights",
  "audit-logs",
  "settings",
  "profile",
  "learners",
  "learner",
  "school-years",
  "grade-levels",
  "sections",
  "teachers",
  "subjects",
  "activities",
  "learner-reports",
  "attendance",
  "books",
  "movements",
  "grades",
  "health",
  "personnel",
  "school-forms",
  "monitoring",
  "class-records",
  "adviser-consolidation",
  "report-cards",
  "helpdesk-admin",
  "sign-in",
  "register",
  "reset-password"
];

const CATEGORIES = [
  {
    slug: "getting-started",
    title: "System overview",
    description: "What the School District Monitoring System does, who uses it, and how the modules fit together.",
    icon: "bi-compass",
    sortOrder: 10,
    articles: [
      {
        slug: "welcome-to-sdms",
        title: "Welcome to the School District Monitoring System",
        summary: "Purpose, audience, and the boundaries of the system you are signed in to.",
        type: "article",
        featured: true,
        sortOrder: 10,
        pages: ["dashboard", "sign-in"],
        keywords: ["overview", "purpose", "introduction", "what is sdms", "help", "manual"],
        body: [
          "The School District Monitoring System (SDMS) is the working record for a schools division office. It brings school registration, learner records, daily operations, DepEd School Forms, class records, report cards, and district monitoring into one authenticated workspace.",
          "The system is built around saved source records. School Forms, report cards, and monitoring summaries are generated from attendance, grades, books, movements, personnel, and learner data that authorised users already encoded. The system does not invent missing attendance, grades, signatures, seals, or approvals, and it never substitutes an unofficial layout for an official DepEd form.",
          "Use this Helpdesk to look up a term, follow a procedure, or troubleshoot a message. Answers come from the installed system's own documentation. If a capability is not described here, treat it as not implemented rather than assuming it exists."
        ],
        steps: [
          "Sign in with the username or email and password issued to you.",
          "Use the sidebar to open the module you need; links you cannot use are hidden.",
          "Open Helpdesk at the bottom-right of any page to search for a procedure or a field definition.",
          "When a task is finished, confirm the success message and check that the record appears in its register or list."
        ],
        notes: [
          "Access is enforced by the server, not only by hidden buttons. A link being visible is never proof that an action is allowed.",
          "Learner and health information is confidential. Do not share screenshots of records outside authorised school or division work."
        ]
      },
      {
        slug: "roles-and-access",
        title: "Roles and access boundaries",
        summary: "The ten account roles, what each one normally does, and how district and school scoping works.",
        type: "reference",
        sortOrder: 20,
        pages: ["users", "user-rights", "dashboard"],
        keywords: ["role", "permission", "access", "system admin", "district admin", "psds", "school head", "teacher", "adviser", "learner"],
        body: [
          "Every account has one role: system administrator, district administrator, PSDS, staff, school head, teacher, coordinator, class adviser, non-teaching personnel, or learner. The role provides a default permission matrix, and an administrator may grant or revoke individual module actions for one account without changing the role default.",
          "District administrators and district staff work inside their own district. PSDS, school heads, teachers, coordinators, advisers, and non-teaching personnel normally work inside their own district or school. System administrators can select any district and manage division-wide configuration.",
          "Learners have the narrowest scope: they can see their own dashboard and records, but they do not manage attendance, grades, books, health data, or form submissions. Sensitive health and personnel screens are limited to authorised administrative and health roles."
        ],
        steps: [
          "Open User Management to see an account's role, district, and school.",
          "Open User Rights to compare inherited role defaults with per-account overrides.",
          "If a module is missing, confirm both the role default and any per-account override before assuming a defect."
        ],
        notes: [
          "The server recomputes permissions on every authenticated request, so a revoked right applies to an open session on its next action.",
          "A system administrator always has the full matrix and cannot be edited through User Rights."
        ]
      },
      {
        slug: "navigating-the-system",
        title: "Navigating the sidebar, breadcrumbs, and school tree",
        summary: "How to move between modules and how the School Division Office hierarchy works.",
        type: "article",
        sortOrder: 30,
        pages: ["dashboard"],
        keywords: ["navigation", "sidebar", "menu", "breadcrumb", "hierarchy", "tree", "search schools"],
        body: [
          "The navy sidebar groups modules into Overview, Learner Records, School Operations, Grading and School Forms, School Division Office, District, Administration, and System. Only modules your account can open are listed.",
          "The School Division Office section lists districts with their assigned PSDS and nested schools. Use the search box to filter districts and schools, expand a district to see its schools, or follow the link that opens the district's schools in the registry.",
          "The top bar shows the breadcrumb for the current page, global school search, notifications, and your profile menu. On a narrow screen the sidebar becomes a drawer opened with the menu button."
        ],
        steps: [
          "Open the menu button on mobile, or use the always-visible sidebar on desktop.",
          "Type part of a district or school name in the School Division Office search box to filter the tree.",
          "Use the breadcrumb to return to a parent page.",
          "Open your profile menu for My Profile, Account Settings, and Sign out."
        ],
        notes: [
          "The hierarchy is read-only reference data. Districts and schools are edited in their own modules by authorised administrators."
        ]
      },
      {
        slug: "system-definitions",
        title: "Definitions and terminology",
        summary: "Plain-language definitions for the terms used across dashboards, forms, records, and reports.",
        type: "reference",
        sortOrder: 40,
        pages: [],
        keywords: ["definition", "glossary", "meaning", "terms", "LRN", "SY", "SF", "PSDS", "adviser", "section"],
        body: [
          "LRN — Learner Reference Number; the unique 12-digit identifier of a learner profile.",
          "School year (SY) — the academic period written as YYYY-YYYY, for example 2026-2027. One school year is marked current.",
          "Section — a class group inside a school, school year, and grade level, with an adviser and enrolled learners.",
          "PSDS — Public Schools District Supervisor assigned to a district.",
          "SF 1 to SF 10 — the DepEd School Forms generated from saved source records; the Forms Center lists the available form for each purpose.",
          "Submission status — the state of a generated form: Draft, In Progress, Ready for Validation, Validation Failed, Submitted, Returned for Correction, Approved, or Finalized.",
          "Scope — the district or school an account is allowed to read or change. Scoping is applied by the server on every request.",
          "Source record — data encoded in a module (attendance, grades, books, movements, personnel, learner profile) that a form or report reads. Generated documents do not overwrite their sources."
        ],
        steps: [
          "Search this Helpdesk for the term you encountered.",
          "Open the related article for the module where the term appears.",
          "Use the module's own labels and field hints for the exact validation rule."
        ],
        notes: [
          "Status labels are fixed by the implementation. A record is never treated as complete merely because a screen displays it."
        ]
      },
      {
        slug: "using-the-helpdesk",
        title: "Using the floating Helpdesk panel",
        summary: "Open, search, minimize, and close the built-in assistance panel without leaving your form.",
        type: "article",
        sortOrder: 50,
        pages: [],
        keywords: ["helpdesk", "help", "assistance", "search answers", "question", "faq", "panel", "floating button"],
        body: [
          "The Helpdesk button sits at the bottom-right of every page. Opening it loads a read-only guide to the installed system. The panel never reads, changes, or clears form data, so you can consult it while encoding a record.",
          "When you open the panel from a module, its home screen lists topics that mention the current page first, followed by suggested questions, browsable categories, and frequently asked questions. Search accepts ordinary questions such as “How do I add a learner?” or “What does the BMI status mean?”.",
          "Answers show a summary, a plain-language explanation, numbered steps, reminders, related topics, and the pages the topic applies to. Use the back button to return to the previous topic or results.",
          "The panel can be minimized to its header or closed with the X button. On a narrow screen it opens as a full-height sheet; closing it returns you to the same page state. Press Escape to close it from the keyboard.",
          "The Helpdesk explains only features that exist in this installation. If an answer is missing, use the administration contact for your division rather than assuming an unsupported feature is available."
        ],
        steps: [
          "Select the Helpdesk button at the bottom-right of the page.",
          "Type a question in the search box, or browse a category.",
          "Open an article and read its steps and reminders.",
          "Use Related topics or the back button to continue.",
          "Minimize the panel to keep it available, or close it to return to your work."
        ],
        notes: [
          "Opening the Helpdesk does not submit, reset, or discard an unfinished form.",
          "Answers never include learner, health, or account secrets."
        ]
      }
    ]
  },
  {
    slug: "accounts-access",
    title: "Accounts and access",
    description: "Signing in, creating an account, approvals, password recovery, profiles, and user administration.",
    icon: "bi-shield-lock",
    sortOrder: 20,
    articles: [
      {
        slug: "signing-in",
        title: "How to sign in and sign out",
        summary: "Use your username or email, understand generic sign-in errors, and end your session safely.",
        type: "procedure",
        featured: true,
        sortOrder: 10,
        pages: ["sign-in"],
        keywords: ["login", "sign in", "log in", "sign out", "logout", "password", "remember me", "cannot sign in"],
        body: [
          "Open the site root. If a session is already active the system opens the dashboard; otherwise the sign-in panel appears. Enter your username or email address and your password.",
          "Sign-in errors are deliberately generic: the panel does not reveal whether a username exists. Repeated failures are rate-limited, so wait before trying again. New self-registered accounts cannot sign in until their approving officer confirms them.",
          "Signing out ends the server session and returns you to the sign-in page. On a shared computer, always sign out rather than only closing the tab."
        ],
        steps: [
          "Open the system address in a browser.",
          "Enter your username or email and password.",
          "Select Remember Me only on a computer you control.",
          "Choose Sign in and wait for the dashboard to load.",
          "Use Sign out in the profile menu when finished."
        ],
        notes: [
          "Passwords are stored as bcrypt hashes and are never displayed or written to logs.",
          "If you were recently approved and still cannot sign in, confirm that the approval queue shows your account as active."
        ]
      },
      {
        slug: "creating-an-account",
        title: "How to create an account and get approved",
        summary: "Self-registration steps, the approval chain, and what to prepare before applying.",
        type: "procedure",
        featured: false,
        sortOrder: 20,
        pages: ["register", "sign-in"],
        keywords: ["register", "sign up", "create account", "approval", "confirm account", "new user", "applicant"],
        body: [
          "Accounts are requested from the sign-in page using Create account. Choose your role, district, and school where required, then enter your name, username, email, and a password that meets the stated rules. The account is created in a pending state.",
          "A pending account is confirmed by the immediate superior defined by the approval chain: PSDS registrations are reviewed by the district administrator, school heads by the PSDS, teachers, non-teaching personnel, and advisers by the school head, and learners by the class adviser. A system administrator can confirm any registration.",
          "Until approval, sign-in is refused. When approved, the account becomes active with the role's default permissions; an administrator may later adjust individual rights."
        ],
        steps: [
          "Open Create account from the sign-in page.",
          "Select the correct role; the district and school fields follow that choice.",
          "Enter your full name, username, email, and password, then submit.",
          "Wait for the approving officer to confirm the registration.",
          "Sign in with the same username or email after approval."
        ],
        notes: [
          "Choose the role and school carefully; approval does not change them later without an administrator.",
          "The system never sends a plaintext password by email. Keep your password private."
        ]
      },
      {
        slug: "account-approvals",
        title: "Confirming or rejecting pending accounts",
        summary: "How approving officers review the queue and what rejection does.",
        type: "procedure",
        sortOrder: 30,
        pages: ["approvals"],
        keywords: ["approve", "reject", "pending account", "registration", "confirm user", "queue"],
        body: [
          "Account Approvals lists registrations waiting for your decision within your scope. Each row shows the applicant's name, requested role, district, school, and submission time.",
          "Approving activates the account with the role default permissions. Rejecting records the decision and a note so the applicant knows the request was reviewed; it does not create a working account.",
          "The queue only shows registrations you are allowed to decide. If an applicant is missing, check that the requested role falls under your approval scope."
        ],
        steps: [
          "Open Account Approvals from the Administration group.",
          "Review the applicant's details against the school or district roster.",
          "Choose Approve, or Reject with a clear reason.",
          "Tell the applicant that approval is complete so they can sign in."
        ],
        notes: [
          "Approval does not grant extra modules beyond the role defaults.",
          "Audit history records the decision, the officer, and the time."
        ]
      },
      {
        slug: "resetting-your-password",
        title: "Reset a forgotten password",
        summary: "Request a reset link, use it before it expires, and choose a strong replacement.",
        type: "procedure",
        sortOrder: 40,
        pages: ["reset-password", "sign-in"],
        keywords: ["forgot password", "reset password", "expired link", "recover account", "new password"],
        body: [
          "Use Forgot password on the sign-in panel and enter the email address on your account. If a matching active account exists, the system produces a single-use reset link with an expiry time. The response does not confirm whether the address is registered.",
          "Open the link promptly. It becomes unavailable after its expiry or after it has been used once. Enter a new password that meets the password rules, then sign in with it.",
          "If the link is expired or already used, request a new one. Administrators can also issue a reset from User Management for accounts they are allowed to manage."
        ],
        steps: [
          "Choose Forgot password on the sign-in panel.",
          "Enter the email address on your account and submit.",
          "Open the reset link and enter the new password twice.",
          "Sign in with the new password.",
          "Request a fresh link if the message says the link is unavailable."
        ],
        notes: [
          "Reset tokens are single-use and time-limited; they are never stored in readable form.",
          "Password reset requests are rate-limited to protect accounts."
        ]
      },
      {
        slug: "managing-your-profile",
        title: "Update your profile and profile photo",
        summary: "Change your own details, upload a picture, and understand what only an administrator can change.",
        type: "procedure",
        sortOrder: 50,
        pages: ["profile", "settings"],
        keywords: ["profile", "photo", "avatar", "email", "contact", "account settings", "change password"],
        body: [
          "My Profile shows your account identity, role, district, school, and photo. You can update the personal fields the form allows and upload a profile picture. The picture appears in the sidebar, top bar, profile page, and user list.",
          "Account Settings holds your own account preferences and password change. Role, district, school, and account status are administrative fields; ask an administrator if one of them is wrong.",
          "Upload an image you have the right to use. The server validates the file type and size and stores it securely rather than exposing an arbitrary path."
        ],
        steps: [
          "Open the profile menu and choose My Profile.",
          "Edit the permitted fields and save.",
          "Use the photo control to upload a replacement picture.",
          "Open Account Settings to change your password.",
          "Refresh the page to confirm the new photo appears in the shell."
        ],
        notes: [
          "Administrators with user-management rights can also set or remove a photo for an account they manage.",
          "Never upload images containing learner identity documents unless your office explicitly requires it."
        ]
      },
      {
        slug: "user-management",
        title: "User management for administrators",
        summary: "Search accounts, adjust status and details, issue resets, and respect the protected-account rules.",
        type: "procedure",
        sortOrder: 60,
        pages: ["users"],
        keywords: ["users", "accounts", "disable account", "reset user password", "edit user", "deactivate"],
        body: [
          "User Management lists accounts inside your scope. Search by name, username, or email, and filter by role, school, or status. Opening an account shows its identity, role, assignment, and status.",
          "Administrators can update permitted account details, activate or deactivate an account, and issue a password reset. Deactivating blocks sign-in without deleting the account's audit history. District administrators cannot manage system or district administrators and remain inside their own district.",
          "Role changes and permission changes are audited. A system administrator account cannot be edited through this screen, and nobody can change their own permissions."
        ],
        steps: [
          "Open User Management from Administration.",
          "Search for the account and open its row.",
          "Update the permitted fields or use the reset action.",
          "Save and confirm the success message.",
          "Check Audit Logs if you need a record of the change."
        ],
        notes: [
          "Passwords are never shown to an administrator; use a reset instead.",
          "Deactivation is reversible. Deleting permanent learner or academic records is a separate, restricted operation."
        ]
      }
    ]
  },
  {
    slug: "dashboard-navigation",
    title: "Dashboard and navigation",
    description: "Read the dashboard, use the monitoring table, and follow notifications and announcements.",
    icon: "bi-grid-1x2",
    sortOrder: 30,
    articles: [
      {
        slug: "dashboard-metrics",
        title: "What the dashboard indicators mean",
        summary: "The six headline metrics and four charts, and why a number can differ from a register count.",
        type: "article",
        featured: false,
        sortOrder: 10,
        pages: ["dashboard"],
        keywords: ["dashboard", "metric", "KPI", "chart", "indicator", "total students", "active schools", "pending reports"],
        body: [
          "The headline metrics summarise the scope you can see: total enrolled schools, active schools, total students, total teaching personnel, pending school reports, and schools requiring attention. A system administrator sees all districts; other roles see their district or school scope.",
          "The charts show enrollment by grade level and by school, a performance comparison, and a monitoring focus selected with the Chart focus control. Charts read the same saved data as the registers, so a difference usually means a different filter or scope rather than a separate calculation.",
          "The learner summary cards add total learners, learners enrolled this school year, incomplete profiles, and sections with advisers. Incomplete profiles are profiles missing required address, contact, or guardian details."
        ],
        steps: [
          "Confirm the district scope shown in the sidebar or filter.",
          "Read the metric label and its description before comparing periods.",
          "Use Chart focus to change the comparison shown in the monitoring chart.",
          "Follow a chart chip or card link to the underlying register or report."
        ],
        notes: [
          "Only records in your scope are counted. A district administrator and a system administrator may legitimately see different totals.",
          "Archived or inactive records are excluded where the module says so."
        ]
      },
      {
        slug: "school-monitoring-table",
        title: "Using the school monitoring table",
        summary: "Filter the dashboard table and read submission and attention indicators.",
        type: "article",
        sortOrder: 20,
        pages: ["dashboard"],
        keywords: ["monitoring table", "dashboard table", "filter school", "attention", "status"],
        body: [
          "Below the charts, the monitoring table lists schools in scope with their reporting and attention indicators. Use the filters to narrow the list before drawing conclusions about a district.",
          "A school requiring attention is flagged from saved monitoring data such as missing or overdue reports and validation failures. The flag is a prompt to open the school's records, not a disciplinary finding.",
          "Row actions open the school profile or the relevant monitoring view, where the underlying submissions and comments are visible."
        ],
        steps: [
          "Apply a district, status, or search filter.",
          "Read the indicator labels in the row.",
          "Open the school to inspect the source submission or record.",
          "Return to the dashboard; filters reset when the page reloads."
        ],
        notes: [
          "The table is a summary. Decisions should be based on the submission or record itself."
        ]
      },
      {
        slug: "notifications",
        title: "Notifications",
        summary: "Where system notifications appear and what they do and do not change.",
        type: "article",
        sortOrder: 30,
        pages: ["dashboard"],
        keywords: ["notification", "bell", "alert", "unread", "messages"],
        body: [
          "The bell in the top bar opens your notifications. Notifications call attention to account and workflow events inside your scope; opening one navigates to the related page where the action is performed.",
          "A notification is informational. It does not approve, submit, or finalize anything on your behalf. The underlying record still follows its normal validation and permission rules."
        ],
        steps: [
          "Open the notification menu in the top bar.",
          "Read the message and note the related page.",
          "Follow the item to the record.",
          "Complete the action in the module, not from the notification."
        ],
        notes: [
          "Notifications never contain passwords, reset tokens, or full learner records."
        ]
      },
      {
        slug: "announcements",
        title: "Publishing and reading announcements",
        summary: "Draft, publish, and archive notices, and understand who sees them.",
        type: "procedure",
        sortOrder: 40,
        pages: ["announcements"],
        keywords: ["announcement", "notice", "publish", "draft", "archive", "memo"],
        body: [
          "Announcements carry division or district notices. Authors with announcement rights can save a draft, publish it, or archive an older notice. Published announcements appear to readers in the author's scope; system-wide notices are visible across districts.",
          "Draft and archived announcements are not shown as current notices. Editing a published notice updates the text readers see, so review the wording before publishing.",
          "Read-only staff still see published announcements for their district or system-wide notices; they cannot publish."
        ],
        steps: [
          "Open Announcements.",
          "Choose New announcement and enter a title and message.",
          "Save as draft to review, or publish when ready.",
          "Archive a notice that is no longer current.",
          "Use the status filter to find drafts and archived items."
        ],
        notes: [
          "Announcements are not a substitute for the formal submission workflow in School Forms.",
          "Publishing is audited."
        ]
      }
    ]
  },
  {
    slug: "schools-districts",
    title: "Schools and districts",
    description: "School registry, enrollment and performance views, districts, PSDS assignments, and scoping.",
    icon: "bi-buildings",
    sortOrder: 40,
    articles: [
      {
        slug: "school-register",
        title: "Add, edit, archive, and restore a school",
        summary: "The school registry fields, soft deletion, and who can change a school record.",
        type: "procedure",
        featured: true,
        sortOrder: 10,
        pages: ["schools"],
        keywords: ["add school", "new school", "edit school", "archive school", "restore school", "school id", "school code"],
        body: [
          "The Schools page is the registry of schools in your scope. Each record carries the school name, school code, district, type, status, address and contact details, and optional enrollment and performance figures used by the dashboard and reports.",
          "Creating or editing a school requires the school module's Add or Edit right. District administrators work only inside their own district. Archiving is a soft delete: the record is retained, hidden from ordinary active lists, and can be restored by an authorised user.",
          "School codes identify the school in bulk imports and reports. Use the official code and keep it unique; duplicate codes are rejected or skipped depending on the operation."
        ],
        steps: [
          "Open Schools and choose New school.",
          "Enter the school name, unique school code, district, type, and contact details.",
          "Save and confirm the record appears in the registry.",
          "Use Edit to correct details; do not create a duplicate for a renamed school.",
          "Use Archive to retire a record and Restore to bring it back."
        ],
        notes: [
          "Archived schools keep their history and are not deleted from the database.",
          "Deleting a district is blocked while schools, accounts, or announcements still reference it."
        ]
      },
      {
        slug: "school-enrollment-view",
        title: "School enrollment view",
        summary: "Read the enrollment view, compare schools, and understand where the counts come from.",
        type: "article",
        sortOrder: 20,
        pages: ["schools", "dashboard"],
        keywords: ["enrollment view", "school enrollment", "students per school", "comparison"],
        body: [
          "School Enrollment is a view of the school registry focused on learner counts. It groups schools in scope and shows enrolled totals for the selected school year.",
          "Counts come from learner enrollment records, not from typed totals on the school profile. If a school looks wrong, open the school and check its learner enrollments for the same school year.",
          "Use the view for comparison and follow a school link to the learner register filtered to that school when you need names."
        ],
        steps: [
          "Open Schools and choose School Enrollment.",
          "Select the school year where the view offers a filter.",
          "Compare schools in scope.",
          "Open the school to inspect its learner records."
        ],
        notes: [
          "A learner is counted through an enrollment record, not merely because a profile exists."
        ]
      },
      {
        slug: "school-performance-view",
        title: "School performance view",
        summary: "What the performance comparison uses and how to drill into a school.",
        type: "article",
        sortOrder: 30,
        pages: ["schools", "dashboard"],
        keywords: ["performance", "score", "comparison", "school ranking"],
        body: [
          "School Performance compares the performance indicator saved for each school in scope. It is a monitoring aid, not a computed national ranking.",
          "A blank or outdated value usually means the school profile or the relevant monitoring submission has not been updated. Open the school record or its monitoring view to correct the source.",
          "Use the comparison to decide which schools to review, then read the underlying submissions before recording any finding."
        ],
        steps: [
          "Open Schools and choose School Performance.",
          "Read the indicator label and the selected scope.",
          "Open a school with a missing or surprising value.",
          "Update the source record through its own module."
        ],
        notes: [
          "The system does not fabricate missing performance data."
        ]
      },
      {
        slug: "district-management",
        title: "Create and maintain districts",
        summary: "District details, exactly two PSDS assignments, deletion guards, and system-administrator scope.",
        type: "procedure",
        sortOrder: 40,
        pages: ["districts"],
        keywords: ["district", "PSDS", "create district", "edit district", "delete district", "district office"],
        body: [
          "Districts are maintained by system administrators. A district record holds its name, code, office contact details, and exactly two PSDS assignments. The sidebar hierarchy and district filters read from this register.",
          "A district cannot be deleted while schools, accounts, or announcements still reference it. Reassign or retire those records first; this guard preserves history instead of cascading a destructive delete.",
          "District administrators do not create districts. They may manage schools, personnel, and users inside the district assigned to them."
        ],
        steps: [
          "Open Districts from Administration.",
          "Choose New district and enter the name, code, and office details.",
          "Assign exactly two PSDS from the available accounts.",
          "Save and confirm the district appears in the division tree.",
          "Before deleting, check the referenced schools, users, and announcements."
        ],
        notes: [
          "PSDS assignments affect routing of account approvals.",
          "District changes are audited."
        ]
      },
      {
        slug: "district-scope",
        title: "Why different users see different records",
        summary: "How district and school scoping is applied to lists, reports, and actions.",
        type: "reference",
        sortOrder: 50,
        pages: ["dashboard", "schools", "users"],
        keywords: ["scope", "district scope", "school scope", "cannot see school", "missing records"],
        body: [
          "Scoping is enforced by the server. A system administrator sees all districts; a district administrator, PSDS, or district staff member sees the assigned district; school-based roles see their own school; a learner sees only their own records.",
          "The same rule applies to lists, dashboard counts, reports, import targets, and write actions. A school outside your scope is not merely hidden in the interface; the API refuses it.",
          "If a record is missing, first confirm the scope shown for your account. Reassignment is an administrative change and is audited."
        ],
        steps: [
          "Check your role, district, and school in My Profile.",
          "Confirm the page filter is not hiding the record.",
          "Open User Management as an administrator to verify the account assignment.",
          "Ask for reassignment only when the business need is confirmed."
        ],
        notes: [
          "Hiding a navigation link is a convenience; the server guard is the security boundary."
        ]
      }
    ]
  },
  {
    slug: "learner-records",
    title: "Learner records",
    description: "Learner register, profiles, guardians, enrollment, academic setup, activities, and learner reports.",
    icon: "bi-person-vcard",
    sortOrder: 50,
    articles: [
      {
        slug: "learner-register",
        title: "Search and filter the learner register",
        summary: "Find a learner by LRN or name, filter by year, grade, section, and status, and read profile completeness.",
        type: "article",
        featured: true,
        sortOrder: 10,
        pages: ["learners"],
        keywords: ["learners", "learner list", "search LRN", "find learner", "filter grade", "section", "enrollment status", "incomplete profile"],
        body: [
          "The Learner register lists permanent learner profiles in scope. Search by LRN or name, then filter by school year, grade level, section, enrollment status, and record status. The counters above the table summarise learners, current-year enrollment, incomplete profiles, and sections.",
          "Profile completeness reflects required address, contact, and guardian details. It is a prompt to complete the record, not a judgement about the learner. Archived profiles are excluded unless you switch the record-status filter to Archived or All records.",
          "Bulk upload and New learner appear only when your account has the learner Add right. Import history is available to accounts that can use the importer."
        ],
        steps: [
          "Open Learners.",
          "Enter an LRN or part of a name in Search learners.",
          "Choose the school year and any grade, section, or status filters.",
          "Open a row to view the learner profile.",
          "Use Reset to clear filters and return to the default scope."
        ],
        notes: [
          "The LRN is unique across all learner profiles; an import never overwrites an existing LRN.",
          "Deleting a permanent learner record is restricted. Ordinary workflows archive instead."
        ]
      },
      {
        slug: "add-a-learner",
        title: "Register a new learner",
        summary: "Required fields, age calculation, LRN rules, and where enrollment and guardians are added.",
        type: "procedure",
        featured: true,
        sortOrder: 20,
        pages: ["learners"],
        keywords: ["add learner", "new learner", "register learner", "LRN", "birth date", "age", "sex", "school"],
        body: [
          "Choose New learner on the register. The dialog records the permanent profile: a 12-digit LRN, birth date, name, sex, optional weight and height, school, address, and contact details. The age readout is derived from the birth date in Asia/Manila time and cannot be typed.",
          "The LRN must be exactly 12 digits and unique across all learner records. Birth date cannot be in the future. School is fixed for a school-based account and selectable for a district or system administrator.",
          "Creating the profile does not enroll the learner. Add a school-year enrollment and guardians from the learner profile after saving."
        ],
        steps: [
          "Open Learners and choose New learner.",
          "Type the 12-digit LRN; non-digits are removed as you type.",
          "Enter the birth date and confirm the calculated age.",
          "Complete the name, sex, measurements, school, address, and contact fields.",
          "Save, then open the profile to add guardians and the school-year enrollment."
        ],
        notes: [
          "A duplicate LRN is refused with a conflict message; search the register first.",
          "Middle name and extension are optional; last and first names are required."
        ]
      },
      {
        slug: "learner-profile",
        title: "Understand the learner profile tabs",
        summary: "What each profile tab contains and which records are connected to a learner.",
        type: "reference",
        sortOrder: 30,
        pages: ["learner", "learners"],
        keywords: ["learner profile", "tabs", "personal details", "guardians", "enrollment history", "subjects", "attendance", "grades", "books", "health", "permanent records"],
        body: [
          "The learner profile is the single view of a learner. Tabs cover overview, personal details, guardians, enrollment history, subjects and teachers, activities, school-year records, attendance, grades, books, restricted health data, school forms, and permanent academic records.",
          "Each tab reads the module that owns the data. Editing a guardian changes the guardian record; editing attendance or grades is done in those modules, subject to their permissions and workflows. The profile does not duplicate or recompute those records.",
          "The permanent academic record is the long-term history for the learner, including finalized report-card snapshots. It is not an editable scratchpad."
        ],
        steps: [
          "Open a learner from the register.",
          "Use the tab list to move between profile areas.",
          "Read the empty-state message on a tab to learn where the source record is created.",
          "Follow an action button to the owning module when you need to add data.",
          "Return to the profile to confirm the new record appears."
        ],
        notes: [
          "Health tabs are restricted to authorised health and administrative roles.",
          "Use the browser Back button or the breadcrumb to return to the register."
        ]
      },
      {
        slug: "guardians-and-enrollment",
        title: "Add guardians and school-year enrollments",
        summary: "Guardian contacts, enrollment records, and how they affect completeness and counting.",
        type: "procedure",
        sortOrder: 40,
        pages: ["learner", "learners"],
        keywords: ["guardian", "parent", "contact", "enrollment", "school year", "section", "grade", "promotion"],
        body: [
          "Guardians are contacts recorded against the learner profile: name, relationship, contact number, address, and whether the guardian is the primary contact. Adding a guardian completes a profile area the register uses for completeness.",
          "An enrollment connects the learner to a school, school year, grade level, and section. A learner can have several school-year enrollments but only one profile. Enrollment status values include Enrolled, Transferred in, Transferred out, Promoted, Retained, Completed, and Archived.",
          "Enrollment counts, attendance rosters, and class records depend on the enrollment record. Add it before expecting the learner to appear in a section workspace."
        ],
        steps: [
          "Open the learner profile.",
          "On Guardians, choose Add guardian and complete the contact details.",
          "On Enrollment history, choose Add enrollment.",
          "Select the school, school year, grade level, section, and status.",
          "Save and confirm the learner appears in the section roster."
        ],
        notes: [
          "Promotion and completion have dedicated workflows; do not create a duplicate enrollment to simulate them.",
          "Enrollment history is retained across school years."
        ]
      },
      {
        slug: "academic-setup",
        title: "School years, grade levels, sections, subjects, and teachers",
        summary: "The academic hierarchy that learner enrollment, attendance, class records, and forms depend on.",
        type: "article",
        sortOrder: 50,
        pages: ["school-years", "grade-levels", "sections", "subjects", "teachers"],
        keywords: ["school year", "grade level", "section", "subject", "teacher", "adviser", "timetable", "academic setup", "hierarchy"],
        body: [
          "Academic records form one hierarchy: school year, grade level, section, subject, teaching assignment, and class schedule. Enrollment, attendance rosters, class records, and School Forms read from this hierarchy.",
          "School Years marks one year as current. Grade Levels and Subjects let a school add school-owned entries by choosing an administrator-managed option from the dropdown. Sections combine a school year, grade level, name, and adviser. Teaching assignments connect a teacher to a subject and section, and the weekly timetable records schedule slots.",
          "Change setup cautiously. A section with enrolled learners and submitted records should not be recreated as a duplicate; correct its details instead so history remains connected."
        ],
        steps: [
          "Confirm the current school year before adding sections or enrollments.",
          "Create or select the grade level and subject options for the school.",
          "Add the section with its adviser.",
          "Create teaching assignments and a conflict-free timetable.",
          "Enroll learners and verify the attendance roster."
        ],
        notes: [
          "An option still used by a school cannot be removed from the administrator catalog.",
          "Existing school subjects and linked records are preserved when the catalog changes."
        ]
      },
      {
        slug: "grade-level-catalog",
        title: "Administrator-managed grade levels",
        summary: "Why grade levels come from a system catalog and how schools add their own.",
        type: "procedure",
        sortOrder: 60,
        pages: ["grade-levels"],
        keywords: ["grade level option", "kindergarten", "grade 1", "catalog", "dropdown", "administrator"],
        body: [
          "A system administrator maintains a system-wide grade level catalog such as Kindergarten through Grade 12. Entries have no school, so every school can use the same vocabulary.",
          "A school adds a grade level to its own record by selecting an active option from the dropdown instead of typing free text. This keeps report grouping consistent. Existing school grade levels, sections, and enrollments are never rewritten by a catalog change.",
          "An option that is still in use cannot be removed. Deactivate an obsolete option to hide it from new selections while preserving history."
        ],
        steps: [
          "Open Grade Levels.",
          "As a system administrator, use Manage to add or reorder catalog options.",
          "As school staff, choose New grade level and select from the dropdown.",
          "Save and confirm the grade appears with the school's other levels."
        ],
        notes: [
          "Deactivation is safer than deletion for an option that may appear in historical records.",
          "Catalog changes are audited."
        ]
      },
      {
        slug: "subject-catalog",
        title: "Administrator-managed subjects",
        summary: "The general subject list, school subject creation, assignments, and timetable rules.",
        type: "procedure",
        sortOrder: 70,
        pages: ["subjects"],
        keywords: ["subject option", "general subject", "learning area", "subject catalog", "teacher assignment", "timetable"],
        body: [
          "The system administrator maintains general subjects covering Kindergarten to Grade 12. These catalog entries have no school and no grade level; they are a shared vocabulary.",
          "A school adds a subject by selecting an active catalog option, optionally attaching a grade level and code. The school then creates teaching assignments and a weekly timetable. Existing subjects, assignments, and schedules are preserved if the catalog changes.",
          "The catalog blocks removing an option that a school still uses. Deactivate it instead."
        ],
        steps: [
          "Open Subjects and teachers.",
          "As system administrator, use Manage to maintain the general catalog.",
          "As school staff, choose New subject and select the learning area.",
          "Add teaching assignments for the section and subject.",
          "Build the weekly timetable and resolve any conflict message before saving."
        ],
        notes: [
          "A subject code should be stable; reports and class records use it for identification.",
          "Timetable conflicts are validated rather than silently accepted."
        ]
      },
      {
        slug: "activities",
        title: "Record learner activities",
        summary: "Activities, participants, dates, and how they connect to learner profiles.",
        type: "procedure",
        sortOrder: 80,
        pages: ["activities"],
        keywords: ["activity", "competition", "club", "participation", "award", "learner activity"],
        body: [
          "Activities record learner participation in school or division events. An activity has a title, date, category or description, and the learners who took part.",
          "Activities appear in the learner profile's activities tab. They support monitoring and recognition; they do not change grades or attendance automatically.",
          "Only record participation that actually happened. Do not create an activity to represent an approval, signature, or award that has no supporting record."
        ],
        steps: [
          "Open Activities.",
          "Choose New activity and enter the title and date.",
          "Add the participating learners from the roster.",
          "Save and confirm the entry appears on each learner's profile.",
          "Use filters to find past activities."
        ],
        notes: [
          "Deleting an activity removes its participation links; confirm before deleting."
        ]
      },
      {
        slug: "learner-reports",
        title: "Generate learner reports and exports",
        summary: "Printable learner lists, profile sheets, directories, and CSV exports.",
        type: "procedure",
        sortOrder: 90,
        pages: ["learner-reports"],
        keywords: ["learner report", "print learner", "CSV export", "directory", "profile sheet", "download"],
        body: [
          "Learner Reports offers printable learner lists, profile sheets, and directories for the scope and filters you can access. Exports respect the same district and school scoping as the register.",
          "Choose the report, apply the school year and other filters, preview it, then print or export. The system does not provide an unrestricted bulk download of learner records; exports are limited to authorised reports.",
          "Confirm the scope and filters before printing so confidential information is not shared beyond the intended office."
        ],
        steps: [
          "Open Learner Reports.",
          "Select the report type and filters.",
          "Preview the output and check the scope.",
          "Print or export the report.",
          "Handle printed copies as confidential learner records."
        ],
        notes: [
          "Report totals come from saved records; an empty preview usually means no matching enrollment or profile.",
          "Do not publish learner reports on public links."
        ]
      }
    ]
  },
  {
    slug: "daily-operations",
    title: "School operations",
    description: "Attendance, grades, books, movements, health, and personnel records that feed forms and reports.",
    icon: "bi-calendar2-check",
    sortOrder: 60,
    articles: [
      {
        slug: "attendance",
        title: "Record daily attendance",
        summary: "Section rosters, attendance marks, calendar overrides, monthly reconciliation, and the working register.",
        type: "procedure",
        sortOrder: 10,
        pages: ["attendance"],
        keywords: ["attendance", "present", "absent", "tardy", "excused", "half day", "roster", "calendar", "monthly register"],
        body: [
          "Attendance uses a section roster for a chosen school year, section, and date. Each learner receives one mark: present (P), absent (A), tardy (T), excused (E), or half day (H). Mark all present is a starting point; review every exception before saving.",
          "School-calendar overrides mark days that are not ordinary class days, so an unrecorded day is never assumed present. Monthly reconciliation summarises each learner's marks for the selected month.",
          "The working register is print-ready. It reflects the marks actually saved, and the system flags unrecorded days rather than filling them in."
        ],
        steps: [
          "Open Attendance and select the school, school year, section, and date.",
          "Load the roster and mark each learner.",
          "Use the calendar override when the date is not a class day.",
          "Save and confirm the success message.",
          "Open the monthly view to reconcile totals and print the register."
        ],
        notes: [
          "Attendance is the source for SF 2; never edit the form in place to hide an attendance gap.",
          "Only users with attendance rights can change marks."
        ]
      },
      {
        slug: "grades-and-promotion",
        title: "Grades, grading policy, and promotion",
        summary: "Quarter entry, submit and finalize, locked grades, the correction path, and promotion decisions.",
        type: "procedure",
        sortOrder: 20,
        pages: ["grades"],
        keywords: ["grades", "quarter", "finalize", "lock", "promotion", "passing grade", "weighted", "average", "grading policy"],
        body: [
          "Grades and Promotion records quarter grades for a section and subject. Enter or import the quarter grades, review the computed final grade, then submit and finalize according to the workflow.",
          "A school grading policy supplies the passing grade and either an average of the four quarters or weighted quarters. The system does not hardcode a grading formula; the policy in force for the school year is applied and shown.",
          "Finalized grades are locked. Corrections go through the audited correction path rather than editing a locked value. Promotion decisions use the finalized results and are recorded per learner."
        ],
        steps: [
          "Open Grades and Promotion and select the school, year, and section.",
          "Choose the subject and grading period.",
          "Enter the quarter grades and review validation messages.",
          "Save, submit for review, and finalize when authorised.",
          "Use the correction path for a locked grade that must change."
        ],
        notes: [
          "A missing grade is not stored as zero.",
          "Grading templates and policies are administrative configurations; changing them does not rewrite previously finalized records."
        ]
      },
      {
        slug: "books-and-materials",
        title: "Issue and return books and materials",
        summary: "Inventory, append-only issuance and return transactions, and outstanding copies.",
        type: "procedure",
        sortOrder: 30,
        pages: ["books"],
        keywords: ["books", "materials", "inventory", "issue book", "return book", "lost", "damaged", "outstanding"],
        body: [
          "Books and Materials tracks textbook and material inventory per school and school year. Issuance and return are recorded as transactions rather than by overwriting a quantity.",
          "An issuance shows which learner received copies and its status: issued, partially returned, returned, damaged, or lost. Outstanding copies are derived from the transactions, and learner history is available from the profile.",
          "The saved issuance data feeds SF 3. Record the physical transaction that actually happened; do not adjust the form independently."
        ],
        steps: [
          "Open Books and Materials and select the school and year.",
          "Add or review the inventory item.",
          "Issue copies to a learner and record the quantity and date.",
          "Record returns, damage, or loss as separate transactions.",
          "Check the outstanding total and the learner's history."
        ],
        notes: [
          "Transactions are append-only; correct a mistake with a new transaction rather than deleting history.",
          "Inventory figures are per school and school year."
        ]
      },
      {
        slug: "learner-movements",
        title: "Transfers, dropouts, reinstatement, and completion",
        summary: "Movement types, approval decisions, and the enrollment status update.",
        type: "procedure",
        sortOrder: 40,
        pages: ["movements"],
        keywords: ["movement", "transfer in", "transfer out", "dropout", "dropped out", "reinstated", "completed", "SF 4"],
        body: [
          "Learner Movements records a change in a learner's enrollment status: transferred in, transferred out, dropped out, reinstated, completed, or other. Each movement carries a date, reason or remarks, and a pending, approved, or rejected decision.",
          "Approving a movement updates the learner's enrollment status. Rejecting it leaves the enrollment unchanged. The decision and reviewer are retained as history.",
          "Approved movements feed SF 4. Record the real event and supporting details; the system does not infer a movement from an empty attendance day."
        ],
        steps: [
          "Open Learner Movements and select the school and year.",
          "Choose New movement and select the learner and type.",
          "Enter the effective date and remarks.",
          "Submit for approval and follow the decision.",
          "Verify the enrollment status on the learner profile."
        ],
        notes: [
          "A rejected movement is kept for audit but does not change enrollment.",
          "Use reinstatement to reverse a dropout when the learner returns."
        ]
      },
      {
        slug: "health-and-nutrition",
        title: "Restricted health and nutrition records",
        summary: "Who can see health data, how BMI is derived, and why adult cutoffs are not applied to children.",
        type: "procedure",
        sortOrder: 50,
        pages: ["health"],
        keywords: ["health", "nutrition", "BMI", "height", "weight", "nutritional status", "restricted", "privacy"],
        body: [
          "Health and Nutrition is restricted to authorised health and administrative personnel. It records height, weight, and health remarks for learners in scope.",
          "BMI is computed only from saved height and weight measurements. Nutritional status is an authorised assessment, not an automatic diagnosis, and the system never applies adult BMI cutoffs to children.",
          "Health information is sensitive personal data. Share it only with staff who need it for the learner's care, and never publish it or include it in ordinary announcements."
        ],
        steps: [
          "Open Health and Nutrition if your role includes health access.",
          "Select the school and school year, then the learner.",
          "Record the measurements and the authorised assessment.",
          "Save and review the aggregate summary without identifying learners unnecessarily.",
          "Restrict printed copies to authorised personnel."
        ],
        notes: [
          "The learner profile's health tab follows the same restriction.",
          "Missing measurements stay missing; the system does not estimate them."
        ]
      },
      {
        slug: "personnel",
        title: "Personnel profiles and teaching loads",
        summary: "Staff profiles, teaching loads, schedules, and the link to SF 7.",
        type: "procedure",
        sortOrder: 60,
        pages: ["personnel"],
        keywords: ["personnel", "staff", "teacher profile", "teaching load", "schedule", "SF 7", "non-teaching"],
        body: [
          "Personnel holds staff profiles for school heads, teachers, coordinators, advisers, and non-teaching personnel in scope. A profile records identity, position, assignment, and contact details.",
          "Teaching loads and class schedules connect personnel to subjects and sections. These records feed SF 7 and the teacher and timetable views.",
          "Personnel bulk import creates a profile and an active login account per valid row, with a one-time activation link. Passwords are never imported."
        ],
        steps: [
          "Open Personnel and select the school.",
          "Open or create the staff profile.",
          "Record the position and assignment.",
          "Add teaching loads and schedule entries where applicable.",
          "Confirm the staff member appears in the expected subject and section views."
        ],
        notes: [
          "Personnel records are not a substitute for the account's role and permissions.",
          "Activation links are shown once and are never stored in history or audit output."
        ]
      }
    ]
  },
  {
    slug: "school-forms",
    title: "School Forms and submissions",
    description: "SF 1 to SF 10, validation, printing, the submission workflow, and district monitoring.",
    icon: "bi-file-earmark-text",
    sortOrder: 70,
    articles: [
      {
        slug: "school-forms-center",
        title: "Generate a School Form in the Forms Center",
        summary: "Choose a form, select the school year and scope, validate, preview, and generate.",
        type: "procedure",
        featured: true,
        sortOrder: 10,
        pages: ["school-forms"],
        keywords: ["school form", "SF 1", "SF 2", "SF 3", "SF 4", "SF 5", "SF 6", "SF 7", "SF 8", "SF 9", "SF 10", "forms center", "generate form"],
        body: [
          "The School Forms Center generates DepEd forms from saved source records. Each form card states its purpose and the records it reads, for example the school register for SF 1, attendance for SF 2, books for SF 3, movements for SF 4, promotion for SF 5 and SF 6, personnel for SF 7, health for SF 8, report cards for SF 9, and the permanent record for SF 10.",
          "Select the school year and scope, run validation, then preview the generated form. Validation errors and warnings are severity-tagged, and completeness is scored so you can see what is still missing before printing.",
          "Generating a form does not change its source records. Forms 9 and 10 are stored per learner so one learner's card or record never overwrites another's."
        ],
        steps: [
          "Open School Forms Center.",
          "Select the school year and the form you need.",
          "Run validation and resolve error-level findings in the owning module.",
          "Preview the generated form and review the layout.",
          "Generate the printable copy or the authorised PDF output."
        ],
        notes: [
          "The system never fabricates missing attendance, grades, signatures, seals, or approvals.",
          "An unofficial layout is never presented as an official DepEd form."
        ]
      },
      {
        slug: "form-sources-and-validation",
        title: "Where each form gets its data and what validation checks",
        summary: "Source records per form, error versus warning, and the completeness score.",
        type: "reference",
        sortOrder: 20,
        pages: ["school-forms"],
        keywords: ["validation", "error", "warning", "completeness", "source record", "SF 1", "SF 10", "missing data"],
        body: [
          "Forms read saved source records rather than separate typed copies. If a field is missing, correct the source module; editing a generated preview does not persist a correction.",
          "Validation reports two severities. Errors block a clean generation or submission; warnings point to data that should be checked but may be legitimately empty. The completeness score summarises how much required data is present.",
          "A form can be generated while warnings remain, but the submission state and reviewer notes record that the data is not final. Incomplete or unapproved records are never counted as complete in monitoring."
        ],
        steps: [
          "Run validation before generating.",
          "Read each finding's form, section, and reason.",
          "Open the source module named by the finding.",
          "Correct the source record and regenerate.",
          "Review remaining warnings with the school head before submitting."
        ],
        notes: [
          "Unrecorded attendance is flagged, not assumed present.",
          "A validation failure is a data finding, not a system failure."
        ]
      },
      {
        slug: "printing-and-pdf",
        title: "Print a form or produce a PDF",
        summary: "Paper size, orientation, layout templates, print preview, and handling of official copies.",
        type: "procedure",
        sortOrder: 30,
        pages: ["school-forms", "report-cards"],
        keywords: ["print", "PDF", "paper size", "orientation", "layout", "template", "official copy"],
        body: [
          "Printable output uses the configured paper size, orientation, and layout template. Administrators can maintain layout templates; generating a form applies the template without altering the underlying values.",
          "Use the browser print dialog or the provided PDF action after previewing the form. Check page breaks, school identity, school year, and learner names before releasing a copy.",
          "The system provides the layout and saved values it has. It does not add signatures, seals, or approvals that were not recorded through the proper workflow."
        ],
        steps: [
          "Generate and preview the form.",
          "Confirm the selected paper size and orientation.",
          "Print or export the PDF.",
          "Inspect the first and last page for truncation.",
          "File the official copy according to school policy."
        ],
        notes: [
          "Printing does not change the submission state.",
          "Batch printing for SF 9 produces one card per learner."
        ]
      },
      {
        slug: "submission-workflow",
        title: "Submit, return, approve, and finalize a form",
        summary: "The form states, reviewer comments, version history, and approval locks.",
        type: "procedure",
        sortOrder: 40,
        pages: ["school-forms", "monitoring"],
        keywords: ["submit", "returned for correction", "approve", "finalize", "workflow", "reviewer", "version history", "lock"],
        body: [
          "A form moves through Draft, In Progress, Ready for Validation, Validation Failed, Submitted, Returned for Correction, Approved, and Finalized. Each transition is recorded with the actor and time.",
          "A reviewer can return a submission with a required comment. The school corrects the source data, regenerates, and submits again; the earlier version remains in the history. Approval locks the form against ordinary edits, and finalization records the accepted version.",
          "Reopening or correcting after finalization follows the module's audited path. The original generated version is retained so the change is traceable."
        ],
        steps: [
          "Generate the form and clear validation errors.",
          "Move the form to Ready for Validation and submit.",
          "Read any reviewer comment if the form is returned.",
          "Correct the source records, regenerate, and resubmit.",
          "Confirm the approved or finalized state before printing the official copy."
        ],
        notes: [
          "Only reviewers in scope can return, approve, or finalize.",
          "Reviewer comments and generation history are audited."
        ]
      },
      {
        slug: "district-monitoring",
        title: "Use the District Monitoring workspace",
        summary: "Submission status, overdue requirements, validation failures, discrepancies, and reviewer actions.",
        type: "procedure",
        sortOrder: 50,
        pages: ["monitoring"],
        keywords: ["monitoring", "district monitoring", "overdue", "submission status", "compliance", "discrepancy", "reviewer"],
        body: [
          "District Monitoring shows the submission state of schools in scope: what is missing, what is overdue, what failed validation, and which records show discrepancies. It is a review workspace, not a second copy of the forms.",
          "Open a school or requirement to see the underlying submission, comments, and version history. Reviewer actions are performed there and remain subject to the form workflow.",
          "Incomplete or unapproved records are never counted as complete. A school marked as requiring attention should be reviewed against the actual submissions before any finding is recorded."
        ],
        steps: [
          "Open District Monitoring.",
          "Filter by school, requirement, or status.",
          "Open an overdue or failed item.",
          "Review the submission and leave a comment or decision where permitted.",
          "Recheck the status after the school resubmits."
        ],
        notes: [
          "Monitoring counts derive from submissions, not from a manual status typed on a dashboard.",
          "Reviewer actions are audited."
        ]
      }
    ]
  },
  {
    slug: "class-records",
    title: "Class records and report cards",
    description: "Subject class records, adviser consolidation, and the SF 9 report card workflow.",
    icon: "bi-journal-text",
    sortOrder: 80,
    articles: [
      {
        slug: "class-record-setup",
        title: "Set up a subject class record",
        summary: "Teaching assignments, components, weights, rounding, and transmutation.",
        type: "procedure",
        sortOrder: 10,
        pages: ["class-records"],
        keywords: ["class record", "teaching assignment", "written work", "performance task", "quarterly assessment", "weights", "transmutation"],
        body: [
          "A class record belongs to one teaching assignment: a teacher, subject, section, and school year. The teacher configures written-work, performance-task, and quarterly-assessment components and their weights, as well as rounding and optional transmutation.",
          "Component weights must be internally consistent; the screen refuses an invalid configuration. Changing a configuration after scores exist requires care because it changes computed results, so complete setup before encoding scores.",
          "The class record computes initial and quarterly grades from the encoded scores and the configured policy. It is independent for each teaching assignment."
        ],
        steps: [
          "Open Class Records and select the assignment.",
          "Review the component labels and weights.",
          "Set rounding and transmutation to match the approved policy.",
          "Save the configuration and confirm the computed columns appear.",
          "Encode scores for the quarter."
        ],
        notes: [
          "The system does not hardcode a grading formula; the configured policy is applied.",
          "A subject teacher sees only their own assignments; advisers and school heads have review access."
        ]
      },
      {
        slug: "score-entry-and-computation",
        title: "Encode scores and understand the computed grade",
        summary: "Blank versus zero, incomplete quarters, and how initial and quarterly grades are produced.",
        type: "reference",
        sortOrder: 20,
        pages: ["class-records"],
        keywords: ["score", "blank", "zero", "missing score", "initial grade", "quarterly grade", "incomplete quarter"],
        body: [
          "Scores are encoded per component and assessment. A blank score means the assessment is missing; it is never stored as zero. This distinction protects learners from an unintended failing mark.",
          "The initial grade is computed from the encoded component totals and weights. The quarterly grade applies the configured rounding and optional transmutation. An incomplete quarter produces no quarterly grade and cannot be submitted.",
          "If a value looks wrong, first check for a blank score, a missing assessment, or a weight that no longer matches the approved policy. The screen shows which component is incomplete."
        ],
        steps: [
          "Open the quarter in the class record.",
          "Enter each score; leave truly missing work blank.",
          "Check the component totals and the initial grade.",
          "Complete every required assessment for the quarter.",
          "Review the quarterly grade before submitting."
        ],
        notes: [
          "Do not use zero as a placeholder for missing work.",
          "Submitting an incomplete quarter is blocked by design."
        ]
      },
      {
        slug: "adviser-consolidation",
        title: "Review subject submissions as an adviser",
        summary: "Accept or return a subject-quarter submission, compare accepted quarters, and feed SF 9.",
        type: "procedure",
        sortOrder: 30,
        pages: ["adviser-consolidation"],
        keywords: ["adviser", "consolidation", "accept grades", "return submission", "review", "section adviser"],
        body: [
          "Adviser Consolidation shows each subject-quarter submission for the adviser's section. The adviser compares accepted quarters per learner and subject and either accepts the submission or returns it with a required reason.",
          "Only the adviser or an authorised school head can accept grades. Acceptance finalizes the subject grade records that feed SF 9. A returned submission goes back to the subject teacher with the reason attached to the review history.",
          "Reviewing is not editing. If a score is wrong, return the submission so the owning teacher corrects it in the class record."
        ],
        steps: [
          "Open Adviser Consolidation and select the section and quarter.",
          "Open a subject submission and review learner grades.",
          "Choose Accept, or Return with a clear reason.",
          "Follow up on returned submissions.",
          "Confirm all offered subjects are accepted before generating SF 9."
        ],
        notes: [
          "Return reasons and decisions are retained in the review history.",
          "Acceptance is limited to the adviser or an authorised school head."
        ]
      },
      {
        slug: "report-cards-sf9",
        title: "Generate, finalize, reopen, and print SF 9",
        summary: "Prerequisites, immutable snapshots, reopen reasons, and individual or batch printing.",
        type: "procedure",
        sortOrder: 40,
        pages: ["report-cards"],
        keywords: ["SF 9", "report card", "finalize", "snapshot", "reopen", "print card", "batch print"],
        body: [
          "Report Cards (SF 9) generates one card per learner. Before a card can be finalized, every offered subject must have a finalized final grade from the class-record and consolidation workflow.",
          "Finalizing freezes an immutable, versioned snapshot. Reopening a finalized card requires a recorded reason; the previous snapshot is retained. This keeps the official card traceable even when a correction is necessary.",
          "Print individual cards or a section batch, or export the register to CSV. Cards and snapshots are per learner; one learner's card never overwrites another's."
        ],
        steps: [
          "Confirm every subject-quarter submission is accepted.",
          "Open Report Cards and select the section and learner.",
          "Generate and review the card values.",
          "Finalize the card when the data is correct.",
          "Print individually or in a section batch."
        ],
        notes: [
          "Reopening is not an ordinary edit; record the reason.",
          "The system does not add signatures or seals that were not part of the recorded output."
        ]
      }
    ]
  },
  {
    slug: "bulk-uploads",
    title: "Bulk uploads",
    description: "Secure spreadsheet import for districts, schools, personnel, and learner profiles.",
    icon: "bi-file-earmark-spreadsheet",
    sortOrder: 90,
    articles: [
      {
        slug: "import-overview",
        title: "How the secure spreadsheet import works",
        summary: "Templates, file limits, preview, duplicates, error reports, and commit.",
        type: "article",
        featured: true,
        sortOrder: 10,
        pages: ["districts", "schools", "personnel", "learners"],
        keywords: ["bulk upload", "import", "spreadsheet", "XLSX", "CSV", "template", "preview", "commit", "error report", "duplicate"],
        body: [
          "District, school, personnel, and learner imports share one workflow: download the template, prepare up to five .xlsx, .xls, or .csv files (5 MB each, 15 MB total, 1,000 rows per sheet), drop them on the upload area, and choose Validate and preview.",
          "The server parses and validates every row, shows each file's detected, valid, duplicate, and rejected counts, and lists the valid records and the rejected rows with file, sheet, row, column, and reason. Nothing is written during preview.",
          "Confirmation revalidates every row, skips duplicates rather than overwriting them, and commits the batch in one transaction. A downloadable Excel error report lists rejected rows. Every batch is audited and visible in Import history."
        ],
        steps: [
          "Open the module and choose Bulk upload.",
          "Download the Excel template and keep its column headers.",
          "Prepare the rows and remove any formula cells you do not need.",
          "Drop the files and choose Validate and preview.",
          "Fix rejected rows using the error report, then confirm the import."
        ],
        notes: [
          "Existing records are skipped, never overwritten.",
          "Profiles and accounts are created only by the import types that state so; learner import creates profiles only."
        ]
      },
      {
        slug: "district-import",
        title: "Import districts in bulk",
        summary: "District rows, PSDS references, duplicates, and system-administrator access.",
        type: "procedure",
        sortOrder: 20,
        pages: ["districts"],
        keywords: ["district import", "bulk district", "PSDS import", "district template"],
        body: [
          "The district import creates district records from a spreadsheet. Each row carries the district identity and the PSDS references required by the template. It is limited to system administrators.",
          "Duplicate districts are skipped, and invalid rows are reported without stopping the rest of the batch. Review the preview before confirming.",
          "District deletion rules still apply after import: a district with schools, accounts, or announcements cannot be removed."
        ],
        steps: [
          "Open Districts and choose Bulk upload.",
          "Download the district template.",
          "Fill the required columns and save the workbook.",
          "Preview the files and resolve rejected rows.",
          "Confirm the import and check the division tree."
        ],
        notes: [
          "Importing a district does not create its schools or accounts.",
          "Imports are audited."
        ]
      },
      {
        slug: "school-import",
        title: "Import school records in bulk",
        summary: "School columns, district scope, duplicate school codes, and who may import.",
        type: "procedure",
        sortOrder: 30,
        pages: ["schools"],
        keywords: ["school import", "bulk school", "school template", "school code duplicate"],
        body: [
          "The school import creates school records using the same validators as manual registration. Each row names the school, code, district, type, and other required details.",
          "District administrators can import only into their own district. Duplicate school codes are skipped instead of overwriting an existing school. Invalid rows are listed with their exact reason.",
          "After import, open the school registry to confirm addresses, contacts, and status, and edit any record that needs completion."
        ],
        steps: [
          "Open Schools and choose Bulk upload.",
          "Download the school template and fill one school per row.",
          "Preview the batch and read every rejected row.",
          "Correct the workbook if needed and preview again.",
          "Confirm and verify the new schools in the registry."
        ],
        notes: [
          "School codes must be unique.",
          "Bulk import does not enroll learners or create staff accounts."
        ]
      },
      {
        slug: "personnel-import",
        title: "Import personnel profiles and accounts",
        summary: "Profiles plus login accounts, activation links, duplicate handling, and district limits.",
        type: "procedure",
        sortOrder: 40,
        pages: ["personnel"],
        keywords: ["personnel import", "staff import", "teacher import", "activation link", "bulk staff"],
        body: [
          "Personnel import creates one personnel profile and one active login account per valid row. Importing does not set a password; each account receives a one-time activation link shown only in the confirmation step.",
          "The activation links are never stored in import history or the audit trail. Copy them securely and deliver each link only to its owner. Duplicate accounts are skipped.",
          "District administrators are limited to their own district. Review role and school values carefully because they determine the account's scope."
        ],
        steps: [
          "Open Personnel and choose Bulk upload.",
          "Download the template and fill staff details, role, and school.",
          "Preview and resolve rejected rows.",
          "Confirm the import.",
          "Deliver each activation link securely and never post the list publicly."
        ],
        notes: [
          "Passwords are never imported.",
          "The one-time activation links cannot be retrieved from history later."
        ]
      },
      {
        slug: "learner-import",
        title: "Import learner profiles in bulk",
        summary: "Profiles only, LRN duplicates, birth-date formats, and school scope.",
        type: "procedure",
        featured: true,
        sortOrder: 50,
        pages: ["learners"],
        keywords: ["learner import", "bulk learner", "LRN", "birth date", "Excel date", "duplicate LRN", "CSV date"],
        body: [
          "Learner import creates permanent learner profiles only. It never creates an enrollment, guardian, grade, attendance, health record, or School Form. Each row must carry a unique 12-digit LRN, name, birth date, sex, and school code.",
          "Birth date accepts a real date cell, a YYYY-MM-DD text value, or an ISO timestamp; an ambiguous value such as 15/12/2013 is rejected. Excel date cells are converted using their calendar value, so a cell showing 2013-12-15 imports as that date.",
          "An existing LRN is skipped, never overwritten. School heads are limited to their own school. After import, open each profile to add guardians and the school-year enrollment."
        ],
        steps: [
          "Open Learners and choose Bulk upload.",
          "Download the learner template and keep the LRN column as text.",
          "Enter birth dates as real dates or YYYY-MM-DD values.",
          "Preview the files and fix rejected rows.",
          "Confirm, then add guardians and enrollments from each profile."
        ],
        notes: [
          "Bulk import does not enroll learners in a section.",
          "A future birth date is rejected."
        ]
      }
    ]
  },
  {
    slug: "reports-monitoring",
    title: "Reports and monitoring",
    description: "District reports, learner reports, and the monitoring summaries built from saved records.",
    icon: "bi-graph-up",
    sortOrder: 100,
    articles: [
      {
        slug: "district-reports",
        title: "Read and print district reports",
        summary: "Report scope, filters, sources, and responsible interpretation.",
        type: "procedure",
        sortOrder: 10,
        pages: ["reports"],
        keywords: ["reports", "district report", "analytics", "print report", "trend", "comparison"],
        body: [
          "Reports and Analytics summarises schools, enrollment, performance, and monitoring data for the scope you can access. Filters choose the school year and comparison.",
          "Report figures come from saved records and submissions, so an unexpected value should be traced to its source module rather than edited in the report. A system administrator and a district administrator may see different totals because their scopes differ.",
          "Printed reports are working documents. Confirm the scope and period before sharing them, and do not present a generated summary as an official DepEd statistical release."
        ],
        steps: [
          "Open Reports and Analytics.",
          "Choose the school year and scope.",
          "Review the summary and open the schools behind an outlier.",
          "Print or export the report where the action is offered.",
          "Record any follow-up in the proper module."
        ],
        notes: [
          "Reports do not generate missing data.",
          "Learner-level exports belong to Learner Reports and follow the same scoping."
        ]
      },
      {
        slug: "data-relationships",
        title: "How records connect across modules",
        summary: "The learner-centered data model and how forms, grades, attendance, books, and movements relate.",
        type: "reference",
        sortOrder: 20,
        pages: [],
        keywords: ["relationship", "data model", "workflow", "source record", "connected records", "algorithm"],
        body: [
          "A learner profile is the anchor. It connects to school-year enrollments, guardians, activities, attendance marks, grades, book transactions, movements, health records, form submissions, and report-card snapshots.",
          "The academic hierarchy (school year, grade level, section, subject, teaching assignment) defines where a learner can be enrolled and which class records apply. Attendance and class records read enrollments and assignments; grades and consolidation feed SF 9; finalized snapshots feed the permanent record.",
          "School Forms read these source records and record their own submission state. A form never replaces the source data, and a dashboard count never becomes a separate source of truth."
        ],
        steps: [
          "Identify the record the form or report is reading.",
          "Open that module and correct the source.",
          "Regenerate or refresh the form, report, or dashboard.",
          "Check the audit trail when a change must be explained."
        ],
        notes: [
          "Deleting a dependent record is restricted where it would orphan permanent history.",
          "Archiving preserves history; it is not the same as deletion."
        ]
      }
    ]
  },
  {
    slug: "administration",
    title: "Administration",
    description: "User rights, audit logs, catalogs, settings, and administrator responsibilities.",
    icon: "bi-sliders",
    sortOrder: 110,
    articles: [
      {
        slug: "user-rights",
        title: "Grant or revoke module permissions",
        summary: "Role defaults, per-account overrides, guarded accounts, and immediate enforcement.",
        type: "procedure",
        featured: false,
        sortOrder: 10,
        pages: ["user-rights"],
        keywords: ["user rights", "permissions", "access", "add", "edit", "delete", "override", "role default", "grant"],
        body: [
          "User Rights and Permissions is limited to system administrators. The directory lists accounts in scope; opening one shows the installed modules with independent Access, Add, Edit, and Delete controls for the actions each module supports.",
          "Each role has a default row. Saving a matrix stores only the entries that differ from the role default in a per-account override. Restoring the default removes the override. Clearing Access clears and disables the write actions.",
          "Guards prevent unsafe changes: a system administrator's matrix cannot be edited, nobody can change their own permissions, and a module/action cannot be granted outside the policy allowed for that role. Every save is audited with the previous and new values."
        ],
        steps: [
          "Open User Rights and search for the account.",
          "Compare the inherited role default with any override.",
          "Tick or clear the permitted module actions.",
          "Save and read the confirmation.",
          "Ask the user to perform the action again; enforcement is immediate on the next request."
        ],
        notes: [
          "Navigation links are hidden as a convenience; the API and page guards enforce the matrix.",
          "Permissions are recomputed from PostgreSQL on every authenticated request."
        ]
      },
      {
        slug: "audit-logs",
        title: "Review audit logs",
        summary: "What is recorded, who can see it, filtering, and privacy limits.",
        type: "procedure",
        sortOrder: 20,
        pages: ["audit-logs"],
        keywords: ["audit", "log", "history", "who changed", "trace", "security"],
        body: [
          "Audit Logs records security-relevant actions such as sign-ins, account and permission changes, imports, and substantial record changes. Only system administrators can open the page and query the API.",
          "Filter by search text, action, or entity type to trace a change. Each entry identifies the actor, action, entity, district, time, and details. Passwords, session secrets, and one-time activation links are never recorded.",
          "The audit trail is evidence, not an editing tool. If an entry is missing, check that the action is one the system audits rather than assuming it did not happen."
        ],
        steps: [
          "Open Audit Logs.",
          "Search by person, school, or action keyword.",
          "Apply action or entity filters to narrow the list.",
          "Read the details and timestamp.",
          "Export or print only when your office authorises it."
        ],
        notes: [
          "Audit logs are read-only in the interface.",
          "Retention and access follow the division's records policy."
        ]
      },
      {
        slug: "administrator-responsibilities",
        title: "Administrator responsibilities and safe changes",
        summary: "A practical checklist for system and district administrators.",
        type: "article",
        sortOrder: 30,
        pages: ["users", "approvals", "user-rights", "audit-logs", "settings"],
        keywords: ["administrator", "checklist", "responsibility", "safe change", "account review"],
        body: [
          "Administrators protect access and data quality. Review pending approvals promptly, keep role assignments accurate, and grant the minimum module actions a person needs. Do not share administrator accounts.",
          "Before a structural change, confirm the school year, the affected sections, and whether records are already finalized. Prefer deactivation and archiving over deletion. Correct source data instead of editing generated forms.",
          "Check the audit trail after sensitive changes and when investigating an issue. Report suspected unauthorized access through your division's security process."
        ],
        steps: [
          "Review Account Approvals and deactivate accounts that should no longer sign in.",
          "Audit role assignments and per-user overrides periodically.",
          "Confirm the current school year before academic setup changes.",
          "Use archive or deactivate instead of destructive deletion.",
          "Record and review sensitive changes in Audit Logs."
        ],
        notes: [
          "System administration is not a substitute for official DepEd approvals.",
          "Never send passwords or activation links through public channels."
        ]
      },
      {
        slug: "managing-helpdesk-content",
        title: "Manage the Helpdesk knowledge base",
        summary: "Create, edit, publish, hide, and remove help articles and categories.",
        type: "procedure",
        sortOrder: 40,
        pages: ["helpdesk-admin"],
        keywords: ["helpdesk content", "help article", "knowledge base", "faq", "category", "publish", "unpublish", "documentation"],
        body: [
          "Helpdesk Content is available to accounts that hold the Helpdesk Content permission, which defaults to the system administrator. It maintains the same articles the floating Helpdesk serves to every user.",
          "An article belongs to one category. It has a title, a short summary, an answer body, optional numbered steps and reminders, search keywords, and the pages where context help should prioritise it. Publishing makes it visible; keeping it as a draft hides it from users while preserving the work.",
          "Changing a category's visibility hides its published articles from the panel without deleting them. A category can only be deleted when it contains no articles. Removing an article reserves its slug so a later seed migration cannot recreate content you deliberately deleted.",
          "Every create, update, publish, and delete is written to the audit log. Existing school, learner, form, and permission records are not changed by this page."
        ],
        steps: [
          "Open Administration, then Helpdesk Content.",
          "Review the categories; add or edit one before creating an article in it.",
          "Select New article, complete the title, summary, category, answer, steps, and reminders.",
          "Choose related pages so the article appears first on those forms.",
          "Tick Published to make it visible, then save.",
          "Use the eye button in the article table to publish or unpublish an entry, and the pencil button to edit it."
        ],
        notes: [
          "Write validation rules and procedures exactly as the installed module behaves.",
          "Use the preview in the floating Helpdesk after saving; drafts do not appear there.",
          "Deleting a category with articles returns a conflict message until the articles are moved or deleted."
        ]
      }
    ]
  },
  {
    slug: "data-security",
    title: "Data, privacy, and security",
    description: "Confidentiality rules, validation, audit, and what the system deliberately does not do.",
    icon: "bi-shield-check",
    sortOrder: 120,
    articles: [
      {
        slug: "data-privacy",
        title: "Privacy rules for learner and health data",
        summary: "Confidentiality, least privilege, safe sharing, and prohibited public exposure.",
        type: "reference",
        sortOrder: 10,
        pages: [],
        keywords: ["privacy", "data privacy", "confidential", "learner data", "health data", "Data Privacy Act", "NPC", "share"],
        body: [
          "Learner and health information is sensitive personal data. Access follows the Philippine Data Privacy Act, National Privacy Commission guidance, and DepEd policy. Use only the records your role needs for an authorised school or division purpose.",
          "The system restricts health records, limits learner exports, and scopes every list and report. It does not provide public learner or health URLs and does not offer an unrestricted bulk learner download.",
          "Printed reports and screenshots leave the system's protections. Store them securely, share only with authorised staff, and dispose of them according to records policy."
        ],
        steps: [
          "Confirm the purpose and the recipient before sharing a report.",
          "Use the narrowest scope and fewest identifying fields that meet the need.",
          "Restrict health information to authorised personnel.",
          "Never post learner lists, health data, or export links publicly.",
          "Report a suspected breach through your division's process."
        ],
        notes: [
          "Administrators can review access through Audit Logs.",
          "Security controls do not replace professional confidentiality obligations."
        ]
      },
      {
        slug: "validation-and-audit",
        title: "Validation, locking, and the audit trail",
        summary: "How the system protects data quality and keeps changes traceable.",
        type: "reference",
        sortOrder: 20,
        pages: [],
        keywords: ["validation", "audit", "lock", "finalize", "correction", "security", "data quality"],
        body: [
          "Server-side validation applies the same rules to manual entry, spreadsheet import, and API requests. Input is trimmed and checked; invalid rows are rejected with a reason rather than partially saved.",
          "Finalization locks grades, report cards, and approved forms. Corrections use audited paths that retain the previous version. Deletion is restricted where it would orphan permanent history.",
          "Security-relevant actions are written to the audit log with the actor, time, and details. Passwords, session secrets, and reset tokens are never recorded. Database access uses parameterized queries and credentials come from environment variables."
        ],
        steps: [
          "Read the validation message and correct the stated field.",
          "Do not bypass a lock by creating a duplicate record.",
          "Use the correction or reopen action when one is provided.",
          "Check Audit Logs to explain a past change.",
          "Report repeated validation failures with the exact message."
        ],
        notes: [
          "A locked record is protected by the server, not only by the interface.",
          "The audit log is system-administrator only."
        ]
      },
      {
        slug: "what-the-system-does-not-do",
        title: "What the system deliberately does not do",
        summary: "Boundaries: no invented records, no unofficial official forms, no hidden approvals.",
        type: "reference",
        sortOrder: 30,
        pages: [],
        keywords: ["limits", "not supported", "official form", "signature", "seal", "approval", "fabricate"],
        body: [
          "The system does not invent attendance, grades, signatures, seals, approvals, or performance data. It generates forms and reports from records that authorised users saved.",
          "It does not present an unofficial layout as an official DepEd form, apply adult BMI cutoffs to children, or hardcode a grading formula in place of the school's approved policy.",
          "It does not provide public learner or health links, unrestricted bulk learner downloads, or deletion of permanent academic records through ordinary workflows. If a request needs one of these, it is outside the system's design and should be handled through official channels."
        ],
        steps: [
          "Check the source record before assuming a form is wrong.",
          "Use the official layout and configured policy.",
          "Escalate records that cannot be corrected through the normal workflow.",
          "Do not create placeholder data to make a form look complete."
        ],
        notes: [
          "Missing data is reported as missing.",
          "Official approvals remain an institutional process, not a system button."
        ]
      }
    ]
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    description: "Common sign-in, access, validation, grade, and import problems with safe fixes.",
    icon: "bi-tools",
    sortOrder: 130,
    articles: [
      {
        slug: "troubleshoot-sign-in",
        title: "Cannot sign in",
        summary: "Check pending approval, rate limits, forgotten passwords, and account status.",
        type: "faq",
        sortOrder: 10,
        pages: ["sign-in", "reset-password"],
        keywords: ["cannot login", "invalid password", "pending account", "rate limited", "account disabled", "sign in problem"],
        body: [
          "Sign-in failures use a generic message so the system does not reveal whether an account exists. Work through the likely causes in order: a mistyped username or email, a pending or rejected registration, a deactivated account, a forgotten password, or repeated attempts that triggered the rate limit.",
          "If you recently registered, check with your approving officer. If you changed roles or schools, an administrator may need to refresh the assignment. After several failures, wait for the rate-limit window before trying again."
        ],
        steps: [
          "Confirm you are using the username or email exactly as registered.",
          "Ask your approving officer whether the account is confirmed.",
          "Use Forgot password to request a single-use reset link.",
          "Wait if the page reports too many attempts.",
          "Ask an administrator to check the account status if the problem persists."
        ],
        notes: [
          "Never ask an administrator to send your password; a reset is the safe path.",
          "Do not create a duplicate account for the same person."
        ]
      },
      {
        slug: "troubleshoot-access",
        title: "A module is missing or access is denied",
        summary: "Role defaults, per-user overrides, page scope, and the difference between hidden and forbidden.",
        type: "faq",
        sortOrder: 20,
        pages: ["dashboard", "user-rights"],
        keywords: ["403", "access denied", "module missing", "forbidden", "permission", "cannot open page"],
        body: [
          "Access is enforced by the server. A 403 means the action is not permitted for your account; a missing link usually means the module is not granted. The two can differ: a stale bookmark can request a page whose link is hidden.",
          "Ask an administrator to compare your role default with any per-account override. District and school scope can also make a record unavailable even when the module itself is granted."
        ],
        steps: [
          "Confirm the page address is one your role uses.",
          "Check My Profile for your role, district, and school.",
          "Ask an administrator to review User Rights for your account.",
          "Retry the action in a fresh page load.",
          "If a 403 persists after a granted change, sign in again."
        ],
        notes: [
          "A system administrator always has full access and cannot test a restricted role from their own account.",
          "Do not share accounts to work around a permission."
        ]
      },
      {
        slug: "troubleshoot-form-validation",
        title: "A form or record will not validate",
        summary: "Read severity, fix the source record, and regenerate instead of editing the preview.",
        type: "faq",
        sortOrder: 30,
        pages: ["school-forms", "class-records"],
        keywords: ["validation error", "form error", "missing data", "cannot submit", "completeness"],
        body: [
          "Validation findings name the form, section, row or learner, and reason. Errors block a clean generation or submission; warnings ask you to check data that may legitimately be empty.",
          "Correct the source module. Editing a preview or a generated copy does not persist a correction and can hide a real data gap. After fixing, regenerate and validate again."
        ],
        steps: [
          "Open the validation list and read the first error.",
          "Identify the owning module from the finding.",
          "Correct the source record.",
          "Regenerate and validate.",
          "Discuss remaining warnings with the school head before submitting."
        ],
        notes: [
          "Unrecorded attendance is flagged, not assumed present.",
          "A form cannot be finalized with unresolved blocking errors."
        ]
      },
      {
        slug: "troubleshoot-grades",
        title: "A grade is locked or missing",
        summary: "Finalized classes, incomplete quarters, blank scores, and the correction path.",
        type: "faq",
        sortOrder: 40,
        pages: ["grades", "class-records", "report-cards", "adviser-consolidation"],
        keywords: ["grade locked", "missing grade", "finalized", "blank score", "cannot edit", "correction"],
        body: [
          "A finalized grade is intentionally locked. If the value is wrong, use the audited correction or reopen path rather than creating a duplicate record. Report cards can be reopened only with a recorded reason.",
          "A missing quarterly grade usually means the quarter is incomplete: a blank score, a missing assessment, or a submission not yet accepted by the adviser. Fix the class record or complete the consolidation first."
        ],
        steps: [
          "Check whether the class or card is finalized.",
          "Look for blank scores and incomplete assessments.",
          "Confirm the adviser accepted the subject-quarter submission.",
          "Use the correction path for a locked value.",
          "Regenerate the report card after the correction is accepted."
        ],
        notes: [
          "A blank score is not zero.",
          "Do not unfinalize a record merely to avoid documenting a correction."
        ]
      },
      {
        slug: "troubleshoot-import",
        title: "A spreadsheet row is rejected",
        summary: "Headers, dates, duplicates, school codes, file size, and formula cells.",
        type: "faq",
        sortOrder: 50,
        pages: ["learners", "personnel", "schools", "districts"],
        keywords: ["import error", "row rejected", "date format", "duplicate LRN", "school code", "file too large", "formula"],
        body: [
          "The importer reports the file, sheet, row, column, and reason for every rejection. Common causes are a renamed or missing header, a value failing the same rule as manual entry, a duplicate unique key, a school code outside your scope, or an unsupported file.",
          "Receive dates as real Excel dates, YYYY-MM-DD text, or ISO timestamps. Ambiguous formats such as 15/12/2013 are rejected. Remove formula cells you do not need; an unrelated corrupt file does not block a valid one in the same batch.",
          "Fix the workbook and preview again. Confirmation revalidates, so a row that was valid in preview can still be rejected if the underlying data changed."
        ],
        steps: [
          "Download the current template and keep its headers.",
          "Read the first rejected row's file, sheet, row, column, and reason.",
          "Correct the value in the workbook.",
          "Preview again and confirm the counts.",
          "If you need the details later, generate the Excel error report before closing."
        ],
        notes: [
          "Duplicates are skipped, never overwritten.",
          "Only five files, 5 MB each and 15 MB total, with up to 1,000 rows per sheet."
        ]
      },
      {
        slug: "troubleshoot-empty-data",
        title: "A list, chart, or report is empty",
        summary: "Scope, school year, enrollment, filters, and archived records.",
        type: "faq",
        sortOrder: 60,
        pages: ["dashboard", "learners", "attendance", "reports"],
        keywords: ["empty list", "no data", "chart empty", "zero", "no learners", "missing records"],
        body: [
          "Check scope and time filters first. Most empty views mean the selected school year, district, section, or record status has no matching saved records in your scope.",
          "For learner-based modules, confirm the learner has a school-year enrollment in the selected year and section. For reports, confirm the underlying submissions exist. Archived records appear only when the record-status filter includes them."
        ],
        steps: [
          "Reset the page filters.",
          "Confirm the current school year.",
          "Check that the learner or section has the expected enrollment.",
          "Switch record status to include archived records.",
          "Open the source module to confirm records exist."
        ],
        notes: [
          "An empty chart is not proof that the school has no learners; check the enrollment year."
        ]
      }
    ]
  },
  {
    slug: "faq",
    title: "Frequently asked questions",
    description: "Quick answers to the tasks users ask about most.",
    icon: "bi-question-circle",
    sortOrder: 140,
    articles: [
      {
        slug: "faq-add-school",
        title: "How do I add a new school?",
        summary: "The shortest path from the school registry to a saved school record.",
        type: "faq",
        featured: true,
        sortOrder: 10,
        pages: ["schools"],
        keywords: ["add school", "new school", "create school", "school record"],
        body: [
          "Open Schools and choose New school. Enter the official school name, unique school code, district, type, and contact details, then save. Only accounts with the school Add right can do this, and district administrators are limited to their own district.",
          "For many schools, use Bulk upload with the school template instead of repeating the form."
        ],
        steps: [
          "Open Schools.",
          "Choose New school.",
          "Complete the required fields and save.",
          "Confirm the school appears in the registry and division tree."
        ],
        notes: [
          "Do not create a second record for a renamed school; edit the existing one."
        ]
      },
      {
        slug: "faq-register-learner",
        title: "How do I register a learner?",
        summary: "Create the profile, then add guardians and the school-year enrollment.",
        type: "faq",
        featured: true,
        sortOrder: 20,
        pages: ["learners"],
        keywords: ["add learner", "register learner", "new learner", "enroll learner"],
        body: [
          "Open Learners and choose New learner. Enter the 12-digit LRN, birth date, name, sex, school, and contact details. The age is calculated from the birth date.",
          "Saving creates the profile only. Open it to add guardians and a school-year enrollment so the learner appears in attendance and class records."
        ],
        steps: [
          "Open Learners and choose New learner.",
          "Enter the LRN and birth date.",
          "Complete the remaining required fields.",
          "Save and open the profile.",
          "Add guardians and the enrollment record."
        ],
        notes: [
          "The LRN must be unique and exactly 12 digits."
        ]
      },
      {
        slug: "faq-access-module",
        title: "Why can't I open a module?",
        summary: "Role, override, and scope are the three things to check.",
        type: "faq",
        featured: true,
        sortOrder: 30,
        pages: ["dashboard", "user-rights"],
        keywords: ["cannot access", "403", "module hidden", "permission denied"],
        body: [
          "Your role supplies default permissions, and an administrator may add or remove individual actions for your account. District or school scope can also limit which records and pages you can use.",
          "Ask an administrator to review User Rights for your account and confirm your district and school assignment. Permission changes take effect on your next request; refresh the page."
        ],
        steps: [
          "Check My Profile for your role and assignment.",
          "Ask an administrator to compare your role default with any override.",
          "Refresh and retry the module.",
          "Sign in again if access still fails after a granted change."
        ],
        notes: [
          "A hidden link and a denied request can have different causes; the server message is authoritative."
        ]
      },
      {
        slug: "faq-print-form",
        title: "How do I print a School Form?",
        summary: "Generate, validate, preview, then print or export the authorized PDF.",
        type: "faq",
        featured: true,
        sortOrder: 40,
        pages: ["school-forms", "report-cards"],
        keywords: ["print form", "PDF", "school form", "report card print"],
        body: [
          "Open School Forms Center, choose the form and school year, validate the source data, then generate and preview. Print from the preview or use the PDF action where offered.",
          "Correct errors in the source module, not in the preview. Check the first and last page before releasing an official copy."
        ],
        steps: [
          "Open School Forms Center.",
          "Select the form and school year.",
          "Validate and fix source errors.",
          "Generate, preview, and print or export."
        ],
        notes: [
          "The system does not add signatures, seals, or approvals that were not recorded."
        ]
      },
      {
        slug: "faq-update-password",
        title: "How do I change my password?",
        summary: "Use Account Settings when signed in, or the reset link when signed out.",
        type: "faq",
        featured: true,
        sortOrder: 50,
        pages: ["settings", "profile", "sign-in"],
        keywords: ["change password", "update password", "forgot password", "reset"],
        body: [
          "When signed in, open Account Settings from your profile menu and use the password change form. When signed out, use Forgot password on the sign-in panel and open the single-use reset link.",
          "Choose a password that meets the stated rules and is not reused elsewhere. Administrators never need to know your password."
        ],
        steps: [
          "Open the profile menu and choose Account Settings.",
          "Enter your current password and the new password.",
          "Save and sign in again if prompted.",
          "Use the reset link instead if you cannot sign in."
        ],
        notes: [
          "Reset links expire and can be used only once."
        ]
      },
      {
        slug: "faq-bulk-upload",
        title: "How do I upload many records at once?",
        summary: "Use the module's Bulk upload, preview, fix rejected rows, then confirm.",
        type: "faq",
        featured: true,
        sortOrder: 60,
        pages: ["learners", "personnel", "schools", "districts"],
        keywords: ["bulk upload", "import many", "spreadsheet", "excel upload"],
        body: [
          "Open the module that owns the records and choose Bulk upload. Download the template, fill the rows, drop up to five files, and choose Validate and preview.",
          "Nothing is written during preview. Fix the rejected rows, preview again, then confirm. Existing unique keys are skipped rather than overwritten."
        ],
        steps: [
          "Open the module and choose Bulk upload.",
          "Download and complete the template.",
          "Preview the files.",
          "Fix rejected rows using the reason column.",
          "Confirm the import and verify the records."
        ],
        notes: [
          "Learner import creates profiles only; add guardians and enrollments afterward."
        ]
      }
    ]
  }
];

module.exports = { PAGE_KEYS, CATEGORIES };
