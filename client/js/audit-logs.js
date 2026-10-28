/* School District Monitoring System — audit log page */
(function (window, document) {
  "use strict";

  var state = {
    session: null,
    districtId: "",
    search: "",
    action: "",
    entityType: "",
    page: 1,
    pageSize: 12,
    logs: [],
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

  function queryParams() {
    var query = {
      page: state.page,
      pageSize: state.pageSize,
      search: state.search,
      action: state.action,
      entityType: state.entityType
    };
    if (state.districtId) {
      query.districtId = state.districtId;
    }
    return query;
  }

  function entityLabel(type) {
    var labels = {
      user: "User",
      school: "School",
      school_report: "School report",
      announcement: "Announcement"
    };
    return labels[type] || window.UI.titleCase(type);
  }

  function detailValue(value) {
    if (typeof value === "boolean") {
      return value ? "Yes" : "No";
    }
    if (value === null || value === undefined) {
      return "—";
    }
    return String(value);
  }

  function detailsHtml(details) {
    if (!details || !Object.keys(details).length) {
      return '<span class="cell-muted">—</span>';
    }
    var keys = Object.keys(details);
    var chips = keys.slice(0, 4).map(function (key) {
      return (
        '<span class="audit-chip"><em>' + window.UI.escapeHtml(window.UI.titleCase(key)) + "</em> " +
        window.UI.escapeHtml(detailValue(details[key])) + "</span>"
      );
    });
    if (keys.length > 4) {
      chips.push('<span class="audit-chip audit-chip--more">+' + (keys.length - 4) + " more</span>");
    }
    return '<div class="audit-details">' + chips.join("") + "</div>";
  }

  function logRow(log) {
    var tone = window.UI.actionTone(log.action);
    return (
      '<tr data-log-id="' + log.id + '">' +
        '<td data-label="Timestamp"><span class="cell-strong">' + window.UI.escapeHtml(window.UI.dateTime(log.createdAt)) + "</span>" +
        '<small class="cell-sub">' + window.UI.escapeHtml(window.UI.relativeTime(log.createdAt)) + "</small></td>" +
        '<td data-label="Actor"><div class="user-cell user-cell--compact">' +
        '<span class="avatar avatar--xs">' + window.UI.escapeHtml(window.UI.initials(log.userName)) + "</span>" +
        "<div><strong>" + window.UI.escapeHtml(log.userName) + "</strong>" +
        (log.userId ? '<small class="cell-sub">Account #' + log.userId + "</small>" : "") +
        "</div></div></td>" +
        '<td data-label="Action"><div class="audit-action audit-action--' + tone + '">' +
        '<span class="audit-action__icon"><i class="bi ' + window.UI.actionIcon(log.action) + '" aria-hidden="true"></i></span>' +
        '<div><strong>' + window.UI.escapeHtml(window.UI.actionLabel(log.action)) + "</strong>" +
        '<small class="audit-code">' + window.UI.escapeHtml(log.action) + "</small></div></div></td>" +
        '<td data-label="Entity"><span class="cell-strong">' + window.UI.escapeHtml(entityLabel(log.entityType)) + "</span>" +
        (log.entityId ? '<small class="cell-sub">#' + window.UI.escapeHtml(log.entityId) + "</small>" : "") + "</td>" +
        '<td data-label="District"><span class="cell-muted">' + window.UI.escapeHtml(log.districtName || "System-wide") + "</span></td>" +
        '<td data-label="IP Address"><code class="ip-chip">' + window.UI.escapeHtml(log.ipAddress || "—") + "</code></td>" +
        '<td data-label="Details">' + detailsHtml(log.details) + "</td>" +
      "</tr>"
    );
  }

  function render(pagination) {
    var body = el("auditTableBody");
    var meta = el("auditTableMeta");
    if (!body) {
      return;
    }
    body.removeAttribute("aria-busy");
    if (!state.logs.length) {
      var filtered = Boolean(state.search || state.action || state.entityType);
      body.innerHTML =
        '<tr class="empty-row"><td colspan="7">' +
        window.UI.emptyState({
          icon: filtered ? "bi-search" : "bi-shield-check",
          title: filtered ? "No matching activity" : "No audit activity yet",
          message: filtered
            ? "Try a different search term or clear the current filters."
            : "Administrative actions and sign-in events will appear here as they occur.",
          action: filtered ? '<button type="button" class="btn btn-light btn-sm" data-empty-reset>Clear filters</button>' : ""
        }) + "</td></tr>";
      if (meta) {
        meta.textContent = "No entries found";
      }
      window.UI.pagination(el("auditPagination"), pagination || {}, function () {});
      return;
    }
    body.innerHTML = state.logs.map(logRow).join("");
    if (meta) {
      meta.textContent =
        window.UI.number(pagination.total) + (Number(pagination.total) === 1 ? " audit entry" : " audit entries") +
        " recorded";
    }
    window.UI.pagination(el("auditPagination"), pagination, function (page) {
      state.page = page;
      loadLogs();
    });
  }

  function loadLogs() {
    var body = el("auditTableBody");
    if (!body) {
      return;
    }
    var sequence = ++state.sequence;
    body.setAttribute("aria-busy", "true");
    body.innerHTML = window.UI.tableLoading(7, 7);
    setText("auditTableMeta", "Loading activity…");
    return API.get("/audit-logs", queryParams())
      .then(function (payload) {
        if (sequence !== state.sequence) {
          return;
        }
        state.logs = payload.data || [];
        render(payload.pagination || { total: state.logs.length, page: state.page, pageSize: state.pageSize, totalPages: 1 });
      })
      .catch(function (error) {
        if (sequence !== state.sequence || error.status === 401) {
          return;
        }
        body.removeAttribute("aria-busy");
        body.innerHTML =
          '<tr class="empty-row"><td colspan="7">' +
          window.UI.emptyState({
            icon: "bi-shield-x",
            title: "Audit trail unavailable",
            message: error.status === 403
              ? "Only system administrators can view the audit trail."
              : error.message || "The audit trail could not be loaded.",
            action: '<button type="button" class="btn btn-primary btn-sm" id="retryAudit">Try again</button>'
          }) + "</td></tr>";
        setText("auditTableMeta", "Unavailable");
        var retry = el("retryAudit");
        if (retry) {
          retry.addEventListener("click", loadLogs);
        }
      });
  }

  function resetFilters() {
    state.search = "";
    state.action = "";
    state.entityType = "";
    state.page = 1;
    el("auditSearch").value = "";
    el("auditActionFilter").value = "";
    el("auditEntityFilter").value = "";
    loadLogs();
  }

  function bind() {
    el("auditSearch").addEventListener(
      "input",
      window.UI.debounce(function (event) {
        state.search = event.target.value.trim();
        state.page = 1;
        loadLogs();
      }, 320)
    );
    el("auditActionFilter").addEventListener("change", function (event) {
      state.action = event.target.value;
      state.page = 1;
      loadLogs();
    });
    el("auditEntityFilter").addEventListener("change", function (event) {
      state.entityType = event.target.value;
      state.page = 1;
      loadLogs();
    });
    el("resetAuditFilters").addEventListener("click", resetFilters);
    el("auditTableBody").addEventListener("click", function (event) {
      if (event.target.closest("[data-empty-reset]")) {
        resetFilters();
      }
    });
    var refresh = el("refreshAudit");
    refresh.addEventListener("click", function () {
      window.UI.setButtonLoading(refresh, true, "Refreshing…");
      loadLogs()
        .catch(function () {
          /* Errors are shown in the table state. */
        })
        .then(function () {
          window.UI.setButtonLoading(refresh, false);
        });
    });
  }

  function populateDistricts() {
    var session = state.session;
    var control = el("auditDistrictControl");
    var select = el("auditDistrictFilter");
    if (!control || !select || !session.districts || !session.districts.length) {
      return;
    }
    select.innerHTML = '<option value="">All districts</option>' +
      session.districts.map(function (district) {
        return '<option value="' + district.id + '">' +
          window.UI.escapeHtml(district.name) + " (" + window.UI.escapeHtml(district.code) + ")</option>";
      }).join("");
    control.classList.remove("d-none");
    select.addEventListener("change", function () {
      state.districtId = select.value;
      state.page = 1;
      loadLogs();
    });
  }

  function init() {
    var query = new URLSearchParams(window.location.search);
    state.search = query.get("search") || "";
    state.action = query.get("action") || "";
    state.entityType = query.get("entityType") || "";
    if (state.search) {
      el("auditSearch").value = state.search;
    }
    if (state.action) {
      el("auditActionFilter").value = state.action;
    }
    if (state.entityType) {
      el("auditEntityFilter").value = state.entityType;
    }

    window.AppShell.init({
      page: "audit",
      breadcrumbs: ["Audit Logs"],
      requiredPermission: "canViewAuditLogs"
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      populateDistricts();
      bind();
      loadLogs();
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
