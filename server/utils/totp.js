"use strict";

// Minimal RFC 6238 TOTP (SHA-1, 30 s steps, 6 digits) built on node:crypto.
// No external dependency so the security module keeps a small audit surface.

const crypto = require("crypto");

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function generateSecret(length = 32) {
  const bytes = crypto.randomBytes(length);
  let bits = "";
  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, "0");
  }
  let secret = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    secret += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return secret;
}

function base32Decode(secret) {
  const clean = String(secret || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) {
      continue;
    }
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secretBuffer, counter, digits = 6) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", secretBuffer).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(code % 10 ** digits).padStart(digits, "0");
}

function totp(secret, { timestamp = Date.now(), stepSeconds = 30, window = 0, digits = 6 } = {}) {
  const counter = Math.floor(timestamp / 1000 / stepSeconds);
  return hotp(base32Decode(secret), counter, digits);
}

function verifyTotp(secret, token, { timestamp = Date.now(), stepSeconds = 30, window = 1, digits = 6 } = {}) {
  const submitted = String(token || "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(submitted)) {
    return false;
  }
  const counter = Math.floor(timestamp / 1000 / stepSeconds);
  for (let offset = -window; offset <= window; offset += 1) {
    if (crypto.timingSafeEqual(Buffer.from(hotp(base32Decode(secret), counter + offset, digits)), Buffer.from(submitted))) {
      return true;
    }
  }
  return false;
}

module.exports = { generateSecret, verifyTotp, totp };
