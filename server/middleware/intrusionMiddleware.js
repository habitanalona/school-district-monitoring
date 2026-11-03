"use strict";

// Intrusion detection: request-level indicators. Conservative patterns keep
// false positives low; detections are recorded and alerted, and repeated
// hostile signals from one IP escalate severity. Blocking of legitimate
// traffic is worse than a logged near-miss, so indicators never silently
// drop requests by themselves — enforcement stays with auth/RBAC and the
// firewall switches.

const securityEvents = require("../services/security/securityEventService");

const SQLI_RE = /(\bunion\b[\s\S]{0,40}\bselect\b)|(\bor\b\s+(?:\d+|'[^']*')\s*=\s*(?:\d+|'[^']*'))|(\band\b\s+(?:\d+|'[^']*')\s*=\s*(?:\d+|'[^']*'))|(;\s*(drop|truncate|delete|update|insert)\b)|(--[\s\S]{0,20}$)/i;
const XSS_RE = /<\s*script|on(error|load|click)\s*=|javascript\s*:|data\s*:\s*text\/html|<\s*iframe/i;
const TRAVERSAL_RE = /(\.\.[\/\\])|(%2e%2e)/i;

const ipFailures = new Map();
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const FAILURE_THRESHOLD = 5;

function prune(ip) {
  const now = Date.now();
  const entries = (ipFailures.get(ip) || []).filter((ts) => now - ts < FAILURE_WINDOW_MS);
  ipFailures.set(ip, entries);
  return entries;
}

function collectStrings(value, output = [], depth = 0) {
  if (depth > 4 || output.length > 40) {
    return output;
  }
  if (typeof value === "string") {
    output.push(value.slice(0, 400));
  } else if (value && typeof value === "object") {
    for (const key of Object.keys(value).slice(0, 30)) {
      collectStrings(value[key], output, depth + 1);
    }
  }
  return output;
}

function scanRequest(req) {
  if (!req.originalUrl || !req.originalUrl.startsWith("/api")) {
    return;
  }
  const strings = collectStrings(req.query).concat(collectStrings(req.body));
  let matched = null;
  for (const value of strings) {
    if (SQLI_RE.test(value)) {
      matched = { kind: "SQLI_INDICATOR", sample: value.slice(0, 120) };
      break;
    }
    if (XSS_RE.test(value)) {
      matched = { kind: "XSS_INDICATOR", sample: value.slice(0, 120) };
      break;
    }
    if (TRAVERSAL_RE.test(value)) {
      matched = { kind: "PATH_TRAVERSAL_INDICATOR", sample: value.slice(0, 120) };
      break;
    }
  }
  if (matched) {
    securityEvents.record({
      severity: "medium",
      category: "network",
      action: matched.kind,
      description: `Request to ${req.originalUrl} contained a ${matched.kind} pattern.`,
      username: req.user ? req.user.username : null,
      userRole: req.user ? req.user.role : null,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || null,
      requestMethod: req.method,
      endpoint: req.originalUrl,
      firewallDecision: "monitored",
      metadata: { sample: matched.sample }
    });
  }
}

function watchResponse(req, res) {
  res.on("finish", () => {
    if (res.statusCode !== 401 && res.statusCode !== 403) {
      return;
    }
    if (!req.originalUrl || !req.originalUrl.startsWith("/api")) {
      return;
    }
    const ip = req.ip || "unknown";
    const failures = prune(ip);
    failures.push(Date.now());
    if (failures.length >= FAILURE_THRESHOLD) {
      const critical = failures.length >= FAILURE_THRESHOLD * 2;
      securityEvents.record({
        severity: critical ? "critical" : "high",
        category: "auth",
        action: critical ? "REPEATED_FAILED_ACCESS_CRITICAL" : "REPEATED_FAILED_ACCESS",
        description: `${failures.length} rejected requests (${res.statusCode}) from ${ip} within 10 minutes, latest: ${req.method} ${req.originalUrl}.`,
        username: req.user ? req.user.username : null,
        ipAddress: req.ip,
        userAgent: req.get("user-agent") || null,
        requestMethod: req.method,
        endpoint: req.originalUrl,
        firewallDecision: "rejected"
      });
      ipFailures.set(ip, []);
    } else if (req.originalUrl.includes("/api/auth/login") && res.statusCode === 401) {
      securityEvents.record({
        severity: "low",
        category: "auth",
        action: "LOGIN_FAILED",
        description: `Failed sign-in attempt from ${ip}.`,
        username: req.body && req.body.username ? String(req.body.username).slice(0, 60) : null,
        ipAddress: req.ip,
        userAgent: req.get("user-agent") || null,
        requestMethod: req.method,
        endpoint: req.originalUrl,
        firewallDecision: "rejected"
      });
    }
  });
}

function intrusionDetection(req, res, next) {
  try {
    scanRequest(req);
  } catch (error) {
    console.error("Intrusion scan error:", error.message);
  }
  watchResponse(req, res);
  return next();
}

module.exports = { intrusionDetection };
