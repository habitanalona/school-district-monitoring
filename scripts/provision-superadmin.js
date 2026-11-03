"use strict";

// First SuperAdmin provisioning (bootstrap).
//
//   SECURITY_BOOTSTRAP_TOKEN=<16+ chars> node scripts/provision-superadmin.js \
//     --username secadmin --password 'Str0ng!Passw0rd' --name "Security Controller"
//
// Requires:
//   - SECURITY_BOOTSTRAP_TOKEN in .env (one-time, remove after use)
//   - no active SuperAdmin (bootstrap works once; deactivated test fixtures do
//     not block it)
// The TOTP secret is printed exactly once; add it to an authenticator app.

require("dotenv").config();

const superAdminService = require("../server/services/security/superAdminService");
const { pool } = require("../server/config/database");

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : null;
}

async function main() {
  const token = process.env.SECURITY_BOOTSTRAP_TOKEN;
  const username = arg("username");
  const password = arg("password");
  const fullName = arg("name");
  const email = arg("email");

  if (!username || !password || !fullName) {
    console.error("Usage: node scripts/provision-superadmin.js --username <u> --password <p> --name <n> [--email <e>]");
    console.error("SECURITY_BOOTSTRAP_TOKEN must be set in .env.");
    process.exit(1);
  }

  const result = await superAdminService.bootstrap({ token, username, password, fullName, email });
  console.log(`SuperAdmin "${result.account.username}" created (id ${result.account.id}).`);
  console.log("TOTP secret (shown once — store it in an authenticator app now):");
  console.log(`  ${result.totpSecret}`);
  console.log("\nRemove SECURITY_BOOTSTRAP_TOKEN from .env after provisioning.");
}

main()
  .catch((error) => {
    console.error("Provisioning failed:", error.message);
    process.exit(1);
  })
  .finally(() => pool.end());
