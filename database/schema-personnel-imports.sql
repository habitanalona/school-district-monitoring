-- ---------------------------------------------------------------------------
-- Secure staff bulk import (school heads, teachers, non-teaching personnel).
--
-- Additive only. `personnel_profiles` and `users` remain the single source of
-- truth. This table holds the server-validated preview for a short-lived
-- confirmation window so the browser cannot submit records the server did not
-- validate. Activation tokens are never stored here: only their SHA-256 hash
-- is written to password_reset_tokens, and the raw link is returned once.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS personnel_import_batches (
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

CREATE INDEX IF NOT EXISTS personnel_import_batches_user_idx
  ON personnel_import_batches (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS personnel_import_batches_pending_idx
  ON personnel_import_batches (expires_at)
  WHERE status = 'previewed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'personnel_import_batches_set_updated_at'
      AND tgrelid = 'personnel_import_batches'::regclass
  ) THEN
    CREATE TRIGGER personnel_import_batches_set_updated_at
      BEFORE UPDATE ON personnel_import_batches
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

COMMIT;
