"use strict";

const fs = require("fs");
const databaseBackupService = require("../services/databaseBackupService");
const auditService = require("../services/auditService");

async function download(req, res) {
  const userId = req.user.id;
  let filePath = null;
  let released = false;

  const release = () => {
    if (released) {
      return;
    }
    released = true;
    databaseBackupService.remove(filePath);
    databaseBackupService.end(userId);
  };

  databaseBackupService.begin(userId);

  try {
    const dump = await databaseBackupService.createDump();
    filePath = dump.filePath;

    await auditService.recordForRequest(req, {
      action: "database.backup_downloaded",
      entityType: "database",
      details: { fileName: dump.fileName, sizeBytes: dump.sizeBytes, database: dump.database }
    });

    res.set({
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${dump.fileName}"`,
      "Content-Length": String(dump.sizeBytes),
      "X-Content-Type-Options": "nosniff"
    });

    const stream = fs.createReadStream(filePath);
    stream.on("error", (error) => {
      release();
      res.destroy(error);
    });
    res.once("close", release);
    stream.pipe(res);
  } catch (error) {
    release();
    throw error;
  }
}

module.exports = { download };
