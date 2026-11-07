-- Announcement school targeting.
-- An announcement without rows here is delivered to every school in its
-- district. Rows narrow delivery to the listed schools only. Additive and
-- idempotent: existing announcements keep their current district-wide reach.

CREATE TABLE IF NOT EXISTS announcement_schools (
  announcement_id BIGINT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (announcement_id, school_id)
);

CREATE INDEX IF NOT EXISTS announcement_schools_school_idx
  ON announcement_schools (school_id, announcement_id);
