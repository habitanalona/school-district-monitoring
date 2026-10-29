-- School District Monitoring System
-- PostgreSQL schema. Run with: npm run db:init

BEGIN;

CREATE TABLE IF NOT EXISTS districts (
  id BIGSERIAL PRIMARY KEY,
  district_name VARCHAR(160) NOT NULL,
  district_code VARCHAR(24) NOT NULL UNIQUE,
  address TEXT,
  contact_email VARCHAR(160),
  psds_one_name VARCHAR(160),
  psds_one_email VARCHAR(160),
  psds_one_phone VARCHAR(32),
  psds_two_name VARCHAR(160),
  psds_two_email VARCHAR(160),
  psds_two_phone VARCHAR(32),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE districts ADD COLUMN IF NOT EXISTS psds_one_name VARCHAR(160);
ALTER TABLE districts ADD COLUMN IF NOT EXISTS psds_one_email VARCHAR(160);
ALTER TABLE districts ADD COLUMN IF NOT EXISTS psds_one_phone VARCHAR(32);
ALTER TABLE districts ADD COLUMN IF NOT EXISTS psds_two_name VARCHAR(160);
ALTER TABLE districts ADD COLUMN IF NOT EXISTS psds_two_email VARCHAR(160);
ALTER TABLE districts ADD COLUMN IF NOT EXISTS psds_two_phone VARCHAR(32);

CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  full_name VARCHAR(160) NOT NULL,
  username VARCHAR(64) NOT NULL UNIQUE,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role VARCHAR(32) NOT NULL CHECK (role IN ('system_admin', 'district_admin', 'staff')),
  district_id BIGINT REFERENCES districts(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_district_required CHECK (role = 'system_admin' OR district_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS schools (
  id BIGSERIAL PRIMARY KEY,
  school_code VARCHAR(32) NOT NULL UNIQUE,
  school_name VARCHAR(200) NOT NULL,
  school_type VARCHAR(48) NOT NULL CHECK (school_type IN ('Elementary School', 'High School', 'Integrated School', 'Senior High School')),
  address TEXT NOT NULL,
  district_id BIGINT NOT NULL REFERENCES districts(id) ON DELETE RESTRICT,
  school_head VARCHAR(160) NOT NULL,
  contact_email VARCHAR(160),
  contact_phone VARCHAR(32),
  student_count INTEGER NOT NULL DEFAULT 0 CHECK (student_count >= 0),
  teacher_count INTEGER NOT NULL DEFAULT 0 CHECK (teacher_count >= 0),
  performance_score NUMERIC(5,2) CHECK (performance_score >= 0 AND performance_score <= 100),
  status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);

-- Self-registered accounts are confirmed by the next level in the role hierarchy.
-- Users are created before schools, so school and approval columns are added here.
ALTER TABLE users ADD COLUMN IF NOT EXISTS school_id BIGINT REFERENCES schools(id) ON DELETE RESTRICT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approval_status VARCHAR(16) NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS rejection_note TEXT;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (
  role IN (
    'system_admin', 'district_admin', 'psds', 'school_head',
    'teacher', 'coordinator', 'nt', 'adviser', 'learner', 'staff'
  )
);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_approval_status_check;
ALTER TABLE users ADD CONSTRAINT users_approval_status_check
  CHECK (approval_status IN ('pending', 'active', 'rejected'));

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_school_required;
ALTER TABLE users ADD CONSTRAINT users_school_required CHECK (
  role NOT IN ('school_head', 'teacher', 'coordinator', 'nt', 'adviser', 'learner')
  OR school_id IS NOT NULL
);

UPDATE users SET approval_status = 'active' WHERE approval_status IS NULL;

CREATE INDEX IF NOT EXISTS users_school_idx ON users (school_id);
CREATE INDEX IF NOT EXISTS users_approval_idx ON users (approval_status);

-- Profile photos are normalised to a 512px square WebP before they are stored,
-- so a row can never exceed the 2 MB upload limit. Keeping the bytes in
-- PostgreSQL makes them survive container restarts on hosts with ephemeral disks.
CREATE TABLE IF NOT EXISTS user_photos (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mime_type VARCHAR(32) NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 2097152),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  image_data BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS school_reports (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  reporting_period VARCHAR(7) NOT NULL CHECK (reporting_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  report_type VARCHAR(48) NOT NULL CHECK (report_type IN ('Monthly Enrollment', 'Performance Review', 'Compliance')),
  submission_status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (submission_status IN ('pending', 'submitted', 'late', 'reviewed')),
  submitted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT school_reports_unique UNIQUE (school_id, reporting_period, report_type)
);

CREATE TABLE IF NOT EXISTS school_enrollment (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  academic_year VARCHAR(9) NOT NULL CHECK (academic_year ~ '^[0-9]{4}-[0-9]{4}$'),
  student_count INTEGER NOT NULL DEFAULT 0 CHECK (student_count >= 0),
  grade_level VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT school_enrollment_unique UNIQUE (school_id, academic_year, grade_level)
);

CREATE TABLE IF NOT EXISTS announcements (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  district_id BIGINT REFERENCES districts(id) ON DELETE CASCADE,
  published_at TIMESTAMPTZ,
  status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  entity_type VARCHAR(48) NOT NULL,
  entity_id VARCHAR(64),
  district_id BIGINT REFERENCES districts(id) ON DELETE SET NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Session table used by connect-pg-simple.
CREATE TABLE IF NOT EXISTS "session" (
  "sid" VARCHAR NOT NULL COLLATE "default",
  "sess" JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX IF NOT EXISTS session_expire_idx ON "session" ("expire");
CREATE INDEX IF NOT EXISTS users_district_idx ON users (district_id);
CREATE INDEX IF NOT EXISTS schools_district_idx ON schools (district_id);
CREATE INDEX IF NOT EXISTS schools_status_idx ON schools (status);
CREATE INDEX IF NOT EXISTS schools_name_idx ON schools (school_name);
CREATE INDEX IF NOT EXISTS reports_school_idx ON school_reports (school_id);
CREATE INDEX IF NOT EXISTS reports_period_idx ON school_reports (reporting_period);
CREATE INDEX IF NOT EXISTS reports_status_idx ON school_reports (submission_status);
CREATE INDEX IF NOT EXISTS enrollment_school_idx ON school_enrollment (school_id);
CREATE INDEX IF NOT EXISTS announcements_district_idx ON announcements (district_id);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, is_read);
CREATE INDEX IF NOT EXISTS audit_logs_created_idx ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs (user_id);
CREATE INDEX IF NOT EXISTS audit_logs_district_idx ON audit_logs (district_id);
CREATE INDEX IF NOT EXISTS reset_tokens_user_idx ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS reset_tokens_expiry_idx ON password_reset_tokens (expires_at);

-- ---------------------------------------------------------------------------
-- Learner records: permanent learner profiles, parents/guardians, and
-- per-school-year enrollment folders with subjects, schedules, and activities.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS school_years (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(9) NOT NULL UNIQUE CHECK (name ~ '^[0-9]{4}-[0-9]{4}$'),
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT school_years_dates_check CHECK (ends_on > starts_on)
);

CREATE UNIQUE INDEX IF NOT EXISTS school_years_current_idx
  ON school_years (is_current) WHERE is_current;

CREATE TABLE IF NOT EXISTS grade_levels (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  name VARCHAR(32) NOT NULL,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT grade_levels_unique UNIQUE (school_id, name)
);

CREATE TABLE IF NOT EXISTS sections (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  grade_level_id BIGINT NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
  name VARCHAR(64) NOT NULL,
  adviser_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  room VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sections_unique UNIQUE (school_id, school_year_id, grade_level_id, name)
);

CREATE TABLE IF NOT EXISTS learners (
  id BIGSERIAL PRIMARY KEY,
  lrn VARCHAR(12) NOT NULL UNIQUE CHECK (lrn ~ '^[0-9]{12}$'),
  last_name VARCHAR(80) NOT NULL,
  first_name VARCHAR(80) NOT NULL,
  middle_name VARCHAR(80),
  extension_name VARCHAR(16),
  birth_date DATE NOT NULL,
  sex VARCHAR(6) NOT NULL CHECK (sex IN ('male', 'female')),
  weight_kg NUMERIC(5,2) CHECK (weight_kg > 0 AND weight_kg <= 500),
  height_cm NUMERIC(5,2) CHECK (height_cm > 0 AND height_cm <= 300),
  house_number VARCHAR(120),
  barangay VARCHAR(120),
  municipality VARCHAR(120),
  province VARCHAR(120),
  region VARCHAR(120),
  zip_code VARCHAR(10),
  contact_number VARCHAR(32),
  email VARCHAR(160),
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  district_id BIGINT NOT NULL REFERENCES districts(id) ON DELETE RESTRICT,
  user_id BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learners_school_idx ON learners (school_id);
CREATE INDEX IF NOT EXISTS learners_district_idx ON learners (district_id);
CREATE INDEX IF NOT EXISTS learners_name_idx ON learners (lower(last_name), lower(first_name));
CREATE INDEX IF NOT EXISTS learners_archived_idx ON learners (archived_at);

CREATE TABLE IF NOT EXISTS guardians (
  id BIGSERIAL PRIMARY KEY,
  learner_id BIGINT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  full_name VARCHAR(160) NOT NULL,
  relationship VARCHAR(48) NOT NULL,
  contact_number VARCHAR(32),
  email VARCHAR(160),
  address TEXT,
  occupation VARCHAR(120),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_emergency BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guardians_learner_idx ON guardians (learner_id);
CREATE UNIQUE INDEX IF NOT EXISTS guardians_primary_unique
  ON guardians (learner_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS enrollments (
  id BIGSERIAL PRIMARY KEY,
  learner_id BIGINT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE RESTRICT,
  grade_level_id BIGINT NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
  section_id BIGINT REFERENCES sections(id) ON DELETE SET NULL,
  adviser_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  enrollment_date DATE NOT NULL DEFAULT current_date,
  status VARCHAR(24) NOT NULL DEFAULT 'enrolled' CHECK (
    status IN ('enrolled', 'transferred_in', 'transferred_out', 'promoted', 'retained', 'completed', 'archived')
  ),
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT enrollments_unique UNIQUE (learner_id, school_year_id)
);

CREATE INDEX IF NOT EXISTS enrollments_school_idx ON enrollments (school_id, school_year_id);
CREATE INDEX IF NOT EXISTS enrollments_section_idx ON enrollments (section_id);
CREATE INDEX IF NOT EXISTS enrollments_learner_idx ON enrollments (learner_id);

CREATE TABLE IF NOT EXISTS subjects (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(160) NOT NULL,
  grade_level_id BIGINT REFERENCES grade_levels(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subjects_unique UNIQUE (school_id, code)
);

CREATE TABLE IF NOT EXISTS teacher_assignments (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  employee_number VARCHAR(32),
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT teacher_assignments_unique UNIQUE (section_id, subject_id, teacher_id)
);

CREATE INDEX IF NOT EXISTS teacher_assignments_year_idx ON teacher_assignments (school_year_id, section_id);
CREATE INDEX IF NOT EXISTS teacher_assignments_teacher_idx ON teacher_assignments (teacher_id);

CREATE TABLE IF NOT EXISTS class_schedules (
  id BIGSERIAL PRIMARY KEY,
  assignment_id BIGINT NOT NULL REFERENCES teacher_assignments(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  room VARCHAR(64),
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT class_schedules_time_check CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS class_schedules_assignment_idx ON class_schedules (assignment_id);
CREATE INDEX IF NOT EXISTS class_schedules_day_idx ON class_schedules (day_of_week, start_time);

CREATE TABLE IF NOT EXISTS activities (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE RESTRICT,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(64) NOT NULL,
  organization VARCHAR(160),
  adviser_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  participation_level VARCHAR(16) NOT NULL DEFAULT 'school' CHECK (
    participation_level IN ('classroom', 'school', 'district', 'division', 'regional', 'national', 'international')
  ),
  start_date DATE,
  end_date DATE,
  achievement VARCHAR(200),
  remarks TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT activities_dates_check CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS activities_school_year_idx ON activities (school_id, school_year_id);

CREATE TABLE IF NOT EXISTS learner_activities (
  id BIGSERIAL PRIMARY KEY,
  activity_id BIGINT NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  learner_id BIGINT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  role VARCHAR(80),
  achievement VARCHAR(200),
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT learner_activities_unique UNIQUE (activity_id, learner_id)
);

CREATE INDEX IF NOT EXISTS learner_activities_learner_idx ON learner_activities (learner_id);

CREATE TABLE IF NOT EXISTS learner_documents (
  id BIGSERIAL PRIMARY KEY,
  learner_id BIGINT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
  school_year_id BIGINT REFERENCES school_years(id) ON DELETE SET NULL,
  title VARCHAR(160) NOT NULL,
  document_type VARCHAR(64) NOT NULL,
  file_name VARCHAR(200) NOT NULL,
  mime_type VARCHAR(64) NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
  document_data BYTEA NOT NULL,
  uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learner_documents_learner_idx ON learner_documents (learner_id);


CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'districts', 'users', 'schools', 'school_reports', 'school_enrollment', 'announcements',
    'school_years', 'grade_levels', 'sections', 'learners', 'guardians', 'enrollments',
    'subjects', 'teacher_assignments', 'class_schedules', 'activities'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgname = table_name || '_set_updated_at'
        AND tgrelid = table_name::regclass
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
        table_name || '_set_updated_at',
        table_name
      );
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- User rights: module catalog, role defaults, and per-user overrides.
-- The catalog and role defaults are synchronised from
-- server/utils/permissionModules.js when the application starts or when
-- database/init.js runs, so new modules receive safe defaults automatically.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS permission_modules (
  module_key VARCHAR(48) PRIMARY KEY,
  label VARCHAR(120) NOT NULL,
  description TEXT,
  group_label VARCHAR(80) NOT NULL DEFAULT 'General',
  sort_order INTEGER NOT NULL DEFAULT 0,
  actions VARCHAR(32)[] NOT NULL DEFAULT ARRAY['access']::varchar[]
    CHECK (actions <@ ARRAY['access', 'add', 'edit', 'delete']::varchar[]),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role VARCHAR(32) NOT NULL,
  module_key VARCHAR(48) NOT NULL REFERENCES permission_modules(module_key) ON DELETE CASCADE,
  can_access BOOLEAN NOT NULL DEFAULT FALSE,
  can_add BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (role, module_key),
  CONSTRAINT role_permissions_access_check
    CHECK (can_access OR NOT (can_add OR can_edit OR can_delete))
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_key VARCHAR(48) NOT NULL REFERENCES permission_modules(module_key) ON DELETE CASCADE,
  can_access BOOLEAN NOT NULL DEFAULT FALSE,
  can_add BOOLEAN NOT NULL DEFAULT FALSE,
  can_edit BOOLEAN NOT NULL DEFAULT FALSE,
  can_delete BOOLEAN NOT NULL DEFAULT FALSE,
  granted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, module_key),
  CONSTRAINT user_permissions_access_check
    CHECK (can_access OR NOT (can_add OR can_edit OR can_delete))
);

CREATE INDEX IF NOT EXISTS user_permissions_user_idx ON user_permissions (user_id);
CREATE INDEX IF NOT EXISTS user_permissions_granted_by_idx ON user_permissions (granted_by);
CREATE INDEX IF NOT EXISTS role_permissions_role_idx ON role_permissions (role);

COMMIT;
