-- ---------------------------------------------------------------------------
-- DepEd Class Record -> Subject Teacher -> Class Adviser -> SF 9 workflow.
--
-- Additive only. Existing learners, enrollments, sections, subjects,
-- assignments, grade_records, report_cards, and school forms are reused.
-- Every statement is idempotent and safe to run against a live database.
--
-- The built-in class record template is a working configuration, not an
-- official DepEd template. Assessment weights start unconfigured (NULL) on an
-- upgraded database; an administrator must enter the values from the current
-- official policy before grades can be computed or submitted. The fictional
-- demonstration seed supplies clearly-labelled sample weights only.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- Curriculum catalog and versions. A version can be tied to a school year and
-- carries a verification flag/source note so the UI never presents an
-- unverified configuration as official.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS curricula (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS curriculum_versions (
  id BIGSERIAL PRIMARY KEY,
  curriculum_id BIGINT NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
  version_code VARCHAR(32) NOT NULL,
  name VARCHAR(160) NOT NULL,
  school_year_id BIGINT REFERENCES school_years(id) ON DELETE SET NULL,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  source_note TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT curriculum_versions_unique UNIQUE (curriculum_id, version_code)
);

CREATE INDEX IF NOT EXISTS curriculum_versions_year_idx
  ON curriculum_versions (school_year_id, is_active);

ALTER TABLE sections
  ADD COLUMN IF NOT EXISTS curriculum_version_id BIGINT
  REFERENCES curriculum_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS sections_curriculum_idx
  ON sections (curriculum_version_id);

-- ---------------------------------------------------------------------------
-- Class record templates. `config` holds the assessment components, their
-- weights, the rounding rule, and an optional transmutation table. A NULL
-- weight means the school has not configured that component yet.
--
-- Example config:
-- {
--   "components": [
--     {"key": "ww", "label": "Written Work", "weight": null},
--     {"key": "pt", "label": "Performance Tasks", "weight": null},
--     {"key": "qa", "label": "Quarterly Assessment", "weight": null}
--   ],
--   "rounding": "two_decimals",
--   "transmutation": {"mode": "none"},
--   "note": "..."
-- }
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_record_templates (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT REFERENCES schools(id) ON DELETE CASCADE,
  curriculum_version_id BIGINT REFERENCES curriculum_versions(id) ON DELETE SET NULL,
  grade_level_id BIGINT REFERENCES grade_levels(id) ON DELETE CASCADE,
  subject_id BIGINT REFERENCES subjects(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  version VARCHAR(32) NOT NULL DEFAULT 'system-1',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_official BOOLEAN NOT NULL DEFAULT FALSE,
  source_note TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE class_record_templates
  ADD COLUMN IF NOT EXISTS school_id BIGINT REFERENCES schools(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS class_record_templates_unique;
CREATE UNIQUE INDEX IF NOT EXISTS class_record_templates_unique
  ON class_record_templates (
    COALESCE(school_id, 0),
    COALESCE(curriculum_version_id, 0),
    COALESCE(grade_level_id, 0),
    COALESCE(subject_id, 0),
    version
  );

CREATE INDEX IF NOT EXISTS class_record_templates_lookup_idx
  ON class_record_templates (school_id, is_active, grade_level_id, subject_id);

-- ---------------------------------------------------------------------------
-- One class record per school year, section, and subject. The record is owned
-- by the assigned subject teacher but remains readable to the section adviser,
-- school head, and authorized administrators. Scores and submissions are
-- period-specific so a returned quarter can be corrected without disturbing
-- an accepted quarter.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS class_records (
  id BIGSERIAL PRIMARY KEY,
  assignment_id BIGINT REFERENCES teacher_assignments(id) ON DELETE SET NULL,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
  subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  teacher_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  template_id BIGINT REFERENCES class_record_templates(id) ON DELETE SET NULL,
  curriculum_version_id BIGINT REFERENCES curriculum_versions(id) ON DELETE SET NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'in_progress', 'ready_for_submission', 'submitted',
      'under_review', 'returned', 'accepted', 'finalized'
    )),
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT class_records_scope_unique UNIQUE (school_year_id, section_id, subject_id)
);

CREATE INDEX IF NOT EXISTS class_records_teacher_idx
  ON class_records (teacher_id, school_year_id);
CREATE INDEX IF NOT EXISTS class_records_section_idx
  ON class_records (section_id, school_year_id);
CREATE INDEX IF NOT EXISTS class_records_school_idx
  ON class_records (school_id, school_year_id);

CREATE TABLE IF NOT EXISTS class_record_assessments (
  id BIGSERIAL PRIMARY KEY,
  class_record_id BIGINT NOT NULL REFERENCES class_records(id) ON DELETE CASCADE,
  period VARCHAR(8) NOT NULL CHECK (period IN ('q1', 'q2', 'q3', 'q4')),
  component_key VARCHAR(24) NOT NULL,
  title VARCHAR(160) NOT NULL,
  max_score NUMERIC(8,2) NOT NULL CHECK (max_score > 0),
  assessment_date DATE,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS class_record_assessments_record_idx
  ON class_record_assessments (class_record_id, period, component_key, sort_order);

CREATE TABLE IF NOT EXISTS class_record_scores (
  id BIGSERIAL PRIMARY KEY,
  assessment_id BIGINT NOT NULL REFERENCES class_record_assessments(id) ON DELETE CASCADE,
  class_record_id BIGINT NOT NULL REFERENCES class_records(id) ON DELETE CASCADE,
  enrollment_id BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  learner_id BIGINT NOT NULL REFERENCES learners(id) ON DELETE RESTRICT,
  score NUMERIC(8,2) CHECK (score IS NULL OR score >= 0),
  encoded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT class_record_scores_unique UNIQUE (assessment_id, enrollment_id)
);

CREATE INDEX IF NOT EXISTS class_record_scores_record_idx
  ON class_record_scores (class_record_id, enrollment_id);
CREATE INDEX IF NOT EXISTS class_record_scores_learner_idx
  ON class_record_scores (learner_id);

-- DB-level guard against a score greater than the assessment maximum. The
-- application checks this first for a friendly message; the trigger protects
-- against any other writer.
CREATE OR REPLACE FUNCTION validate_class_record_score()
RETURNS TRIGGER AS $$
DECLARE
  maximum NUMERIC;
BEGIN
  SELECT max_score INTO maximum FROM class_record_assessments WHERE id = NEW.assessment_id;
  IF maximum IS NULL THEN
    RAISE EXCEPTION 'Assessment % does not exist', NEW.assessment_id;
  END IF;
  IF NEW.score IS NOT NULL AND NEW.score > maximum THEN
    RAISE EXCEPTION 'Score % exceeds the maximum % for assessment %',
      NEW.score, maximum, NEW.assessment_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS class_record_scores_validate ON class_record_scores;
CREATE TRIGGER class_record_scores_validate
  BEFORE INSERT OR UPDATE OF score, assessment_id ON class_record_scores
  FOR EACH ROW EXECUTE FUNCTION validate_class_record_score();

-- Persisted calculation for one learner and one quarter. `components` keeps
-- the per-component totals and percentages; `calculation` keeps the weights,
-- rounding, transmutation, and missing-field detail used at compute time.
CREATE TABLE IF NOT EXISTS class_record_grades (
  id BIGSERIAL PRIMARY KEY,
  class_record_id BIGINT NOT NULL REFERENCES class_records(id) ON DELETE CASCADE,
  enrollment_id BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  learner_id BIGINT NOT NULL REFERENCES learners(id) ON DELETE RESTRICT,
  period VARCHAR(8) NOT NULL CHECK (period IN ('q1', 'q2', 'q3', 'q4')),
  components JSONB NOT NULL DEFAULT '[]'::jsonb,
  initial_grade NUMERIC(5,2),
  quarterly_grade NUMERIC(5,2),
  status VARCHAR(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'accepted', 'finalized')),
  calculation JSONB NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ,
  computed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT class_record_grades_unique UNIQUE (class_record_id, enrollment_id, period)
);

CREATE INDEX IF NOT EXISTS class_record_grades_learner_idx
  ON class_record_grades (learner_id, period);

-- ---------------------------------------------------------------------------
-- Grade submissions: one per class record and quarter. Items are an immutable
-- snapshot of the values submitted for adviser review. Reviews preserve the
-- correction history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS grade_submissions (
  id BIGSERIAL PRIMARY KEY,
  class_record_id BIGINT NOT NULL REFERENCES class_records(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE RESTRICT,
  school_year_id BIGINT NOT NULL REFERENCES school_years(id) ON DELETE RESTRICT,
  section_id BIGINT NOT NULL REFERENCES sections(id) ON DELETE RESTRICT,
  subject_id BIGINT NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
  teacher_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  adviser_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  period VARCHAR(8) NOT NULL CHECK (period IN ('q1', 'q2', 'q3', 'q4')),
  status VARCHAR(20) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('draft', 'submitted', 'under_review', 'returned', 'accepted', 'finalized')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ,
  reviewed_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT grade_submissions_unique UNIQUE (class_record_id, period)
);

CREATE INDEX IF NOT EXISTS grade_submissions_section_idx
  ON grade_submissions (section_id, school_year_id, period);
CREATE INDEX IF NOT EXISTS grade_submissions_adviser_idx
  ON grade_submissions (adviser_id, status);

CREATE TABLE IF NOT EXISTS grade_submission_items (
  id BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL REFERENCES grade_submissions(id) ON DELETE CASCADE,
  enrollment_id BIGINT NOT NULL REFERENCES enrollments(id) ON DELETE CASCADE,
  learner_id BIGINT NOT NULL REFERENCES learners(id) ON DELETE RESTRICT,
  quarterly_grade NUMERIC(5,2) CHECK (quarterly_grade IS NULL OR quarterly_grade BETWEEN 0 AND 100),
  initial_grade NUMERIC(5,2),
  breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT grade_submission_items_unique UNIQUE (submission_id, enrollment_id)
);

CREATE INDEX IF NOT EXISTS grade_submission_items_learner_idx
  ON grade_submission_items (learner_id);

CREATE TABLE IF NOT EXISTS grade_submission_reviews (
  id BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL REFERENCES grade_submissions(id) ON DELETE CASCADE,
  action VARCHAR(20) NOT NULL
    CHECK (action IN ('submitted', 'resubmitted', 'returned', 'accepted', 'finalized', 'reopened')),
  comments TEXT,
  actor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS grade_submission_reviews_submission_idx
  ON grade_submission_reviews (submission_id, created_at);

-- ---------------------------------------------------------------------------
-- Traceability from legacy grade_records back to the class record that
-- produced them, and from report cards to the template/snapshot used.
-- ---------------------------------------------------------------------------
ALTER TABLE grade_records
  ADD COLUMN IF NOT EXISTS class_record_id BIGINT REFERENCES class_records(id) ON DELETE SET NULL;
ALTER TABLE grade_records
  ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS grade_records_class_record_idx
  ON grade_records (class_record_id);

ALTER TABLE report_cards
  ADD COLUMN IF NOT EXISTS template_id BIGINT REFERENCES form_templates(id) ON DELETE SET NULL;
ALTER TABLE report_cards
  ADD COLUMN IF NOT EXISTS snapshot JSONB;
ALTER TABLE report_cards
  ADD COLUMN IF NOT EXISTS finalized_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE report_cards
  ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
ALTER TABLE report_cards
  ADD COLUMN IF NOT EXISTS reopened_by BIGINT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE report_cards
  ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;
ALTER TABLE report_cards
  ADD COLUMN IF NOT EXISTS reopen_reason TEXT;

ALTER TABLE report_cards DROP CONSTRAINT IF EXISTS report_cards_status_check;
ALTER TABLE report_cards ADD CONSTRAINT report_cards_status_check
  CHECK (status IN ('draft', 'submitted', 'approved', 'issued', 'finalized', 'reopened'));

-- ---------------------------------------------------------------------------
-- Built-in system curriculum/template. Weights deliberately start NULL so an
-- upgraded school must enter the values from its verified policy. The demo
-- seed replaces the weights for the fictional school only.
-- ---------------------------------------------------------------------------
INSERT INTO curricula (code, name, description)
VALUES (
  'SYS',
  'System working configuration',
  'Configuration container. Curriculum versions and grading weights must be verified by the school before use.'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO curriculum_versions (curriculum_id, version_code, name, is_verified, source_note)
SELECT c.id, 'system-1', 'System working version (unverified)', FALSE,
       'Pending verification against the current DepEd curriculum and grading policy.'
FROM curricula c
WHERE c.code = 'SYS'
ON CONFLICT (curriculum_id, version_code) DO NOTHING;

INSERT INTO class_record_templates
  (curriculum_version_id, grade_level_id, subject_id, name, version, is_official, source_note, config)
SELECT cv.id, NULL, NULL, 'System working class record', 'system-1', FALSE,
       'System layout pending verification. Enter the assessment weights from the school''s approved policy before submitting grades.',
       '{"components":[{"key":"ww","label":"Written Work","weight":null},{"key":"pt","label":"Performance Tasks","weight":null},{"key":"qa","label":"Quarterly Assessment","weight":null}],"rounding":"two_decimals","transmutation":{"mode":"none"},"note":"Weights unconfigured."}'::jsonb
FROM curriculum_versions cv
JOIN curricula c ON c.id = cv.curriculum_id AND c.code = 'SYS'
WHERE cv.version_code = 'system-1'
ON CONFLICT DO NOTHING;

-- Existing sections inherit the system working version when no curriculum has
-- been assigned. This is metadata only and does not change learner records.
UPDATE sections
SET curriculum_version_id = (
  SELECT cv.id FROM curriculum_versions cv
  JOIN curricula c ON c.id = cv.curriculum_id
  WHERE c.code = 'SYS' AND cv.version_code = 'system-1'
)
WHERE curriculum_version_id IS NULL;

-- ---------------------------------------------------------------------------
-- updated_at triggers.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'curricula', 'curriculum_versions', 'class_record_templates',
    'class_records', 'class_record_assessments', 'class_record_scores',
    'class_record_grades', 'grade_submissions'
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
