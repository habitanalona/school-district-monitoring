-- ---------------------------------------------------------------------------
-- Secure learner profile bulk import.
--
-- Additive only. `learners` remains the single source of truth. This table
-- holds the server-validated preview for a short-lived confirmation window.
-- The import writes permanent learner profiles only; it never creates
-- enrollments, guardians, grades, attendance, health, or form submissions.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS learner_import_batches (
  id BIGSERIAL PRIMARY KEY,
  token VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL DEFAULT 'previewed'
    CHECK (status IN ('previewed', 'committed', 'failed', 'expired')),
  files JSONB NOT NULL DEFAULT '[]'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  valid_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL,
  committed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learner_import_batches_user_idx
  ON learner_import_batches (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS learner_import_batches_pending_idx
  ON learner_import_batches (expires_at)
  WHERE status = 'previewed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'learner_import_batches_set_updated_at'
      AND tgrelid = 'learner_import_batches'::regclass
  ) THEN
    CREATE TRIGGER learner_import_batches_set_updated_at
      BEFORE UPDATE ON learner_import_batches
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

COMMIT;
