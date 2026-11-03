"use strict";

// Upload security observer. Existing upload endpoints (photos, learner
// documents, spreadsheet imports) already validate type and content; this
// module adds the centralized inspection ledger required by the firewall:
// magic-byte verification, suspicious-content detection, and a full
// file_upload_security_logs entry for every uploaded file, plus security
// events for rejected or suspicious uploads.

const { query, runSecurityWrite } = require("../../config/database");
const securityEvents = require("./securityEventService");

const SIGNATURES = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff], label: "JPEG" },
  { mime: "image/png", bytes: [0x89, 0x50, 0x4e, 0x47], label: "PNG" },
  { mime: "image/webp", bytes: [0x52, 0x49, 0x46, 0x46], label: "WEBP", offset4: [0x57, 0x45, 0x42, 0x50] },
  { mime: "application/pdf", bytes: [0x25, 0x50, 0x44, 0x46], label: "PDF" },
  { mime: "application/zip", bytes: [0x50, 0x4b], label: "ZIP" },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46], label: "GIF" }
];

const EXECUTABLE_EXTENSIONS = new Set([".exe", ".bat", ".cmd", ".ps1", ".sh", ".msi", ".scr", ".vbs", ".js", ".jar", ".com", ".dll", ".php", ".asp", ".aspx", ".jsp"]);

function detectMime(buffer) {
  if (!buffer || buffer.length < 4) {
    return "unknown";
  }
  for (const signature of SIGNATURES) {
    const matches = signature.bytes.every((byte, index) => buffer[index] === byte);
    if (!matches) {
      continue;
    }
    if (signature.offset4) {
      const ok4 = signature.offset4.every((byte, index) => buffer[index + 4] === byte);
      if (!ok4) {
        continue;
      }
    }
    return signature.mime;
  }
  return "application/octet-stream";
}

function extensionOf(name) {
  const match = String(name || "").toLowerCase().match(/(\.[a-z0-9]{1,10})$/);
  return match ? match[1] : "";
}

// Inspect and log an upload. Called by the observer middleware after multer
// has populated req.file; outcomes are logged even when downstream handlers
// reject the file (that rejection is part of the audit).
async function inspectAndLog(req, { storedName = null, destination = null, actionTaken = "stored" } = {}) {
  const file = req.file;
  if (!file) {
    return null;
  }
  const detectedMime = detectMime(file.buffer);
  const declaredMime = String(file.mimetype || "").toLowerCase();
  const originalName = String(file.originalname || "").slice(0, 255);
  const extension = extensionOf(originalName);

  let scanResult = "clean";
  let rejectionReason = null;

  const declaredAllowed = ["application/octet-stream", "application/pdf", "image/jpeg", "image/png", "image/webp", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "image/heic", "image/heif"].includes(declaredMime);
  if (EXECUTABLE_EXTENSIONS.has(extension)) {
    scanResult = "rejected";
    rejectionReason = "Executable files are not accepted.";
  } else if (!declaredAllowed) {
    scanResult = "rejected";
    rejectionReason = "Declared file type is not permitted.";
  } else if (detectedMime !== "application/octet-stream" && declaredMime !== detectedMime && !declaredMime.startsWith("application/vnd")) {
    // Declared vs actual content disagree (e.g. renamed executable).
    scanResult = "rejected";
    rejectionReason = `File content (${detectedMime}) does not match its declared type (${declaredMime}).`;
  } else if (detectedMime === "application/octet-stream" && declaredMime !== "application/octet-stream" && !declaredMime.startsWith("application/vnd")) {
    scanResult = "rejected";
    rejectionReason = "File content could not be verified against its declared type.";
  }

  try {
    await runSecurityWrite(() =>
      query(
        `INSERT INTO file_upload_security_logs
           (original_name, stored_name, username, user_role, ip_address, file_size, declared_mime, detected_mime,
            destination, scan_result, rejection_reason, action_taken)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          originalName,
          storedName,
          req.user ? req.user.username : null,
          req.user ? req.user.role : null,
          req.ip || null,
          file.size,
          declaredMime,
          detectedMime,
          destination,
          scanResult,
          rejectionReason,
          scanResult === "rejected" ? "rejected" : actionTaken
        ]
      )
    );
  } catch (error) {
    console.error("file_upload_security_logs write failed:", error.message);
  }

  if (scanResult === "rejected") {
    await securityEvents.record({
      severity: "medium",
      category: "upload",
      action: "SUSPICIOUS_UPLOAD_REJECTED",
      description: `Upload rejected: ${originalName} (${rejectionReason})`,
      username: req.user ? req.user.username : null,
      userRole: req.user ? req.user.role : null,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || null,
      requestMethod: req.method,
      endpoint: req.originalUrl,
      fileName: originalName,
      firewallDecision: "rejected",
      metadata: { declaredMime, detectedMime, size: file.size }
    });
  }

  return { scanResult, detectedMime, rejectionReason };
}

// Express middleware: observes every /api request; when multer attached a
// file, inspect it once the route finishes with its outcome.
function uploadSecurityObserver(req, res, next) {
  res.on("finish", () => {
    if (!req.file) {
      return;
    }
    inspectAndLog(req, {
      destination: req.originalUrl,
      actionTaken: res.statusCode < 400 ? "stored" : "rejected_by_handler"
    }).catch((error) => console.error("Upload inspection failed:", error.message));
  });
  return next();
}

async function listLogs({ page = 1, pageSize = 50, result = "", search = "" } = {}) {
  const filters = ["($1 = '' OR scan_result = $1)", "($2 = '' OR original_name ILIKE $2 OR username ILIKE $2)"];
  const params = [result, search ? `%${search}%` : ""];
  const where = filters.join(" AND ");
  const count = await runSecurityWrite(() =>
    query(`SELECT COUNT(*)::int AS total FROM file_upload_security_logs WHERE ${where}`, params)
  );
  const data = await runSecurityWrite(() =>
    query(
      `SELECT * FROM file_upload_security_logs WHERE ${where}
       ORDER BY created_at DESC, id DESC LIMIT $3 OFFSET $4`,
      [...params, pageSize, (page - 1) * pageSize]
    )
  );
  return { logs: data.rows, total: count.rows[0].total, page, pageSize };
}

module.exports = { uploadSecurityObserver, inspectAndLog, listLogs, detectMime };
