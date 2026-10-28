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
    'teacher', 'nt', 'adviser', 'learner', 'staff'
  )
);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_approval_status_check;
ALTER TABLE users ADD CONSTRAINT users_approval_status_check
  CHECK (approval_status IN ('pending', 'active', 'rejected'));

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_school_required;
ALTER TABLE users ADD CONSTRAINT users_school_required CHECK (
  role NOT IN ('school_head', 'teacher', 'nt', 'adviser', 'learner')
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
  FOREACH table_name IN ARRAY ARRAY['districts', 'users', 'schools', 'school_reports', 'school_enrollment', 'announcements']
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

COMMIT;
