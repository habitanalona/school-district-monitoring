/* DepEd Learner Records — shared secure spreadsheet import wizard.
 *
 * One factory drives the staff (school head / teacher / non-teaching) and
 * learner bulk upload modals. Each page supplies its own endpoints, preview
 * columns, and result table; validation, duplicate detection, transactions,
 * and audit logging all happen on the server.
 */
(function (window, document) {
  "use strict";

  var LIMITS = {
    maxFiles: 5,
    maxFileBytes: 5 * 1024 * 1024,
    maxTotalBytes: 15 * 1024 * 1024,
    allowed: [".xlsx", ".xls", ".csv"]
  };

  function escapeHtml(value) {
    return window.UI.escapeHtml(value === null || value === undefined ? "" : String(value));
  }

  function count(value) {
    return window.UI.number(Number(value) || 0);
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

  function statusBadge(status) {
    var map = {
      committed: ["success", "Committed"],
      previewed: ["info", "Awaiting confirmation"],
      expired: ["neutral", "Expired"],
      failed: ["danger", "Failed"]
    };
    var meta = map[status] || ["neutral", status || "Unknown"];
    return (
      '<span class="status-badge status-badge--' + meta[0] + '">' +
      '<span class="status-dot" aria-hidden="true"></span>' + escapeHtml(meta[1]) + "</span>"
    );
  }

  function fileStatusBadge(status) {
    var map = {
      valid: ["success", "Ready"],
      warning: ["warning", "Review"],
      failed: ["danger", "Failed"]
    };
    var meta = map[status] || ["neutral", status || "Unknown"];
    return '<span class="status-badge status-badge--' + meta[0] + '">' + escapeHtml(meta[1]) + "</span>";
  }

  function csvCell(value) {
    var text = value === null || value === undefined ? "" : String(value);
    // Neutralise spreadsheet formula injection without altering display text.
    if (/^[=+\-@\t\r]/.test(text)) {
      text = "'" + text;
    }
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function triggerDownload(blob, filename) {
    var url = window.URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      window.URL.revokeObjectURL(url);
    }, 2000);
  }

  function create(config) {
    var prefix = config.prefix;

    var state = {
      session: null,
      onImported: null,
      importModal: null,
      historyModal: null,
      files: [],
      batch: null,
      result: null,
      uploading: false,
      sequence: 0
    };

    function node(suffix) {
      return document.getElementById(prefix + suffix);
    }

    function setText(suffix, value) {
      var target = node(suffix);
      if (target) {
        target.textContent = value;
      }
    }

    function canImport() {
      return Boolean(state.session && config.canImport(state.session));
    }

    function setImportStep(step) {
      var steps = document.querySelectorAll("#" + prefix + "Steps li");
      Array.prototype.forEach.call(steps, function (item) {
        var key = item.getAttribute("data-import-step");
        item.classList.toggle("is-active", key === step);
        item.classList.toggle(
          "is-done",
          key === "select" ? step !== "select" : key === "review" && step === "done"
        );
      });

      node("SelectStep").classList.toggle("d-none", step !== "select");
      node("PreviewStep").classList.toggle("d-none", step !== "review");
      node("ResultStep").classList.toggle("d-none", step !== "done");

      node("PreviewButton").classList.toggle("d-none", step !== "select");
      node("BackButton").classList.toggle("d-none", step !== "review");
      node("ConfirmButton").classList.toggle("d-none", step !== "review");
      node("DoneButton").classList.toggle("d-none", step !== "done");
      node("CloseButton").classList.toggle("d-none", step === "done");
      node("ReportButton").classList.toggle("d-none", step === "select" || !state.batch);
    }

    function setImportProgress(percent, label) {
      var value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
      var fill = node("ProgressFill");
      var bar = node("ProgressBar");
      if (fill) {
        fill.style.width = value + "%";
      }
      if (bar) {
        bar.setAttribute("aria-valuenow", String(value));
      }
      setText("ProgressValue", value + "%");
      setText("ProgressLabel", label || "Uploading…");
    }

    function showImportProgress(show) {
      var progress = node("Progress");
      if (progress) {
        progress.classList.toggle("d-none", !show);
      }
    }

    function renderImportFiles() {
      var list = node("FileList");
      if (!list) {
        return;
      }
      if (!state.files.length) {
        list.innerHTML = "";
        node("PreviewButton").disabled = true;
        return;
      }
      list.innerHTML = state.files
        .map(function (file, index) {
          var dot = String(file.name || "").lastIndexOf(".");
          var extension = dot === -1 ? "" : file.name.slice(dot);
          return (
            '<div class="import-file">' +
            '<span class="import-file__icon"><i class="bi bi-file-earmark-spreadsheet" aria-hidden="true"></i></span>' +
            '<div class="import-file__copy">' +
            '<span class="import-file__name">' + escapeHtml(file.name) + "</span>" +
            '<span class="import-file__meta">' + escapeHtml(formatFileSize(file.size)) +
            " · " + escapeHtml(extension.replace(".", "").toUpperCase()) + "</span>" +
            "</div>" +
            '<button type="button" class="icon-action icon-action--danger import-file__remove" data-import-remove="' + index +
            '" title="Remove file" aria-label="Remove ' + escapeHtml(file.name) + '">' +
            '<i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
            "</div>"
          );
        })
        .join("");
      node("PreviewButton").disabled = state.uploading;
    }

    function addImportFiles(fileList) {
      var incoming = Array.prototype.slice.call(fileList || []);
      var errors = [];
      var added = 0;

      incoming.forEach(function (file) {
        if (state.files.length >= LIMITS.maxFiles) {
          errors.push("Only " + LIMITS.maxFiles + " files can be uploaded at once.");
          return;
        }
        var dot = String(file.name || "").lastIndexOf(".");
        var extension = dot === -1 ? "" : file.name.slice(dot).toLowerCase();
        if (LIMITS.allowed.indexOf(extension) === -1) {
          errors.push(file.name + " is not an .xlsx, .xls, or .csv file.");
          return;
        }
        if (!file.size) {
          errors.push(file.name + " is empty.");
          return;
        }
        if (file.size > LIMITS.maxFileBytes) {
          errors.push(file.name + " is larger than 5 MB.");
          return;
        }
        var total = state.files.reduce(function (sum, item) {
          return sum + item.size;
        }, 0);
        if (total + file.size > LIMITS.maxTotalBytes) {
          errors.push("The combined upload would exceed 15 MB.");
          return;
        }
        var duplicate = state.files.some(function (item) {
          return (
            item.name === file.name &&
            item.size === file.size &&
            item.lastModified === file.lastModified
          );
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
          node("Alert"),
          "warning",
          errors.slice(0, 3).join(" "),
          "Some files were not added"
        );
      } else if (added) {
        window.UI.hideAlert(node("Alert"));
      }
    }

    function resetImport() {
      state.files = [];
      state.batch = null;
      state.result = null;
      state.uploading = false;
      state.sequence += 1;
      var input = node("Input");
      if (input) {
        input.value = "";
      }
      window.UI.hideAlert(node("Alert"));
      window.UI.setButtonLoading(node("PreviewButton"), false);
      window.UI.setButtonLoading(node("ConfirmButton"), false);
      node("PreviewButton").disabled = true;
      node("ConfirmButton").disabled = false;
      var confirmLabel = node("ConfirmButton").querySelector("span");
      if (confirmLabel) {
        confirmLabel.textContent = "Confirm import";
      }
      node("Result").innerHTML = "";
      showImportProgress(false);
      setImportProgress(0, "Uploading…");
      renderImportFiles();
      setImportStep("select");
    }

    function openImportModal() {
      if (!canImport()) {
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
            xhr.open("POST", config.endpoints.preview, true);
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

    function summaryItems(items) {
      return items
        .map(function (item) {
          return (
            '<div class="import-summary__item' + (item.tone ? " import-summary__item--" + item.tone : "") + '">' +
            '<span class="import-summary__label">' + escapeHtml(item.label) + "</span>" +
            '<span class="import-summary__value">' + escapeHtml(item.value) + "</span>" +
            "</div>"
          );
        })
        .join("");
    }

    function renderImportPreview(batch) {
      state.batch = batch;
      var summary = batch.summary || {};
      var previewButton = node("PreviewButton");
      var confirmButton = node("ConfirmButton");

      node("Summary").innerHTML = summaryItems([
        { label: "Files", value: count(summary.files) },
        { label: "Detected", value: count(summary.recordsDetected) },
        { label: "Valid", value: count(summary.validRecords), tone: "good" },
        { label: "Duplicates", value: count(summary.duplicates), tone: "warn" },
        { label: "Rejected", value: count(summary.rejected), tone: "bad" }
      ]);

      node("FileResults").innerHTML = (batch.files || [])
        .map(function (file) {
          return (
            '<div class="import-file-result">' +
            '<span class="import-file-result__name">' +
            '<i class="bi bi-file-earmark-spreadsheet" aria-hidden="true"></i> ' +
            escapeHtml(file.name) + "</span>" +
            fileStatusBadge(file.status) +
            "<span>" + escapeHtml(formatFileSize(file.size)) + "</span>" +
            '<span class="import-block__meta">' + count(file.detected) + " detected · " +
            count(file.valid) + " valid · " + count(file.duplicates) + " duplicate · " +
            count(file.rejected) + " rejected</span>" +
            (file.error
              ? '<p class="import-file-result__error"><i class="bi bi-exclamation-circle" aria-hidden="true"></i> ' +
                escapeHtml(file.error) + "</p>"
              : "") +
            "</div>"
          );
        })
        .join("");

      node("PreviewHead").innerHTML =
        "<tr>" +
        config.previewColumns
          .map(function (column) {
            return '<th scope="col">' + escapeHtml(column.label) + "</th>";
          })
          .join("") +
        "</tr>";

      var rows = batch.preview || [];
      var columnCount = config.previewColumns.length;
      node("PreviewBody").innerHTML = rows.length
        ? rows
            .map(function (row) {
              return (
                "<tr>" +
                config.previewColumns
                  .map(function (column) {
                    return "<td>" + column.render(row) + "</td>";
                  })
                  .join("") +
                "</tr>"
              );
            })
            .join("")
        : '<tr class="empty-row"><td colspan="' + columnCount + '">' +
          escapeHtml(config.previewEmpty || "No records are ready to import.") + "</td></tr>";
      setText(
        "PreviewMeta",
        rows.length
          ? "Showing " + rows.length + " of " + count(summary.validRecords) + " valid record(s)"
          : "Nothing will be written"
      );

      var issues = batch.issues || [];
      node("IssuesBody").innerHTML =
        issues
          .map(function (item) {
            var badge =
              item.type === "duplicate"
                ? '<span class="status-badge status-badge--warning">Duplicate</span>'
                : '<span class="status-badge status-badge--danger">Rejected</span>';
            var where = [item.sheet, item.row ? "row " + item.row : ""].filter(Boolean).join(" · ");
            return (
              "<tr>" +
              "<td>" + badge + "</td>" +
              "<td>" + escapeHtml(item.file) + "</td>" +
              "<td>" + escapeHtml(where || "—") + "</td>" +
              "<td>" + escapeHtml(item.column || "—") + "</td>" +
              '<td><span class="cell-muted">' + escapeHtml(item.reason) + "</span></td>" +
              "</tr>"
            );
          })
          .join("") ||
        '<tr class="empty-row"><td colspan="5">No rejected or duplicate records.</td></tr>';
      setText(
        "IssuesMeta",
        issues.length
          ? "Showing " + Math.min(issues.length, 200) + " of " + count(batch.issueCount || issues.length)
          : "Nothing rejected"
      );
      node("IssuesBlock").classList.toggle("d-none", !issues.length);
      node("ReportButton").disabled = false;

      setText(
        "Expiry",
        "Preview expires " + formatDateTime(batch.expiresAt) +
          ". Records are written only after you confirm, and the server revalidates every row and duplicate."
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

    function resultTable(result) {
      var imported = result.imported || [];
      if (!imported.length) {
        return "";
      }
      var columns = config.resultColumns;
      return (
        '<div class="import-block"><div class="import-block__head"><h4>' +
        escapeHtml(config.resultHeading) + "</h4>" +
        '<span class="import-block__meta">' + imported.length + " record(s)</span></div>" +
        '<div class="table-responsive"><table class="app-table app-table--compact">' +
        "<thead><tr>" +
        columns
          .map(function (column) {
            return '<th scope="col">' + escapeHtml(column.label) + "</th>";
          })
          .join("") +
        "</tr></thead><tbody>" +
        imported
          .map(function (item) {
            return (
              "<tr>" +
              columns
                .map(function (column) {
                  return "<td>" + column.render(item) + "</td>";
                })
                .join("") +
              "</tr>"
            );
          })
          .join("") +
        "</tbody></table></div></div>"
      );
    }

    function credentialsBlock(result) {
      if (!config.credentials || !(result.credentials || []).length) {
        return "";
      }
      return (
        '<div class="import-block">' +
        '<div class="import-block__head"><h4>One-time account credentials</h4>' +
        '<span class="import-block__meta">' + count(result.credentials.length) + " account(s)</span></div>" +
        '<div class="info-banner" style="margin:0 0 12px">' +
        '<i class="bi bi-shield-lock" aria-hidden="true"></i>' +
        "<div>These activation links are shown once and are never stored in the import history or audit log. " +
        "Download the file now, hand each link to its owner through a private channel, and delete the file afterwards. " +
        "Accounts are active but cannot sign in until each person sets a password.</div></div>" +
        '<button type="button" class="btn btn-light btn-sm" data-credentials>' +
        '<i class="bi bi-download" aria-hidden="true"></i> Download credentials CSV</button>' +
        "</div>"
      );
    }

    function renderImportResult(result) {
      state.result = result;
      var imported = result.imported || [];
      var summary = result.summary || {};
      var tone = imported.length ? "success" : "warning";
      var noun = config.resultNoun;
      var title = imported.length
        ? imported.length + " " + noun + (imported.length === 1 ? "" : "s") + " imported"
        : "No " + noun + " was imported";

      node("Result").innerHTML =
        '<div class="import-result__banner' + (tone === "warning" ? " import-result__banner--warning" : "") + '">' +
        '<span class="import-result__icon"><i class="bi ' +
        (tone === "warning" ? "bi-exclamation-triangle" : "bi-check2-circle") + '" aria-hidden="true"></i></span>' +
        "<div>" +
        '<p class="import-result__title">' + escapeHtml(title) + "</p>" +
        '<p class="import-result__copy">' +
        escapeHtml(imported.length ? config.resultSuccessCopy : config.resultWarningCopy) +
        "</p></div></div>" +
        '<div class="import-summary">' +
        summaryItems([
          { label: "Imported", value: count(imported.length), tone: "good" },
          { label: "Detected", value: count(summary.recordsDetected) },
          { label: "Duplicates", value: count(result.duplicates), tone: "warn" },
          { label: "Rejected", value: count(result.rejected), tone: "bad" },
          { label: "Time", value: escapeHtml(formatDuration(summary.durationMs)) }
        ]) +
        "</div>" +
        resultTable(result) +
        credentialsBlock(result) +
        (typeof config.extraResult === "function" ? config.extraResult(result) : "");

      node("ReportButton").classList.remove("d-none");
      node("ReportButton").disabled = false;
      setImportStep("done");
    }

    function downloadFile(path, fallbackName) {
      return fetch(path, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      })
        .then(function (response) {
          if (!response.ok) {
            return response
              .json()
              .catch(function () {
                return {};
              })
              .then(function (payload) {
                throw API.ApiError(
                  payload.error || "The file could not be downloaded.",
                  response.status,
                  payload.code || "DOWNLOAD_FAILED"
                );
              });
          }
          return response.blob();
        })
        .then(function (blob) {
          triggerDownload(blob, fallbackName);
        });
    }

    function downloadTemplate() {
      downloadFile(config.endpoints.template, config.templateName).catch(function (error) {
        window.UI.showAlert(
          node("Alert"),
          "danger",
          error.message || "The template could not be downloaded.",
          "Download failed"
        );
      });
    }

    function downloadImportReport(importId, alertSuffix) {
      var target = importId || (state.batch && state.batch.importId);
      if (!target) {
        return;
      }
      downloadFile(
        config.endpoints.report(target),
        prefix.replace(/Import$/, "").toLowerCase() + "-import-" + target + "-errors.xlsx"
      ).catch(function (error) {
        window.UI.showAlert(
          node(alertSuffix || "Alert"),
          "danger",
          error.message || "The error report could not be downloaded.",
          "Download failed"
        );
      });
    }

    function downloadCredentials() {
      var result = state.result;
      var rows = (result && result.credentials) || [];
      if (!rows.length) {
        return;
      }
      var lines = [
        ["Name", "Username", "Email", "Role", "Activation link", "Link expires"]
          .map(csvCell)
          .join(",")
      ];
      rows.forEach(function (item) {
        lines.push(
          [
            item.fullName,
            item.username,
            item.email,
            item.role,
            item.activationUrl,
            item.expiresAt
          ]
            .map(csvCell)
            .join(",")
        );
      });
      triggerDownload(
        new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }),
        "staff-credentials-" + (result.importId || "import") + ".csv"
      );
    }

    function uploadImportPreview() {
      if (state.uploading || !state.files.length) {
        return;
      }
      var sequence = ++state.sequence;
      state.uploading = true;
      state.batch = null;
      window.UI.hideAlert(node("Alert"));
      window.UI.setButtonLoading(node("PreviewButton"), true, "Validating…");
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
          window.UI.setButtonLoading(node("PreviewButton"), false);
          showImportProgress(false);
          renderImportPreview(payload.data);
        })
        .catch(function (error) {
          if (sequence !== state.sequence) {
            return;
          }
          state.uploading = false;
          window.UI.setButtonLoading(node("PreviewButton"), false);
          showImportProgress(false);
          renderImportFiles();
          window.UI.showAlert(
            node("Alert"),
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
        title: "Import " + batch.summary.validRecords + " " + config.resultNoun + " record(s)?",
        message: config.confirmMessage,
        confirmLabel: "Yes, import records"
      }).then(function (confirmed) {
        if (!confirmed) {
          return;
        }
        var button = node("ConfirmButton");
        window.UI.setButtonLoading(button, true, "Importing…");
        API.post(config.endpoints.commit(batch.importId), { token: batch.token })
          .then(function (response) {
            window.UI.setButtonLoading(button, false);
            renderImportResult(response.data);
            if (typeof state.onImported === "function") {
              state.onImported(response.data);
            }
            window.UI.toast(
              config.toastTitle,
              response.data.imported.length + " " + config.resultNoun + " record(s) were saved.",
              "success"
            );
          })
          .catch(function (error) {
            window.UI.setButtonLoading(button, false);
            window.UI.showAlert(
              node("Alert"),
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
      if (!canImport()) {
        return;
      }
      window.UI.hideAlert(node("HistoryAlert"));
      state.historyModal.show();
      loadImportHistory();
    }

    function renderImportHistory(rows) {
      var body = node("HistoryBody");
      if (!rows.length) {
        body.innerHTML =
          '<tr class="empty-row"><td colspan="5">No import batches have been recorded for this account.</td></tr>';
        return;
      }
      body.innerHTML = rows
        .map(function (row) {
          var summary = row.summary || {};
          var imported = summary.imported === undefined ? summary.validRecords : summary.imported;
          var counts =
            row.status === "previewed"
              ? count(summary.validRecords) + " valid / " + count(summary.recordsDetected) + " detected"
              : count(imported) + " imported / " + count(summary.recordsDetected) + " detected";
          var files = (row.files || []).join(", ");
          return (
            '<tr class="import-history-row">' +
            "<td><strong>#" + count(row.id) + "</strong>" +
            '<div class="cell-muted">' + escapeHtml(formatDateTime(row.createdAt)) + "</div></td>" +
            '<td><span title="' + escapeHtml(files) + '">' + count((row.files || []).length) + " file(s)</span>" +
            (files ? '<div class="cell-muted">' + escapeHtml(files) + "</div>" : "") + "</td>" +
            "<td>" + escapeHtml(counts) +
            '<div class="cell-muted">' + count(summary.duplicates) + " duplicate · " +
            count(summary.rejected) + " rejected</div></td>" +
            "<td>" + statusBadge(row.status) + "</td>" +
            '<td class="text-right">' +
            (row.issueCount
              ? '<button type="button" class="btn btn-light btn-sm" data-import-report="' + row.id + '">' +
                '<i class="bi bi-download" aria-hidden="true"></i> Report</button>'
              : '<span class="cell-muted">No issues</span>') +
            "</td></tr>"
          );
        })
        .join("");
    }

    function loadImportHistory() {
      var body = node("HistoryBody");
      body.innerHTML =
        '<tr class="skeleton-row"><td colspan="5"><span class="skeleton skeleton-block"></span></td></tr>';
      return API.get(config.endpoints.history, { limit: 20 })
        .then(function (payload) {
          renderImportHistory(payload.data || []);
        })
        .catch(function (error) {
          body.innerHTML =
            '<tr class="empty-row"><td colspan="5">Import history could not be loaded.</td></tr>';
          window.UI.showAlert(
            node("HistoryAlert"),
            "danger",
            error.message || "Import history could not be loaded.",
            "Unable to load history"
          );
        });
    }

    function bind() {
      var trigger = document.getElementById(config.triggerId);
      if (trigger) {
        trigger.addEventListener("click", openImportModal);
      }
      var historyTrigger = document.getElementById(config.historyTriggerId);
      if (historyTrigger) {
        historyTrigger.addEventListener("click", openImportHistory);
      }

      var dropzone = node("Dropzone");
      var input = node("Input");
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

      var fileList = node("FileList");
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

      node("TemplateButton").addEventListener("click", downloadTemplate);
      node("PreviewButton").addEventListener("click", uploadImportPreview);
      node("ConfirmButton").addEventListener("click", confirmImport);
      node("BackButton").addEventListener("click", function () {
        renderImportFiles();
        setImportStep("select");
      });
      node("ReportButton").addEventListener("click", function () {
        downloadImportReport(null, "Alert");
      });
      node("Result").addEventListener("click", function (event) {
        if (event.target.closest("[data-credentials]")) {
          downloadCredentials();
        }
      });

      var importModal = node("Modal");
      if (importModal) {
        importModal.addEventListener("hidden.bs.modal", resetImport);
      }

      var historyRefresh = node("HistoryRefresh");
      if (historyRefresh) {
        historyRefresh.addEventListener("click", function () {
          window.UI.setButtonLoading(historyRefresh, true, "Refreshing…");
          loadImportHistory().then(function () {
            window.UI.setButtonLoading(historyRefresh, false);
          });
        });
      }
      node("HistoryBody").addEventListener("click", function (event) {
        var report = event.target.closest("[data-import-report]");
        if (report) {
          downloadImportReport(report.dataset.importReport, "HistoryAlert");
        }
      });
    }

    function init(session, options) {
      state.session = session;
      state.onImported = options && options.onImported;
      if (!canImport()) {
        return;
      }
      state.importModal = new window.bootstrap.Modal(node("Modal"));
      state.historyModal = new window.bootstrap.Modal(node("HistoryModal"));
      bind();
      [config.triggerId, config.historyTriggerId].forEach(function (id) {
        var target = document.getElementById(id);
        if (target) {
          target.classList.remove("d-none");
        }
      });
    }

    return { init: init, open: openImportModal };
  }

  window.SpreadsheetImport = { create: create };
})(window, document);
