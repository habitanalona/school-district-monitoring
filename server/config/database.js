"use strict";

const { Pool } = require("pg");
const config = require("./env");

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: Number.parseInt(process.env.PG_POOL_MAX, 10) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : false
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error:", error.message);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function getClient() {
  return pool.connect();
}

module.exports = { pool, query, getClient };
