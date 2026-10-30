/* School District Monitoring System — secure school bulk upload */
(function (window, document) {
  "use strict";

  var IMPORT_LIMITS = {
    maxFiles: 5,
    maxFileBytes: 5 * 1024 * 1024,
    maxTotalBytes: 15 * 1024 * 1024,
    allowed: [".xlsx", ".xls", ".csv"]
  };

  var state = {
    session: null,
    onImported: null,
    importModal: null,
    historyModal: null,
    files: [],
    batch: null,
    uploading: false,
    sequence: 0
  };

  function el(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    var node = el(id);
    if (node) {
      node.textContent = value;
    }
  }

  function formatFileSize(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024) {
      return value + " B";
    }
    if (value < 1024 * 1024) {
      return (value / 1024).toFixed(1) + " KB";
    }
    return (value / (1024 * 1024)).toFixed(1) + " MB";
  }

  function formatDateTime(value) {
    if (!value) {
      return "—";
    }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "—";
    }
    return date.toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatDuration(milliseconds) {
    var value = Math.max(0, Number(milliseconds) || 0);
    if (value < 1000) {
      return Math.max(1, Math.round(value)) + " ms";
    }
    return (value / 1000).toFixed(value < 10000 ? 1 : 0) + " s";
  }

  function canImportSchools() {
    var session = state.session;
    if (!session) {
      return false;
    }
    var modules = (session.permissions && session.permissions.modules) || {};
    var role = session.user && session.user.role;
    return (
      (role === "system_admin" || role === "district_admin") &&
      Boolean(modules.schools && modules.schools.add)
    );
  }

  function importStatusBadge(status) {
    var map = {
      committed: ["success", "Committed"],
      previewed: ["info", "Awaiting confirmation"],
      expired: ["neutral", "Expired"],
      failed: ["danger", "Failed"]
    };
    var meta = map[status] || ["neutral", status || "Unknown"];
    return '<span class="status-badge status-badge--' + meta[0] + '">' +
      '<span class="status-dot" aria-hidden="true"></span>' + window.UI.escapeHtml(meta[1]) + "</span>";
  }

  function fileStatusBadge(status) {
    var map = {
      valid: ["success", "Ready"],
      warning: ["warning", "Review"],
      failed: ["danger", "Failed"]
    };
    var meta = map[status] || ["neutral", status || "Unknown"];
    return '<span class="status-badge status-badge--' + meta[0] + '">' +
      window.UI.escapeHtml(meta[1]) + "</span>";
  }

  function setImportStep(step) {
    var steps = document.querySelectorAll("#schoolImportSteps li");
    Array.prototype.forEach.call(steps, function (node) {
      var key = node.getAttribute("data-import-step");
      node.classList.toggle("is-active", key === step);
      node.classList.toggle("is-done", key === "select" ? step !== "select" : key === "review" && step === "done");
    });

    el("schoolImportSelectStep").classList.toggle("d-none", step !== "select");
    el("schoolImportPreviewStep").classList.toggle("d-none", step !== "review");
    el("schoolImportResultStep").classList.toggle("d-none", step !== "done");

    el("schoolImportPreviewButton").classList.toggle("d-none", step !== "select");
    el("schoolImportBackButton").classList.toggle("d-none", step !== "review");
    el("schoolImportConfirmButton").classList.toggle("d-none", step !== "review");
    el("schoolImportDoneButton").classList.toggle("d-none", step !== "done");
    el("schoolImportCloseButton").classList.toggle("d-none", step === "done");
    el("schoolImportReportButton").classList.toggle(
      "d-none",
      step === "select" || !state.batch
    );
  }

  function setImportProgress(percent, label) {
    var value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    var fill = el("schoolImportProgressFill");
    var bar = el("schoolImportProgressBar");
    if (fill) {
      fill.style.width = value + "%";
    }
    if (bar) {
      bar.setAttribute("aria-valuenow", String(value));
    }
    setText("schoolImportProgressValue", value + "%");
    setText("schoolImportProgressLabel", label || "Uploading…");
  }

  function showImportProgress(show) {
    var node = el("schoolImportProgress");
    if (node) {
      node.classList.toggle("d-none", !show);
    }
  }

  function renderImportFiles() {
    var list = el("schoolImportFileList");
    if (!list) {
      return;
    }
    if (!state.files.length) {
      list.innerHTML = "";
      el("schoolImportPreviewButton").disabled = true;
      return;
    }
    list.innerHTML = state.files.map(function (file, index) {
      var extension = String(file.name || "").slice(file.name.lastIndexOf(".")).toLowerCase();
      return (
        '<div class="import-file">' +
          '<span class="import-file__icon"><i class="bi bi-file-earmark-spreadsheet" aria-hidden="true"></i></span>' +
          '<div class="import-file__copy">' +
            '<span class="import-file__name">' + window.UI.escapeHtml(file.name) + "</span>" +
            '<span class="import-file__meta">' + window.UI.escapeHtml(formatFileSize(file.size)) +
              " · " + window.UI.escapeHtml(extension.replace(".", "").toUpperCase()) + "</span>" +
          "</div>" +
          '<button type="button" class="icon-action icon-action--danger import-file__remove" data-import-remove="' + index +
            '" title="Remove file" aria-label="Remove ' + window.UI.escapeHtml(file.name) + '">' +
            '<i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
        "</div>"
      );
    }).join("");
    el("schoolImportPreviewButton").disabled = state.uploading;
  }

  function addImportFiles(fileList) {
    var incoming = Array.prototype.slice.call(fileList || []);
    var errors = [];
    var added = 0;

    incoming.forEach(function (file) {
      if (state.files.length >= IMPORT_LIMITS.maxFiles) {
        errors.push("Only " + IMPORT_LIMITS.maxFiles + " files can be uploaded at once.");
        return;
      }
      var dot = String(file.name || "").lastIndexOf(".");
      var extension = dot === -1 ? "" : file.name.slice(dot).toLowerCase();
      if (IMPORT_LIMITS.allowed.indexOf(extension) === -1) {
        errors.push(file.name + " is not an .xlsx, .xls, or .csv file.");
        return;
      }
      if (!file.size) {
        errors.push(file.name + " is empty.");
        return;
      }
      if (file.size > IMPORT_LIMITS.maxFileBytes) {
        errors.push(file.name + " is larger than 5 MB.");
        return;
      }
      var total = state.files.reduce(function (sum, item) { return sum + item.size; }, 0);
      if (total + file.size > IMPORT_LIMITS.maxTotalBytes) {
        errors.push("The combined upload would exceed 15 MB.");
        return;
      }
      var duplicate = state.files.some(function (item) {
        return item.name === file.name && item.size === file.size && item.lastModified === file.lastModified;
      });
      if (duplicate) {
        return;
      }
      state.files.push(file);
      added += 1;
    });

    renderImportFiles();
    if (errors.length) {
      window.UI.showAlert(
        el("schoolImportAlert"),
        "warning",
        errors.slice(0, 3).join(" "),
        "Some files were not added"
      );
    } else if (added) {
      window.UI.hideAlert(el("schoolImportAlert"));
    }
  }

  function resetImport() {
    state.files = [];
    state.batch = null;
    state.uploading = false;
    state.sequence += 1;
    var input = el("schoolImportInput");
    if (input) {
      input.value = "";
    }
    window.UI.hideAlert(el("schoolImportAlert"));
    window.UI.setButtonLoading(el("schoolImportPreviewButton"), false);
    window.UI.setButtonLoading(el("schoolImportConfirmButton"), false);
    el("schoolImportPreviewButton").disabled = true;
    el("schoolImportConfirmButton").disabled = false;
    var confirmLabel = el("schoolImportConfirmButton").querySelector("span");
    if (confirmLabel) {
      confirmLabel.textContent = "Confirm import";
    }
    el("schoolImportResult").innerHTML = "";
    showImportProgress(false);
    setImportProgress(0, "Uploading…");
    renderImportFiles();
    setImportStep("select");
  }

  function openImportModal() {
    if (!canImportSchools()) {
      return;
    }
    resetImport();
    state.importModal.show();
  }

  function parseXhrPayload(xhr) {
    try {
      return JSON.parse(xhr.responseText || "{}");
    } catch (error) {
      return {};
    }
  }

  function sendImportFiles(formData, onProgress) {
    return API.ensureCsrfToken().then(function (token) {
      return new Promise(function (resolve, reject) {
        var retried = false;

        function send(csrfToken) {
          var xhr = new XMLHttpRequest();
          xhr.open("POST", "/api/schools/imports/preview", true);
          xhr.withCredentials = true;
          xhr.timeout = 120000;
          xhr.setRequestHeader("Accept", "application/json");
          xhr.setRequestHeader("X-CSRF-Token", csrfToken);

          xhr.upload.onprogress = function (event) {
            if (event.lengthComputable) {
              onProgress(Math.round((event.loaded / event.total) * 100));
            }
          };
          xhr.upload.onload = function () {
            onProgress(100, "Validating on the server…");
          };
          xhr.onload = function () {
            var payload = parseXhrPayload(xhr);
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(payload);
              return;
            }
            if (xhr.status === 403 && payload.code === "CSRF_INVALID" && !retried) {
              retried = true;
              API.ensureCsrfToken(true).then(send).catch(reject);
              return;
            }
            reject(
              API.ApiError(
                payload.error || "The files could not be validated.",
                xhr.status,
                payload.code || "IMPORT_FAILED",
                payload.details
              )
            );
          };
          xhr.onerror = function () {
            reject(API.ApiError("The upload could not reach the server.", 0, "NETWORK_ERROR"));
          };
          xhr.ontimeout = function () {
            reject(API.ApiError("The upload timed out. Try a smaller file.", 0, "UPLOAD_TIMEOUT"));
          };
          xhr.send(formData);
        }

        send(token);
      });
    });
  }

  function renderImportPreview(batch) {
    state.batch = batch;
    var summary = batch.summary || {};
    var previewButton = el("schoolImportPreviewButton");
    var confirmButton = el("schoolImportConfirmButton");

    el("schoolImportSummary").innerHTML = [
      { label: "Files", value: summary.files || 0, tone: "" },
      { label: "Detected", value: summary.recordsDetected || 0, tone: "" },
      { label: "Valid", value: summary.validRecords || 0, tone: "good" },
      { label: "Duplicates", value: summary.duplicates || 0, tone: "warn" },
      { label: "Rejected", value: summary.rejected || 0, tone: "bad" }
    ].map(function (item) {
      return (
        '<div class="import-summary__item' + (item.tone ? " import-summary__item--" + item.tone : "") + '">' +
          '<span class="import-summary__label">' + window.UI.escapeHtml(item.label) + "</span>" +
          '<span class="import-summary__value">' + window.UI.number(item.value) + "</span>" +
        "</div>"
      );
    }).join("");

    el("schoolImportFileResults").innerHTML = (batch.files || []).map(function (file) {
      return (
        '<div class="import-file-result">' +
          '<span class="import-file-result__name">' +
            '<i class="bi bi-file-earmark-spreadsheet" aria-hidden="true"></i> ' +
            window.UI.escapeHtml(file.name) + "</span>" +
          fileStatusBadge(file.status) +
          '<span>' + window.UI.escapeHtml(formatFileSize(file.size)) + "</span>" +
          '<span class="import-block__meta">' + window.UI.number(file.detected) + " detected · " +
            window.UI.number(file.valid) + " valid · " + window.UI.number(file.duplicates) + " duplicate · " +
            window.UI.number(file.rejected) + " rejected</span>" +
          (file.error ? '<p class="import-file-result__error"><i class="bi bi-exclamation-circle" aria-hidden="true"></i> ' +
            window.UI.escapeHtml(file.error) + "</p>" : "") +
        "</div>"
      );
    }).join("");

    var rows = batch.preview || [];
    el("schoolImportPreviewBody").innerHTML = rows.length
      ? rows.map(function (row) {
          return (
            "<tr>" +
              "<td><strong>" + window.UI.escapeHtml(row.name) + "</strong>" +
                '<div class="cell-muted">' + window.UI.escapeHtml(row.type) + " · " +
                window.UI.escapeHtml(row.head) + "</div>" +
              "</td>" +
              "<td>" + window.UI.escapeHtml(row.code) + "</td>" +
              "<td>" + window.UI.escapeHtml(row.district) +
                '<div class="cell-muted">' + window.UI.number(row.students) + " students · " +
                window.UI.number(row.teachers) + " teachers</div></td>" +
              '<td class="cell-muted">' + window.UI.escapeHtml(row.file) + " · row " + window.UI.number(row.row) + "</td>" +
            "</tr>"
          );
        }).join("")
      : '<tr class="empty-row"><td colspan="4">No records are ready to import.</td></tr>';
    setText(
      "schoolImportPreviewMeta",
      rows.length
        ? "Showing " + rows.length + " of " + window.UI.number(summary.validRecords) + " valid record(s)"
        : "Nothing will be written"
    );

    var issues = batch.issues || [];
    el("schoolImportIssuesBody").innerHTML = issues.map(function (item) {
      var badge = item.type === "duplicate"
        ? '<span class="status-badge status-badge--warning">Duplicate</span>'
        : '<span class="status-badge status-badge--danger">Rejected</span>';
      var where = [item.sheet, item.row ? "row " + item.row : ""].filter(Boolean).join(" · ");
      return (
        "<tr>" +
          "<td>" + badge + "</td>" +
          "<td>" + window.UI.escapeHtml(item.file) + "</td>" +
          "<td>" + window.UI.escapeHtml(where || "—") + "</td>" +
          "<td>" + window.UI.escapeHtml(item.column || "—") + "</td>" +
          "<td>" + window.UI.escapeHtml(item.reason) + "</td>" +
        "</tr>"
      );
    }).join("") || '<tr class="empty-row"><td colspan="5">No rejected or duplicate records.</td></tr>';
    setText(
      "schoolImportIssuesMeta",
      issues.length
        ? "Showing " + Math.min(issues.length, 200) + " of " + window.UI.number(batch.issueCount || issues.length)
        : "Nothing rejected"
    );
    el("schoolImportIssuesBlock").classList.toggle("d-none", !issues.length);
    el("schoolImportReportButton").disabled = false;

    setText(
      "schoolImportExpiry",
      "Preview expires " + formatDateTime(batch.expiresAt) +
        ". Records are written only after you confirm, and the server revalidates every row and district."
    );

    var valid = Number(summary.validRecords) || 0;
    confirmButton.disabled = valid < 1;
    var confirmLabel = confirmButton.querySelector("span");
    if (confirmLabel) {
      confirmLabel.textContent = valid > 0 ? "Confirm import (" + valid + ")" : "Nothing to import";
    }
    previewButton.disabled = true;
    setImportStep("review");
  }

  function renderImportResult(result) {
    var summary = result.summary || {};
    var imported = result.imported || [];
    var tone = imported.length ? "success" : "warning";
    var title = imported.length
      ? imported.length + " school" + (imported.length === 1 ? "" : "s") + " imported"
      : "No school was imported";
    var copy = imported.length
      ? "The validated records were saved in one transaction. The school register has been refreshed."
      : "Every row was a duplicate or was rejected. Review the report and correct the source file.";

    el("schoolImportResult").innerHTML =
      '<div class="import-result__banner' + (tone === "warning" ? " import-result__banner--warning" : "") + '">' +
        '<span class="import-result__icon"><i class="bi ' +
          (tone === "warning" ? "bi-exclamation-triangle" : "bi-check2-circle") + '" aria-hidden="true"></i></span>' +
        "<div>" +
          '<p class="import-result__title">' + window.UI.escapeHtml(title) + "</p>" +
          '<p class="import-result__copy">' + window.UI.escapeHtml(copy) + "</p>" +
        "</div>" +
      "</div>" +
      '<div class="import-summary">' +
        '<div class="import-summary__item import-summary__item--good"><span class="import-summary__label">Imported</span>' +
          '<span class="import-summary__value">' + window.UI.number(imported.length) + "</span></div>" +
        '<div class="import-summary__item"><span class="import-summary__label">Detected</span>' +
          '<span class="import-summary__value">' + window.UI.number(summary.recordsDetected || 0) + "</span></div>" +
        '<div class="import-summary__item import-summary__item--warn"><span class="import-summary__label">Duplicates</span>' +
          '<span class="import-summary__value">' + window.UI.number(result.duplicates || 0) + "</span></div>" +
        '<div class="import-summary__item import-summary__item--bad"><span class="import-summary__label">Rejected</span>' +
          '<span class="import-summary__value">' + window.UI.number(result.rejected || 0) + "</span></div>" +
        '<div class="import-summary__item"><span class="import-summary__label">Time</span>' +
          '<span class="import-summary__value">' + window.UI.escapeHtml(formatDuration(summary.durationMs)) + "</span></div>" +
      "</div>" +
      (imported.length
        ? '<div class="import-block"><div class="import-block__head"><h4>Imported schools</h4>' +
          '<span class="import-block__meta">' + imported.length + " record(s)</span></div>" +
          '<div class="table-responsive"><table class="app-table app-table--compact">' +
          '<thead><tr><th scope="col">School</th><th scope="col">Code</th><th scope="col">District</th><th scope="col">ID</th></tr></thead><tbody>' +
          imported.map(function (item) {
            return "<tr><td><strong>" + window.UI.escapeHtml(item.name) + "</strong></td><td>" +
              window.UI.escapeHtml(item.code) + "</td><td>" + window.UI.escapeHtml(item.district || "—") +
              "</td><td class=\"cell-muted\">#" + window.UI.number(item.id) + "</td></tr>";
          }).join("") +
          "</tbody></table></div></div>"
        : "");

    el("schoolImportReportButton").classList.remove("d-none");
    el("schoolImportReportButton").disabled = false;
    setImportStep("done");
  }

  function downloadFile(path, fallbackName) {
    return fetch(path, {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    }).then(function (response) {
      if (!response.ok) {
        return response.json().catch(function () { return {}; }).then(function (payload) {
          throw API.ApiError(
            payload.error || "The file could not be downloaded.",
            response.status,
            payload.code || "DOWNLOAD_FAILED"
          );
        });
      }
      return response.blob();
    }).then(function (blob) {
      var url = window.URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = fallbackName;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(function () { window.URL.revokeObjectURL(url); }, 2000);
    });
  }

  function downloadTemplate() {
    downloadFile("/api/schools/imports/template", "school-import-template.xlsx").catch(function (error) {
      window.UI.showAlert(
        el("schoolImportAlert"),
        "danger",
        error.message || "The template could not be downloaded.",
        "Download failed"
      );
    });
  }

  function downloadImportReport(importId, alertId) {
    var target = importId || (state.batch && state.batch.importId);
    if (!target) {
      return;
    }
    downloadFile(
      "/api/schools/imports/" + target + "/errors.xlsx",
      "school-import-" + target + "-errors.xlsx"
    ).catch(function (error) {
      window.UI.showAlert(
        el(alertId || "schoolImportAlert"),
        "danger",
        error.message || "The error report could not be downloaded.",
        "Download failed"
      );
    });
  }

  function uploadImportPreview() {
    if (state.uploading || !state.files.length) {
      return;
    }
    var sequence = ++state.sequence;
    state.uploading = true;
    state.batch = null;
    window.UI.hideAlert(el("schoolImportAlert"));
    window.UI.setButtonLoading(el("schoolImportPreviewButton"), true, "Validating…");
    showImportProgress(true);
    setImportProgress(0, "Uploading…");

    var formData = new FormData();
    state.files.forEach(function (file) {
      formData.append("files", file, file.name);
    });

    sendImportFiles(formData, function (percent, label) {
      if (sequence === state.sequence) {
        setImportProgress(percent, label);
      }
    })
      .then(function (payload) {
        if (sequence !== state.sequence) {
          return;
        }
        state.uploading = false;
        window.UI.setButtonLoading(el("schoolImportPreviewButton"), false);
        showImportProgress(false);
        renderImportPreview(payload.data);
      })
      .catch(function (error) {
        if (sequence !== state.sequence) {
          return;
        }
        state.uploading = false;
        window.UI.setButtonLoading(el("schoolImportPreviewButton"), false);
        showImportProgress(false);
        renderImportFiles();
        window.UI.showAlert(
          el("schoolImportAlert"),
          error.status === 413 ? "warning" : "danger",
          error.message || "The files could not be validated.",
          "Validation failed"
        );
      });
  }

  function confirmImport() {
    var batch = state.batch;
    if (!batch || !batch.summary || Number(batch.summary.validRecords) < 1) {
      return;
    }
    window.UI.confirm({
      title: "Import " + batch.summary.validRecords + " school record(s)?",
      message: "This writes the server-validated records to PostgreSQL in one transaction. Duplicate school codes are skipped and reported.",
      confirmLabel: "Yes, import records"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      var button = el("schoolImportConfirmButton");
      window.UI.setButtonLoading(button, true, "Importing…");
      API.post("/schools/imports/" + batch.importId + "/commit", { token: batch.token })
        .then(function (response) {
          window.UI.setButtonLoading(button, false);
          renderImportResult(response.data);
          if (typeof state.onImported === "function") {
            state.onImported(response.data);
          }
          window.UI.toast(
            "School import complete",
            response.data.imported.length + " school record(s) were saved.",
            "success"
          );
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          window.UI.showAlert(
            el("schoolImportAlert"),
            "danger",
            error.message || "The import could not be completed.",
            error.code === "IMPORT_EXPIRED" ? "Preview expired" : "Import failed"
          );
          if (error.code === "IMPORT_EXPIRED") {
            button.disabled = true;
          }
        });
    });
  }

  function openImportHistory() {
    if (!canImportSchools()) {
      return;
    }
    window.UI.hideAlert(el("schoolImportHistoryAlert"));
    state.historyModal.show();
    loadImportHistory();
  }

  function renderImportHistory(rows) {
    var body = el("schoolImportHistoryBody");
    if (!rows.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="5">No import batches have been recorded for this account.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (row) {
      var summary = row.summary || {};
      var imported = summary.imported === undefined ? summary.validRecords : summary.imported;
      var counts = row.status === "previewed"
        ? window.UI.number(summary.validRecords || 0) + " valid / " + window.UI.number(summary.recordsDetected || 0) + " detected"
        : window.UI.number(imported || 0) + " imported / " + window.UI.number(summary.recordsDetected || 0) + " detected";
      var files = (row.files || []).join(", ");
      return (
        '<tr class="import-history-row">' +
          "<td><strong>#" + window.UI.number(row.id) + "</strong>" +
            '<div class="cell-muted">' + window.UI.escapeHtml(formatDateTime(row.createdAt)) + "</div></td>" +
          '<td><span title="' + window.UI.escapeHtml(files) + '">' +
            window.UI.number((row.files || []).length) + " file(s)</span>" +
            (files ? '<div class="cell-muted">' + window.UI.escapeHtml(files) + "</div>" : "") + "</td>" +
          "<td>" + window.UI.escapeHtml(counts) +
            '<div class="cell-muted">' + window.UI.number(summary.duplicates || 0) + " duplicate · " +
            window.UI.number(summary.rejected || 0) + " rejected</div></td>" +
          "<td>" + importStatusBadge(row.status) + "</td>" +
          '<td class="text-right">' +
            (row.issueCount
              ? '<button type="button" class="btn btn-light btn-sm" data-import-report="' + row.id + '">' +
                '<i class="bi bi-download" aria-hidden="true"></i> Report</button>'
              : '<span class="cell-muted">No issues</span>') +
          "</td>" +
        "</tr>"
      );
    }).join("");
  }

  function loadImportHistory() {
    var body = el("schoolImportHistoryBody");
    body.innerHTML = '<tr class="skeleton-row"><td colspan="5"><span class="skeleton skeleton-block"></span></td></tr>';
    return API.get("/schools/imports", { limit: 20 })
      .then(function (payload) {
        renderImportHistory(payload.data || []);
      })
      .catch(function (error) {
        body.innerHTML = '<tr class="empty-row"><td colspan="5">Import history could not be loaded.</td></tr>';
        window.UI.showAlert(
          el("schoolImportHistoryAlert"),
          "danger",
          error.message || "Import history could not be loaded.",
          "Unable to load history"
        );
      });
  }

  function bind() {
    var importButton = el("bulkUploadSchools");
    var historyButton = el("schoolImportHistoryButton");
    if (importButton) {
      importButton.addEventListener("click", openImportModal);
    }
    if (historyButton) {
      historyButton.addEventListener("click", openImportHistory);
    }

    var dropzone = el("schoolDropzone");
    var input = el("schoolImportInput");
    if (dropzone && input) {
      dropzone.addEventListener("click", function () {
        input.click();
      });
      dropzone.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          input.click();
        }
      });
      ["dragenter", "dragover"].forEach(function (name) {
        dropzone.addEventListener(name, function (event) {
          event.preventDefault();
          dropzone.classList.add("is-dragging");
        });
      });
      ["dragleave", "dragend"].forEach(function (name) {
        dropzone.addEventListener(name, function () {
          dropzone.classList.remove("is-dragging");
        });
      });
      dropzone.addEventListener("drop", function (event) {
        event.preventDefault();
        dropzone.classList.remove("is-dragging");
        if (event.dataTransfer && event.dataTransfer.files) {
          addImportFiles(event.dataTransfer.files);
        }
      });
      input.addEventListener("change", function () {
        addImportFiles(input.files);
        input.value = "";
      });
    }

    var fileList = el("schoolImportFileList");
    if (fileList) {
      fileList.addEventListener("click", function (event) {
        var remove = event.target.closest("[data-import-remove]");
        if (!remove || state.uploading) {
          return;
        }
        var index = Number(remove.dataset.importRemove);
        if (Number.isInteger(index) && index >= 0) {
          state.files.splice(index, 1);
          renderImportFiles();
        }
      });
    }

    var templateButton = el("schoolTemplateButton");
    if (templateButton) {
      templateButton.addEventListener("click", downloadTemplate);
    }
    var previewButton = el("schoolImportPreviewButton");
    if (previewButton) {
      previewButton.addEventListener("click", uploadImportPreview);
    }
    var backButton = el("schoolImportBackButton");
    if (backButton) {
      backButton.addEventListener("click", function () {
        renderImportFiles();
        setImportStep("select");
      });
    }
    var confirmButton = el("schoolImportConfirmButton");
    if (confirmButton) {
      confirmButton.addEventListener("click", confirmImport);
    }
    var reportButton = el("schoolImportReportButton");
    if (reportButton) {
      reportButton.addEventListener("click", function () {
        downloadImportReport(null, "schoolImportAlert");
      });
    }

    var importModal = el("schoolImportModal");
    if (importModal) {
      importModal.addEventListener("hidden.bs.modal", resetImport);
    }

    var historyRefresh = el("schoolImportHistoryRefresh");
    if (historyRefresh) {
      historyRefresh.addEventListener("click", function () {
        window.UI.setButtonLoading(historyRefresh, true, "Refreshing…");
        loadImportHistory().then(function () {
          window.UI.setButtonLoading(historyRefresh, false);
        });
      });
    }
    var historyBody = el("schoolImportHistoryBody");
    if (historyBody) {
      historyBody.addEventListener("click", function (event) {
        var report = event.target.closest("[data-import-report]");
        if (report) {
          downloadImportReport(report.dataset.importReport, "schoolImportHistoryAlert");
        }
      });
    }
  }

  function init(options) {
    var settings = Object.assign({ session: null, onImported: null }, options || {});
    state.session = settings.session;
    state.onImported = settings.onImported;
    if (!canImportSchools()) {
      return;
    }
    state.importModal = new window.bootstrap.Modal(el("schoolImportModal"));
    state.historyModal = new window.bootstrap.Modal(el("schoolImportHistoryModal"));
    bind();
    ["bulkUploadSchools", "schoolImportHistoryButton"].forEach(function (id) {
      var node = el(id);
      if (node) {
        node.classList.remove("d-none");
      }
    });
  }

  window.SchoolImport = { init: init };
})(window, document);
