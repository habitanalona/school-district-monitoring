-- School logo support.
--
-- The logo image itself is stored in the private upload directory configured by
-- SCHOOL_LOGO_DIR (default: storage/school-logos). PostgreSQL keeps only the
-- relative file reference, so the column is nullable and existing school rows
-- are untouched. Safe to run repeatedly.

BEGIN;

ALTER TABLE schools ADD COLUMN IF NOT EXISTS school_logo VARCHAR(500) NULL;

COMMENT ON COLUMN schools.school_logo IS
  'Relative path to the school logo inside the private school-logo storage directory. NULL when the school has no logo.';

COMMIT;
