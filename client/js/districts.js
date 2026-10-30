/* School District Monitoring System — district management page */
(function (window, document) {
  "use strict";

  var SERVER_FIELDS = {
    "District name": "districtName",
    "District code": "districtCode",
    "Address": "districtAddress",
    "Contact email": "districtContactEmail",
    "PSDS 1 name": "psdsOneName",
    "PSDS 1 email": "psdsOneEmail",
    "PSDS 1 phone": "psdsOnePhone",
    "PSDS 2 name": "psdsTwoName",
    "PSDS 2 email": "psdsTwoEmail",
    "PSDS 2 phone": "psdsTwoPhone"
  };

  var state = {
    session: null,
    districts: [],
    search: "",
    sequence: 0,
    editing: null,
    formModal: null,
    importModal: null,
    importHistoryModal: null,
    importFiles: [],
    importBatch: null,
    importUploading: false,
    importSequence: 0
  };

  var IMPORT_LIMITS = {
    maxFiles: 5,
    maxFileBytes: 5 * 1024 * 1024,
    maxTotalBytes: 15 * 1024 * 1024,
    allowed: [".xlsx", ".xls", ".csv"]
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

  function optionalValue(id) {
    var node = el(id);
    var value = node ? node.value.trim() : "";
    return value || null;
  }

  function psdsCell(district) {
    if (!district.psds || !district.psds.length) {
      return '<span class="cell-locked"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i> Not assigned</span>';
    }
    return (
      '<div class="psds-cell">' +
      district.psds
        .map(function (supervisor, index) {
          var detail = [supervisor.email, supervisor.phone].filter(Boolean).join(" · ");
          return (
            '<div class="psds-person">' +
            '<span class="psds-index">' + (index + 1) + "</span>" +
            '<div class="psds-person__copy"><strong>' +
            window.UI.escapeHtml(supervisor.name) +
            "</strong><small>" +
            window.UI.escapeHtml(detail || "No contact details") +
            "</small></div></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function districtRow(district) {
    var contact = [
      district.contactEmail
        ? '<span class="cell-time">' + window.UI.escapeHtml(district.contactEmail) + "</span>"
        : '<span class="cell-muted">No email</span>',
      district.address
        ? '<span class="cell-muted">' + window.UI.escapeHtml(district.address) + "</span>"
        : '<span class="cell-muted">No address</span>'
    ].join("");
    return (
      '<tr data-district-id="' + district.id + '">' +
        '<td data-label="District"><div class="district-cell">' +
        '<span class="district-mark"><i class="bi bi-diagram-3" aria-hidden="true"></i></span>' +
        "<div><strong>" + window.UI.escapeHtml(district.name) + "</strong><small>" +
        window.UI.escapeHtml(district.code) + "</small></div></div></td>" +
        '<td data-label="PSDS assignments">' + psdsCell(district) + "</td>" +
        '<td data-label="Schools"><div class="count-cell"><strong>' +
        window.UI.number(district.schoolCount || 0) + "</strong><small>" +
        (Number(district.schoolCount) === 1 ? "school" : "schools") + "</small></div></td>" +
        '<td data-label="Accounts"><div class="count-cell"><strong>' +
        window.UI.number(district.userCount || 0) + "</strong><small>" +
        (Number(district.userCount) === 1 ? "account" : "accounts") + "</small></div></td>" +
        '<td data-label="Office contact"><div class="contact-cell">' + contact + "</div></td>" +
        '<td data-label="Actions" class="cell-actions"><div class="table-actions">' +
        '<button type="button" class="icon-action" data-action="edit" data-id="' + district.id +
        '" title="Edit district" aria-label="Edit ' + window.UI.escapeHtml(district.name) +
        '"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>' +
        '<button type="button" class="icon-action icon-action--danger" data-action="delete" data-id="' + district.id +
        '" title="Delete district" aria-label="Delete ' + window.UI.escapeHtml(district.name) +
        '"><i class="bi bi-trash3" aria-hidden="true"></i></button>' +
        "</div></td>" +
      "</tr>"
    );
  }

  function filteredDistricts() {
    var search = state.search.trim().toLowerCase();
    if (!search) {
      return state.districts;
    }
    return state.districts.filter(function (district) {
      var psds = (district.psds || []).map(function (supervisor) {
        return [supervisor.name, supervisor.email, supervisor.phone].join(" ");
      }).join(" ");
      var haystack = [
        district.name,
        district.code,
        district.address,
        district.contactEmail,
        psds
      ].join(" ").toLowerCase();
      return haystack.indexOf(search) !== -1;
    });
  }

  function renderKpis() {
    var psds = state.districts.reduce(function (total, district) {
      return total + (district.psds ? district.psds.length : 0);
    }, 0);
    var schools = state.districts.reduce(function (total, district) {
      return total + Number(district.schoolCount || 0);
    }, 0);
    setText("districtKpiTotal", window.UI.number(state.districts.length));
    setText("districtKpiPsds", window.UI.number(psds));
    setText("districtKpiSchools", window.UI.number(schools));
  }

  function renderDistricts() {
    var body = el("districtTableBody");
    var meta = el("districtTableMeta");
    if (!body) {
      return;
    }
    body.removeAttribute("aria-busy");
    renderKpis();
    var districts = filteredDistricts();
    if (!districts.length) {
      var filtered = Boolean(state.search);
      body.innerHTML =
        '<tr class="empty-row"><td colspan="6">' +
        window.UI.emptyState({
          icon: filtered ? "bi-search" : "bi-diagram-3",
          title: filtered ? "No matching districts" : "No districts yet",
          message: filtered
            ? "Try a different search term or clear the current filter."
            : "Add the first district under the School Division Office.",
          action: filtered
            ? '<button type="button" class="btn btn-light btn-sm" data-empty-reset>Clear search</button>'
            : '<button type="button" class="btn btn-primary btn-sm" data-empty-add>Add district</button>'
        }) + "</td></tr>";
      if (meta) {
        meta.textContent = filtered
          ? "No districts match “" + state.search + "”"
          : "No districts in the division";
      }
      return;
    }
    body.innerHTML = districts.map(districtRow).join("");
    if (meta) {
      meta.textContent = state.search
        ? districts.length + " of " + state.districts.length +
          (state.districts.length === 1 ? " district" : " districts") + " shown"
        : state.districts.length + (state.districts.length === 1 ? " district" : " districts") +
          " under the School Division Office";
    }
  }

  function loadDistricts() {
    var body = el("districtTableBody");
    if (!body) {
      return;
    }
    var sequence = ++state.sequence;
    body.setAttribute("aria-busy", "true");
    body.innerHTML = window.UI.tableLoading(6, 5);
    setText("districtTableMeta", "Loading districts…");
    return API.get("/districts")
      .then(function (payload) {
        if (sequence !== state.sequence) {
          return;
        }
        state.districts = payload.data || [];
        renderDistricts();
      })
      .catch(function (error) {
        if (sequence !== state.sequence || error.status === 401) {
          return;
        }
        body.removeAttribute("aria-busy");
        body.innerHTML =
          '<tr class="empty-row"><td colspan="6">' +
          window.UI.emptyState({
            icon: "bi-cloud-slash",
            title: "Districts could not be loaded",
            message: error.status === 403
              ? "You do not have permission to manage districts."
              : error.message || "The district directory is temporarily unavailable.",
            action: '<button type="button" class="btn btn-primary btn-sm" id="retryDistricts">Try again</button>'
          }) + "</td></tr>";
        setText("districtTableMeta", "Unavailable");
        var retry = el("retryDistricts");
        if (retry) {
          retry.addEventListener("click", loadDistricts);
        }
      });
  }

  function openForm(district) {
    var form = el("districtForm");
    var modal = state.formModal;
    if (!form || !modal) {
      return;
    }
    state.editing = district || null;
    var editing = Boolean(district);
    var psds = district && district.psds ? district.psds : [];
    form.reset();
    window.UI.clearFieldErrors(form);
    window.UI.hideAlert(el("districtFormAlert"));

    setText("districtFormTitle", editing ? "Edit district" : "Add a district");
    setText("districtFormSubtitle", editing
      ? "Update the district office details and its two PSDS assignments."
      : "Create a district under the School Division Office.");
    var saveLabel = el("districtSaveButton").querySelector("span");
    if (saveLabel) {
      saveLabel.textContent = editing ? "Save changes" : "Create district";
    }

    el("districtName").value = district ? district.name : "";
    el("districtCode").value = district ? district.code : "";
    el("districtAddress").value = district && district.address ? district.address : "";
    el("districtContactEmail").value = district && district.contactEmail ? district.contactEmail : "";
    el("psdsOneName").value = psds[0] ? psds[0].name : "";
    el("psdsOneEmail").value = psds[0] && psds[0].email ? psds[0].email : "";
    el("psdsOnePhone").value = psds[0] && psds[0].phone ? psds[0].phone : "";
    el("psdsTwoName").value = psds[1] ? psds[1].name : "";
    el("psdsTwoEmail").value = psds[1] && psds[1].email ? psds[1].email : "";
    el("psdsTwoPhone").value = psds[1] && psds[1].phone ? psds[1].phone : "";

    modal.show();
    window.setTimeout(function () {
      el("districtName").focus();
    }, 180);
  }

  function showServerError(error) {
    var form = el("districtForm");
    var alertBox = el("districtFormAlert");
    var fieldName = error.details && error.details.field
      ? SERVER_FIELDS[error.details.field] || ""
      : "";
    if (fieldName) {
      var field = form.querySelector('[name="' + fieldName + '"]');
      if (field) {
        field.classList.add("is-invalid");
        var group = field.closest(".form-group");
        var errorNode = group ? group.querySelector(".field-error") : null;
        if (errorNode) {
          errorNode.textContent = error.message;
        }
        field.focus();
        return;
      }
    }
    window.UI.showAlert(
      alertBox,
      "danger",
      error.message || "The district could not be saved.",
      "Unable to save district"
    );
  }

  function submitForm(event) {
    event.preventDefault();
    var form = el("districtForm");
    var alertBox = el("districtFormAlert");
    var saveButton = el("districtSaveButton");
    window.UI.hideAlert(alertBox);

    var rules = [
      { name: "districtName", label: "District name", required: true, minLength: 2, maxLength: 160 },
      {
        name: "districtCode",
        label: "District code",
        required: true,
        minLength: 2,
        maxLength: 24,
        pattern: /^[A-Za-z0-9-]+$/,
        patternMessage: "Use letters, numbers, and hyphens only."
      },
      {
        name: "districtContactEmail",
        label: "Office email",
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        patternMessage: "Enter a valid email address."
      },
      { name: "psdsOneName", label: "PSDS one name", required: true, maxLength: 160 },
      {
        name: "psdsOneEmail",
        label: "PSDS one email",
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        patternMessage: "Enter a valid email address."
      },
      {
        name: "psdsOnePhone",
        label: "PSDS one phone",
        maxLength: 32,
        pattern: /^[0-9+()\-\s.]+$/,
        patternMessage: "Use numbers, spaces, and + ( ) - . only."
      },
      { name: "psdsTwoName", label: "PSDS two name", required: true, maxLength: 160 },
      {
        name: "psdsTwoEmail",
        label: "PSDS two email",
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        patternMessage: "Enter a valid email address."
      },
      {
        name: "psdsTwoPhone",
        label: "PSDS two phone",
        maxLength: 32,
        pattern: /^[0-9+()\-\s.]+$/,
        patternMessage: "Use numbers, spaces, and + ( ) - . only."
      }
    ];
    if (!window.UI.validateForm(form, rules)) {
      return;
    }

    var psdsOneName = el("psdsOneName").value.trim();
    var psdsTwoName = el("psdsTwoName").value.trim();
    if (psdsOneName.toLowerCase() === psdsTwoName.toLowerCase()) {
      window.UI.showAlert(
        alertBox,
        "warning",
        "The two PSDS assignments must be different people.",
        "Check PSDS assignments"
      );
      el("psdsTwoName").focus();
      return;
    }

    var payload = {
      name: el("districtName").value.trim(),
      code: el("districtCode").value.trim().toUpperCase(),
      address: optionalValue("districtAddress"),
      contactEmail: optionalValue("districtContactEmail"),
      psds: [
        {
          name: psdsOneName,
          email: optionalValue("psdsOneEmail"),
          phone: optionalValue("psdsOnePhone")
        },
        {
          name: psdsTwoName,
          email: optionalValue("psdsTwoEmail"),
          phone: optionalValue("psdsTwoPhone")
        }
      ]
    };

    window.UI.setButtonLoading(saveButton, true, state.editing ? "Saving…" : "Creating…");
    var request = state.editing
      ? API.put("/districts/" + state.editing.id, payload)
      : API.post("/districts", payload);

    request
      .then(function (response) {
        window.UI.setButtonLoading(saveButton, false);
        state.formModal.hide();
        window.UI.toast(
          state.editing ? "District updated" : "District created",
          response.data.name + (state.editing
            ? " was updated successfully."
            : " is now part of the School Division Office."),
          "success"
        );
        loadDistricts();
        window.AppShell.refreshSchools();
      })
      .catch(function (error) {
        window.UI.setButtonLoading(saveButton, false);
        showServerError(error);
      });
  }

  function findDistrict(id) {
    return state.districts.find(function (district) {
      return Number(district.id) === Number(id);
    });
  }

  function deleteDistrict(district) {
    window.UI.confirm({
      title: "Delete " + district.name + "?",
      message: "This permanently removes the district from the School Division Office. Districts with schools, accounts, or announcements cannot be deleted.",
      confirmLabel: "Delete district",
      tone: "danger"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      API.delete("/districts/" + district.id)
        .then(function () {
          window.UI.toast("District deleted", district.name + " was removed from the division.", "success");
          loadDistricts();
          window.AppShell.refreshSchools();
        })
        .catch(function (error) {
          window.UI.toast(
            "District could not be deleted",
            error.status === 409
              ? error.message
              : error.message || "The district could not be deleted.",
            "danger"
          );
        });
    });
  }

  function formatFileSize(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024) {
      return value + " B";
    }
    if (value < 1024 * 1024) {
      return (value / 1024).toFixed(1) + " KB";
    }
    return (value / (1024 * 1024)).toFixed(2) + " MB";
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

  function canImportDistricts() {
    var modules = (state.session && state.session.permissions && state.session.permissions.modules) || {};
    return Boolean(modules.districts && modules.districts.add);
  }

  function setImportStep(step) {
    var steps = document.querySelectorAll("#districtImportSteps li");
    Array.prototype.forEach.call(steps, function (node) {
      var key = node.getAttribute("data-import-step");
      node.classList.toggle("is-active", key === step);
      node.classList.toggle("is-done", key === "select" ? step !== "select" : key === "review" && step === "done");
    });

    el("districtImportSelectStep").classList.toggle("d-none", step !== "select");
    el("districtImportPreviewStep").classList.toggle("d-none", step !== "review");
    el("districtImportResultStep").classList.toggle("d-none", step !== "done");

    el("districtImportPreviewButton").classList.toggle("d-none", step !== "select");
    el("districtImportBackButton").classList.toggle("d-none", step !== "review");
    el("districtImportConfirmButton").classList.toggle("d-none", step !== "review");
    el("districtImportDoneButton").classList.toggle("d-none", step !== "done");
    el("districtImportCloseButton").classList.toggle("d-none", step === "done");
    el("districtImportReportButton").classList.toggle(
      "d-none",
      step === "select" || !state.importBatch
    );
  }

  function setImportProgress(percent, label) {
    var value = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    var fill = el("districtImportProgressFill");
    var bar = el("districtImportProgressBar");
    if (fill) {
      fill.style.width = value + "%";
    }
    if (bar) {
      bar.setAttribute("aria-valuenow", String(value));
    }
    setText("districtImportProgressValue", value + "%");
    setText("districtImportProgressLabel", label || "Uploading…");
  }

  function showImportProgress(show) {
    var node = el("districtImportProgress");
    if (node) {
      node.classList.toggle("d-none", !show);
    }
  }

  function renderImportFiles() {
    var list = el("districtImportFileList");
    if (!list) {
      return;
    }
    if (!state.importFiles.length) {
      list.innerHTML = "";
      el("districtImportPreviewButton").disabled = true;
      return;
    }
    list.innerHTML = state.importFiles.map(function (file, index) {
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
    el("districtImportPreviewButton").disabled = state.importUploading;
  }

  function addImportFiles(fileList) {
    var incoming = Array.prototype.slice.call(fileList || []);
    var errors = [];
    var added = 0;

    incoming.forEach(function (file) {
      if (state.importFiles.length >= IMPORT_LIMITS.maxFiles) {
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
      var total = state.importFiles.reduce(function (sum, item) { return sum + item.size; }, 0);
      if (total + file.size > IMPORT_LIMITS.maxTotalBytes) {
        errors.push("The combined upload would exceed 15 MB.");
        return;
      }
      var duplicate = state.importFiles.some(function (item) {
        return item.name === file.name && item.size === file.size && item.lastModified === file.lastModified;
      });
      if (duplicate) {
        return;
      }
      state.importFiles.push(file);
      added += 1;
    });

    renderImportFiles();
    if (errors.length) {
      window.UI.showAlert(
        el("districtImportAlert"),
        "warning",
        errors.slice(0, 3).join(" "),
        "Some files were not added"
      );
    } else if (added) {
      window.UI.hideAlert(el("districtImportAlert"));
    }
  }

  function resetImport() {
    state.importFiles = [];
    state.importBatch = null;
    state.importUploading = false;
    state.importSequence += 1;
    var input = el("districtImportInput");
    if (input) {
      input.value = "";
    }
    window.UI.hideAlert(el("districtImportAlert"));
    window.UI.setButtonLoading(el("districtImportPreviewButton"), false);
    window.UI.setButtonLoading(el("districtImportConfirmButton"), false);
    el("districtImportPreviewButton").disabled = true;
    el("districtImportConfirmButton").disabled = false;
    var confirmLabel = el("districtImportConfirmButton").querySelector("span");
    if (confirmLabel) {
      confirmLabel.textContent = "Confirm import";
    }
    el("districtImportResult").innerHTML = "";
    showImportProgress(false);
    setImportProgress(0, "Uploading…");
    renderImportFiles();
    setImportStep("select");
  }

  function openImportModal() {
    if (!canImportDistricts()) {
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
          xhr.open("POST", "/api/districts/imports/preview", true);
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
    state.importBatch = batch;
    var summary = batch.summary || {};
    var previewButton = el("districtImportPreviewButton");
    var confirmButton = el("districtImportConfirmButton");

    el("districtImportSummary").innerHTML = [
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

    el("districtImportFileResults").innerHTML = (batch.files || []).map(function (file) {
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
    el("districtImportPreviewBody").innerHTML = rows.length
      ? rows.map(function (row) {
          return (
            "<tr>" +
              "<td><strong>" + window.UI.escapeHtml(row.name) + "</strong>" +
                (row.address ? '<div class="cell-muted">' + window.UI.escapeHtml(row.address) + "</div>" : "") +
              "</td>" +
              "<td>" + window.UI.escapeHtml(row.code) + "</td>" +
              "<td>" + window.UI.escapeHtml((row.psds || []).join(" · ")) + "</td>" +
              '<td class="cell-muted">' + window.UI.escapeHtml(row.file) + " · row " + window.UI.number(row.row) + "</td>" +
            "</tr>"
          );
        }).join("")
      : '<tr class="empty-row"><td colspan="4">No records are ready to import.</td></tr>';
    setText(
      "districtImportPreviewMeta",
      rows.length
        ? "Showing " + rows.length + " of " + window.UI.number(summary.validRecords) + " valid record(s)"
        : "Nothing will be written"
    );

    var issues = batch.issues || [];
    el("districtImportIssuesBody").innerHTML = issues.map(function (item) {
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
      "districtImportIssuesMeta",
      issues.length
        ? "Showing " + Math.min(issues.length, 200) + " of " + window.UI.number(batch.issueCount || issues.length)
        : "Nothing rejected"
    );
    el("districtImportIssuesBlock").classList.toggle("d-none", !issues.length);
    el("districtImportReportButton").disabled = false;

    setText(
      "districtImportExpiry",
      "Preview expires " + formatDateTime(batch.expiresAt) +
        ". Records are written only after you confirm, and the server revalidates every row."
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
      ? imported.length + " district" + (imported.length === 1 ? "" : "s") + " imported"
      : "No district was imported";
    var copy = imported.length
      ? "The validated records were saved in one transaction. The district directory has been refreshed."
      : "Every row was a duplicate or was rejected. Review the report and correct the source file.";

    el("districtImportResult").innerHTML =
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
        ? '<div class="import-block"><div class="import-block__head"><h4>Imported districts</h4>' +
          '<span class="import-block__meta">' + imported.length + " record(s)</span></div>" +
          '<div class="table-responsive"><table class="app-table app-table--compact">' +
          '<thead><tr><th scope="col">District</th><th scope="col">Code</th><th scope="col">ID</th></tr></thead><tbody>' +
          imported.map(function (item) {
            return "<tr><td><strong>" + window.UI.escapeHtml(item.name) + "</strong></td><td>" +
              window.UI.escapeHtml(item.code) + "</td><td class=\"cell-muted\">#" + window.UI.number(item.id) + "</td></tr>";
          }).join("") +
          "</tbody></table></div></div>"
        : "");

    el("districtImportReportButton").classList.remove("d-none");
    el("districtImportReportButton").disabled = false;
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
    downloadFile("/api/districts/imports/template", "district-import-template.xlsx").catch(function (error) {
      window.UI.showAlert(
        el("districtImportAlert"),
        "danger",
        error.message || "The template could not be downloaded.",
        "Download failed"
      );
    });
  }

  function downloadImportReport(importId, alertId) {
    var target = importId || (state.importBatch && state.importBatch.importId);
    if (!target) {
      return;
    }
    downloadFile(
      "/api/districts/imports/" + target + "/errors.xlsx",
      "district-import-" + target + "-errors.xlsx"
    ).catch(function (error) {
      window.UI.showAlert(
        el(alertId || "districtImportAlert"),
        "danger",
        error.message || "The error report could not be downloaded.",
        "Download failed"
      );
    });
  }

  function uploadImportPreview() {
    if (state.importUploading || !state.importFiles.length) {
      return;
    }
    var sequence = ++state.importSequence;
    state.importUploading = true;
    state.importBatch = null;
    window.UI.hideAlert(el("districtImportAlert"));
    window.UI.setButtonLoading(el("districtImportPreviewButton"), true, "Validating…");
    showImportProgress(true);
    setImportProgress(0, "Uploading…");

    var formData = new FormData();
    state.importFiles.forEach(function (file) {
      formData.append("files", file, file.name);
    });

    sendImportFiles(formData, function (percent, label) {
      if (sequence === state.importSequence) {
        setImportProgress(percent, label);
      }
    })
      .then(function (payload) {
        if (sequence !== state.importSequence) {
          return;
        }
        state.importUploading = false;
        window.UI.setButtonLoading(el("districtImportPreviewButton"), false);
        showImportProgress(false);
        renderImportPreview(payload.data);
      })
      .catch(function (error) {
        if (sequence !== state.importSequence) {
          return;
        }
        state.importUploading = false;
        window.UI.setButtonLoading(el("districtImportPreviewButton"), false);
        showImportProgress(false);
        renderImportFiles();
        window.UI.showAlert(
          el("districtImportAlert"),
          error.status === 413 ? "warning" : "danger",
          error.message || "The files could not be validated.",
          "Validation failed"
        );
      });
  }

  function confirmImport() {
    var batch = state.importBatch;
    if (!batch || !batch.summary || Number(batch.summary.validRecords) < 1) {
      return;
    }
    window.UI.confirm({
      title: "Import " + batch.summary.validRecords + " district record(s)?",
      message: "This writes the server-validated records to PostgreSQL in one transaction. Duplicate codes are skipped and reported.",
      confirmLabel: "Yes, import records"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      var button = el("districtImportConfirmButton");
      window.UI.setButtonLoading(button, true, "Importing…");
      API.post("/districts/imports/" + batch.importId + "/commit", { token: batch.token })
        .then(function (response) {
          window.UI.setButtonLoading(button, false);
          renderImportResult(response.data);
          loadDistricts();
          window.AppShell.refreshSchools();
          window.UI.toast(
            "District import complete",
            response.data.imported.length + " district record(s) were saved.",
            "success"
          );
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          window.UI.showAlert(
            el("districtImportAlert"),
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
    if (!canImportDistricts()) {
      return;
    }
    window.UI.hideAlert(el("districtImportHistoryAlert"));
    state.importHistoryModal.show();
    loadImportHistory();
  }

  function renderImportHistory(rows) {
    var body = el("districtImportHistoryBody");
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
    var body = el("districtImportHistoryBody");
    body.innerHTML = '<tr class="skeleton-row"><td colspan="5"><span class="skeleton skeleton-block"></span></td></tr>';
    return API.get("/districts/imports", { limit: 20 })
      .then(function (payload) {
        renderImportHistory(payload.data || []);
      })
      .catch(function (error) {
        body.innerHTML = '<tr class="empty-row"><td colspan="5">Import history could not be loaded.</td></tr>';
        window.UI.showAlert(
          el("districtImportHistoryAlert"),
          "danger",
          error.message || "Import history could not be loaded.",
          "Unable to load history"
        );
      });
  }

  function bindImport() {
    var importButton = el("bulkUploadDistricts");
    var historyButton = el("districtImportHistoryButton");
    if (importButton) {
      importButton.addEventListener("click", openImportModal);
    }
    if (historyButton) {
      historyButton.addEventListener("click", openImportHistory);
    }

    var dropzone = el("districtDropzone");
    var input = el("districtImportInput");
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

    var fileList = el("districtImportFileList");
    if (fileList) {
      fileList.addEventListener("click", function (event) {
        var remove = event.target.closest("[data-import-remove]");
        if (!remove || state.importUploading) {
          return;
        }
        var index = Number(remove.dataset.importRemove);
        if (Number.isInteger(index) && index >= 0) {
          state.importFiles.splice(index, 1);
          renderImportFiles();
        }
      });
    }

    var templateButton = el("districtTemplateButton");
    if (templateButton) {
      templateButton.addEventListener("click", downloadTemplate);
    }
    var previewButton = el("districtImportPreviewButton");
    if (previewButton) {
      previewButton.addEventListener("click", uploadImportPreview);
    }
    var backButton = el("districtImportBackButton");
    if (backButton) {
      backButton.addEventListener("click", function () {
        renderImportFiles();
        setImportStep("select");
      });
    }
    var confirmButton = el("districtImportConfirmButton");
    if (confirmButton) {
      confirmButton.addEventListener("click", confirmImport);
    }
    var reportButton = el("districtImportReportButton");
    if (reportButton) {
      reportButton.addEventListener("click", function () {
        downloadImportReport(null, "districtImportAlert");
      });
    }

    var importModal = el("districtImportModal");
    if (importModal) {
      importModal.addEventListener("hidden.bs.modal", resetImport);
    }

    var historyRefresh = el("districtImportHistoryRefresh");
    if (historyRefresh) {
      historyRefresh.addEventListener("click", function () {
        window.UI.setButtonLoading(historyRefresh, true, "Refreshing…");
        loadImportHistory().then(function () {
          window.UI.setButtonLoading(historyRefresh, false);
        });
      });
    }
    var historyBody = el("districtImportHistoryBody");
    if (historyBody) {
      historyBody.addEventListener("click", function (event) {
        var report = event.target.closest("[data-import-report]");
        if (report) {
          downloadImportReport(report.dataset.importReport, "districtImportHistoryAlert");
        }
      });
    }
  }

  function resetFilters() {
    state.search = "";
    el("districtSearch").value = "";
    renderDistricts();
  }

  function bind() {
    el("districtSearch").addEventListener(
      "input",
      window.UI.debounce(function (event) {
        state.search = event.target.value.trim();
        renderDistricts();
      }, 220)
    );
    el("resetDistrictFilters").addEventListener("click", resetFilters);

    el("districtTableBody").addEventListener("click", function (event) {
      var actionButton = event.target.closest("[data-action]");
      if (actionButton) {
        var district = findDistrict(actionButton.dataset.id);
        if (!district) {
          return;
        }
        if (actionButton.dataset.action === "edit") {
          openForm(district);
        } else if (actionButton.dataset.action === "delete") {
          deleteDistrict(district);
        }
        return;
      }
      if (event.target.closest("[data-empty-reset]")) {
        resetFilters();
      }
      if (event.target.closest("[data-empty-add]")) {
        openForm(null);
      }
    });

    el("addDistrictButton").addEventListener("click", function () {
      openForm(null);
    });

    var refresh = el("refreshDistricts");
    refresh.addEventListener("click", function () {
      window.UI.setButtonLoading(refresh, true, "Refreshing…");
      loadDistricts()
        .catch(function () {
          /* Errors are surfaced inside the table. */
        })
        .then(function () {
          window.UI.setButtonLoading(refresh, false);
        });
    });

    el("districtForm").addEventListener("submit", submitForm);
    el("districtFormModal").addEventListener("hidden.bs.modal", function () {
      window.UI.setButtonLoading(el("districtSaveButton"), false);
    });

    bindImport();
  }

  function init() {
    state.formModal = new window.bootstrap.Modal(el("districtFormModal"));
    state.importModal = new window.bootstrap.Modal(el("districtImportModal"));
    state.importHistoryModal = new window.bootstrap.Modal(el("districtImportHistoryModal"));
    window.AppShell.init({
      page: "districts",
      breadcrumbs: ["Districts"],
      requiredPermission: "canManageDistricts"
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      bind();
      if (!canImportDistricts()) {
        ["bulkUploadDistricts", "districtImportHistoryButton"].forEach(function (id) {
          var node = el(id);
          if (node) {
            node.classList.add("d-none");
          }
        });
      }
      loadDistricts();
      var footer = el("footerUpdated");
      if (footer) {
        footer.textContent = "Data refreshed " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
