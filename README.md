# School District Monitoring System

A full-stack web application for district administrators to manage enrolled schools, monitor reporting compliance, review performance, publish announcements, and audit administrative activity. The frontend is plain HTML5, CSS3, Bootstrap 4, and vanilla JavaScript; the backend is Node.js, Express, and PostgreSQL.

![Stack](https://img.shields.io/badge/stack-Express%20%7C%20PostgreSQL%20%7C%20Bootstrap%204-0b2545)

## Features

- Landing page with a secure sign-in panel, show/hide password, Remember Me, forgot-password flow, validation, loading states, and generic error messages.
- Session authentication with bcrypt-hashed passwords and a PostgreSQL-backed session store.
- Self-service account creation from the sign-in page: applicants choose their role, district, and school, then wait for confirmation by their immediate superior before they can sign in.
- Role-based access control for **system administrators**, **district administrators**, **PSDS**, **school heads**, **teachers**, **coordinators**, **non-teaching personnel**, **class advisers**, **learners**, and **authorized staff**, enforced on every API route and page.
- User rights and permissions console for system administrators: search accounts, compare inherited role defaults with per-user overrides, grant or revoke **Access / Add / Edit / Delete** per installed module, reset to role defaults, and review who changed what and when. The matrix is enforced by the API and page guards, not only by hidden buttons.
- District scoping: district administrators and staff only see schools, reports, announcements, and users inside their own district.
- Account approvals queue: PSDS registrations are confirmed by the district administrator, school heads by the PSDS, teachers/NT/advisers by the school head, and learners by the class adviser. System administrators can confirm any registration.
- School Division Office hierarchy in the sidebar: expandable districts, their two PSDS (Public Schools District Supervisors), nested schools, live search, and deep links into the school registry.
- District management for system administrators: create, edit, and delete districts with office contact details and exactly two PSDS assignments. Deletion is blocked while schools, accounts, or announcements still reference the district.
- Dashboard with six live metrics, four Chart.js charts, recent audit activity, and a filterable school monitoring table.
- School registry with register, view, edit, archive (soft delete), and restore. Archived records are retained.
- Monthly report tracking with submission status, reporting period, and uniqueness per school/period/type.
- User administration, announcement publishing, notifications, audit logs, and self-service profile/password management.
- Secure profile photos for every account: users upload their own picture, administrators can set or remove one for any account they manage from the Users page, and avatars appear in the sidebar, top bar, profile page, and user list.
- Permanent learner records with one profile per learner, multiple school-year enrollments, guardians, documents, activities, and a connected academic history. School years, grade levels, sections, subjects, teacher assignments, and class schedules form a single hierarchy rather than separate modules.
- Unified learner profile with tabs for overview, personal details, guardians, enrollment history, subjects and teachers, activities, school-year records, attendance, grades, books, restricted health data, school forms, and permanent academic records.
- Daily attendance workspace: section roster, present/absent/tardy/excused/half-day marks, school-calendar overrides, monthly reconciliation, and a print-ready working register. Unrecorded days are flagged and never assumed present.
- Grades and promotion: quarter grade entry, submit/finalize workflow, locked finalized grades with an audited correction path, school grading policy (passing grade, averaging or weighted quarters), promotion decisions, and report-card generation without a hardcoded grading formula.
- Subject teacher class records: one independent record per teaching assignment, configurable written-work/performance-task/quarterly-assessment components and weights, raw score encoding where a blank score means missing and is never stored as zero, configurable rounding and optional transmutation, and automatically computed initial and quarterly grades. An incomplete quarter produces no quarterly grade and cannot be submitted.
- Class adviser review and consolidation: accept or return each subject-quarter submission with a required return reason and full review history, compare accepted quarters per learner and subject, and let only the adviser or an authorized school head accept grades. Acceptance finalizes the subject `grade_records` that feed SF 9.
- SF 9 report card workspace: generate one card per learner, validate that every offered subject has a finalized final grade, freeze an immutable versioned snapshot, reopen a finalized card only with a recorded reason, and print individual or section-batch copies or export the register to CSV.
- Books and materials inventory with append-only issuance and return transactions, outstanding-copy tracking, learner-level history, and SF 3 source data.
- Learner movements (transfer in/out, dropout, reinstatement, completion) with an approval decision that updates enrollment status and feeds SF 4.
- Health and nutrition records restricted to authorized health and administrative personnel. BMI is computed only from saved height and weight measurements; nutritional status is an authorized assessment and the system never applies adult cutoffs to children.
- Personnel profiles, teaching loads, and class schedules that feed SF 7.
- **DepEd School Forms Center (SF 1–SF 10)** built from saved source records: the school register, daily attendance, books, movements, promotion, school-wide promotion summary, personnel, restricted health, report cards, and the permanent academic record.
- Form validation with severity-tagged errors and warnings, completeness scoring, preview before generation, printable HTML and authorized PDF output, configurable paper size/orientation/layout templates, school-year periods, deadlines, and explicit draft/validation/submission/review states.
- Submission workflow: Draft → In Progress → Ready for Validation → Validation Failed → Submitted → Returned for Correction → Approved → Finalized, with reviewer comments, version history, generation and review audit entries, and approval locks. Forms 9 and 10 are stored per learner so one learner's report card or permanent record never overwrites another's.
- District monitoring workspace for submission status, overdue requirements, validation failures, discrepancies, reviewer actions, and an audit trail. Incomplete or unapproved records are never counted as complete.
- Responsive layout: collapsible navy sidebar, mobile drawer, keyboard-accessible focus styles, loading skeletons, toasts, empty states, and print styles for forms and academic records.
- Security hardening: Helmet CSP, HSTS in production, CSRF tokens for cookie-authenticated writes, login and password-reset rate limiting, parameterized SQL, centralized error handling, and no stack traces in production.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | HTML5, CSS3, Bootstrap 4.6.2, Bootstrap Icons, Chart.js 4.4.1, vanilla JavaScript (Fetch API) |
| Backend | Node.js 20+, Express 4 |
| Database | PostgreSQL 14+ with `pg` |
| Sessions | `express-session` + `connect-pg-simple` |
| Security | `bcrypt`, Helmet, `express-rate-limit`, CSRF middleware, CORS allow-list, `multer` + `sharp` image pipeline |
| Tooling | `dotenv`, `compression`, `morgan`, `nodemon`, `node:test`, `supertest`, Newman/Postman |

## Project structure

```
school-district-monitoring/
├── client/                 Static frontend (served by Express)
│   ├── css/style.css
│   ├── css/user-rights.css
│   ├── js/                 API helper, UI helpers, page controllers
│   ├── index.html          Landing page and sign-in
│   ├── dashboard.html
│   ├── districts.html      District and PSDS management
│   ├── schools.html
│   ├── reports.html
│   ├── users.html
│   ├── user-rights.html    Permission matrix console (system admin)
│   ├── announcements.html
│   ├── audit-logs.html
│   ├── settings.html
│   ├── profile.html
│   ├── reset-password.html
│   ├── learners.html       Learner directory
│   ├── learner.html        Unified learner profile (13 tabs)
│   ├── school-years.html
│   ├── grade-levels.html
│   ├── sections.html
│   ├── subjects.html
│   ├── teachers.html
│   ├── activities.html
│   ├── learner-reports.html
│   ├── attendance.html     Daily and monthly attendance
│   ├── grades.html         Grades, promotion, report cards, policy
│   ├── books.html          Catalog, issuances, returns
│   ├── movements.html      Transfer/dropout decisions
│   ├── health.html         Restricted measurements and summary
│   ├── personnel.html      Personnel, loads, schedules
│   ├── school-forms.html   School Forms Center and submissions
│   ├── class-records.html  Subject teacher class record and score entry
│   ├── adviser-consolidation.html  Adviser review queue and readiness
│   ├── report-cards.html   SF 9 register, finalization, printing, export
│   ├── monitoring.html     District submission monitoring
│   ├── 403.html            Access-denied page used by page guards
│   └── 404.html
├── database/
│   ├── schema.sql          Core tables, constraints, indexes
│   ├── schema-forms.sql    Attendance, books, grades, health, personnel, permanent records, forms
│   ├── schema-classrecords.sql  Curricula, class records, assessments, submissions, SF 9 snapshot
│   ├── seed.sql            Fictional demonstration data
│   └── init.js             Applies the schemas + seed
├── postman/
│   ├── SDMS.postman_collection.json
│   └── SDMS.local.postman_environment.json
├── scripts/
│   ├── hash-password.js
│   ├── migrate.js          Additive rights upgrade for existing databases
│   ├── migrate-forms.js    Additive learner/forms upgrade for existing databases
│   ├── migrate-classrecords.js  Additive class record and SF 9 upgrade
│   ├── smoke-forms.js      End-to-end forms smoke test
│   ├── smoke-classrecords.js  End-to-end class record to SF 9 smoke test
│   └── verify-academic-tabs.js  Learner academic endpoint check
├── server/
│   ├── app.js              Middleware, security, static pages, routes
│   ├── server.js           Startup and graceful shutdown
│   ├── config/             Environment and PostgreSQL pool
│   ├── controllers/        HTTP handlers
│   ├── middleware/         Auth, RBAC, CSRF, rate limits, errors
│   ├── routes/             API route definitions
│   ├── services/           SQL and business logic
│   └── utils/              Validation, scope, permissions, serializers
├── tests/
│   ├── api.test.js         Automated API tests
│   ├── permissions.test.js Rights matrix and enforcement tests
│   ├── forms.test.js       School Forms acceptance and privacy tests
│   └── classrecords.test.js  Class record to SF 9 workflow tests
├── .env.example
├── .gitignore
└── package.json
```

## Prerequisites

- Node.js 20 or newer
- PostgreSQL 14 or newer, running locally or reachable over the network
- npm

## Installation

```bash
cd school-district-monitoring
npm install
```

Create the database and an application role. Replace the password with your own strong value:

```sql
CREATE ROLE school_monitor WITH LOGIN PASSWORD 'replace-with-a-strong-password';
CREATE DATABASE school_district_monitoring OWNER school_monitor;
```

## Configuration

Copy the example file and edit it:

```bash
cp .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development`, `test`, or `production`. Production enables secure cookies, HSTS, and hides internal errors. |
| `PORT` | HTTP port. Default `3000`. |
| `DATABASE_URL` | PostgreSQL connection string used by the app and the init script. This is the only database variable the app reads; `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_PORT`, and `DB_NAME` are ignored. |
| `DATABASE_SSL` | `true` when the PostgreSQL provider requires TLS (e.g. managed hosting). |
| `PG_POOL_MAX` | Maximum pool size. Default `10`. |
| `SESSION_SECRET` | At least 32 random characters. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. |
| `SESSION_NAME` | Session cookie name. Default `sdms.sid`. |
| `RESET_TOKEN_MINUTES` | Password reset link lifetime. Default `60`. |
| `TRUST_PROXY` | `1` only behind a trusted HTTPS reverse proxy; required for secure cookies to work there. |
| `CORS_ORIGIN` | Leave blank for same-origin. If set, allow a single trusted origin. |
| `APP_NAME`, `APP_VERSION` | Displayed in the UI and startup log. |

Never commit `.env`. `.gitignore` already excludes it, dependencies, logs, and coverage output.

## Database setup

Apply the schema and fictional demonstration data:

```bash
npm run db:init
```

The script is idempotent: tables use `CREATE TABLE IF NOT EXISTS`, columns use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, seed inserts use uniqueness guards, and audit seed rows only load when the table is empty. Existing databases are upgraded in place, including the PSDS columns added to `districts`, which the seed backfills with `COALESCE`. To reset completely, drop and recreate the database before rerunning.

Expected seed volume: 3 districts (each with two PSDS assignments), 16 schools, 32 monthly reports, 22 users (including pending applicants), 4 announcements, 2 school years, 2 grade levels, 2 sections, 8 subjects, 5 teaching assignments, 15 class schedules, 8 learner profiles, 16 school-year enrollments, and 3 activities. Attendance, grades, books, health measurements, movements, personnel profiles, and form submissions start empty so every generated form reflects source records that were actually saved.

### Upgrading an existing database

`npm run db:init` also reloads the demonstration rows, so do not run it against live records. To add the rights schema to a database that already holds real data, run the additive migration:

```bash
npm run db:migrate
```

It creates `permission_modules`, `role_permissions`, and `user_permissions`, adds the coordinator role and school-scope constraints, creates the missing indexes, and synchronises the module catalogue and role defaults inside one transaction. It never deletes users, schools, learners, reports, or audit rows, and it is safe to run repeatedly. Per-user overrides are preserved. Back up the database first, as with any schema change, and roll back by restoring that backup if needed.

The learner records and School Forms release adds `database/schema-forms.sql`. Apply it to a database that already holds real data with:

```bash
npm run db:migrate:forms
```

This is additive and idempotent: it creates attendance, calendar, book catalog/issuance, grade record, grading policy, promotion, report card, health measurement, personnel, learner movement, permanent academic record, form submission, review, template, and deadline tables; adds the per-learner `form_submissions.learner_id` column and its unique scope index; and adds the supporting foreign keys and indexes. It does not delete or rewrite existing learners, enrollments, users, schools, or audit rows. The core `learners` and enrollment tables are created by `database/schema.sql`, so run `npm run db:migrate` first on a very old installation if those tables are missing. Back up the database before either migration.

The class record and SF 9 release adds `database/schema-classrecords.sql`. Run it after the forms migration:

```bash
npm run db:migrate:classrecords
```

It creates curricula, curriculum versions, class record templates, class records, assessments, scores, computed grades, grade submissions, submission items, and submission reviews; adds `class_record_id` and `source` to `grade_records`; adds template, snapshot, finalization, and reopen columns to `report_cards`; and attaches the system curriculum version to sections that do not have one. Existing learners, enrollments, sections, subjects, assignments, grades, and report cards are reused, never duplicated. The migration is additive and idempotent, but it deliberately leaves the assessment weights unconfigured (`null`) so an administrator must enter values from the school's verified policy before grades can be computed or submitted. Back up the database first.

## Run the application

```bash
npm start
```

Open http://localhost:3000. For development with auto-restart:

```bash
npm run dev
```

### Demonstration accounts

All people and schools are fictional. These accounts exist only in the seed file:

| Username | Password | Role | Scope |
| --- | --- | --- | --- |
| `sysadmin` | `Admin@2026` | System administrator | All districts |
| `northadmin` | `District@2026` | District administrator | North Valley |
| `southadmin` | `District@2026` | District administrator | Southgate |
| `riversideadmin` | `District@2026` | District administrator | Riverside |
| `northpsds` | `Demo@2026` | PSDS | North Valley |
| `riversidepsds` | `Demo@2026` | PSDS | Riverside |
| `southpsds` | `Demo@2026` | PSDS | Southgate |
| `northhead` | `Demo@2026` | School head | Central Elementary (North Valley) |
| `riversidehead` | `Demo@2026` | School head | Riverbend Elementary (Riverside) |
| `southhead` | `Demo@2026` | School head | Southgate Central Elementary |
| `northteacher` | `Demo@2026` | Teacher | Central Elementary (North Valley) |
| `northnt` | `Demo@2026` | Non-teaching personnel | Central Elementary (North Valley) |
| `northadviser` | `Demo@2026` | Class adviser | Central Elementary (North Valley) |
| `northlearner` | `Demo@2026` | Learner | Central Elementary (North Valley) |
| `northstaff` | `Staff@2026` | Authorized staff | North Valley |
| `southstaff` | `Staff@2026` | Authorized staff | Southgate |

The seed also creates four **pending** applicants (`pendingpsds`, `pendinghead`, `pendingteacher`, `pendinglearner`, all `Demo@2026`) so the approvals queue has something to review. Pending accounts cannot sign in until confirmed.

Change or remove these accounts before any real deployment. They are not hardcoded in frontend JavaScript; authentication always goes through the API.

## Roles and permissions

The table below lists the **default** policy shipped in the seed. Administrators can change a single account without changing the role default for everyone.

| Capability | System admin | District admin | PSDS | School head / adviser / coordinator | Teacher / NT / learner |
| --- | --- | --- | --- | --- | --- |
| View dashboard and scoped schools | All districts | Own district | Own district | Own district | Own district |
| View district hierarchy and PSDS assignments | All districts | Own district | Own district | Own district | Own district |
| Create, edit, delete districts and PSDS assignments | Yes | No | No | No | No |
| Create, edit, archive, restore schools | Yes | Yes | No | No | No |
| Submit and update reports | Yes | Yes | Yes | Yes | Yes |
| Manage users | Yes | Yes (own district, no system/district admins) | No | No | No |
| Confirm self-registered accounts | Any registration | PSDS in own district | School heads in own district | Teachers, NT, advisers, coordinators in own school; learners (adviser only) | No |
| Publish announcements | Yes | Yes | No | No | No |
| View audit logs | Yes | No | No | No | No |
| Select another district | Yes | No | No | No | No |
| Maintain own subject class record | Yes | Yes | No | School head: view and submit | Assigned teacher only; advisers read for review |
| Return or accept submitted quarterly grades | Yes | Yes | No | School head and section adviser in scope | No |
| Finalize or reopen an SF 9 report card | Yes | Yes | No | School head and section adviser in scope | No |
| Generate report cards and edit grading templates | Yes | Yes | No | School head and adviser (cards); administrators (templates) | No |

Read-only staff still see only published announcements for their district or system-wide notices.

### User rights and permissions

`user-rights.html` is the **User rights and permissions** console. It is limited to system administrators; district administrators, PSDS, school heads, and staff receive `403` from both the page and the API.

- **Directory.** Search by name, username, or email; filter by role, school, and account status; open any account. School- and role-based scoping on learners and records is unchanged by this module.
- **Matrix.** Modules come from `permission_modules`, which is synchronised from `server/utils/permissionModules.js` at startup and during migration, so the screen always reflects the installed system rather than a hardcoded list. Each module has independent **Access**, **Add**, **Edit**, and **Delete** checkboxes for the actions it supports. Clearing **Access** clears and disables the write actions.
- **Role defaults and overrides.** Each role has a default row in `role_permissions`. Saving a matrix stores only the modules that differ from the role default in `user_permissions`; restoring the default deletes the override row. **Role defaults** in the toolbar returns the editor to the inherited policy, and **Cancel** discards unsaved edits.
- **Guarded accounts.** A system administrator always has the full matrix and cannot be edited. Nobody can change their own permissions, including a system administrator, and a user cannot be granted a module/action outside the grant policy for their role (for example, `user_rights` itself or system-administration powers). Attempts return `SELF_PERMISSION_CHANGE`, `SYSTEM_ADMIN_IMMUTABLE`, or `PERMISSION_NOT_GRANTABLE`.
- **Enforcement.** Every API route that belongs to a module checks the effective matrix server-side with `requireModule(moduleKey, action)`, and every protected page confirms module access before it is served. Effective permissions are recomputed from PostgreSQL on each authenticated request, so a revoked right applies to an already signed-in session on its next call rather than after a re-login. Navigation links are hidden as a convenience, not as the security boundary.
- **Audit trail.** A save writes `user.permissions_updated` to `audit_logs` with the administrator, target account, module, action, previous value, new value, and timestamp. The editor shows the most recent change and a per-account history; the audit log remains system-administrator only and never records passwords or secrets.

Existing accounts inherit role defaults when the module is first installed. Nothing is granted **Add**, **Edit**, or **Delete** merely because a module exists.

## Learner records and DepEd School Forms

### Connected hierarchy

Records follow one chain: district → school → school year → grade level → section → adviser → learner. Teachers are accounts linked to a school and assigned to subjects, sections, and class schedules. A learner has **one permanent profile** and **one enrollment row per school year**, so a learner who moves from Grade 1 to Grade 6 keeps the same learner ID and LRN while the academic history grows.

| Page | Purpose |
| --- | --- |
| `learners.html` | Search and filter the learner directory; open a profile |
| `learner.html` | Unified profile with Overview, Personal, Guardians, Enrollment, Subjects, Activities, School Year Records, Attendance, Grades, Books, Health & Nutrition, School Forms, and Permanent Records |
| `school-years.html`, `grade-levels.html`, `sections.html`, `subjects.html`, `teachers.html` | Academic structure, loads, and schedules |
| `attendance.html` | Daily entry, monthly register, and school-calendar overrides |
| `grades.html` | Grade entry, submission/finalization, promotion, report cards, and grading policy |
| `books.html`, `movements.html`, `health.html`, `personnel.html` | Source records used by SF 3, SF 4, SF 8, and SF 7 |
| `school-forms.html` | Forms Center, previews, generation, templates, deadlines, submissions, and review |
| `monitoring.html` | District submission status, overdue work, discrepancies, and audit trail |

Profile tabs are lazy-loaded and permission-checked. An account without health access does not receive the tab, the page content, or the API; an unauthorized direct URL or API call is rejected server-side.

### School Forms 1–10

| Form | Source and behavior |
| --- | --- |
| **SF 1** School Register | Permanent learner profiles plus the selected school-year enrollment, grade, and section. Missing sections, admission dates, guardians, or addresses become errors or warnings. |
| **SF 2** Daily Attendance | Only saved daily attendance entries. Every derived school day without a saved entry is flagged; unrecorded days are never assumed present. |
| **SF 3** Books Issued and Returned | Catalog and append-only issuance/return transactions. Returns are new records; history is never rewritten. |
| **SF 4** Monthly Movement and Attendance | Beginning enrollment, approved movements, and saved attendance reconciled. An absence is never treated as a dropout. |
| **SF 5** Promotion and Progress | Finalized subject grades and authorized promotion decisions per section. Missing grades and unapproved decisions are flagged. |
| **SF 6** Summarized Promotion | School-wide totals built only from **approved or finalized** SF 5 decisions; classes with incomplete SF 5 are reported, not silently counted. |
| **SF 7** Personnel Assignment List | Personnel profiles, active accounts, teaching assignments, and class schedules. Restricted contact details are omitted. |
| **SF 8** Learner Health and Nutrition | Restricted to authorized health/administrative accounts. BMI comes from saved height and weight; nutritional status is an authorized assessment, never inferred from adult cutoffs. |
| **SF 9** Learner Progress Report Card | Finalized grade records and promotion data. Unfinalized grades block issuance. Stored per learner and school year. |
| **SF 10** Permanent Academic Record | Verified historical records plus clearly marked proposals from finalized system grades. Empty or unverified records are not certified. Stored per learner and school year. |

Each form supports preview before generation, completeness and validation details, printable HTML, and authorized PDF. Generated submissions keep a JSON snapshot and template reference, so later source edits do not rewrite an already generated version. Draft and validation-failed output is visibly distinct from an approved copy. Signatures, seals, and approvals are never drawn or fabricated; the printed form provides signature lines and a status/source reference.

### Submission workflow and monitoring

The workflow is `draft` → `in_progress` → `ready_for_validation` → `validation_failed` → `submitted` → `returned` → `approved` → `finalized`. School heads and district reviewers can return, reject, or approve; system and district administrators can finalize. Approved and finalized submissions are locked against ordinary regeneration. Corrections create a new version and an audit entry rather than overwriting history.

`monitoring.html` shows school-by-form status, overdue requirements, validation failures, discrepancies, and reviewer actions. It never counts an incomplete, unsubmitted, returned, or merely generated form as complete.

### Privacy and scope rules

- Health endpoints and the SF 8 form require the health module; teachers, advisers, and learners receive `403` even if they can view the learner profile.
- Learners, attendance, grades, books, movements, personnel, forms, and monitoring endpoints apply the same school/district scope as the rest of the system. A district administrator cannot open another district's school by changing an ID in the URL.
- Report card and permanent record submissions are unique per learner, form, school year, and period. The unique index includes `learner_id`.
- Permanent academic records are never deleted by ordinary workflows. Corrections are versioned and audited.
- Exports and PDFs are authenticated; there is no public learner, health, or form URL.

### Official layouts and external configuration

The bundled layouts are system-generated working designs, not certified copies of current DepEd forms. Before using them for official submission:

1. Obtain the current official DepEd layout for each form and school year.
2. Add it through **School Forms Center → Templates** with the correct paper size, orientation, version, and source note, and mark it official only when the supplied layout is authoritative.
3. Verify school name, school ID, region, division, district, school year, and signatory names against the school profile.
4. Review a printed proof for multipage headers, clipped names, and signature space.

The system does not supply DepEd letterhead, seals, e-signatures, or a licensed PDF font. It also does not integrate with DepEd LIS/EBEIS, email/SMS delivery, or a national child-growth-standard service; those require external configuration. Nutritional status must be entered by authorized personnel using the current child-appropriate standard.

### Self-registration and confirmation

The sign-in page links to **Create an account** (`register.html`). An applicant chooses a self-registrable role (`psds`, `school_head`, `teacher`, `coordinator`, `nt`, `adviser`, or `learner`), a district, and — for school-based roles — an active school. The API stores the account with `approval_status = 'pending'` and `is_active = FALSE`, notifies the approver, and returns the confirming role.

| Applicant role | Confirmed by |
| --- | --- |
| `psds` | District administrator |
| `school_head` | PSDS in the same district |
| `teacher`, `coordinator`, `nt`, `adviser` | School head at the same school |
| `learner` | Class adviser at the same school |

If no active account exists for the immediate superior role, the district administrator can act as the fallback approver. System administrators can confirm any pending registration. Confirmation activates the account, signs in are allowed, and the user can update their own profile through **My Profile**. Rejection keeps the account blocked and records an optional reason. Confirmations and rejections are recorded in the audit trail and notify the applicant.

The approvals queue is available at `approvals.html` and in the **Account Approvals** sidebar entry for every role that can confirm accounts.

## Class records, adviser consolidation, and SF 9

This workflow connects three separate roles without duplicating any learner, enrollment, section, subject, assignment, or grade row:

1. The **subject teacher** keeps an independent class record for each teaching assignment and encodes raw scores.
2. The teacher submits a completed quarter for adviser review.
3. The **class adviser** returns it with a reason or accepts it. Acceptance writes the quarter's subject grade into the existing `grade_records` table as a finalized record.
4. Once every offered subject has a finalized final grade, the adviser generates the learner's **SF 9 report card**, validates completeness, and finalizes an immutable snapshot.

| Page | Purpose |
| --- | --- |
| `class-records.html` | Teacher dashboard, class record, assessments, score matrix, computed grades, submission |
| `adviser-consolidation.html` | Submission queue, return/accept, per-learner subject readiness, report-card generation |
| `report-cards.html` | SF 9 register, card detail, finalize/reopen, print, PDF, and CSV export |

### Score entry and computation

Each class record belongs to one school year, section, subject, and assigned teacher, and holds quarter-specific assessments. A teacher records the highest possible score and each learner's raw score. A blank cell means **not yet encoded**: it is stored as no row, is listed as missing work, and is never converted to zero. A typed `0` is a real score and is retained as zero.

Computation uses the school's template configuration, not a formula baked into the code:

- Each component (for example Written Work, Performance Tasks, Quarterly Assessment) totals the learner's scores and maximum scores for that quarter, then converts the total to a percentage.
- The initial grade is the weighted sum of the component percentages using the configured weights. Weights must total `1.00`; a `null` weight means the school has not configured that component.
- Rounding is configurable (`nearest_whole`, `two_decimals`, or `floor`).
- Transmutation is optional. It is disabled by default; a range table can be configured, and the whole initial grade is mapped through it. No transmutation table is invented or shipped as official.
- A quarterly grade is produced **only when every configured component is complete and every score is encoded**. An incomplete quarter shows missing items and no quarterly grade; it cannot be submitted. Partial work is never renormalised into a provisional grade that could be mistaken for a final one.

An administrator edits the template in **Class records → Template** or through `PUT /api/class-records/templates`. The response lists configuration issues, including missing weights, weights that do not total `1.00`, invalid rounding, and uncovered transmutation ranges. The built-in template is a working configuration with a version and source note; it is not marked official.

### Review, acceptance, and resubmission

Teacher actions move a quarter through `draft` → `in_progress` → `ready_for_submission` → `submitted` → `under_review` → `accepted` (or `returned`). A return requires a reason of 5–1000 characters, records a `grade_submission_reviews` row, notifies the teacher, and reopens the quarter for correction. Resubmission increments the submission version and keeps the earlier review history. Only the section adviser or an authorized school head can return or accept; a teacher cannot accept their own submission, and an adviser cannot change raw scores.

Acceptance is transactional. It finalizes the quarter in the class record, creates or updates the matching `grade_records` row with `source = 'class_record'` and `class_record_id`, and writes the acceptance review entry. When all four quarters are accepted, the final subject grade is computed from the verified policy and stored. Previous manual or finalized grade rows are not silently overwritten: the flow refuses conflicting records rather than losing history.

`adviser-consolidation.html` shows the queue for the adviser's sections and a per-learner matrix of accepted quarters by subject, so a missing subject or quarter is visible before SF 9 is generated.

### SF 9 report card, snapshot, and reopen

`report-cards.html` generates one card per learner enrolled in the section. Generation validates that every offered subject has a finalized final grade, every required quarter is present, and promotion data is available. An incomplete card stays a draft and lists the missing subjects; finalization returns `409 REPORT_CARD_INCOMPLETE` instead of issuing a card with gaps.

Finalizing stores the rendered data in `report_cards.snapshot`, together with `finalized_by` and `finalized_at`, and increments the version. A finalized card is reproducible even if sections, subject offerings, assignments, or roster change later, because the snapshot — not the live tables — is used for detail, HTML, and PDF output. Reopening requires a reason, records `reopened_by`, `reopened_at`, and `reopen_reason`, keeps the frozen snapshot and version in `report_card_revisions`, and returns the card to draft for correction. Re-finalizing creates the next version; nothing is deleted.

Printing and export:

- **Print view / PDF** — individual card as printable HTML or server-generated PDF (`GET /api/class-records/report-cards/:id/render?format=pdf`).
- **Batch print** — every card in a section, with one learner's card per page (`GET /api/class-records/report-cards/batch?sectionId=…`).
- **CSV** — register export for the section and school year (`GET /api/class-records/report-cards/export`).

### Access boundaries and audit

- A teacher can open and score only class records tied to their own active teaching assignment. Another teacher's record returns `403`, and an adviser or school head can read but not alter scores.
- Advisers see only their own sections. District and school administrators are limited to their scope. Passing another section, school, or district ID does not widen access.
- A learner cannot open class records, submissions, consolidation, batch printing, or another learner's card. Report card output is available only to the roles that hold the `report_cards` module, so the section-batch endpoint cannot leak classmates' cards to a learner.
- Every initialize, assessment, score save, submit, return, accept, template save, generate, finalize, and reopen writes an `audit_logs` entry. Notifications inform the teacher on return and the adviser on submission.

### What is not claimed or provided

- The bundled SF 9 layout is a **system working design**, not a certified copy of the current DepEd form. Load the official layout through **School Forms Center → Templates** and mark it official only when the supplied copy is authoritative.
- The system does not fabricate grades, signatures, seals, approvals, or attendance. It does not integrate with DepEd LIS/EBEIS or an e-signature service.
- No default assessment weights or transmutation table are asserted as DepEd policy. A school must enter the weights and any transmutation ranges from its verified policy; until then, grades cannot be computed or submitted.
- Finalized cards are not deletable through ordinary workflows. Corrections use reopen and a new version.

## API overview

Base URL: `http://localhost:3000/api`

All list responses use:

```json
{ "data": [], "pagination": { "page": 1, "pageSize": 10, "total": 0, "totalPages": 0 } }
```

Single resources use `{ "data": { ... } }`. Errors use:

```json
{ "error": "Human-readable message", "code": "MACHINE_CODE", "details": {} }
```

| Method | Endpoint | Description |
| --- | --- | --- |
| GET | `/auth/csrf` | Create an anonymous session and return a CSRF token |
| POST | `/auth/login` | Sign in with email or username |
| POST | `/auth/logout` | Destroy the session |
| GET | `/auth/me` | Current user, permissions, districts, CSRF token |
| POST | `/auth/forgot-password` | Request an expiring reset token (generic response) |
| POST | `/auth/reset-password` | Consume a one-time reset token |
| GET | `/auth/registration-options` | Public self-registration roles, districts, and active schools |
| POST | `/auth/register` | Public self-registration; creates a pending, inactive account |
| GET | `/dashboard/summary` | Six headline metrics |
| GET | `/dashboard/enrollment` | Enrollment chart data |
| GET | `/dashboard/performance` | Performance comparison data |
| GET | `/dashboard/report-status` | Monthly reporting status counts |
| GET | `/dashboard/recent-activity` | Recent audit activity |
| GET | `/schools` | Paginated, searchable, sortable school list |
| GET | `/schools/sidebar` | Compact enrolled-school list |
| GET | `/schools/:id` | School detail |
| POST | `/schools` | Register a school (admin only) |
| PUT | `/schools/:id` | Update a school (admin only) |
| PATCH | `/schools/:id/archive` | Archive without deleting (admin only) |
| PATCH | `/schools/:id/restore` | Restore an archived school (admin only) |
| GET | `/reports` | Paginated report list |
| GET | `/reports/summary` | Reporting summary |
| GET | `/reports/:id` | Report detail |
| POST | `/reports` | Create or submit a report |
| PUT | `/reports/:id` | Update a report |
| GET | `/users` | Paginated user list (admin only) |
| POST | `/users` | Create a user (admin only) |
| PUT | `/users/:id` | Update a user (admin only) |
| PATCH | `/users/:id/status` | Activate or deactivate (admin only) |
| GET | `/users/:id/photo` | Profile photo (any signed-in user in scope) |
| PUT | `/users/:id/photo` | Upload or replace a photo (admin only) |
| DELETE | `/users/:id/photo` | Remove a photo (admin only) |
| GET | `/approvals` | Pending registrations the signed-in user may confirm |
| POST | `/approvals/:id/approve` | Confirm a pending registration |
| POST | `/approvals/:id/reject` | Return a pending registration with an optional reason (max 500 characters) |
| GET | `/announcements` | Visible announcements |
| GET | `/announcements/:id` | Announcement detail |
| POST | `/announcements` | Publish (admin only) |
| PUT | `/announcements/:id` | Update (admin only) |
| GET | `/audit-logs` | Audit trail (system admin only) |
| GET | `/notifications` | Current user's notifications and unread count |
| PATCH | `/notifications/:id/read` | Mark one notification read |
| PATCH | `/notifications/read-all` | Mark all read |
| PUT | `/profile` | Update own name and email |
| PUT | `/profile/password` | Change own password |
| POST | `/profile/photo` | Upload or replace own profile photo |
| DELETE | `/profile/photo` | Remove own profile photo |
| GET | `/districts` | Districts available to the signed-in user, with PSDS and counts |
| GET | `/districts/hierarchy` | School Division Office → district → school tree with totals |
| GET | `/districts/:id` | District detail |
| POST | `/districts` | Create a district with two PSDS (system admin only) |
| PUT | `/districts/:id` | Update a district and both PSDS (system admin only) |
| DELETE | `/districts/:id` | Delete an unused district (system admin only) |
| GET | `/user-rights/catalog` | Modules, supported actions, roles, and schools (system admin only) |
| GET | `/user-rights/users` | Paginated rights directory with summary counts (system admin only) |
| GET | `/user-rights/users/:id` | Effective matrix, role defaults, overrides, and last change (system admin only) |
| GET | `/user-rights/users/:id/history` | Audited permission changes for one account (system admin only) |
| PUT | `/user-rights/users/:id` | Replace the account's matrix; stores only differences from role defaults (system admin only) |
| GET | `/learners` | Paginated learner directory with search and academic filters |
| POST | `/learners` | Create a learner profile; duplicate LRN returns `409 LRN_IN_USE` |
| GET | `/learners/:id` | Full learner profile, enrollments, guardians, documents, and academic summary |
| PUT | `/learners/:id` | Update profile fields; archived learners are restorable |
| PATCH | `/learners/:id/archive`, `/restore` | Retain a learner without deleting permanent records |
| POST | `/learners/:id/enrollments` | Add one school-year enrollment; a duplicate year returns `409 ENROLLMENT_EXISTS` |
| POST | `/learners/:id/promote` | Carry a learner into the next school year |
| GET | `/learner-reports/:type` | Authorized CSV/Excel-style learner reports |
| GET | `/academic/school-years` | School years |
| GET | `/academic/grade-levels` | Grade levels for a school |
| GET | `/academic/sections` | Sections with school, year, grade, adviser, and learner count |
| GET | `/academic/subjects`, `/assignments`, `/schedules`, `/timetable`, `/teachers` | Subjects, teaching loads, class schedules, and teachers |
| GET | `/attendance/sheet` | Daily roster for a section and date; unsaved status is `null`, never `present` |
| PUT | `/attendance/sheet` | Save daily attendance marks |
| GET | `/attendance/month`, `/summary`, `/learner/:learnerId` | Monthly register, aggregate summary, and learner history |
| GET/POST/DELETE | `/attendance/calendar` | School-calendar overrides |
| GET/PUT | `/grades/entry` | Read or save quarter grades for a section, subject, and period |
| POST | `/grades/submit`, `/finalize`, `/correction` | Submit, finalize, or correct locked grades with audit |
| GET/PUT | `/grades/policy` | School grading policy (passing grade, averaging or quarter weights) |
| GET/POST/PATCH | `/grades/promotion`, `/promotion/compute`, `/promotion/:id` | Promotion recommendations, computation, and decisions |
| GET/POST | `/grades/report-cards`, `/report-cards/generate`, `/report-cards/:id/:action` | Report cards and issue workflow |
| GET | `/grades/learners/:learnerId` | Learner grade history and report card status |
| GET | `/books/catalog`, `/issuances`, `/summary` | Inventory, append-only issuances, and outstanding copies |
| POST | `/books/issuances`, `/issuances/:id/returns` | Issue or return materials |
| GET | `/movements`, `/movements/:id` | Movement register and detail |
| POST | `/movements` | Record a transfer, dropout, reinstatement, or completion |
| PATCH | `/movements/:id/approved`, `/rejected` | Approve or reject a movement with enrollment impact |
| GET | `/health/measurements`, `/learners/:learnerId`, `/summary` | Restricted measurements and aggregate summary (health module only) |
| POST/PUT | `/health/measurements` | Record or correct a height/weight measurement |
| GET | `/personnel`, `/personnel/assignments`, `/personnel/summary` | Personnel profiles and teaching loads |
| GET | `/school-forms/definitions` | SF 1–SF 10 definitions, requirements, and restricted flags |
| GET | `/school-forms/cards` | Forms overview for one school and school year |
| GET | `/school-forms/preview/:code` | Preview a form without saving a submission |
| POST | `/school-forms/generate/:code` | Generate or refresh a versioned submission with validation |
| GET | `/school-forms/submissions` | Submission list filtered by school, year, form, status, period, or learner |
| GET | `/school-forms/submissions/:id`, `/:id/render?format=pdf` | Submission detail or authorized HTML/PDF output |
| POST | `/school-forms/submissions/:id/:action` | Submit, return, approve, reject, or finalize |
| GET/POST | `/school-forms/templates`, `/templates/:id/activate` | Layout templates and activation |
| GET/POST/DELETE | `/school-forms/deadlines` | Deadlines per form and period |
| GET | `/monitoring`, `/monitoring/discrepancies`, `/monitoring/audit-trail` | District submission monitoring and review history |
| GET | `/class-records/dashboard` | Teacher's assigned class records and their quarter status |
| POST | `/class-records` | Initialize or return the class record for an assignment, section, subject, and school year |
| GET | `/class-records/:id` | Record, assessments, score matrix, computed grades, and submission state |
| POST/DELETE | `/class-records/:id/assessments`, `/:id/assessments/:assessmentId` | Add or archive an assessment |
| PUT | `/class-records/:id/scores` | Save raw scores; a missing score stays missing |
| POST | `/class-records/:id/submit` | Submit a complete quarter for adviser review |
| GET/PUT | `/class-records/templates` | Read or update the school's grading configuration |
| GET | `/class-records/adviser/overview` | Adviser submission queue and completion counts |
| GET | `/class-records/submissions/:id` | Submission detail with items and review history |
| POST | `/class-records/submissions/:id/return`, `/accept` | Return with a required reason or accept and finalize grade records |
| GET | `/class-records/consolidation` | Section readiness per learner and subject |
| GET/POST | `/class-records/report-cards`, `/report-cards/generate` | SF 9 register and card generation |
| GET | `/class-records/report-cards/:id` | Card detail, validation, grades, attendance, and revisions |
| GET | `/class-records/report-cards/:id/render?format=pdf\|html` | Individual card print or PDF |
| GET | `/class-records/report-cards/batch`, `/report-cards/export` | Section batch PDF and CSV register |
| POST | `/class-records/report-cards/:id/finalize`, `/:id/reopen` | Freeze an immutable snapshot or reopen with a reason |

### CSRF and cookies

Browser requests use the session cookie set at login (HttpOnly, SameSite=Lax, Secure in production). Every `POST`, `PUT`, `PATCH`, and `DELETE` must include the token returned by `/auth/csrf`, `/auth/me`, or login in the `X-CSRF-Token` header. The token rotates after login.

For non-browser clients:

1. Call `GET /api/auth/csrf` with a cookie jar.
2. Send `X-CSRF-Token` with the login request and store the rotated token from the response.
3. Continue sending the same cookie jar and updated token on writes.

## Profile photos

Every account can have one profile picture. Learners and staff upload it from **My Profile**; administrators can set or remove a picture for any account they already manage through `PUT`/`DELETE /api/users/:id/photo`. Photos are served from `GET /api/users/:id/photo` and shown as avatars in the sidebar, top bar, profile page, and user list. Accounts without a photo keep their initials avatar.

Upload rules:

- Accepted formats are JPEG, PNG, and WebP, up to 10 MB per request. The file is decoded with `sharp`; a renamed non-image (for example a GIF or HTML file with a `.png` name) is rejected.
- Images above 48 megapixels are refused before decoding to avoid decompression bombs, so modern phone cameras are accepted. iPhone HEIC files are rejected with guidance to share as JPEG, because the bundled `sharp` build cannot decode HEIC.
- The server strips all metadata (including EXIF and GPS), applies the camera orientation, center-crops to a square, and re-encodes to a 512 × 512 WebP. The stored bytes never match the uploaded file, which also neutralizes polyglot and script-in-image tricks.
- Uploads are held in memory (nothing is written to disk) and stored as `bytea` in the `user_photos` table, so they survive restarts and redeploys on hosts with an ephemeral filesystem such as Render.
- Uploads are limited to 60 per hour per IP. They are multipart requests and still need the `X-CSRF-Token` header; let the browser set the multipart boundary instead of setting `Content-Type` yourself.

Access:

- `GET /api/users/:id/photo` requires a session. The account owner, system administrators, and users in the same district may view a photo. Everyone else receives `403 PHOTO_FORBIDDEN`, and an account without a photo returns `404 PHOTO_NOT_FOUND`.
- `POST`/`DELETE /api/profile/photo` act on the signed-in user only. `PUT`/`DELETE /api/users/:id/photo` require an administrator and follow the same district and role rules as editing the account.
- Responses are sent with `Cache-Control: private, max-age=60, must-revalidate`, an `ETag` (304 on `If-None-Match`), and `X-Content-Type-Options: nosniff`. User payloads include `photoUpdatedAt`, which the client uses to add a version query string so an updated avatar is not served from cache.

Upload example (replace the cookie jar and token with your session values):

```bash
curl -X PUT http://localhost:3000/api/users/12/photo \
  -b cookies.txt -H "X-CSRF-Token: $CSRF_TOKEN" \
  -F "photo=@portrait.jpg"
```

Possible error codes: `PHOTO_REQUIRED` (400), `PHOTO_TYPE_UNSUPPORTED` (415), `PHOTO_HEIC_UNSUPPORTED` (415), `PHOTO_INVALID` (415), `PHOTO_TOO_LARGE` (413), `PHOTO_FIELD_INVALID` (400), `PHOTO_NOT_FOUND` (404), `PHOTO_FORBIDDEN` (403), `RATE_LIMITED` (429). Photo changes are recorded in the audit trail as `profile.photo_updated`, `profile.photo_removed`, `user.photo_updated`, and `user.photo_removed`.

The `user_photos` table is created by `database/schema.sql`, so run `npm run db:init` after pulling this release. The script is idempotent.

## Postman collection

Import both files from `postman/`:

- `SDMS.postman_collection.json`
- `SDMS.local.postman_environment.json`

Set `username` and `password` in the environment to one of the demonstration accounts. The environment ships with blank credentials on purpose. `baseUrl` defaults to `http://localhost:3000/api`.

The collection enables Postman's cookie jar automatically, fetches a fresh CSRF token before login, and rotates the saved token after login. It runs 86 requests across Authentication, Dashboard, Districts, Schools, Reports, Users, Registration and approvals, Announcements, System and account, User rights, School forms and operations, Class records and SF 9, and Session. Logout is deliberately the final request. To exercise approvals, sign in as the approver (for example `northhead`) before running **List pending approvals** and **Approve registration**; change the sample registration username if you run it more than once.

The School forms and operations folder reads the form catalogue, loads the cards for one school, previews and generates SF 1, reads the new submission, renders its PDF, lists submissions, and calls the attendance, academic profile, grading policy, health summary, personnel, and district monitoring endpoints. It uses `formsSchoolId`, `formsSchoolYearId`, `formsSectionId`, and `formsLearnerId`, which default to the demo seed (Central Elementary, 2026-2027, Rizal, learner 1). Sign in as a school head or system administrator for the write requests; a district administrator can read the monitoring summary. Generating SF 1 creates one row in `form_submissions` and an audit entry, so run it against a development database.

The Class records and SF 9 folder walks the full workflow: teacher dashboard, initialize, add a written-work assessment, save scores, submit the quarter, adviser overview, read the submission, return it, resubmit, accept, consolidation, generate and read a card, finalize, reopen, render a PDF, batch-print the section, export CSV, and read/save the template. It uses `classRecordSectionId` (2, Rizal), `classRecordSubjectId` (1, ENG6), `classRecordAssignmentId` (1, `northteacher`'s ENG6 assignment), `gradeLevelId` (2, Grade 6), and captures `classRecordId`, `assessmentId`, `gradeSubmissionId`, and `reportCardId` as it runs. Run the teacher requests as `northteacher`, then sign in as `northadviser` for the return/accept/consolidation/report-card requests; a teacher cannot accept their own submission. The folder writes class record, grade, and report card rows, so use a development database.

The User rights folder reads the catalogue and directory, picks the first non-system account, and re-saves that account's current matrix unchanged, so the sample data is not altered. Run it with `sysadmin`; every request in the folder is restricted to the system administrator.

The Districts folder lists districts, loads the hierarchy, creates a district with two PSDS, reads and updates it, then deletes it. Created rows use an `API-` timestamp code.

Run it headlessly with Newman:

```bash
npx --yes newman@6 run postman/SDMS.postman_collection.json \
  -e postman/SDMS.local.postman_environment.json \
  --env-var "username=sysadmin" \
  --env-var "password=Admin@2026" \
  --env-var "newUserPassword=ApiTest@2026"
```

`newUserPassword` is required by the Create user request and is never stored in the environment file. The verification run leaves a deactivated `api.staff.` account behind and removes its own `API-` school and district. Use a development database, or clean up afterward.

## Automated tests

```bash
npm test
```

The suite uses `node:test` and `supertest`, starts the Express app in test mode, and covers:

- Helmet headers and JSON 404 handling
- Unauthenticated access, invalid login, generic auth errors
- Session cookie flags, CSRF enforcement, logout
- Dashboard endpoint shapes
- School pagination/search, validation, duplicate codes, CRUD, archive/restore
- Staff restrictions and district scoping
- Report uniqueness and updates
- User creation, deactivation, username conflicts
- Self-registration options, pending-account sign-in blocking, approver queue scoping, the full role-by-role confirmation chain, rejection, and post-confirmation profile updates
- Announcement visibility and updates
- District PSDS validation, CRUD, hierarchy scoping, and the delete guard
- Profile photo upload, normalisation to 512 × 512 WebP, MIME spoofing and oversize rejection, ETag revalidation, district-scoped viewing, administrator upload, removal, and audit entries
- User rights: administrator-only page/API, directory search and filters, role-default inspection, override normalisation, persistence, audit entries, immediate enforcement for an existing session, page guards, self-change and escalation rejection, immutable system administrators, and module-level isolation
- School Forms access: unauthenticated page/API denial, adviser denial of health pages and APIs, school-head health access, cross-district form/attendance denial, and non-leaking scoped submission lists
- Learner integrity: duplicate LRN and duplicate school-year enrollment rejection without changing row counts
- Attendance integrity: an unrecorded day never defaults to present; SF 2 flags every unsaved school day and cannot reach 100% completeness
- SF 4 movement/attendance reconciliation warnings and report tables
- SF 6 refusing to aggregate classes without finalized grades or approved promotion decisions
- SF 9 refusing a report card before final grades are finalized
- SF 10 per-learner uniqueness, versioning without overwriting another learner, validation of an empty permanent record, and learner-scoped submission filtering
- SF 1 completeness and the ten-form cards overview
- Authorized PDF rendering and the `school_form.generate` audit entry
- Class record isolation: a teacher sees only their own assignments, an adviser cannot overwrite raw scores, a learner is denied the page and API, and another district cannot read the record
- Computed grades: weighted components with a genuine zero, configurable rounding, missing scores producing `complete: false` and **no quarterly grade**, and an incomplete quarter that cannot be submitted
- Submission workflow: locked resubmission, mandatory return reason, retained review history, resubmission version increment, and adviser-only acceptance that finalizes the matching `grade_records` row without changing raw scores
- SF 9: teacher denial for generate/finalize, `409 REPORT_CARD_INCOMPLETE` for a card with gaps, an immutable finalized snapshot that survives a later grade edit, reopen with a required reason, refinalization incrementing the version, and learner denial of card detail and batch output
- Authorized report card HTML, PDF, batch PDF (`%PDF`), and CSV output
- Notifications, malformed JSON, and no stack-trace leakage

Tests create data prefixed `TST-` and remove it in `after()`, and `tests/classrecords.test.js` restores the shared class record template it edits. Run them against a disposable development database, not production. The suite requires the seed accounts and the forms plus class record schemas to exist.

## Security notes

- Passwords are hashed with bcrypt (cost 12) and never returned by the API.
- Login uses a dummy hash for unknown accounts to reduce timing differences and always returns the same `INVALID_CREDENTIALS` message.
- Sessions are stored in PostgreSQL, regenerated at login, and expire. Cookies are HttpOnly and SameSite=Lax; `Secure` and HSTS are enabled in production.
- CSRF protection applies to every cookie-authenticated state-changing request.
- Login is limited to 10 failed attempts per 15 minutes; password reset requests to 5 per hour; self-registration to 5 requests per hour; general API traffic to 600 requests per 15 minutes.
- All SQL uses parameterized queries. Multi-row writes use transactions.
- Input is validated and trimmed at API boundaries; output is serialized through explicit field lists.
- Helmet restricts scripts to same-origin and disables framing. Inline styles are allowed because Bootstrap utilities and chart sizing rely on them.
- In production, `NODE_ENV=production` enables HSTS and secure cookies, and error responses omit stack traces and database details.
- Sensitive administrative actions (login, logout, self-registration, account approval/rejection, district/school/user/announcement changes, reports, password reset requests, profile and photo changes, and permission updates) are written to `audit_logs`.
- Module permissions are enforced by middleware on every protected API route and by page guards before a protected HTML file is served. Effective rights are reloaded from PostgreSQL on each authenticated request, so revocation does not wait for a new login or a cache expiry. System administrators are immutable, and no one can change their own rights.
- Health records are served only through the `health` module. The learner profile hides the tab and the API returns `403` to teachers, advisers, and learners. Health print/PDF output is part of SF 8 and is subject to the same module permission.
- Every learner, section, school-year, attendance, grade, book, movement, personnel, form, and monitoring query is scoped by the signed-in user's school or district. Passing another school's ID does not widen access.
- Form submissions are unique per form, school, school year, grade, section, learner, and period. The per-learner scope prevents SF 9/SF 10 collisions. Approved/finalized forms are locked; corrections create versions and audit rows.
- Form generation, review actions, grade corrections, attendance saves, health changes, movement decisions, and permission changes are written to `audit_logs`. Printed forms carry a status and source reference, never a fabricated signature, seal, or approval.
- Exports and PDFs require an authenticated, authorized session. There is no public learner, health, or form URL, and no unrestricted bulk learner download.
- Profile photos are validated by decoding, not by filename or declared MIME type; they are re-encoded with `sharp` to strip metadata and scripts, capped at a 10 MB input and 48 megapixels, stored in PostgreSQL, and served with `nosniff`, a private cache policy, and district-scoped authorisation. Upload endpoints are rate limited and CSRF protected.
- User management, user rights, and audit logs are restricted server-side; hiding a navigation link is not the security boundary.

## Production deployment

1. Set `NODE_ENV=production`, `TRUST_PROXY=1` behind an HTTPS terminator, and a strong `SESSION_SECRET`.
2. Set `DATABASE_SSL=true` if your PostgreSQL provider requires TLS.
3. Serve the app over HTTPS only. Cookies are marked `Secure` in production, so plain HTTP will not keep a session.
4. For a database that already holds real data, run `npm run db:migrate` to add the rights tables and synchronise the catalogue without touching existing records, then `npm run db:migrate:forms` to add the learner/forms tables and the per-learner submission scope, then `npm run db:migrate:classrecords` to add the class record, submission, and SF 9 snapshot schema. For a fresh installation, run `npm run db:init`, then replace or remove the demonstration accounts. Rerun the appropriate scripts after every release that changes `database/schema.sql`, `database/schema-forms.sql`, or `database/schema-classrecords.sql`; all are idempotent and only add tables, columns, constraints, and indexes.
5. Obtain and load the current official DepEd form layouts through the Templates console before using generated output for official submission. Review a printed proof of every form for school identity, multipage headers, clipped names, and signature space.
6. Use a process manager (systemd, PM2, or a container orchestrator) and run the app as an unprivileged user.
7. Back up PostgreSQL and monitor the `audit_logs` and `session` tables for growth. Learner forms, health measurements, and permanent academic records are covered by the same backup policy; never delete permanent records during routine cleanup.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `DATABASE_URL is required` | `.env` is missing or incomplete. Copy `.env.example` and set the connection string. |
| `SESSION_SECRET must be at least 32 characters` | Generate a longer random secret. |
| `Unable to connect to PostgreSQL` | Confirm PostgreSQL is running, the database exists, and the role can log in. |
| `Unable to connect to PostgreSQL: Invalid URL` | `DATABASE_URL` is not a parseable connection string. Paste the provider's string as one line, without quotes or a `DATABASE_URL=` prefix, and percent-encode special characters in the password (`@` → `%40`, `:` → `%3A`, `/` → `%2F`, `#` → `%23`, `?` → `%3F`). Setting only `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_PORT`/`DB_NAME` does not configure the app. |
| `password authentication failed` | Check the role password in `DATABASE_URL`; URL-encode special characters. |
| Login returns 403 `CSRF_INVALID` | Fetch `/api/auth/csrf` first and send the token in `X-CSRF-Token`. In Postman, clear cookies and rerun the Authentication folder. |
| Sign-in fails with `CSRF_INVALID` on HTTPS hosting but works locally | `NODE_ENV=production` marks session cookies `Secure`, and Express only sends them when it knows the request arrived over HTTPS. Behind Render, Railway, Heroku, or nginx set `TRUST_PROXY=1`. Without it no session cookie is sent, so the CSRF token cannot be stored and every sign-in fails. Check that `/api/auth/csrf` returns a `Set-Cookie` header. |
| Login returns 429 | The failed-login limiter is active for 15 minutes. Successful logins do not count. Restart the app to clear the in-memory counter during development. |
| `{"error":"An unexpected server error occurred.","code":"42703"}` | PostgreSQL `undefined_column`: the database predates the deployed release. Run `npm run db:migrate` (existing data) or `npm run db:init` (fresh/demo database) with `DATABASE_URL` pointing at that database, then retry. |
| Charts are empty | Confirm `npm run db:init` loaded the seed data and that the selected period has reports. |
| Password reset link is missing | In development the API returns `devResetUrl`; production never exposes it. Check your email delivery integration. |

## Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Start the production-style server |
| `npm run dev` | Start with nodemon |
| `npm run db:init` | Apply all schemas and demonstration data (fresh databases) |
| `npm run db:migrate` | Add the rights schema to an existing database without reseeding |
| `npm run db:migrate:forms` | Add learner, attendance, grade, book, health, movement, personnel, permanent-record, and forms tables without reseeding |
| `npm run db:migrate:classrecords` | Add curricula, class records, assessments, submissions, and SF 9 snapshot columns without reseeding |
| `npm run db:hash` | Generate a bcrypt hash for a new password |
| `npm test` | Run the automated API, permissions, School Forms, and class record suites |
| `node scripts/smoke-forms.js` | Signed-in end-to-end check of the forms and operations APIs |
| `node scripts/smoke-classrecords.js` | Signed-in end-to-end check of the class record, adviser, and SF 9 APIs |
| `node scripts/verify-academic-tabs.js` | Check the learner attendance, grades, books, health, forms, and SF 10 endpoints |

## License

This project is a demonstration application. All names, accounts, schools, and records are fictional. Add a license before distributing it publicly.
# school-district-monitoring
