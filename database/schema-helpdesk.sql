-- ---------------------------------------------------------------------------
-- Helpdesk knowledge base.
--
-- The Helpdesk is an additive module: it explains how the installed system
-- actually works. Nothing here changes existing tables, permissions, forms, or
-- workflows. Categories and articles are maintained by authorised
-- administrators and are served read-only to every page through the floating
-- Helpdesk panel.
--
-- The starter content is inserted by scripts/migrate-helpdesk.js with
-- ON CONFLICT DO NOTHING, so an administrator's later edits are never
-- overwritten by re-running the migration.
-- ---------------------------------------------------------------------------

BEGIN;

CREATE TABLE IF NOT EXISTS helpdesk_categories (
  id BIGSERIAL PRIMARY KEY,
  slug VARCHAR(80) NOT NULL CHECK (slug ~ '^[a-z0-9-]{2,80}$'),
  title VARCHAR(120) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 120),
  description VARCHAR(400) NOT NULL DEFAULT '',
  icon VARCHAR(40) NOT NULL DEFAULT 'bi-question-circle'
    CHECK (icon ~ '^bi-[a-z0-9-]{1,36}$'),
  sort_order SMALLINT NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 999),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  -- Removed categories keep their slug so the seed migration cannot recreate
  -- content an administrator deliberately deleted.
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Upgrade-safe columns for installations created before the soft-removal
-- fields were introduced.
ALTER TABLE helpdesk_categories
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS helpdesk_categories_slug_key
  ON helpdesk_categories (lower(slug));

CREATE INDEX IF NOT EXISTS helpdesk_categories_order_idx
  ON helpdesk_categories (is_active DESC, sort_order ASC, title ASC)
  WHERE is_deleted = FALSE;

CREATE TABLE IF NOT EXISTS helpdesk_articles (
  id BIGSERIAL PRIMARY KEY,
  category_id BIGINT NOT NULL REFERENCES helpdesk_categories (id) ON DELETE RESTRICT,
  slug VARCHAR(100) NOT NULL CHECK (slug ~ '^[a-z0-9-]{3,100}$'),
  title VARCHAR(140) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 140),
  summary VARCHAR(300) NOT NULL CHECK (char_length(btrim(summary)) BETWEEN 10 AND 300),
  body TEXT NOT NULL DEFAULT '',
  article_type VARCHAR(16) NOT NULL DEFAULT 'article'
    CHECK (article_type IN ('article', 'faq', 'procedure', 'reference')),
  steps JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(steps) = 'array'),
  notes JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(notes) = 'array'),
  keywords TEXT[] NOT NULL DEFAULT '{}',
  page_paths TEXT[] NOT NULL DEFAULT '{}',
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  -- Deleting an article hides it without freeing its slug, so re-running the
  -- seed migration can never resurrect content an administrator removed.
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order SMALLINT NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 999),
  created_by BIGINT REFERENCES users (id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE helpdesk_articles
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS helpdesk_articles_slug_key
  ON helpdesk_articles (lower(slug));

CREATE INDEX IF NOT EXISTS helpdesk_articles_category_idx
  ON helpdesk_articles (category_id, sort_order ASC, title ASC);

CREATE INDEX IF NOT EXISTS helpdesk_articles_published_idx
  ON helpdesk_articles (is_published DESC, is_featured DESC, sort_order ASC)
  WHERE is_deleted = FALSE;

CREATE INDEX IF NOT EXISTS helpdesk_articles_pages_idx
  ON helpdesk_articles USING GIN (page_paths);

-- Reuse the project-wide timestamp trigger. The schema.sql helper creates the
-- triggers for tables that exist when it runs, so each new table is attached
-- here as well.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS helpdesk_categories_set_updated_at ON helpdesk_categories;
CREATE TRIGGER helpdesk_categories_set_updated_at
  BEFORE UPDATE ON helpdesk_categories
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS helpdesk_articles_set_updated_at ON helpdesk_articles;
CREATE TRIGGER helpdesk_articles_set_updated_at
  BEFORE UPDATE ON helpdesk_articles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
