/* School District Monitoring System — reports and analytics page */
(function (window, document) {
  "use strict";

  var STATUS_ORDER = [
    { key: "reviewed", label: "Reviewed", tone: "reviewed" },
    { key: "submitted", label: "Submitted", tone: "submitted" },
    { key: "late", label: "Late", tone: "late" },
    { key: "pending", label: "Pending", tone: "pending" }
  ];

  var state = {
    session: null,
    districtId: "",
    period: "",
    status: "",
    type: "",
    search: "",
    page: 1,
    sequence: 0,
    summarySequence: 0,
    reports: [],
    schools: [],
    schoolsLoaded: false,
    viewingReport: null,
    editingReport: null,
    formModal: null,
    viewModal: null
  };

  function el(id) {
    return document.getElementById(id);
  }

  function params() {
    return new URLSearchParams(window.location.search);
  }

  function districtParams() {
    return state.districtId ? { districtId: state.districtId } : {};
  }

  function queryParams() {
    var query = {
      page: state.page,
      pageSize: 10,
      period: state.period,
      status: state.status,
      type: state.type,
      search: state.search
    };
    if (state.districtId) {
      query.districtId = state.districtId;
    }
    return query;
  }

  function reportTypeChip(type) {
    var icon = "bi-journal-text";
    if (type === "Performance Review") {
      icon = "bi-graph-up-arrow";
    } else if (type === "Compliance") {
      icon = "bi-shield-check";
    }
    return (
      '<span class="type-chip"><i class="bi ' + icon + '" aria-hidden="true"></i> ' +
      window.UI.escapeHtml(type) + "</span>"
    );
  }

  function setText(id, value) {
    var node = el(id);
    if (node) {
      node.textContent = value;
    }
  }

  function showPageAlert(type, message, title) {
    window.UI.showAlert(el("reportPageAlert"), type, message, title);
  }

  function renderPeriodOptions(periods) {
    var select = el("reportPeriodFilter");
    if (!select) {
      return;
    }
    var unique = periods.filter(function (period, index) {
      return period && periods.indexOf(period) === index;
    });
    if (state.period && unique.indexOf(state.period) === -1) {
      unique.unshift(state.period);
    }
    select.innerHTML = unique.map(function (period) {
      return (
        '<option value="' + window.UI.escapeHtml(period) + '"' +
        (period === state.period ? " selected" : "") +
        ">" + window.UI.escapeHtml(window.UI.month(period)) + "</option>"
      );
    }).join("");
  }

  function loadPeriods() {
    return API.get("/dashboard/report-status", districtParams())
      .then(function (payload) {
        var data = payload.data || {};
        var periods = data.periods || [];
        if (!state.period || periods.indexOf(state.period) === -1) {
          state.period = periods[0] || data.period || state.period;
        }
        renderPeriodOptions(periods.length ? periods : state.period ? [state.period] : []);
        updatePeriodLabels();
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        if (state.period) {
          renderPeriodOptions([state.period]);
        }
        showPageAlert("warning", "Reporting periods could not be refreshed. " + (error.message || ""), "Period list unavailable");
      });
  }

  function updatePeriodLabels() {
    var label = window.UI.month(state.period);
    setText("reportPeriodTag", label);
    setText("reportOverviewSubtitle", "Status distribution for " + label + ".");
  }

  function renderSummary(data) {
    var statuses = data.statuses || {};
    setText("reportKpiTotal", window.UI.number(data.total));
    setText("reportKpiReviewed", window.UI.number(statuses.reviewed));
    setText("reportKpiPending", window.UI.number(statuses.pending));
    setText("reportKpiLate", window.UI.number(statuses.late));

    var total = Number(data.total || 0);
    var body = el("reportOverviewBody");
    if (!body) {
      return;
    }
    if (!total) {
      body.innerHTML = window.UI.emptyState({
        icon: "bi-clipboard-x",
        title: "No reports recorded",
        message: "No school reports have been recorded for " + window.UI.month(data.period || state.period) + " yet."
      });
      return;
    }
    var segments = STATUS_ORDER.map(function (status) {
      var count = Number(statuses[status.key] || 0);
      return (
        '<span class="insight-seg insight-seg--' + status.tone + '" style="width:' +
        ((count / total) * 100).toFixed(2) + '%" title="' +
        window.UI.escapeHtml(status.label + ": " + count + " reports") + '"></span>'
      );
    }).join("");
    var legend = STATUS_ORDER.map(function (status) {
      var count = Number(statuses[status.key] || 0);
      return (
        '<li><span class="insight-swatch insight-swatch--' + status.tone + '"></span>' +
        "<span>" + status.label + "</span><strong>" + window.UI.number(count) + "</strong></li>"
      );
    }).join("");
    var complete = Number(statuses.reviewed || 0) + Number(statuses.submitted || 0);
    body.innerHTML =
      '<div class="insight-meter" role="img" aria-label="Report status distribution for ' +
      window.UI.escapeHtml(window.UI.month(state.period)) + '">' + segments + "</div>" +
      '<ul class="insight-legend">' + legend + "</ul>" +
      '<p class="insight-foot"><i class="bi bi-calendar-check" aria-hidden="true"></i> ' +
      window.UI.escapeHtml(window.UI.month(state.period)) + " · <strong>" +
      window.UI.number(complete) + "</strong> of <strong>" + window.UI.number(total) +
      "</strong> recorded reports have been submitted or reviewed.</p>";
  }

  function loadSummary() {
    var sequence = ++state.summarySequence;
    API.get("/reports/summary", Object.assign({ period: state.period }, districtParams()))
      .then(function (payload) {
        if (sequence !== state.summarySequence) {
          return;
        }
        renderSummary(payload.data || {});
      })
      .catch(function (error) {
        if (sequence !== state.summarySequence || error.status === 401) {
          return;
        }
        ["reportKpiTotal", "reportKpiReviewed", "reportKpiPending", "reportKpiLate"].forEach(function (id) {
          setText(id, "—");
        });
        showPageAlert("warning", "The report summary could not be loaded. " + (error.message || ""), "Summary unavailable");
      });
  }

  function reportRow(report) {
    var submitted = report.submittedByName
      ? window.UI.escapeHtml(report.submittedByName)
      : '<span class="cell-muted">Awaiting submission</span>';
    return (
      '<tr data-report-id="' + report.id + '">' +
        '<td data-label="School"><div class="school-name-cell"><span class="school-avatar"><i class="bi bi-building" aria-hidden="true"></i></span><div><strong>' +
        window.UI.escapeHtml(report.schoolName) + "</strong><small>" +
        window.UI.escapeHtml(report.schoolCode) + " · " + window.UI.escapeHtml(report.districtName || "") +
        "</small></div></div></td>" +
        '<td data-label="Reporting Period"><span class="cell-strong">' + window.UI.escapeHtml(window.UI.month(report.reportingPeriod)) + "</span></td>" +
        '<td data-label="Report Type">' + reportTypeChip(report.reportType) + "</td>" +
        '<td data-label="Submission Status">' + window.UI.badge("report", report.submissionStatus) + "</td>" +
        '<td data-label="Submitted By">' + submitted + "</td>" +
        '<td data-label="Submitted"><span class="cell-time">' + window.UI.escapeHtml(window.UI.dateTime(report.submittedAt)) + "</span></td>" +
        '<td data-label="Last Updated"><span class="cell-time" title="' +
        window.UI.escapeHtml(window.UI.dateTime(report.updatedAt)) + '">' +
        window.UI.escapeHtml(window.UI.relativeTime(report.updatedAt)) + "</span></td>" +
        '<td data-label="Actions" class="cell-actions"><div class="table-actions">' +
        '<button type="button" class="icon-action" data-action="view" data-id="' + report.id +
        '" title="View report" aria-label="View report for ' + window.UI.escapeHtml(report.schoolName) +
        '"><i class="bi bi-eye" aria-hidden="true"></i></button>' +
        '<button type="button" class="icon-action" data-action="edit" data-id="' + report.id +
        '" title="Update report" aria-label="Update report for ' + window.UI.escapeHtml(report.schoolName) +
        '"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>' +
        "</div></td>" +
      "</tr>"
    );
  }

  function renderReports(pagination) {
    var body = el("reportTableBody");
    var meta = el("reportTableMeta");
    if (!body) {
      return;
    }
    body.removeAttribute("aria-busy");
    if (!state.reports.length) {
      var filtered = Boolean(state.search || state.status || state.type);
      body.innerHTML =
        '<tr class="empty-row"><td colspan="8">' +
        window.UI.emptyState({
          icon: filtered ? "bi-search" : "bi-clipboard-x",
          title: filtered ? "No matching reports" : "No reports for this period",
          message: filtered
            ? "Try a different search term or clear the current filters."
            : "Record a report to begin tracking submissions for this period.",
          action: '<button type="button" class="btn btn-light btn-sm" data-empty-reset>Clear filters</button>'
        }) + "</td></tr>";
      if (meta) {
        meta.textContent = "No reports found";
      }
      window.UI.pagination(el("reportPagination"), pagination || {}, function () {});
      return;
    }
    body.innerHTML = state.reports.map(reportRow).join("");
    if (meta) {
      meta.textContent =
        window.UI.number(pagination.total) + (Number(pagination.total) === 1 ? " report" : " reports") +
        " for " + window.UI.month(state.period);
    }
    window.UI.pagination(el("reportPagination"), pagination, function (page) {
      state.page = page;
      loadReports();
    });
  }

  function loadReports() {
    var body = el("reportTableBody");
    if (!body) {
      return;
    }
    var sequence = ++state.sequence;
    body.setAttribute("aria-busy", "true");
    body.innerHTML = window.UI.tableLoading(8, 6);
    var meta = el("reportTableMeta");
    if (meta) {
      meta.textContent = "Loading reports…";
    }
    API.get("/reports", queryParams())
      .then(function (payload) {
        if (sequence !== state.sequence) {
          return;
        }
        state.reports = payload.data || [];
        renderReports(payload.pagination || { total: state.reports.length, page: state.page, pageSize: 10, totalPages: 1 });
      })
      .catch(function (error) {
        if (sequence !== state.sequence || error.status === 401) {
          return;
        }
        body.removeAttribute("aria-busy");
        body.innerHTML =
          '<tr class="empty-row"><td colspan="8">' +
          window.UI.emptyState({
            icon: "bi-cloud-slash",
            title: "Reports could not be loaded",
            message: error.message || "The reporting register is temporarily unavailable.",
            action: '<button type="button" class="btn btn-primary btn-sm" id="retryReports">Try again</button>'
          }) + "</td></tr>";
        if (meta) {
          meta.textContent = "Unavailable";
        }
        var retry = el("retryReports");
        if (retry) {
          retry.addEventListener("click", loadReports);
        }
      });
  }

  function loadSchools() {
    if (state.schoolsLoaded) {
      return Promise.resolve(state.schools);
    }
    return API.get("/schools/sidebar", districtParams()).then(function (payload) {
      state.schools = (payload.data && payload.data.schools) || [];
      state.schoolsLoaded = true;
      return state.schools;
    });
  }

  function schoolOptions(selectedId) {
    return state.schools.map(function (school) {
      return (
        '<option value="' + school.id + '"' +
        (String(school.id) === String(selectedId) ? " selected" : "") +
        ">" + window.UI.escapeHtml(school.name) + " (" + window.UI.escapeHtml(school.code) + ")</option>"
      );
    }).join("");
  }

  function openForm(report) {
    var form = el("reportForm");
    var modal = state.formModal;
    if (!form || !modal) {
      return;
    }
    state.editingReport = report || null;
    form.reset();
    window.UI.clearFieldErrors(form);
    window.UI.hideAlert(el("reportFormAlert"));

    var editing = Boolean(report);
    setText("reportFormTitle", editing ? "Update school report" : "Record a school report");
    setText("reportFormSubtitle", editing
      ? "Update the submission status or add review remarks."
      : "Log a monthly enrollment, performance, or compliance report.");
    setText("reportFormNote", editing
      ? "School, period, and report type cannot be changed after a report is recorded. Update the status or remarks instead."
      : "A report can only be recorded once per school, period, and report type.");

    var schoolSelect = el("reportSchool");
    schoolSelect.innerHTML = '<option value="">Select a school</option>' + schoolOptions(report ? report.schoolId : "");
    if (report && state.schools.every(function (school) { return Number(school.id) !== Number(report.schoolId); })) {
      schoolSelect.insertAdjacentHTML(
        "beforeend",
        '<option value="' + report.schoolId + '" selected>' +
        window.UI.escapeHtml(report.schoolName) + " (" + window.UI.escapeHtml(report.schoolCode) + ")</option>"
      );
    }
    schoolSelect.value = report ? String(report.schoolId) : "";
    el("reportPeriod").value = report ? report.reportingPeriod : state.period;
    el("reportType").value = report ? report.reportType : "Monthly Enrollment";
    el("reportStatus").value = report ? report.submissionStatus : "pending";
    el("reportRemarks").value = report ? report.remarks || "" : "";

    ["reportSchool", "reportPeriod", "reportType"].forEach(function (id) {
      el(id).disabled = editing;
    });

    var saveLabel = el("reportSaveButton").querySelector("span");
    if (saveLabel) {
      saveLabel.textContent = editing ? "Save changes" : "Save report";
    }
    modal.show();
    window.setTimeout(function () {
      el(editing ? "reportStatus" : "reportSchool").focus();
    }, 180);
  }

  function submitForm(event) {
    event.preventDefault();
    var form = el("reportForm");
    var alertBox = el("reportFormAlert");
    var saveButton = el("reportSaveButton");
    window.UI.hideAlert(alertBox);

    var rules = [
      { name: "schoolId", label: "School", required: true, requiredMessage: "Select a school." },
      { name: "reportingPeriod", label: "Reporting period", required: true },
      { name: "reportType", label: "Report type", required: true },
      { name: "submissionStatus", label: "Submission status", required: true },
      { name: "remarks", label: "Remarks", maxLength: 2000 }
    ];
    if (!window.UI.validateForm(form, rules)) {
      return;
    }
    var period = el("reportPeriod").value;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      window.UI.fieldError(el("reportPeriod"), "Choose a valid reporting month.");
      return;
    }

    var payload = {
      schoolId: Number(el("reportSchool").value),
      reportingPeriod: period,
      reportType: el("reportType").value,
      submissionStatus: el("reportStatus").value,
      remarks: el("reportRemarks").value.trim()
    };

    var editing = state.editingReport;
    window.UI.setButtonLoading(saveButton, true, editing ? "Saving…" : "Recording…");
    var request = editing
      ? API.put("/reports/" + editing.id, payload)
      : API.post("/reports", payload);

    request
      .then(function (response) {
        window.UI.setButtonLoading(saveButton, false);
        state.formModal.hide();
        state.period = response.data.reportingPeriod;
        return loadPeriods().then(function () {
          loadSummary();
          loadReports();
          window.UI.toast(
            editing ? "Report updated" : "Report recorded",
            response.data.schoolName + " · " + window.UI.month(response.data.reportingPeriod) + " · " +
              window.UI.REPORT_STATUS[response.data.submissionStatus].label,
            "success"
          );
        });
      })
      .catch(function (error) {
        window.UI.setButtonLoading(saveButton, false);
        if (!window.UI.showFieldErrors(form, error)) {
          window.UI.showAlert(
            alertBox,
            "danger",
            error.code === "REPORT_DUPLICATE"
              ? "A report already exists for that school, period, and report type. Open the existing report to update it instead."
              : error.message || "The report could not be saved.",
            "Unable to save report"
          );
        }
      });
  }

  function viewReport(report) {
    state.viewingReport = report;
    setText("reportViewEyebrow", report.schoolCode + " · " + window.UI.month(report.reportingPeriod));
    setText("reportViewTitle", report.schoolName);
    var body = el("reportViewBody");
    if (!body) {
      return;
    }
    var statusMeta = window.UI.REPORT_STATUS[report.submissionStatus] || { label: report.submissionStatus, tone: "neutral" };
    body.innerHTML =
      '<div class="report-view-status">' +
        '<div><span class="detail-label">Submission status</span>' +
        '<div class="report-view-badges">' + window.UI.badge("report", report.submissionStatus) +
        reportTypeChip(report.reportType) + "</div></div>" +
        '<span class="report-view-icon report-view-icon--' + statusMeta.tone + '"><i class="bi bi-clipboard-check" aria-hidden="true"></i></span>' +
      "</div>" +
      '<div class="detail-grid">' +
        '<div class="detail-item"><span class="detail-label">School</span><span class="detail-value">' +
        window.UI.escapeHtml(report.schoolName) + "</span></div>" +
        '<div class="detail-item"><span class="detail-label">School ID</span><span class="detail-value">' +
        window.UI.escapeHtml(report.schoolCode) + "</span></div>" +
        '<div class="detail-item"><span class="detail-label">District</span><span class="detail-value">' +
        window.UI.escapeHtml(report.districtName || "—") + "</span></div>" +
        '<div class="detail-item"><span class="detail-label">Reporting period</span><span class="detail-value">' +
        window.UI.escapeHtml(window.UI.month(report.reportingPeriod)) + "</span></div>" +
        '<div class="detail-item"><span class="detail-label">Submitted by</span><span class="detail-value">' +
        window.UI.escapeHtml(report.submittedByName || "Awaiting submission") + "</span></div>" +
        '<div class="detail-item"><span class="detail-label">Submitted at</span><span class="detail-value">' +
        window.UI.escapeHtml(window.UI.dateTime(report.submittedAt)) + "</span></div>" +
        '<div class="detail-item detail-item--wide"><span class="detail-label">Remarks</span><span class="detail-value">' +
        (report.remarks ? window.UI.escapeHtml(report.remarks) : "No review remarks have been added.") + "</span></div>" +
      "</div>" +
      '<div class="detail-timeline">' +
        '<span><i class="bi bi-calendar-plus" aria-hidden="true"></i> Recorded ' +
        window.UI.escapeHtml(window.UI.date(report.createdAt)) + "</span>" +
        '<span><i class="bi bi-clock-history" aria-hidden="true"></i> Updated ' +
        window.UI.escapeHtml(window.UI.dateTime(report.updatedAt)) + "</span>" +
      "</div>";
    state.viewModal.show();
  }

  function findReport(id) {
    return state.reports.find(function (report) {
      return Number(report.id) === Number(id);
    });
  }

  function bindTableActions() {
    var body = el("reportTableBody");
    if (!body) {
      return;
    }
    body.addEventListener("click", function (event) {
      var actionButton = event.target.closest("[data-action]");
      if (actionButton) {
        var report = findReport(actionButton.dataset.id);
        if (!report) {
          return;
        }
        if (actionButton.dataset.action === "view") {
          viewReport(report);
        } else if (actionButton.dataset.action === "edit") {
          openForm(report);
        }
        return;
      }
      if (event.target.closest("[data-empty-reset]")) {
        resetFilters();
      }
    });
  }

  function resetFilters() {
    state.search = "";
    state.status = "";
    state.type = "";
    state.page = 1;
    el("reportSearch").value = "";
    el("reportStatusFilter").value = "";
    el("reportTypeFilter").value = "";
    loadReports();
  }

  function populateDistricts() {
    var session = state.session;
    var control = el("reportDistrictControl");
    var select = el("reportDistrictFilter");
    if (!session.permissions.canSelectDistrict || !control || !select) {
      return;
    }
    select.innerHTML = '<option value="">All districts</option>' +
      (session.districts || []).map(function (district) {
        return '<option value="' + district.id + '">' +
          window.UI.escapeHtml(district.name) + " (" + window.UI.escapeHtml(district.code) + ")</option>";
      }).join("");
    control.classList.remove("d-none");
    select.addEventListener("change", function () {
      state.districtId = select.value;
      state.schoolsLoaded = false;
      state.page = 1;
      loadPeriods().then(function () {
        loadSummary();
        loadReports();
      });
    });
  }

  function bindFilters() {
    el("reportPeriodFilter").addEventListener("change", function (event) {
      state.period = event.target.value;
      state.page = 1;
      updatePeriodLabels();
      loadSummary();
      loadReports();
    });
    el("reportSearch").addEventListener(
      "input",
      window.UI.debounce(function (event) {
        state.search = event.target.value.trim();
        state.page = 1;
        loadReports();
      }, 320)
    );
    el("reportStatusFilter").addEventListener("change", function (event) {
      state.status = event.target.value;
      state.page = 1;
      loadReports();
    });
    el("reportTypeFilter").addEventListener("change", function (event) {
      state.type = event.target.value;
      state.page = 1;
      loadReports();
    });
    el("resetReportFilters").addEventListener("click", resetFilters);
    el("newReportButton").addEventListener("click", function () {
      loadSchools()
        .then(function () {
          openForm(null);
        })
        .catch(function (error) {
          if (error.status === 401) {
            return;
          }
          showPageAlert("danger", error.message || "The school list could not be loaded.", "Unable to open the report form");
        });
    });
  }

  function init() {
    state.formModal = new window.bootstrap.Modal(el("reportFormModal"));
    state.viewModal = new window.bootstrap.Modal(el("reportViewModal"));
    el("reportForm").addEventListener("submit", submitForm);
    el("reportViewEdit").addEventListener("click", function () {
      var report = state.viewingReport;
      if (!report) {
        return;
      }
      state.viewModal.hide();
      window.setTimeout(function () {
        openForm(report);
      }, 180);
    });

    var query = params();
    state.period = query.get("period") || "";
    state.status = query.get("status") || "";
    state.type = query.get("type") || "";
    state.search = query.get("search") || "";
    if (state.status) {
      el("reportStatusFilter").value = state.status;
    }
    if (state.type) {
      el("reportTypeFilter").value = state.type;
    }
    if (state.search) {
      el("reportSearch").value = state.search;
    }

    window.AppShell.init({
      page: "reports",
      breadcrumbs: ["Reports and Analytics"]
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      populateDistricts();
      bindFilters();
      bindTableActions();
      document.getElementById("reportFormModal").addEventListener("hidden.bs.modal", function () {
        window.UI.setButtonLoading(el("reportSaveButton"), false);
      });
      loadSchools().catch(function () {
        /* The form will retry loading schools when opened. */
      });
      loadPeriods().then(function () {
        loadSummary();
        loadReports();
      });
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
