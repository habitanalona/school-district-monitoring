"use strict";

const app = require("./app");
const config = require("./config/env");
const { pool, runSecurityWrite } = require("./config/database");
const { ensurePermissionCatalog } = require("./services/permissionService");
const firewallService = require("./services/security/firewallService");
const monitoringWorker = require("./services/security/monitoringWorker");

let server;

async function start() {
  try {
    await pool.query("SELECT 1");
    // Keeps the permission catalog and role defaults in sync without touching
    // administrator-made overrides (ON CONFLICT DO NOTHING for role defaults).
    // Boot-time maintenance runs in the security execution context so schema
    // housekeeping is not mistaken for an application write.
    await runSecurityWrite(() => ensurePermissionCatalog());
  } catch (error) {
    console.error("Unable to prepare PostgreSQL:", error.message);
    console.error("Check DATABASE_URL in .env and run `npm run db:init` to apply the schema.");
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

  // Security module warm-up: load switch state, then start the 24/7
  // monitoring worker (health probes, code integrity scans, retention).
  await firewallService.refreshCache();
  monitoringWorker.start();
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
