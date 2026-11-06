"use strict";

// Outbound email through Mailgun's HTTP API. Render blocks outbound SMTP
// ports, so messages go to the HTTPS endpoint instead of an SMTP relay.

const config = require("../config/env");

const SEND_TIMEOUT_MS = 10000;

function isConfigured() {
  return Boolean(config.mailgunApiKey && config.mailgunDomain);
}

function fromAddress() {
  return config.mailgunFrom || `${config.appName} <no-reply@${config.mailgunDomain}>`;
}

function messagesEndpoint() {
  const host = config.mailgunRegion === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
  return `https://${host}/v3/${encodeURIComponent(config.mailgunDomain)}/messages`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendMessage({ to, subject, text, html }) {
  if (!isConfigured()) {
    throw new Error("Mailgun is not configured (MAILGUN_API_KEY, MAILGUN_DOMAIN).");
  }

  const payload = new URLSearchParams({ from: fromAddress(), to, subject, text });
  if (html) {
    payload.set("html", html);
  }

  const response = await fetch(messagesEndpoint(), {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${config.mailgunApiKey}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: payload,
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
  });

  if (!response.ok) {
    const detail = await response
      .text()
      .catch(() => "")
      .then((value) => value.replace(/\s+/g, " ").slice(0, 300));
    throw new Error(`Mailgun rejected the message (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  return response;
}

async function sendPasswordReset({ to, resetUrl, expiresAt }) {
  const minutes = config.resetTokenMinutes;
  const expires = expiresAt instanceof Date ? expiresAt.toISOString() : String(expiresAt);
  const subject = `${config.appName} password reset`;

  const text = [
    "A password reset was requested for your account.",
    "",
    "Open this link to choose a new password:",
    resetUrl,
    "",
    `The link can be used once and expires ${expires} (${minutes} minutes from the request).`,
    "If you did not request this, you can ignore this email; your password stays the same."
  ].join("\n");

  const html = [
    "<p>A password reset was requested for your account.</p>",
    `<p><a href="${escapeHtml(resetUrl)}">Choose a new password</a></p>`,
    `<p>The link can be used once and expires ${escapeHtml(expires)} (${minutes} minutes from the request).</p>`,
    "<p>If you did not request this, you can ignore this email; your password stays the same.</p>"
  ].join("");

  return sendMessage({ to, subject, text, html });
}

module.exports = {
  isConfigured,
  sendMessage,
  sendPasswordReset
};
