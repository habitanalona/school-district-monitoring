-- ---------------------------------------------------------------------------
-- Administrator-managed subject options.
--
-- The system administrator maintains one catalog of subject names. Schools
-- keep their own subjects (one row per school, code, and optional grade
-- level) but choose the subject name from this list instead of typing free
-- text. Existing subjects are never renamed or removed: distinct names already
-- in use are copied into the catalog so every school record stays valid.
--
-- The catalog is reference data for Kindergarten to Grade 12. An
-- administrator can add, rename, deactivate, or remove entries later; a name
-- used by a school subject cannot be removed.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS subject_options (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  sort_order SMALLINT NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Two options may not differ only by letter case.
CREATE UNIQUE INDEX IF NOT EXISTS subject_options_name_key
  ON subject_options (lower(name));

CREATE INDEX IF NOT EXISTS subject_options_order_idx
  ON subject_options (is_active DESC, sort_order ASC, name ASC);

-- Preserve every subject name that schools already use. Grouping on the
-- lower-case form avoids duplicates when schools capitalised a name
-- differently. Legacy names follow the starter catalogue so the standard
-- learning areas stay at the top of the dropdown.
INSERT INTO subject_options (name, sort_order)
SELECT MIN(sub.name), 50
FROM subjects sub
WHERE btrim(sub.name) <> ''
GROUP BY lower(sub.name)
ON CONFLICT DO NOTHING;

-- Starter catalogue for Kindergarten to Grade 12. Existing catalog names are
-- never rewritten; only missing names are added. Administrators can adjust
-- the list afterwards.
INSERT INTO subject_options (name, sort_order)
SELECT v.name, v.sort_order
FROM (VALUES
  ('Kindergarten', 0),
  ('Mother Tongue', 1),
  ('Filipino', 2),
  ('English', 3),
  ('Mathematics', 4),
  ('Science', 5),
  ('Araling Panlipunan', 6),
  ('Edukasyon sa Pagpapakatao', 7),
  ('Music', 8),
  ('Arts', 9),
  ('Physical Education', 10),
  ('Health', 11),
  ('MAPEH', 12),
  ('Edukasyong Pantahanan at Pangkabuhayan', 13),
  ('Technology and Livelihood Education', 14),
  ('Homeroom Guidance', 15),
  ('Oral Communication', 16),
  ('Reading and Writing', 17),
  ('Komunikasyon at Pananaliksik sa Wika at Kulturang Pilipino', 18),
  ('Pagbasa at Pagsusuri ng Iba''t Ibang Teksto Tungo sa Pananaliksik', 19),
  ('21st Century Literature from the Philippines and the World', 20),
  ('General Mathematics', 21),
  ('Statistics and Probability', 22),
  ('Earth and Life Science', 23),
  ('Physical Science', 24),
  ('Understanding Culture, Society and Politics', 25),
  ('Personal Development', 26),
  ('Physical Education and Health', 27),
  ('Practical Research 1', 28),
  ('Practical Research 2', 29),
  ('Media and Information Literacy', 30),
  ('Contemporary Philippine Arts from the Regions', 31),
  ('Disaster Readiness and Risk Reduction', 32),
  ('Entrepreneurship', 33),
  ('Inquiries, Investigations and Immersion', 34),
  ('Pre-Calculus', 35),
  ('Basic Calculus', 36),
  ('General Biology 1', 37),
  ('General Chemistry 1', 38),
  ('General Physics 1', 39),
  ('Philippine Politics and Governance', 40),
  ('Community Engagement, Solidarity and Citizenship', 41),
  ('Trends, Networks, and Critical Thinking in the 21st Century', 42),
  ('Creative Writing', 43),
  ('Creative Nonfiction', 44),
  ('Fundamentals of Accountancy, Business and Management 1', 45),
  ('Business Mathematics', 46),
  ('Organization and Management', 47),
  ('Principles of Marketing', 48),
  ('Empowerment Technologies', 49)
) AS v(name, sort_order)
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'subject_options_set_updated_at'
      AND tgrelid = 'subject_options'::regclass
  ) THEN
    CREATE TRIGGER subject_options_set_updated_at
      BEFORE UPDATE ON subject_options
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END;
$$;

COMMIT;
