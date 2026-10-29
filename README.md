# School District Monitoring System

A full-stack web application for district administrators to manage enrolled schools, monitor reporting compliance, review performance, publish announcements, and audit administrative activity. The frontend is plain HTML5, CSS3, Bootstrap 4, and vanilla JavaScript; the backend is Node.js, Express, and PostgreSQL.

![Stack](https://img.shields.io/badge/stack-Express%20%7C%20PostgreSQL%20%7C%20Bootstrap%204-0b2545)

## Features

- Landing page with a secure sign-in panel, show/hide password, Remember Me, forgot-password flow, validation, loading states, and generic error messages.
- Session authentication with bcrypt-hashed passwords and a PostgreSQL-backed session store.
- Self-service account creation from the sign-in page: applicants choose their role, district, and school, then wait for confirmation by their immediate superior before they can sign in.
- Role-based access control for **system administrators**, **district administrators**, **PSDS**, **school heads**, **teachers**, **non-teaching personnel**, **class advisers**, **learners**, and **authorized staff**, enforced on every API route and page.
- District scoping: district administrators and staff only see schools, reports, announcements, and users inside their own district.
- Account approvals queue: PSDS registrations are confirmed by the district administrator, school heads by the PSDS, teachers/NT/advisers by the school head, and learners by the class adviser. System administrators can confirm any registration.
- School Division Office hierarchy in the sidebar: expandable districts, their two PSDS (Public Schools District Supervisors), nested schools, live search, and deep links into the school registry.
- District management for system administrators: create, edit, and delete districts with office contact details and exactly two PSDS assignments. Deletion is blocked while schools, accounts, or announcements still reference the district.
- Dashboard with six live metrics, four Chart.js charts, recent audit activity, and a filterable school monitoring table.
- School registry with register, view, edit, archive (soft delete), and restore. Archived records are retained.
- Monthly report tracking with submission status, reporting period, and uniqueness per school/period/type.
- User administration, announcement publishing, notifications, audit logs, and self-service profile/password management.
- Secure profile photos for every account: users upload their own picture, administrators can set or remove one for any account they manage from the Users page, and avatars appear in the sidebar, top bar, profile page, and user list.
- Responsive layout: collapsible navy sidebar, mobile drawer, keyboard-accessible focus styles, loading skeletons, toasts, and empty states.
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
│   ├── js/                 API helper, UI helpers, page controllers
│   ├── index.html          Landing page and sign-in
│   ├── dashboard.html
│   ├── districts.html      District and PSDS management
│   ├── schools.html
│   ├── reports.html
│   ├── users.html
│   ├── announcements.html
│   ├── audit-logs.html
│   ├── settings.html
│   ├── profile.html
│   ├── reset-password.html
│   └── 404.html
├── database/
│   ├── schema.sql          Tables, constraints, indexes
│   ├── seed.sql            Fictional demonstration data
│   └── init.js             Applies schema + seed
├── postman/
│   ├── SDMS.postman_collection.json
│   └── SDMS.local.postman_environment.json
├── scripts/hash-password.js
├── server/
│   ├── app.js              Middleware, security, static pages, routes
│   ├── server.js           Startup and graceful shutdown
│   ├── config/             Environment and PostgreSQL pool
│   ├── controllers/        HTTP handlers
│   ├── middleware/         Auth, RBAC, CSRF, rate limits, errors
│   ├── routes/             API route definitions
│   ├── services/           SQL and business logic
│   └── utils/              Validation, scope, permissions, serializers
├── tests/api.test.js       Automated API tests
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

Expected seed volume: 3 districts (each with two PSDS assignments), 16 schools, 32 monthly reports, 5 users, 4 announcements, and 9 notifications.

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

| Capability | System admin | District admin | PSDS | School head / adviser | Teacher / NT / learner |
| --- | --- | --- | --- | --- | --- |
| View dashboard and scoped schools | All districts | Own district | Own district | Own district | Own district |
| View district hierarchy and PSDS assignments | All districts | Own district | Own district | Own district | Own district |
| Create, edit, delete districts and PSDS assignments | Yes | No | No | No | No |
| Create, edit, archive, restore schools | Yes | Yes | No | No | No |
| Submit and update reports | Yes | Yes | Yes | Yes | Yes |
| Manage users | Yes | Yes (own district, no system/district admins) | No | No | No |
| Confirm self-registered accounts | Any registration | PSDS in own district | School heads in own district | Teachers, NT, advisers in own school; learners (adviser only) | No |
| Publish announcements | Yes | Yes | No | No | No |
| View audit logs | Yes | No | No | No | No |
| Select another district | Yes | No | No | No | No |

Read-only staff still see only published announcements for their district or system-wide notices.

### Self-registration and confirmation

The sign-in page links to **Create an account** (`register.html`). An applicant chooses a self-registrable role (`psds`, `school_head`, `teacher`, `nt`, `adviser`, or `learner`), a district, and — for school-based roles — an active school. The API stores the account with `approval_status = 'pending'` and `is_active = FALSE`, notifies the approver, and returns the confirming role.

| Applicant role | Confirmed by |
| --- | --- |
| `psds` | District administrator |
| `school_head` | PSDS in the same district |
| `teacher`, `nt`, `adviser` | School head at the same school |
| `learner` | Class adviser at the same school |

If no active account exists for the immediate superior role, the district administrator can act as the fallback approver. System administrators can confirm any pending registration. Confirmation activates the account, signs in are allowed, and the user can update their own profile through **My Profile**. Rejection keeps the account blocked and records an optional reason. Confirmations and rejections are recorded in the audit trail and notify the applicant.

The approvals queue is available at `approvals.html` and in the **Account Approvals** sidebar entry for every role that can confirm accounts.


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

The collection enables Postman's cookie jar automatically, fetches a fresh CSRF token before login, and rotates the saved token after login. It runs 49 requests across Authentication, Dashboard, Districts, Schools, Reports, Users, Registration and approvals, Announcements, System and account, and Session. Logout is deliberately the final request. To exercise approvals, sign in as the approver (for example `northhead`) before running **List pending approvals** and **Approve registration**; change the sample registration username if you run it more than once.

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
- Notifications, malformed JSON, and no stack-trace leakage

Tests create data prefixed `TST-` and remove it in `after()`. Run them against a disposable development database, not production. The suite requires the seed accounts to exist.

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
- Sensitive administrative actions (login, logout, self-registration, account approval/rejection, district/school/user/announcement changes, reports, password reset requests, profile and photo changes) are written to `audit_logs`.
- Profile photos are validated by decoding, not by filename or declared MIME type; they are re-encoded with `sharp` to strip metadata and scripts, capped at a 10 MB input and 48 megapixels, stored in PostgreSQL, and served with `nosniff`, a private cache policy, and district-scoped authorisation. Upload endpoints are rate limited and CSRF protected.
- User management and audit logs are restricted server-side; hiding a navigation link is not the security boundary.

## Production deployment

1. Set `NODE_ENV=production`, `TRUST_PROXY=1` behind an HTTPS terminator, and a strong `SESSION_SECRET`.
2. Set `DATABASE_SSL=true` if your PostgreSQL provider requires TLS.
3. Serve the app over HTTPS only. Cookies are marked `Secure` in production, so plain HTTP will not keep a session.
4. Run `npm run db:init` against the production database, then replace or remove the demonstration accounts. Rerun it after every release that changes `database/schema.sql`; the script is idempotent and only adds tables, columns, constraints, and indexes.
5. Use a process manager (systemd, PM2, or a container orchestrator) and run the app as an unprivileged user.
6. Back up PostgreSQL and monitor the `audit_logs` and `session` tables for growth.

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
| `{"error":"An unexpected server error occurred.","code":"42703"}` | PostgreSQL `undefined_column`: the database predates the deployed release. Run `npm run db:init` with `DATABASE_URL` pointing at that database, then retry. |
| Charts are empty | Confirm `npm run db:init` loaded the seed data and that the selected period has reports. |
| Password reset link is missing | In development the API returns `devResetUrl`; production never exposes it. Check your email delivery integration. |

## Scripts

| Command | Purpose |
| --- | --- |
| `npm start` | Start the production-style server |
| `npm run dev` | Start with nodemon |
| `npm run db:init` | Apply schema and seed data |
| `npm run db:hash` | Generate a bcrypt hash for a new password |
| `npm test` | Run the automated API suite |

## License

This project is a demonstration application. All names, accounts, schools, and records are fictional. Add a license before distributing it publicly.
# school-district-monitoring
