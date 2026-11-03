"use strict";

// 24/7 background monitoring worker. Runs inside the application process so
// monitoring continues whether or not anyone has a browser open. Responsibilities:
//   - switch-state cache refresh (source of truth stays the database)
//   - health probes persisted to system_health_records (DB latency, worker alive)
//   - scheduled code integrity verification
//   - retention pruning for high-volume monitoring tables
//   - fail-safe: probe failures raise MONITORING_DEGRADED alerts instead of
//     failing silently; the ring buffer keeps events readable during DB trouble.
//
// Architectural note: a process-level worker is the strongest isolation
// available inside this codebase (the spec asks for independence from the
// main application). A separately supervised worker service is documented as
// a hardening step in docs/security-module/REQUIREMENTS.md.

const { pool, query, runWorkerWrite } = require("../../config/database");
const guardState = require("./guardState");
const firewallService = require("./firewallService");
const codeIntegrityService = require("./codeIntegrityService");
const securityEvents = require("./securityEventService");

const HEALTH_INTERVAL_MS = Number(process.env.SECURITY_HEALTH_INTERVAL_MS) || 30 * 1000;
const CODE_SCAN_INTERVAL_MS = Number(process.env.SECURITY_CODE_SCAN_INTERVAL_MS) || 5 * 60 * 1000;
const RETENTION_DAYS = Number(process.env.SECURITY_RETENTION_DAYS) || 30;

let healthTimer = null;
let codeTimer = null;
let pruneTimer = null;
let bootTimer = null;
let startedAt = null;
let lastHealthAt = null;
let consecutiveFailures = 0;

function uptimeSeconds() {
  return startedAt ? Math.floor((Date.now() - startedAt.getTime()) / 1000) : 0;
}

async function recordHealth(checkName, status, latencyMs, message, details = {}) {
  await runWorkerWrite(() =>
    query(
      `INSERT INTO system_health_records (check_name, status, latency_ms, message, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [checkName, status, latencyMs, message, JSON.stringify(details)]
    )
  );
}

async function probeDatabase() {
  const started = Date.now();
  try {
    await pool.query("SELECT 1");
    const latency = Date.now() - started;
    await recordHealth("database", latency > 2000 ? "degraded" : "healthy", latency, "SELECT 1 probe");
    consecutiveFailures = 0;
  } catch (error) {
    await recordHealth("database", "down", Date.now() - started, error.message);
    consecutiveFailures += 1;
    if (consecutiveFailures === 3) {
      await securityEvents.alert({
        severity: "critical",
        title: "DATABASE_DOWN",
        message: "Database health probe has failed 3 consecutive times."
      });
    }
  }
}

async function heartbeat() {
  lastHealthAt = new Date();
  await recordHealth("security_worker", "healthy", null, "worker alive", {
    uptimeSeconds: uptimeSeconds(),
    switches: guardState.getSnapshot()
  });
}

async function pruneRetention() {
  await runWorkerWrite(() =>
    query(
      `DELETE FROM system_health_records WHERE created_at < now() - ($1 || ' days')::interval`,
      [String(RETENTION_DAYS)]
    )
  );
  await runWorkerWrite(() =>
    query(
      `DELETE FROM database_activity_logs WHERE created_at < now() - ($1 || ' days')::interval AND decision = 'allowed'`,
      [String(Math.min(RETENTION_DAYS, 7))]
    )
  );
}

async function runCodeScan() {
  try {
    const report = await codeIntegrityService.verify({ source: "worker" });
    await recordHealth("code_integrity", report.status === "verified" ? "healthy" : "degraded", null, report.status, {
      changes: report.changes.length
    });
  } catch (error) {
    await recordHealth("code_integrity", "unknown", null, error.message);
    await securityEvents.alert({
      severity: "high",
      title: "CODE_SCAN_ERROR",
      message: `Scheduled code integrity scan failed: ${error.message}`
    });
  }
}

function start() {
  if (healthTimer || codeTimer) {
    return;
  }
  startedAt = new Date();

  firewallService.refreshCache().catch(() => {});

  healthTimer = setInterval(async () => {
    try {
      await firewallService.refreshCache();
      await probeDatabase();
      await heartbeat();
    } catch (error) {
      console.error("Monitoring worker health cycle failed:", error.message);
    }
  }, HEALTH_INTERVAL_MS);

  codeTimer = setInterval(() => {
    runCodeScan().catch((error) => console.error("Code scan cycle failed:", error.message));
  }, CODE_SCAN_INTERVAL_MS);

  // First scans shortly after boot so the dashboard has data quickly.
  bootTimer = setTimeout(() => {
    probeDatabase().catch(() => {});
    heartbeat().catch(() => {});
    runCodeScan().catch(() => {});
  }, 3000);

  // Daily retention pruning.
  pruneTimer = setInterval(
    () => pruneRetention().catch((error) => console.error("Retention pruning failed:", error.message)),
    24 * 60 * 60 * 1000
  );

  if (healthTimer.unref) healthTimer.unref();
  if (codeTimer.unref) codeTimer.unref();
  if (pruneTimer.unref) pruneTimer.unref();
  if (bootTimer.unref) bootTimer.unref();
}

function stop() {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
  if (codeTimer) {
    clearInterval(codeTimer);
    codeTimer = null;
  }
  if (pruneTimer) {
    clearInterval(pruneTimer);
    pruneTimer = null;
  }
  if (bootTimer) {
    clearTimeout(bootTimer);
    bootTimer = null;
  }
}

function status() {
  return {
    running: Boolean(healthTimer),
    startedAt,
    lastHealthAt,
    uptimeSeconds: uptimeSeconds(),
    intervals: { healthMs: HEALTH_INTERVAL_MS, codeScanMs: CODE_SCAN_INTERVAL_MS },
    retentionDays: RETENTION_DAYS,
    consecutiveFailures
  };
}

module.exports = { start, stop, status };
