"use strict";

// Shared in-memory state for the security module.
//
// - switchCache: replica of firewall_settings so the DB write guard can make
//   decisions without querying the database on every statement (and so the
//   guard keeps working when the database is under attack). firewallService
//   invalidates it on every change.
// - AsyncLocalStorage: carries the execution context (who/what is running a
//   SQL statement) from HTTP middleware or security workers down to the guard.

const { AsyncLocalStorage } = require("async_hooks");

const als = new AsyncLocalStorage();

const SECURITY_TABLES = new Set([
  "superadmin_users",
  "firewall_settings",
  "firewall_control_history",
  "security_events",
  "security_incidents",
  "security_audit_logs",
  "database_activity_logs",
  "code_integrity_records",
  "security_baselines",
  "file_upload_security_logs",
  "system_health_records",
  "security_alerts",
  "backup_records",
  "recovery_sessions",
  "approved_maintenance_sessions"
]);

const state = {
  switches: {
    db_write_protection: false,
    code_write_protection: false,
    maintenance_mode: false,
    security_lockdown: false
  },
  initialized: false,
  // When true the guard cannot confirm switch state and must fail closed.
  degraded: false
};

function setSwitch(key, enabled) {
  if (Object.prototype.hasOwnProperty.call(state.switches, key)) {
    state.switches[key] = Boolean(enabled);
  }
}

function getSwitch(key) {
  return Boolean(state.switches[key]);
}

function getSnapshot() {
  return { ...state.switches };
}

function runWithContext(context, fn) {
  return als.run({ ...context }, fn);
}

function getContext() {
  return als.getStore() || null;
}

module.exports = {
  als,
  SECURITY_TABLES,
  state,
  setSwitch,
  getSwitch,
  getSnapshot,
  runWithContext,
  getContext
};
