-- ---------------------------------------------------------------------------
-- Subject-period attendance, adviser validation, and configurable academic
-- terms. Additive only: existing attendance, enrollment, and form tables are
-- never altered or dropped, and every statement is safe to re-run.
--
-- Two attendance layers are kept deliberately separate:
--   * subject_attendance      — the source record per learner, subject,
--                               period, and date, written by the subject
--                               teacher.
--   * adviser_attendance      — the adviser-validated official daily record
--                               that SF 2 reads.
-- A single subject absence is never promoted to a whole-day absence, and
-- multiple subject absences on one date never count as multiple days.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- Academic term model. Three-term years (DepEd Order No. 009, s. 2026) and
-- historical four-quarter years share one structure: a configurable list of
-- terms with start and end dates. The model only labels the default
-- provisioned terms; administrators may rename or re-date any term.
-- ---------------------------------------------------------------------------
ALTER TABLE school_years
  ADD COLUMN IF NOT EXISTS term_model VARCHAR(20) NOT NULL DEFAULT 'four_quarter';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'school_years_term_model_check'
  ) THEN
    ALTER TABLE school_years
      ADD CONSTRAINT school_years_term_model_check
      CHECK (term_model IN ('three_term', 'four_quarter', 'custom'));
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS school_terms (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  term_no SMALLINT NOT NULL CHECK (term_no BETWEEN 1 AND 6),
  name VARCHAR(64) NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved')),
  approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT school_terms_unique UNIQUE (school_id, school_year_id, term_no),
  CONSTRAINT school_terms_dates_check CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS school_terms_year_idx
  ON school_terms (school_id, school_year_id, starts_on);

COMMENT ON TABLE school_terms IS
  'Administrator-configurable reporting terms per school and school year. Dates and names are editable; draft terms are not treated as approved policy.';

-- ---------------------------------------------------------------------------
-- Configurable class periods. A period set may be defined for the whole
-- school, one grade level, or one section; the most specific definition wins
-- for each period number. No period times are hardcoded in application logic.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_periods (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  grade_level_id BIGINT REFERENCES grade_levels(id) ON DELETE CASCADE,
  section_id BIGINT REFERENCES sections(id) ON DELETE CASCADE,
  period_no SMALLINT NOT NULL CHECK (period_no BETWEEN 1 AND 12),
  label VARCHAR(64),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT class_periods_time_check CHECK (end_time > start_time),
  CONSTRAINT class_periods_section_grade_check CHECK (section_id IS NULL OR grade_level_id IS NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS class_periods_scope_unique
  ON class_periods (
    school_id,
    school_year_id,
    period_no,
    COALESCE(grade_level_id, 0),
    COALESCE(section_id, 0)
  );
CREATE INDEX IF NOT EXISTS class_periods_school_idx
  ON class_periods (school_id, school_year_id, grade_level_id, section_id);

COMMENT ON TABLE class_periods IS
  'Editable period schedule per school year, optionally narrowed to a grade level or section.';

-- ---------------------------------------------------------------------------
-- Subject teacher attendance. One row per learner, subject, period number, and
-- date. The period number is snapshotted so later schedule edits never create
-- duplicate or orphaned source records. Duplicate submissions are impossible
-- at the database level.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subject_attendance (
  id BIGSERIAL PRIMARY KEY,
  learner_id BIGINT NOT NULL REFERENCES learners(id) ON DELETE RESTRICT,
  enrollment_id BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE RESTRICT,
  grade_level_id BIGINT NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
  section_id BIGINT REFERENCES sections(id) ON DELETE SET NULL,
  subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  assignment_id BIGINT REFERENCES teacher_assignments(id) ON DELETE SET NULL,
  class_period_id BIGINT REFERENCES class_periods(id) ON DELETE SET NULL,
  period_no SMALLINT NOT NULL CHECK (period_no BETWEEN 1 AND 12),
  period_label VARCHAR(64),
  attendance_date DATE NOT NULL,
  status VARCHAR(12) NOT NULL
    CHECK (status IN ('present', 'absent', 'tardy', 'excused')),
  remarks VARCHAR(255),
  recorded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subject_attendance_unique
    UNIQUE (enrollment_id, subject_id, period_no, attendance_date)
);

CREATE INDEX IF NOT EXISTS subject_attendance_section_date_idx
  ON subject_attendance (section_id, attendance_date);
CREATE INDEX IF NOT EXISTS subject_attendance_subject_date_idx
  ON subject_attendance (subject_id, attendance_date);
CREATE INDEX IF NOT EXISTS subject_attendance_learner_date_idx
  ON subject_attendance (learner_id, attendance_date);
CREATE INDEX IF NOT EXISTS subject_attendance_teacher_idx
  ON subject_attendance (recorded_by, attendance_date);

COMMENT ON TABLE subject_attendance IS
  'Source attendance captured by the subject teacher for every scheduled period. Never overwritten by adviser or SF 2 consolidation.';

-- ---------------------------------------------------------------------------
-- Submission header per section, subject, and date. The presence of a
-- submitted row tells the adviser which subject attendance is authoritative
-- and when it arrived. Reopening keeps the original timestamps for audit.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subject_attendance_submissions (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  assignment_id BIGINT REFERENCES teacher_assignments(id) ON DELETE SET NULL,
  teacher_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  attendance_date DATE NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'reopened')),
  submitted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  reopened_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reopened_at TIMESTAMPTZ,
  remarks VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT subject_attendance_submissions_unique
    UNIQUE (section_id, subject_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS subject_attendance_submissions_section_idx
  ON subject_attendance_submissions (section_id, attendance_date, status);

COMMENT ON TABLE subject_attendance_submissions IS
  'One submission per section, subject, and attendance date. Reopening is recorded rather than deleting the submission.';

-- ---------------------------------------------------------------------------
-- Adviser-validated official daily attendance. This is the record SF 2 reads.
-- It is derived from the submitted subject records, may be corrected by the
-- adviser, and is stored separately from the subject source records.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS adviser_attendance (
  id BIGSERIAL PRIMARY KEY,
  learner_id BIGINT NOT NULL REFERENCES learners(id) ON DELETE RESTRICT,
  enrollment_id BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE RESTRICT,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE RESTRICT,
  grade_level_id BIGINT NOT NULL REFERENCES grade_levels(id) ON DELETE RESTRICT,
  section_id BIGINT REFERENCES sections(id) ON DELETE SET NULL,
  attendance_date DATE NOT NULL,
  status VARCHAR(12) NOT NULL
    CHECK (status IN ('present', 'absent', 'tardy', 'excused', 'half_day')),
  source VARCHAR(24) NOT NULL DEFAULT 'subject_consolidation'
    CHECK (source IN ('subject_consolidation', 'manual')),
  subject_summary JSONB,
  remarks VARCHAR(255),
  validated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  validated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT adviser_attendance_unique UNIQUE (enrollment_id, attendance_date)
);

CREATE INDEX IF NOT EXISTS adviser_attendance_section_idx
  ON adviser_attendance (section_id, attendance_date);
CREATE INDEX IF NOT EXISTS adviser_attendance_learner_idx
  ON adviser_attendance (learner_id, attendance_date);

COMMENT ON TABLE adviser_attendance IS
  'Official daily attendance validated by the class adviser. Subject absences are consolidated per date, never multiplied.';

-- ---------------------------------------------------------------------------
-- Correction requests. A subject teacher asks the adviser to change a locked
-- source record; approval writes the new status and keeps the request.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subject_attendance_corrections (
  id BIGSERIAL PRIMARY KEY,
  subject_attendance_id BIGINT NOT NULL REFERENCES subject_attendance(id) ON DELETE CASCADE,
  requested_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  proposed_status VARCHAR(12) NOT NULL
    CHECK (proposed_status IN ('present', 'absent', 'tardy', 'excused')),
  reason TEXT NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subject_attendance_corrections_record_idx
  ON subject_attendance_corrections (subject_attendance_id, status);
CREATE INDEX IF NOT EXISTS subject_attendance_corrections_section_idx
  ON subject_attendance_corrections (requested_by, status);

-- ---------------------------------------------------------------------------
-- Generated summary snapshots. SF 2 monthly, SF 9 term, and transferred SF 10
-- attendance summaries are frozen so later source edits do not silently
-- rewrite a document the adviser already validated or issued.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_summary_snapshots (
  id BIGSERIAL PRIMARY KEY,
  scope VARCHAR(16) NOT NULL
    CHECK (scope IN ('sf2_month', 'sf9_term', 'sf10_history')),
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  section_id BIGINT REFERENCES sections(id) ON DELETE CASCADE,
  enrollment_id BIGINT REFERENCES enrollments(id) ON DELETE CASCADE,
  period_key VARCHAR(24) NOT NULL,
  payload JSONB NOT NULL,
  generated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS attendance_summary_snapshots_unique
  ON attendance_summary_snapshots (
    scope,
    school_id,
    school_year_id,
    COALESCE(section_id, 0),
    COALESCE(enrollment_id, 0),
    period_key
  );

COMMIT;
