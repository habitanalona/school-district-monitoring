/* School District Monitoring System — administrator database backup */
(function (window, document) {
  "use strict";

  var state = {
    session: null,
    busy: false
  };

  function el(id) {
    return document.getElementById(id);
  }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (!value) {
      return "0 B";
    }
    var units = ["B", "KB", "MB", "GB"];
    var index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value = value / 1024;
      index += 1;
    }
    return (index === 0 ? String(value) : value.toFixed(1)) + " " + units[index];
  }

  function fileNameFromHeader(header) {
    var match = /filename="?([^";]+)"?/i.exec(header || "");
    return match && match[1] ? match[1].trim() : "database_backup.sql";
  }

  function readFailure(response) {
    return response
      .json()
      .catch(function () {
        return null;
      })
      .then(function (payload) {
        var error = new Error(
          (payload && (payload.error || payload.message)) || "The backup could not be generated."
        );
        error.status = response.status;
        error.code = (payload && payload.code) || "BACKUP_FAILED";
        return error;
      });
  }

  function requestBackup(retried) {
    return window.API.ensureCsrfToken(Boolean(retried)).then(function (token) {
      return window
        .fetch("/api/database-backup", {
          method: "POST",
          credentials: "same-origin",
          headers: { Accept: "application/json", "X-CSRF-Token": token }
        })
        .then(function (response) {
          if (response.status === 401) {
            window.API.redirectToLogin();
            return null;
          }
          if (!response.ok) {
            return readFailure(response).then(function (error) {
              if (error.code === "CSRF_INVALID" && !retried) {
                window.API.setCsrfToken(null);
                return requestBackup(true);
              }
              throw error;
            });
          }
          var name = fileNameFromHeader(response.headers.get("Content-Disposition"));
          return response.blob().then(function (blob) {
            return { blob: blob, name: name };
          });
        });
    });
  }

  function saveBlob(blob, name) {
    var url = window.URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.rel = "noopener";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () {
      window.URL.revokeObjectURL(url);
    }, 5000);
  }

  function setBusy(busy, message) {
    state.busy = busy;
    window.UI.setButtonLoading(el("generateBackup"), busy, "Generating backup…");
    var status = el("backupStatus");
    if (status) {
      status.textContent = message || "";
      status.classList.toggle("d-none", !message);
      status.setAttribute("aria-busy", busy ? "true" : "false");
    }
  }

  function startBackup() {
    if (state.busy) {
      return;
    }
    window.UI.confirm({
      title: "Generate a database backup?",
      message:
        "The server will run pg_dump and download a full SQL snapshot of the database to this device. This may take several minutes for a large database.",
      confirmLabel: "Generate backup",
      cancelLabel: "Cancel",
      tone: "primary"
    }).then(function (confirmed) {
      if (!confirmed || state.busy) {
        return;
      }
      window.UI.hideAlert(el("backupAlert"));
      setBusy(true, "Creating the snapshot. Keep this page open until the download starts…");

      requestBackup(false)
        .then(function (result) {
          if (!result) {
            setBusy(false, "");
            return;
          }
          saveBlob(result.blob, result.name);
          setBusy(false, "");
          var meta = el("backupLastRun");
          if (meta) {
            meta.textContent =
              "Last download: " + result.name + " (" + formatBytes(result.blob.size) + ").";
          }
          window.UI.toast(
            "Backup ready",
            result.name + " is downloading. Store the file somewhere secure.",
            "success"
          );
        })
        .catch(function (error) {
          setBusy(false, "");
          var message =
            error && error.message
              ? error.message
              : "The backup could not be generated. Try again.";
          if (error && error.status === 403 && error.code !== "CSRF_INVALID") {
            message = "Only the system administrator can generate database backups.";
          }
          window.UI.showAlert(el("backupAlert"), "danger", message, "Backup failed");
          window.UI.toast("Backup failed", message, "danger");
        });
    });
  }

  function init() {
    window.AppShell.init({
      page: "database-backup",
      breadcrumbs: ["Administration", "Database Backup"]
    }).then(function (session) {
      if (!session) {
        return;
      }
      if (!session.user || session.user.role !== "system_admin") {
        window.UI.flash("Only the system administrator can open database backups.", "danger");
        window.location.replace("/dashboard.html");
        return;
      }
      state.session = session;
      var button = el("generateBackup");
      if (button) {
        button.addEventListener("click", startBackup);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})(window, document);
