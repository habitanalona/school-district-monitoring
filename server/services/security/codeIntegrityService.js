"use strict";

// Application code integrity monitoring.
//
// A baseline records SHA-256 hashes of the application's source files
// (server/, client/ excluding generated assets, package files). Scheduled
// verification re-hashes the tree and reports modified / missing / added
// files. Verification NEVER auto-overwrites changes: unexpected modifications
// produce a security event (critical by default) and, when code protection is
// ON, open a CRITICAL incident for investigation. Restoration is a controlled
// recovery action, not an automatic one.
//
// OS-level write prevention (immutable flags, WORM storage, restricted
// deployment keys) is documented in docs/security-module/REQUIREMENTS.md as
// the layer only the operating system can provide.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { query, runSecurityWrite, runWorkerWrite } = require("../../config/database");
const securityEvents = require("./securityEventService");
const guardState = require("./guardState");

const PROJECT_ROOT = path.join(__dirname, "..", "..", "..");
const PROTECTED_DIRS = ["server", "client/js", "client/css", "client/*.html"];
const IGNORED = new Set([
  "node_modules",
  "client/assets",
  "backups",
  "docs",
  "tests",
  "postman",
  "database",
  "scripts",
  "exports",
  ".git"
]);
const EXTENSIONS = new Set([".js", ".json", ".html", ".css", ".sql"]);

function shouldInclude(relativePath) {
  const parts = relativePath.split(path.sep);
  if (parts.some((part) => IGNORED.has(part))) {
    return false;
  }
  if (relativePath.startsWith(`client${path.sep}assets`)) {
    return false;
  }
  const base = path.basename(relativePath);
  if (base === "package-lock.json") {
    return true;
  }
  if (base === "package.json") {
    return true;
  }
  if (base.endsWith(".html") && relativePath.startsWith("client")) {
    return true;
  }
  return EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

function walk(dir, base, output = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    return output;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const relative = path.relative(base, full);
    if (entry.isDirectory()) {
      if (!IGNORED.has(entry.name) && entry.name !== "assets") {
        walk(full, base, output);
      }
    } else if (shouldInclude(relative)) {
      output.push(relative);
    }
  }
  return output;
}

function hashFile(relativePath) {
  const digest = crypto.createHash("sha256");
  digest.update(fs.readFileSync(path.join(PROJECT_ROOT, relativePath)));
  return digest.digest("hex");
}

function collectTree() {
  const files = walk(PROJECT_ROOT, PROJECT_ROOT);
  const tree = {};
  for (const relative of files) {
    try {
      const stat = fs.statSync(path.join(PROJECT_ROOT, relative));
      tree[relative.split(path.sep).join("/")] = {
        sha256: hashFile(relative),
        size: stat.size
      };
    } catch (error) {
      tree[relative.split(path.sep).join("/")] = { sha256: null, size: null, error: error.message };
    }
  }
  return tree;
}

async function createBaseline(actor) {
  const tree = collectTree();
  await runSecurityWrite(() =>
    query(
      `INSERT INTO security_baselines (name, kind, content, created_by)
       VALUES ('code-tree', 'code_tree', $1::jsonb, $2)
       ON CONFLICT (name) DO UPDATE SET content = EXCLUDED.content, created_at = now()`,
      [JSON.stringify({ files: tree, count: Object.keys(tree).length }), actor ? actor.id : null]
    )
  );

  // Refresh per-file records to the verified state.
  await runSecurityWrite(() => query("DELETE FROM code_integrity_records"));
  for (const [filePath, meta] of Object.entries(tree)) {
    await runWorkerWrite(() =>
      query(
        `INSERT INTO code_integrity_records (file_path, sha256, size_bytes, status, last_verified_at)
         VALUES ($1, $2, $3, 'verified', now())`,
        [filePath, meta.sha256, meta.size]
      )
    );
  }
  return { files: Object.keys(tree).length };
}

async function getBaseline() {
  const result = await runSecurityWrite(() =>
    query("SELECT * FROM security_baselines WHERE name = 'code-tree'")
  );
  return result.rows[0] || null;
}

// Compare the live tree against the baseline. Returns a report; unexpected
// changes also raise events/incidents according to the switches.
async function verify({ source = "worker" } = {}) {
  const baselineRow = await getBaseline();
  if (!baselineRow) {
    return { status: "no_baseline", changes: [] };
  }
  const baseline = baselineRow.content.files || {};
  const live = collectTree();

  const changes = [];
  for (const [filePath, meta] of Object.entries(baseline)) {
    if (!(filePath in live)) {
      changes.push({ filePath, status: "missing", baseline: meta.sha256, current: null, size: null });
    } else if (live[filePath].sha256 !== meta.sha256) {
      changes.push({
        filePath,
        status: "modified",
        baseline: meta.sha256,
        current: live[filePath].sha256,
        size: live[filePath].size
      });
    }
  }
  for (const [filePath, meta] of Object.entries(live)) {
    if (!(filePath in baseline)) {
      changes.push({ filePath, status: "added", baseline: null, current: meta.sha256, size: meta.size });
    }
  }

  const run = source === "worker" ? runWorkerWrite : runSecurityWrite;
  for (const change of changes) {
    await run(() =>
      query(
        `INSERT INTO code_integrity_records (file_path, sha256, size_bytes, status, last_verified_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (file_path) DO UPDATE SET sha256 = EXCLUDED.sha256, status = EXCLUDED.status, last_verified_at = now()`,
        [change.filePath, change.current, change.size === undefined ? null : change.size, change.status]
      )
    );
  }
  if (changes.length === 0) {
    await run(() => query("UPDATE code_integrity_records SET status = 'verified', last_verified_at = now() WHERE status != 'verified'"));
  }

  if (changes.length > 0) {
    const critical = guardState.getSwitch("code_write_protection");
    await securityEvents.record({
      severity: critical ? "critical" : "high",
      category: "code",
      action: critical ? "UNAUTHORIZED_CODE_MODIFICATION" : "CODE_INTEGRITY_CHANGE",
      description: `Code integrity verification found ${changes.length} unexpected change(s): ${changes
        .slice(0, 5)
        .map((change) => `${change.status}:${change.filePath}`)
        .join(", ")}${changes.length > 5 ? "…" : ""}`,
      firewallDecision: "monitored",
      metadata: { changeCount: changes.length, changes: changes.slice(0, 20) }
    });
  }

  return {
    status: changes.length === 0 ? "verified" : "changed",
    baselineAt: baselineRow.created_at,
    files: Object.keys(live).length,
    changes
  };
}

async function records({ status = null, limit = 200 } = {}) {
  const result = await runSecurityWrite(() =>
    query(
      `SELECT * FROM code_integrity_records
       WHERE ($1::text IS NULL OR status = $1)
       ORDER BY status DESC, file_path ASC LIMIT $2`,
      [status, Math.min(Number(limit) || 200, 1000)]
    )
  );
  return result.rows;
}

module.exports = { createBaseline, verify, records, getBaseline, collectTree, PROTECTED_DIRS };
