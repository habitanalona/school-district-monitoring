"use strict";

// Idempotent seeding for the Helpdesk knowledge base.
//
// The starter articles are inserted once. An administrator's later edits,
// unpublishing, or deletions are never overwritten by re-running the
// migration, because existing slugs are left untouched.

const { CATEGORIES } = require("../data/helpdeskContent");

function bodyText(paragraphs) {
  return (paragraphs || []).join("\n\n").trim();
}

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

async function seedHelpdesk(runner) {
  const stats = { categories: 0, articles: 0, skippedCategories: 0, skippedArticles: 0 };

  for (const category of CATEGORIES) {
    const inserted = await runner.query(
      `INSERT INTO helpdesk_categories (slug, title, description, icon, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        category.slug,
        category.title,
        category.description || "",
        category.icon || "bi-question-circle",
        category.sortOrder || 0
      ]
    );

    let categoryId;
    if (inserted.rows.length) {
      categoryId = inserted.rows[0].id;
      stats.categories += 1;
    } else {
      const existing = await runner.query(
        "SELECT id FROM helpdesk_categories WHERE lower(slug) = lower($1)",
        [category.slug]
      );
      categoryId = existing.rows[0] && existing.rows[0].id;
      stats.skippedCategories += 1;
    }
    if (!categoryId) {
      continue;
    }

    for (const article of category.articles || []) {
      const result = await runner.query(
        `INSERT INTO helpdesk_articles
           (category_id, slug, title, summary, body, article_type,
            steps, notes, keywords, page_paths, is_featured, is_published, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::text[], $10::text[], $11, TRUE, $12)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          categoryId,
          article.slug || slugify(article.title),
          article.title,
          article.summary,
          bodyText(article.body),
          article.type || "article",
          JSON.stringify(article.steps || []),
          JSON.stringify(article.notes || []),
          article.keywords || [],
          article.pages || [],
          Boolean(article.featured),
          article.sortOrder || 0
        ]
      );
      if (result.rows.length) {
        stats.articles += 1;
      } else {
        stats.skippedArticles += 1;
      }
    }
  }

  return stats;
}

module.exports = { seedHelpdesk, slugify, bodyText };
