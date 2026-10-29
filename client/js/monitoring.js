/* District monitoring workspace */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var F = window.FormsUI;
  var state = {
    session: null,
    yearId: "",
    schoolId: "",
    districtId: "",
    schools: [],
    tab: "overview",
    data: null
  };

  function el(id) {
    return document.getElementById(id);
  }

  var ACTION_LABEL = {
    generated: "Generated",
    submitted: "Submitted for review",
    returned: "Returned for correction",
    rejected: "Rejected",
    approved: "Approved",
    finalized: "Finalized"
  };

  function query() {
    return {
      schoolId: state.schoolId || undefined,
      districtId: state.districtId || undefined,
      schoolYearId: state.yearId || undefined
    };
  }

  function loadFilters() {
    var hasDistrict = Boolean(state.session.permissions.canSelectDistrict);
    if (hasDistrict) {
      el("monitorDistrictControl").classList.remove("d-none");
    }
    return Promise.all([L.schools(), L.years()]).then(function (results) {
      state.schools = results[0] || [];
      state.years = results[1] || [];
      var current = state.years.find(function (year) {
        return year.isCurrent;
      });
      state.yearId = state.yearId || (current ? String(current.id) : state.years[0] ? String(state.years[0].id) : "");
      el("monitorYearFilter").innerHTML = L.yearOptions(state.years, state.yearId, "Select school year");

      if (hasDistrict) {
        var districts = [];
        state.schools.forEach(function (school) {
          if (!districts.some(function (district) { return String(district.id) === String(school.districtId); })) {
            districts.push({ id: school.districtId, name: school.districtName });
          }
        });
        el("monitorDistrictFilter").innerHTML = L.options(districts, "id", "name", state.districtId, "All districts");
      }
      if (!L.schoolId()) {
        el("monitorSchoolControl").classList.remove("d-none");
      }
      renderSchoolOptions();
      wireFilters();
    });
  }

  function renderSchoolOptions() {
    var list = state.schools.filter(function (school) {
      return !state.districtId || String(school.districtId) === String(state.districtId);
    });
    el("monitorSchoolFilter").innerHTML = L.options(list, "id", "name", state.schoolId, "All schools");
  }

  function wireFilters() {
    el("monitorYearFilter").addEventListener("change", function (event) {
      state.yearId = event.target.value;
      loadOverview();
    });
    el("monitorDistrictFilter").addEventListener("change", function (event) {
      state.districtId = event.target.value;
      state.schoolId = "";
      renderSchoolOptions();
      loadOverview();
    });
    var schoolSelect = el("monitorSchoolFilter");
    if (schoolSelect) {
      schoolSelect.addEventListener("change", function (event) {
        state.schoolId = event.target.value;
        loadOverview();
      });
    }
    el("refreshMonitoring").addEventListener("click", function () {
      loadOverview();
      if (state.tab === "discrepancies") loadDiscrepancies();
      if (state.tab === "audit") loadAudit();
    });
  }

  function loadOverview() {
    el("monitoringScopeLabel").textContent = "Loading submission status…";
    return L.apiGet("/monitoring", query())
      .then(function (data) {
        state.data = data;
        el("monitoringYearBadge").innerHTML = '<span class="status-dot"></span>' + F.esc(data.schoolYear.name);
        el("monitoringScopeLabel").textContent =
          (state.schoolId ? L.schoolName(state.schoolId) : state.districtId ? "Selected district" : "All schools in scope") +
          " · " + data.schoolYear.name;
        renderStats(data.totals);
        renderSchools(data.schools);
        renderDeadlines(data.deadlines);
      })
      .catch(function (error) {
        if (error.status === 401) return;
        F.pageAlert("monitoringAlert", "danger", L.friendlyError(error), "Monitoring data unavailable");
        el("monitorFooter").textContent = "Submission status could not be loaded.";
      });
  }

  function renderStats(totals) {
    var cards = [
      { label: "Schools monitored", value: totals.schools, note: "Active schools in scope", tone: "" },
      { label: "Forms generated", value: totals.formsGenerated, note: "Latest version per form and school", tone: "" },
      { label: "Approved / finalized", value: totals.approved, note: "Of " + totals.expected + " expected form records", tone: "success" },
      { label: "Awaiting review", value: totals.submitted, note: "Submitted and unreviewed", tone: "violet" },
      { label: "Returned", value: totals.returned, note: "Sent back for correction", tone: "warning" },
      { label: "Validation failed", value: totals.validationFailed, note: "Blocked by source data issues", tone: "danger" },
      { label: "Overdue", value: totals.overdue, note: "Past the reporting deadline", tone: "danger" }
    ];
    el("monitorStats").innerHTML = cards
      .map(function (card) {
        return (
          '<div class="mini-stat' + (card.tone ? " mini-stat--" + card.tone : "") + '">' +
          "<span>" + F.esc(card.label) + "</span>" +
          "<strong>" + window.UI.number(card.value) + "</strong>" +
          "<small>" + F.esc(card.note) + "</small></div>"
        );
      })
      .join("");
  }

  function renderSchools(schools) {
    var body = el("monitorSchoolsBody");
    if (!schools.length) {
      body.innerHTML = F.emptyRow(11, "No active schools are in this scope.");
      el("monitorFooter").textContent = "No schools to monitor.";
      return;
    }
    body.innerHTML = schools
      .map(function (school) {
        return (
          "<tr><td><strong>" + F.esc(school.schoolName) + "</strong>" +
          '<span class="record-note">' + F.esc(school.schoolCode) + "</span></td>" +
          "<td>" + F.esc(school.districtName) + "</td>" +
          '<td class="text-right">' + school.formsGenerated + "</td>" +
          '<td class="text-right">' + school.approved + "</td>" +
          '<td class="text-right">' + school.submitted + "</td>" +
          '<td class="text-right">' + (school.returned || "—") + "</td>" +
          '<td class="text-right">' + (school.validationFailed || "—") + "</td>" +
          '<td class="text-right">' + school.missing + "</td>" +
          '<td class="text-right">' + (school.overdue ? '<span class="status-badge status-badge--danger"><span class="status-dot"></span>' + school.overdue + "</span>" : "—") + "</td>" +
          "<td>" + F.completion(school.completion) + "</td>" +
          '<td class="text-right"><a class="btn btn-light btn-sm" href="school-forms.html?schoolId=' +
          encodeURIComponent(school.schoolId) + "&schoolYearId=" + encodeURIComponent(state.yearId) +
          '" title="Open the forms workspace for this school"><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i></a></td></tr>'
        );
      })
      .join("");
    el("monitorFooter").textContent =
      schools.length + (schools.length === 1 ? " school" : " schools") +
      " · completion counts only approved or finalized forms.";
  }

  function renderDeadlines(deadlines) {
    var body = el("monitorDeadlinesBody");
    if (!deadlines || !deadlines.length) {
      body.innerHTML = F.emptyRow(5, "No deadlines have been configured for this school year.");
      return;
    }
    var schoolsById = {};
    state.schools.forEach(function (school) {
      schoolsById[String(school.id)] = school;
    });
    body.innerHTML = deadlines
      .map(function (deadline) {
        var scope = deadline.schoolId
          ? (schoolsById[String(deadline.schoolId)] || {}).name || "School #" + deadline.schoolId
          : "District-wide";
        return (
          "<tr><td><strong>" + F.esc(deadline.formCode.toUpperCase()) + "</strong></td>" +
          "<td>" + F.esc(deadline.title) + "</td>" +
          "<td>" + F.esc(window.UI.phDate(deadline.dueDate)) + "</td>" +
          "<td>" + F.esc(scope) + "</td>" +
          "<td>" + F.esc(deadline.period || "Whole year") + "</td></tr>"
        );
      })
      .join("");
  }

  function loadDiscrepancies() {
    var mount = el("discrepancyList");
    mount.innerHTML = '<div class="skeleton skeleton-block" style="height:120px;margin:16px"></div>';
    return L.apiGet("/monitoring/discrepancies", query())
      .then(function (rows) {
        if (!rows.length) {
          mount.innerHTML = '<div class="empty-state"><i class="bi bi-check2-circle" aria-hidden="true"></i><p>No incomplete, failed, or returned submissions in this scope.</p></div>';
          return;
        }
        mount.innerHTML = rows
          .map(function (row) {
            return (
              '<details class="discrepancy">' +
              '<summary class="discrepancy__head">' +
              '<span class="form-code">' + F.esc(row.formCode.toUpperCase()) + "</span>" +
              '<span class="discrepancy__copy"><strong>' + F.esc(row.formTitle) + "</strong>" +
              "<span>" + F.esc(row.schoolName) +
              (row.gradeLevelName || row.sectionName
                ? " · " + F.esc([row.gradeLevelName, row.sectionName].filter(Boolean).join(" · "))
                : "") +
              (row.period ? " · " + F.esc(row.period) : "") + "</span></span>" +
              F.statusBadge(row.status) +
              '<span class="validation-counts">' +
              (row.errorCount ? '<span class="is-error">' + row.errorCount + " errors</span>" : "") +
              (row.warningCount ? "<span>" + row.warningCount + " warnings</span>" : "") +
              "</span>" +
              "</summary>" +
              '<div class="discrepancy__panel">' +
              F.completion(row.completeness) +
              '<div class="mt-2">' + F.issueList(row.errors, row.warnings) + "</div>" +
              (row.reviewNotes
                ? '<div class="info-banner info-banner--warning mt-2"><i class="bi bi-chat-left-text" aria-hidden="true"></i><div>' + F.esc(row.reviewNotes) + "</div></div>"
                : "") +
              '<p class="field-hint mt-2 mb-0">Last updated ' + F.esc(window.UI.phDateTime(row.updatedAt)) + "</p>" +
              "</div></details>"
            );
          })
          .join("");
      })
      .catch(function (error) {
        if (error.status === 401) return;
        mount.innerHTML = '<div class="empty-state"><i class="bi bi-cloud-slash" aria-hidden="true"></i><p>' + F.esc(L.friendlyError(error)) + "</p></div>";
      });
  }

  function loadAudit() {
    var body = el("auditBody");
    body.innerHTML = L.skeletonRows(6, 5);
    return L.apiGet("/monitoring/audit-trail", query())
      .then(function (rows) {
        if (!rows.length) {
          body.innerHTML = F.emptyRow(6, "No form review actions have been recorded yet.");
          return;
        }
        body.innerHTML = rows
          .map(function (row) {
            return (
              "<tr><td>" + F.esc(window.UI.phDateTime(row.createdAt)) + "</td>" +
              "<td><strong>" + F.esc(row.formCode.toUpperCase()) + "</strong></td>" +
              "<td>" + F.esc(row.schoolName) + "</td>" +
              "<td>" + F.esc(ACTION_LABEL[row.action] || window.UI.titleCase(row.action)) + "</td>" +
              "<td>" + F.esc(row.actorName || "System") +
              (row.actorRole ? '<span class="record-note">' + F.esc(window.UI.titleCase(row.actorRole)) + "</span>" : "") +
              "</td>" +
              '<td style="max-width:280px;white-space:normal">' + F.esc(row.comments || "—") + "</td></tr>"
            );
          })
          .join("");
      })
      .catch(function (error) {
        if (error.status === 401) return;
        body.innerHTML = F.emptyRow(6, L.friendlyError(error));
      });
  }

  function setTab(name) {
    state.tab = name;
    ["overview", "discrepancies", "audit"].forEach(function (key) {
      var tab = el("tab" + key.charAt(0).toUpperCase() + key.slice(1));
      var panel = el("panel" + key.charAt(0).toUpperCase() + key.slice(1));
      var active = key === name;
      tab.setAttribute("aria-selected", String(active));
      panel.classList.toggle("d-none", !active);
    });
    if (name === "discrepancies") loadDiscrepancies();
    if (name === "audit") loadAudit();
  }

  function init() {
    window.AppShell.init({
      page: "monitoring",
      breadcrumbs: ["District Monitoring"],
      requiredPermission: "canViewMonitoring"
    }).then(function (session) {
      if (!session) return;
      state.session = session;
      document.querySelectorAll(".module-tabs [data-tab]").forEach(function (button) {
        button.addEventListener("click", function () {
          setTab(button.dataset.tab);
        });
      });
      loadFilters().then(loadOverview).catch(function (error) {
        if (error.status === 401) return;
        F.pageAlert("monitoringAlert", "danger", L.friendlyError(error), "Monitoring could not start");
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
