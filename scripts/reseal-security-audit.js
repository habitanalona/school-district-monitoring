"use strict";

// Recomputes the security audit hash chain with the canonical hashing scheme.
// Row contents are preserved; only previous_hash/entry_hash are rewritten.
// This exists because the first implementation hashed JSON with insertion
// order and raw target-id types, which JSONB storage does not preserve.
// Run once after upgrading, then confirm with:
//   GET /api/security/audit-logs/verify

require("dotenv").config();

const securityAudit = require("../server/services/security/securityAuditService");
const { pool } = require("../server/config/database");

async function main() {
  const result = await securityAudit.resealChain();
  const verify = await securityAudit.verifyChain();
  console.log(
    `Audit chain resealed: ${result.entries} entries inspected, ${result.updated} hash links rewritten.`
  );
  console.log(verify.intact ? "Verification: intact." : `Verification: BROKEN at id ${verify.brokenAtId}.`);
  await pool.end();
  if (!verify.intact) {
    process.exit(1);
  }
}

main().catch(async (error) => {
  console.error("Audit reseal failed:", error.message);
  try {
    await pool.end();
  } catch (closeError) {
    // ignore
  }
  process.exit(1);
});
