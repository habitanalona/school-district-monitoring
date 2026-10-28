"use strict";

const app = require("./app");
const config = require("./config/env");
const { pool } = require("./config/database");

let server;

async function start() {
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    console.error("Unable to connect to PostgreSQL:", error.message);
    console.error("Check DATABASE_URL in .env and confirm the database has been initialized.");
    process.exit(1);
  }

  if (config.isProduction && !config.trustProxy) {
    console.warn(
      "TRUST_PROXY is not set. Behind a TLS-terminating proxy such as Render, " +
        "secure session cookies will not be issued and every sign-in will fail " +
        "with CSRF_INVALID. Set TRUST_PROXY=1 on the host."
    );
  }

  server = app.listen(config.port, () => {
    console.log(`${config.appName} v${config.appVersion}`);
    console.log(`Server running at http://localhost:${config.port}`);
    console.log(`Environment: ${config.nodeEnv}`);
  });
}

async function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down...`);
  if (server) {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  } else {
    await pool.end();
    process.exit(0);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start();
