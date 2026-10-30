-- ---------------------------------------------------------------------------
-- Secure school bulk import.
--
-- Additive only. The existing `schools` table remains the single source of
-- truth and is never duplicated, renamed, or truncated. This table stores the
-- server-validated preview, the final summary, and the error report data for a
-- short-lived confirmation window so the browser cannot submit records that
-- the server did not validate.
--
-- No spreadsheet cell is ever turned into SQL. Valid rows are inserted with
-- parameterized statements, scoped to a district the actor may manage.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS school_import_batches (
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

CREATE INDEX IF NOT EXISTS school_import_batches_user_idx
  ON school_import_batches (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS school_import_batches_pending_idx
  ON school_import_batches (expires_at)
  WHERE status = 'previewed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'school_import_batches_set_updated_at'
      AND tgrelid = 'school_import_batches'::regclass
  ) THEN
    CREATE TRIGGER school_import_batches_set_updated_at
      BEFORE UPDATE ON school_import_batches
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

COMMIT;
