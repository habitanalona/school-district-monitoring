-- ---------------------------------------------------------------------------
-- DepEd School Forms 1-10 add-on.
--
-- Additive only: every statement is safe to re-run and no existing table or
-- column is altered. Run through `npm run db:migrate` or database/init.js.
-- All academic records carry their school-year, school, grade, and section
-- context so historical registers never change when a learner moves.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- Personnel profiles (SF 7). A profile may be linked to a login account but
-- does not require one, so non-teaching staff can appear on SF 7 without
-- receiving system access.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS personnel_profiles (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  employee_no VARCHAR(32) NOT NULL,
  last_name VARCHAR(80) NOT NULL,
  first_name VARCHAR(80) NOT NULL,
  middle_name VARCHAR(80),
  suffix VARCHAR(16),
  position VARCHAR(120) NOT NULL,
  employment_type VARCHAR(24) NOT NULL DEFAULT 'plantilla'
    CHECK (employment_type IN ('plantilla', 'provisional', 'contractual', 'substitute', 'volunteer', 'other')),
  employment_status VARCHAR(16) NOT NULL DEFAULT 'active'
    CHECK (employment_status IN ('active', 'inactive')),
  is_teaching BOOLEAN NOT NULL DEFAULT TRUE,
  specialization VARCHAR(160),
  qualifications TEXT,
  designation VARCHAR(160),
  contact_number VARCHAR(32),
  email VARCHAR(160),
  date_hired DATE,
  archived_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT personnel_profiles_employee_unique UNIQUE (school_id, employee_no)
);

CREATE INDEX IF NOT EXISTS personnel_profiles_school_idx ON personnel_profiles (school_id);
CREATE INDEX IF NOT EXISTS personnel_profiles_user_idx ON personnel_profiles (user_id);
CREATE INDEX IF NOT EXISTS personnel_profiles_active_idx ON personnel_profiles (school_id, employment_status)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS personnel_profiles_name_idx
  ON personnel_profiles (lower(last_name), lower(first_name));

-- ---------------------------------------------------------------------------
-- School calendar. Attendance totals use configured school days; weekends
-- are excluded unless a school explicitly marks a make-up school day.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS school_calendar_days (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  calendar_date DATE NOT NULL,
  day_type VARCHAR(16) NOT NULL DEFAULT 'school_day'
    CHECK (day_type IN ('school_day', 'holiday', 'suspension', 'no_class', 'orientation')),
  label VARCHAR(160),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT school_calendar_unique UNIQUE (school_id, school_year_id, calendar_date)
);

CREATE INDEX IF NOT EXISTS school_calendar_year_idx ON school_calendar_days (school_year_id, calendar_date);

-- ---------------------------------------------------------------------------
-- SF 2 daily attendance. One record per enrollment and date. The learner,
-- school, grade, and section are snapshotted for reliable historical reports
-- even if the enrollment is later transferred or corrected.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_records (
  id BIGSERIAL PRIMARY KEY,
  learner_id BIGINT NOT NULL REFERENCES learners(id) ON DELETE RESTRICT,
  enrollment_id BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE RESTRICT,
  grade_level_id BIGINT NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
  section_id BIGINT REFERENCES sections(id) ON DELETE SET NULL,
  attendance_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'present'
    CHECK (status IN ('present', 'absent', 'tardy', 'excused', 'half_day')),
  remarks VARCHAR(255),
  recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attendance_records_unique UNIQUE (enrollment_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS attendance_section_date_idx
  ON attendance_records (section_id, attendance_date);
CREATE INDEX IF NOT EXISTS attendance_year_idx ON attendance_records (school_year_id, attendance_date);
CREATE INDEX IF NOT EXISTS attendance_learner_idx ON attendance_records (learner_id, attendance_date);

-- ---------------------------------------------------------------------------
-- SF 3 book catalog and issuance transactions. Past transactions are never
-- rewritten; a return is appended as its own record.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS book_catalog (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE RESTRICT,
  title VARCHAR(200) NOT NULL,
  subject_id BIGINT REFERENCES subjects(id) ON DELETE SET NULL,
  grade_level_id BIGINT REFERENCES grade_levels(id) ON DELETE SET NULL,
  author VARCHAR(160),
  publisher VARCHAR(160),
  edition VARCHAR(64),
  publication_year SMALLINT CHECK (publication_year IS NULL OR publication_year BETWEEN 1900 AND 2200),
  isbn VARCHAR(32),
  quantity_total INTEGER NOT NULL DEFAULT 0 CHECK (quantity_total >= 0),
  condition VARCHAR(24) NOT NULL DEFAULT 'good'
    CHECK (condition IN ('new', 'good', 'fair', 'poor', 'for_repair')),
  location VARCHAR(120),
  remarks TEXT,
  archived_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS book_catalog_school_idx ON book_catalog (school_id, school_year_id);
CREATE INDEX IF NOT EXISTS book_catalog_title_idx ON book_catalog (lower(title));
CREATE INDEX IF NOT EXISTS book_catalog_subject_idx ON book_catalog (subject_id);

CREATE TABLE IF NOT EXISTS book_issuances (
  id BIGSERIAL PRIMARY KEY,
  catalog_id BIGINT NOT NULL REFERENCES book_catalog(id) ON DELETE RESTRICT,
  learner_id BIGINT NOT NULL REFERENCES learners(id) ON DELETE RESTRICT,
  enrollment_id BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE RESTRICT,
  grade_level_id BIGINT NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
  section_id BIGINT REFERENCES sections(id) ON DELETE SET NULL,
  quantity_issued INTEGER NOT NULL CHECK (quantity_issued > 0),
  issued_on DATE NOT NULL DEFAULT current_date,
  issued_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  expected_return_on DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'issued'
    CHECK (status IN ('issued', 'partially_returned', 'returned', 'lost', 'damaged')),
  remarks TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS book_issuances_learner_idx ON book_issuances (learner_id);
CREATE INDEX IF NOT EXISTS book_issuances_catalog_idx ON book_issuances (catalog_id);
CREATE INDEX IF NOT EXISTS book_issuances_year_idx ON book_issuances (school_year_id);

CREATE TABLE IF NOT EXISTS book_returns (
  id BIGSERIAL PRIMARY KEY,
  issuance_id BIGINT NOT NULL REFERENCES book_issuances(id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  returned_on DATE NOT NULL DEFAULT current_date,
  condition VARCHAR(16) NOT NULL DEFAULT 'good'
    CHECK (condition IN ('good', 'fair', 'damaged', 'lost')),
  received_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS book_returns_issuance_idx ON book_returns (issuance_id);

-- ---------------------------------------------------------------------------
-- SF 4 learner movement events. Only an authorized movement record can make
-- a learner count as a transfer or dropout; an absence never does.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS learner_movements (
  id BIGSERIAL PRIMARY KEY,
  learner_id BIGINT NOT NULL REFERENCES learners(id) ON DELETE RESTRICT,
  enrollment_id BIGINT REFERENCES enrollments(id) ON DELETE SET NULL,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE RESTRICT,
  grade_level_id BIGINT REFERENCES grade_levels(id) ON DELETE SET NULL,
  section_id BIGINT REFERENCES sections(id) ON DELETE SET NULL,
  movement_type VARCHAR(24) NOT NULL
    CHECK (movement_type IN ('transferred_in', 'transferred_out', 'dropped_out', 'reinstated', 'completed', 'other')),
  effective_date DATE NOT NULL,
  from_school_id BIGINT REFERENCES schools(id) ON DELETE SET NULL,
  to_school_id BIGINT REFERENCES schools(id) ON DELETE SET NULL,
  counterpart_school_name VARCHAR(160),
  reason TEXT,
  reference_no VARCHAR(80),
  status VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learner_movements_learner_idx ON learner_movements (learner_id);
CREATE INDEX IF NOT EXISTS learner_movements_year_idx
  ON learner_movements (school_id, school_year_id, effective_date);

-- ---------------------------------------------------------------------------
-- Grades, configurable grading policy, and promotion decisions (SF 5, 6, 9).
-- Grades are quarter records plus a computed final that is only written during
-- finalization. Nothing is auto-finalized from incomplete records.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grading_policies (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  grade_level_id BIGINT REFERENCES grade_levels(id) ON DELETE CASCADE,
  passing_grade NUMERIC(5,2) NOT NULL DEFAULT 75 CHECK (passing_grade BETWEEN 0 AND 100),
  final_formula VARCHAR(16) NOT NULL DEFAULT 'average'
    CHECK (final_formula IN ('average', 'weighted')),
  quarter_weights NUMERIC(4,3)[] NOT NULL DEFAULT ARRAY[0.25, 0.25, 0.25, 0.25]::numeric[],
  notes TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS grading_policies_unique
  ON grading_policies (school_id, school_year_id, COALESCE(grade_level_id, 0));

CREATE TABLE IF NOT EXISTS grade_records (
  id BIGSERIAL PRIMARY KEY,
  enrollment_id BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE RESTRICT,
  period VARCHAR(8) NOT NULL CHECK (period IN ('q1', 'q2', 'q3', 'q4', 'final')),
  grade NUMERIC(5,2) NOT NULL CHECK (grade BETWEEN 0 AND 100),
  status VARCHAR(12) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'finalized')),
  remarks VARCHAR(255),
  submitted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  finalized_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  finalized_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT grade_records_unique UNIQUE (enrollment_id, subject_id, period)
);

CREATE INDEX IF NOT EXISTS grade_records_enrollment_idx ON grade_records (enrollment_id);
CREATE INDEX IF NOT EXISTS grade_records_subject_idx ON grade_records (subject_id, school_year_id);

CREATE TABLE IF NOT EXISTS promotion_decisions (
  id BIGSERIAL PRIMARY KEY,
  enrollment_id BIGINT NOT NULL UNIQUE REFERENCES enrollments(id) ON DELETE CASCADE,
  learner_id BIGINT NOT NULL REFERENCES learners(id) ON DELETE RESTRICT,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE RESTRICT,
  grade_level_id BIGINT NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
  section_id BIGINT REFERENCES sections(id) ON DELETE SET NULL,
  general_average NUMERIC(5,2) CHECK (general_average IS NULL OR general_average BETWEEN 0 AND 100),
  decision VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending', 'promoted', 'retained', 'conditional', 'completed', 'other')),
  workflow_status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (workflow_status IN ('draft', 'recommended', 'approved', 'finalized')),
  adviser_remarks TEXT,
  head_remarks TEXT,
  recommended_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  recommended_at TIMESTAMPTZ,
  approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS promotion_decisions_year_idx
  ON promotion_decisions (school_id, school_year_id, grade_level_id);

-- ---------------------------------------------------------------------------
-- SF 8 health measurements. Restricted module; BMI is calculated only from
-- valid positive measurements, and nutritional status is an authorized
-- assessment, not an automatic diagnosis.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS health_measurements (
  id BIGSERIAL PRIMARY KEY,
  learner_id BIGINT NOT NULL REFERENCES learners(id) ON DELETE RESTRICT,
  enrollment_id BIGINT REFERENCES enrollments(id) ON DELETE SET NULL,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE RESTRICT,
  measured_on DATE NOT NULL,
  age_at_measurement NUMERIC(4,1) CHECK (age_at_measurement IS NULL OR age_at_measurement BETWEEN 0 AND 30),
  sex VARCHAR(6) CHECK (sex IN ('male', 'female')),
  weight_kg NUMERIC(5,2) NOT NULL CHECK (weight_kg > 0 AND weight_kg <= 500),
  height_cm NUMERIC(5,2) NOT NULL CHECK (height_cm > 0 AND height_cm <= 300),
  bmi NUMERIC(5,2) CHECK (bmi IS NULL OR (bmi > 0 AND bmi <= 200)),
  nutritional_status VARCHAR(40)
    CHECK (nutritional_status IS NULL OR nutritional_status IN (
      'severely_wasted', 'wasted', 'normal', 'overweight', 'obese',
      'severely_stunted', 'stunted', 'tall', 'not_assessed'
    )),
  assessment TEXT,
  assessor_name VARCHAR(160),
  assessed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  remarks TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS health_measurements_learner_idx
  ON health_measurements (learner_id, measured_on DESC);
CREATE INDEX IF NOT EXISTS health_measurements_year_idx
  ON health_measurements (school_id, school_year_id);

-- ---------------------------------------------------------------------------
-- SF 9 report cards. One active card per enrollment. Reissues increment the
-- version and preserve an immutable snapshot.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS report_cards (
  id BIGSERIAL PRIMARY KEY,
  learner_id BIGINT NOT NULL REFERENCES learners(id) ON DELETE RESTRICT,
  enrollment_id BIGINT NOT NULL UNIQUE REFERENCES enrollments(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE RESTRICT,
  section_id BIGINT REFERENCES sections(id) ON DELETE SET NULL,
  adviser_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  general_average NUMERIC(5,2) CHECK (general_average IS NULL OR general_average BETWEEN 0 AND 100),
  days_of_school INTEGER CHECK (days_of_school IS NULL OR days_of_school >= 0),
  days_present INTEGER CHECK (days_present IS NULL OR days_present >= 0),
  days_absent INTEGER CHECK (days_absent IS NULL OR days_absent >= 0),
  days_tardy INTEGER CHECK (days_tardy IS NULL OR days_tardy >= 0),
  promotion_status VARCHAR(20),
  status VARCHAR(12) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'approved', 'issued')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  remarks TEXT,
  prepared_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  issued_on DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS report_cards_year_idx
  ON report_cards (school_id, school_year_id, section_id);

CREATE TABLE IF NOT EXISTS report_card_revisions (
  id BIGSERIAL PRIMARY KEY,
  report_card_id BIGINT NOT NULL REFERENCES report_cards(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  reason TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT report_card_revisions_unique UNIQUE (report_card_id, version)
);

-- ---------------------------------------------------------------------------
-- SF 10 permanent academic record. Records built from the system are marked
-- `system`; imported historical records must be explicitly verified. Neither
-- is deleted through ordinary workflows.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS permanent_academic_records (
  id BIGSERIAL PRIMARY KEY,
  learner_id BIGINT NOT NULL REFERENCES learners(id) ON DELETE RESTRICT,
  school_id BIGINT REFERENCES schools(id) ON DELETE RESTRICT,
  school_year_id BIGINT REFERENCES school_years(id) ON DELETE RESTRICT,
  grade_level_id BIGINT REFERENCES grade_levels(id) ON DELETE SET NULL,
  level VARCHAR(16) NOT NULL DEFAULT 'jhs'
    CHECK (level IN ('elementary', 'jhs', 'shs')),
  school_name VARCHAR(160) NOT NULL,
  school_id_no VARCHAR(48),
  section_name VARCHAR(80),
  general_average NUMERIC(5,2) CHECK (general_average IS NULL OR general_average BETWEEN 0 AND 100),
  promotion_status VARCHAR(48),
  awards VARCHAR(255),
  transfer_info VARCHAR(255),
  source VARCHAR(16) NOT NULL DEFAULT 'system' CHECK (source IN ('system', 'imported')),
  verification_status VARCHAR(16) NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'verified')),
  verified_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  verified_at TIMESTAMPTZ,
  remarks TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS permanent_records_learner_idx
  ON permanent_academic_records (learner_id, school_year_id);
CREATE UNIQUE INDEX IF NOT EXISTS permanent_records_unique
  ON permanent_academic_records (learner_id, COALESCE(school_year_id, 0), COALESCE(grade_level_id, 0));

CREATE TABLE IF NOT EXISTS permanent_academic_subjects (
  id BIGSERIAL PRIMARY KEY,
  record_id BIGINT NOT NULL REFERENCES permanent_academic_records(id) ON DELETE CASCADE,
  subject_name VARCHAR(160) NOT NULL,
  final_grade NUMERIC(5,2) CHECK (final_grade IS NULL OR final_grade BETWEEN 0 AND 100),
  remarks VARCHAR(160),
  sort_order SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS permanent_subjects_record_idx ON permanent_academic_subjects (record_id);

-- ---------------------------------------------------------------------------
-- Configurable school form templates. Built-in templates are explicitly
-- marked as system layouts until the school supplies a verified official
-- version; the UI must not present an unverified layout as official.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS form_templates (
  id BIGSERIAL PRIMARY KEY,
  form_code VARCHAR(8) NOT NULL CHECK (form_code IN (
    'sf1', 'sf2', 'sf3', 'sf4', 'sf5', 'sf6', 'sf7', 'sf8', 'sf9', 'sf10'
  )),
  name VARCHAR(160) NOT NULL,
  version VARCHAR(32) NOT NULL DEFAULT 'system-1',
  orientation VARCHAR(16) NOT NULL DEFAULT 'portrait'
    CHECK (orientation IN ('portrait', 'landscape')),
  paper_size VARCHAR(16) NOT NULL DEFAULT 'A4'
    CHECK (paper_size IN ('A4', 'Letter', 'Legal', 'Folio')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_official BOOLEAN NOT NULL DEFAULT FALSE,
  source_note TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT form_templates_unique UNIQUE (form_code, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS form_templates_active_idx
  ON form_templates (form_code) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Submission and review workflow (district monitoring).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS form_submissions (
  id BIGSERIAL PRIMARY KEY,
  form_code VARCHAR(8) NOT NULL CHECK (form_code IN (
    'sf1', 'sf2', 'sf3', 'sf4', 'sf5', 'sf6', 'sf7', 'sf8', 'sf9', 'sf10'
  )),
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  grade_level_id BIGINT REFERENCES grade_levels(id) ON DELETE SET NULL,
  section_id BIGINT REFERENCES sections(id) ON DELETE SET NULL,
  learner_id BIGINT REFERENCES learners(id) ON DELETE RESTRICT,
  period VARCHAR(10),
  status VARCHAR(32) NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'in_progress', 'ready_for_validation', 'validation_failed',
      'submitted', 'returned', 'approved', 'finalized'
    )),
  completeness NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (completeness BETWEEN 0 AND 100),
  validation JSONB NOT NULL DEFAULT '{}'::jsonb,
  snapshot JSONB,
  template_id BIGINT REFERENCES form_templates(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ,
  generated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  submitted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The learner column keeps single-learner forms (SF 9 and SF 10) distinct.
-- Older installations are upgraded in place; the previous scope index is
-- replaced so a section-wide form and a learner card cannot collide.
ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS learner_id BIGINT REFERENCES learners(id) ON DELETE RESTRICT;

DROP INDEX IF EXISTS form_submissions_scope_unique;

CREATE UNIQUE INDEX IF NOT EXISTS form_submissions_scope_unique
  ON form_submissions (
    form_code, school_id, school_year_id,
    COALESCE(grade_level_id, 0), COALESCE(section_id, 0),
    COALESCE(learner_id, 0), COALESCE(period, '')
  );

CREATE INDEX IF NOT EXISTS form_submissions_school_idx
  ON form_submissions (school_id, school_year_id, form_code);

CREATE INDEX IF NOT EXISTS form_submissions_learner_idx
  ON form_submissions (learner_id, form_code, school_year_id);

CREATE TABLE IF NOT EXISTS form_reviews (
  id BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  action VARCHAR(24) NOT NULL
    CHECK (action IN ('generated', 'submitted', 'returned', 'approved', 'rejected', 'finalized')),
  comments TEXT,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS form_reviews_submission_idx ON form_reviews (submission_id, created_at);

CREATE TABLE IF NOT EXISTS form_deadlines (
  id BIGSERIAL PRIMARY KEY,
  district_id BIGINT REFERENCES districts(id) ON DELETE CASCADE,
  school_id BIGINT REFERENCES schools(id) ON DELETE CASCADE,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  form_code VARCHAR(8) NOT NULL CHECK (form_code IN (
    'sf1', 'sf2', 'sf3', 'sf4', 'sf5', 'sf6', 'sf7', 'sf8', 'sf9', 'sf10'
  )),
  period VARCHAR(10),
  title VARCHAR(160) NOT NULL,
  due_date DATE NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS form_deadlines_year_idx ON form_deadlines (school_year_id, due_date);

-- ---------------------------------------------------------------------------
-- Built-in template registry. These are system layouts, not official DepEd
-- templates; the source_note is surfaced in the form centre and print header.
-- ---------------------------------------------------------------------------
INSERT INTO form_templates (form_code, name, version, orientation, paper_size, is_official, source_note, config)
VALUES
  ('sf1', 'School Register', 'system-1', 'landscape', 'Legal', FALSE,
   'System layout pending verification against the current official DepEd SF 1 template.', '{}'),
  ('sf2', 'Daily Attendance Report of Learners', 'system-1', 'landscape', 'Legal', FALSE,
   'System layout pending verification against the current official DepEd SF 2 template.', '{}'),
  ('sf3', 'Books Issued and Returned', 'system-1', 'landscape', 'Legal', FALSE,
   'System layout pending verification against the current official DepEd SF 3 template.', '{}'),
  ('sf4', 'Monthly Learner Movement and Attendance', 'system-1', 'portrait', 'Legal', FALSE,
   'System layout pending verification against the current official DepEd SF 4 template.', '{}'),
  ('sf5', 'Report on Promotion and Level of Progress', 'system-1', 'landscape', 'Legal', FALSE,
   'System layout pending verification against the current official DepEd SF 5 template.', '{}'),
  ('sf6', 'Summarized Report on Promotion and Level of Progress', 'system-1', 'portrait', 'Legal', FALSE,
   'System layout pending verification against the current official DepEd SF 6 template.', '{}'),
  ('sf7', 'Personnel Assignment List and Basic Profile', 'system-1', 'landscape', 'Legal', FALSE,
   'System layout pending verification against the current official DepEd SF 7 template.', '{}'),
  ('sf8', 'Learner Health and Nutrition Profile', 'system-1', 'portrait', 'Legal', FALSE,
   'System layout pending verification against the current official DepEd SF 8 template. Restricted access.', '{}'),
  ('sf9', 'Learner Progress Report Card', 'system-1', 'portrait', 'A4', FALSE,
   'System layout pending verification against the current official DepEd SF 9 template.', '{}'),
  ('sf10', 'Learner Permanent Academic Record', 'system-1', 'portrait', 'Legal', FALSE,
   'System layout pending verification against the current official DepEd SF 10 template.', '{}')
ON CONFLICT (form_code, version) DO NOTHING;

-- ---------------------------------------------------------------------------
-- updated_at triggers for the new mutable tables.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'personnel_profiles', 'school_calendar_days', 'attendance_records',
    'book_catalog', 'book_issuances', 'learner_movements', 'grading_policies',
    'grade_records', 'promotion_decisions', 'health_measurements',
    'report_cards', 'permanent_academic_records', 'form_templates',
    'form_submissions', 'form_deadlines'
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

COMMIT;
