"use strict";

// Non-destructive upgrade for the Helpdesk knowledge base.
//
// Applies database/schema-helpdesk.sql and inserts the starter articles.
// Existing helpdesk categories and articles are never overwritten, so any
// edits made through the administration page survive later migrations.
// Safe to run repeatedly.

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { seedHelpdesk } = require("../server/services/helpdeskSeedService");

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is missing. Configure it in .env before migrating.");
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    const sql = fs.readFileSync(
      path.join(__dirname, "..", "database", "schema-helpdesk.sql"),
      "utf8"
    );
    console.log("Applying Helpdesk schema...");
    await client.query(sql);

    console.log("Loading starter Helpdesk content...");
    const stats = await seedHelpdesk(client);
    console.log(
      `Helpdesk ready: ${stats.categories} new categor(ies), ${stats.articles} new article(s); ` +
        `${stats.skippedCategories} existing categor(ies) and ${stats.skippedArticles} existing article(s) preserved.`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Helpdesk migration failed:", error.message);
  process.exit(1);
});
