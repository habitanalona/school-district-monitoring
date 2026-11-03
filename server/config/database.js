"use strict";

const { Pool } = require("pg");
const config = require("./env");
const dbGuard = require("../services/security/dbGuard");
const guardState = require("../services/security/guardState");

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

dbGuard.initGuard(pool);

// Every statement goes through the security write guard. Reads pass straight
// through; writes are classified and decided against the firewall switches.
async function query(text, params) {
  return dbGuard.guardQuery(() => pool.query(text, params), { text, params });
}

// Checked-out clients keep their guarded query for as long as pg reuses the
// client, so wrap exactly once and keep both calling conventions: services
// await the promise, while pg-pool's own pool.query() re-checks a client out
// and passes a (err, result) callback. Dropping that callback leaves the pool
// waiting forever.
function wrapClientQuery(client) {
  if (client.__guardWrapped) {
    return client;
  }
  const rawQuery = client.query.bind(client);
  client.query = function guardedClientQuery(text, values, callback) {
    if (typeof values === "function") {
      callback = values;
      values = undefined;
    }
    const execute = () =>
      new Promise((resolve, reject) => {
        rawQuery(text, values, (error, result) => {
          if (error) {
            reject(error);
          } else {
            resolve(result);
          }
        });
      });
    const guarded = dbGuard.guardQuery(execute, { text, params: values });
    if (typeof callback === "function") {
      guarded.then(
        (result) => callback(null, result),
        (error) => callback(error)
      );
      return undefined;
    }
    return guarded;
  };
  client.__guardWrapped = true;
  return client;
}

async function getClient() {
  return wrapClientQuery(await pool.connect());
}

// Run database writes as the security module itself (auditing, events, switch
// state). Uses the raw pool so the module's own bookkeeping can never be
// blocked by the switch it maintains — and every such write is still recorded
// by the guard as INTERNAL_SOURCE.
async function runSecurityWrite(fn) {
  return guardState.runWithContext(
    { source: "security", actor: "security-module", authenticated: true },
    fn
  );
}

async function runWorkerWrite(fn) {
  return guardState.runWithContext(
    { source: "worker", actor: "security-worker", authenticated: true },
    fn
  );
}

module.exports = { pool, query, getClient, runSecurityWrite, runWorkerWrite };
