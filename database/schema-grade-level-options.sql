-- ---------------------------------------------------------------------------
-- Administrator-managed grade level options.
--
-- The system administrator maintains this catalog. Schools keep their own
-- grade_levels rows (one per offered level) but choose the name from this
-- list instead of typing free text. Existing grade_levels rows are untouched;
-- distinct names already in use are copied into the catalog so no school
-- record becomes invalid. Catalogue rows are additive and never remove or
-- rename school records.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS grade_level_options (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(32) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 32),
  sort_order SMALLINT NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Two options may not differ only by letter case.
CREATE UNIQUE INDEX IF NOT EXISTS grade_level_options_name_key
  ON grade_level_options (lower(name));

CREATE INDEX IF NOT EXISTS grade_level_options_order_idx
  ON grade_level_options (is_active DESC, sort_order ASC, name ASC);

-- Preserve every grade level name that schools already use. Grouping on the
-- lower-case form avoids duplicates when schools capitalised a name
-- differently. The lowest existing order is kept, clamped to the API range.
INSERT INTO grade_level_options (name, sort_order)
SELECT MIN(gl.name), LEAST(GREATEST(MIN(gl.sort_order), 0), 100)
FROM grade_levels gl
WHERE btrim(gl.name) <> ''
GROUP BY lower(gl.name)
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'grade_level_options_set_updated_at'
      AND tgrelid = 'grade_level_options'::regclass
  ) THEN
    CREATE TRIGGER grade_level_options_set_updated_at
      BEFORE UPDATE ON grade_level_options
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

COMMIT;
