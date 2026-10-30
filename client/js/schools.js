/* School District Monitoring System — school register page */
(function (window, document) {
  "use strict";

  var REPORTS = [
    { key: "reviewed", label: "Reviewed", tone: "reviewed" },
    { key: "submitted", label: "Submitted", tone: "submitted" },
    { key: "late", label: "Late", tone: "late" },
    { key: "pending", label: "Pending", tone: "pending" },
    { key: "missing", label: "Not submitted", tone: "missing" }
  ];

  var VIEWS = {
    register: {
      eyebrow: "School registry",
      title: "School register",
      subtitle: "Manage every enrolled school, its leadership, and reporting compliance.",
      tableTitle: "Enrolled schools",
      tableSubtitle: "Reporting compliance and operating status for every school.",
      breadcrumbs: ["Schools"],
      documentTitle: "Schools"
    },
    enrollment: {
      eyebrow: "Enrollment monitoring",
      title: "School enrollment",
      subtitle: "Compare student enrollment and staffing across every monitored school.",
      tableTitle: "Enrollment by school",
      tableSubtitle: "Student and teaching personnel counts for each enrolled school.",
      breadcrumbs: ["Schools", "Enrollment"],
      documentTitle: "School Enrollment"
    },
    performance: {
      eyebrow: "Performance monitoring",
      title: "School performance",
      subtitle: "Review performance scores and identify schools that may need support.",
      tableTitle: "Performance by school",
      tableSubtitle: "Performance scores alongside enrollment and reporting status.",
      breadcrumbs: ["Schools", "Performance"],
      documentTitle: "School Performance"
    }
  };

  var state = {
    session: null,
    view: "register",
    districtId: "",
    table: null,
    sequence: 0,
    insightSequence: 0
  };

  function params() {
    return new URLSearchParams(window.location.search);
  }

  function readView() {
    var view = params().get("view") || "";
    return VIEWS[view] ? view : "register";
  }

  function districtParams() {
    return state.districtId ? { districtId: state.districtId } : {};
  }

  function scopeLabel() {
    var session = state.session;
    if (session.user.districtName) {
      return session.user.districtName;
    }
    if (state.districtId) {
      var match = (session.districts || []).find(function (district) {
        return String(district.id) === String(state.districtId);
      });
      return match ? match.name : "Selected district";
    }
    return "All districts";
  }

  function applyView() {
    var meta = VIEWS[state.view];
    var setText = function (id, value) {
      var node = document.getElementById(id);
      if (node) {
        node.textContent = value;
      }
    };
    setText("schoolPageEyebrow", meta.eyebrow);
    setText("schoolPageTitle", meta.title);
    setText("schoolPageSubtitle", meta.subtitle);
    setText("schoolRegisterHeading", meta.tableTitle);
    setText("schoolRegisterSubtitle", meta.tableSubtitle);
    document.title = meta.documentTitle + " · School District Monitoring System";
    document.querySelectorAll("[data-view-link]").forEach(function (link) {
      var active = link.dataset.viewLink === state.view;
      link.classList.toggle("is-active", active);
      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function renderKpis(summary) {
    var setText = function (id, value) {
      var node = document.getElementById(id);
      if (node) {
        node.textContent = value;
      }
    };
    var total = Number(summary.totalSchools || 0);
    var active = Number(summary.activeSchools || 0);
    setText("schoolKpiTotal", window.UI.number(total));
    setText("schoolKpiActive", window.UI.number(active));
    setText("schoolKpiStudents", window.UI.number(summary.totalStudents));
    setText("schoolKpiTeachers", window.UI.number(summary.totalTeachers));
    setText("schoolKpiRate", total ? Math.round((active / total) * 100) + "% active" : "No schools");
  }

  function loadKpis() {
    var sequence = ++state.sequence;
    API.get("/dashboard/summary", districtParams())
      .then(function (payload) {
        if (sequence !== state.sequence) {
          return;
        }
        renderKpis(payload.data || {});
      })
      .catch(function (error) {
        if (sequence !== state.sequence || error.status === 401) {
          return;
        }
        ["schoolKpiTotal", "schoolKpiActive", "schoolKpiStudents", "schoolKpiTeachers", "schoolKpiRate"].forEach(function (id) {
          var node = document.getElementById(id);
          if (node) {
            node.textContent = "—";
          }
        });
      });
  }

  function insightShell(title, subtitle, chip, icon) {
    var titleNode = document.getElementById("schoolInsightTitle");
    var subtitleNode = document.getElementById("schoolInsightSubtitle");
    var chipNode = document.getElementById("schoolInsightChip");
    if (titleNode) {
      titleNode.textContent = title;
    }
    if (subtitleNode) {
      subtitleNode.textContent = subtitle;
    }
    if (chipNode) {
      chipNode.innerHTML = '<i class="bi ' + icon + '" aria-hidden="true"></i> ' + chip;
    }
  }

  function insightSkeleton() {
    return (
      '<div class="insight-skeleton">' +
      '<span class="skeleton skeleton-text" style="width:82%"></span>' +
      '<span class="skeleton skeleton-text" style="width:64%"></span>' +
      '<span class="skeleton skeleton-text" style="width:74%"></span>' +
      '<span class="skeleton skeleton-text" style="width:52%"></span>' +
      "</div>"
    );
  }

  function insightBody(html) {
    var node = document.getElementById("schoolInsightBody");
    if (node) {
      node.innerHTML = html;
    }
  }

  function insightError(message) {
    insightBody(
      '<div class="insight-error"><i class="bi bi-exclamation-circle" aria-hidden="true"></i>' +
        "<p>" + window.UI.escapeHtml(message) + "</p>" +
        '<button type="button" class="btn btn-light btn-sm" id="retryInsight">Try again</button></div>'
    );
    var retry = document.getElementById("retryInsight");
    if (retry) {
      retry.addEventListener("click", loadInsight);
    }
  }

  function loadReportingInsight() {
    insightShell(
      "Reporting compliance",
      "Monthly enrollment reports for the current period",
      "Reports",
      "bi-clipboard-check"
    );
    insightBody(insightSkeleton());
    API.get("/dashboard/report-status", districtParams())
      .then(function (payload) {
        var data = payload.data || {};
        var statuses = data.statuses || {};
        var total = Number(data.total || 0);
        if (!total) {
          insightBody(
            window.UI.emptyState({
              icon: "bi-clipboard-x",
              title: "No reports for this period",
              message: "School reports will appear here once they are recorded for " + window.UI.month(data.period) + "."
            })
          );
          return;
        }
        var segments = REPORTS.map(function (report) {
          var count = Number(statuses[report.key] || 0);
          var share = total ? (count / total) * 100 : 0;
          return (
            '<span class="insight-seg insight-seg--' +
            report.tone +
            '" style="width:' +
            share.toFixed(2) +
            '%" title="' +
            window.UI.escapeHtml(report.label + ": " + count + " schools") +
            '"></span>'
          );
        }).join("");
        var legend = REPORTS.map(function (report) {
          var count = Number(statuses[report.key] || 0);
          return (
            '<li><span class="insight-swatch insight-swatch--' + report.tone + '"></span>' +
            "<span>" + report.label + "</span><strong>" + window.UI.number(count) + "</strong></li>"
          );
        }).join("");
        var reported = total - Number(statuses.pending || 0) - Number(statuses.missing || 0);
        insightBody(
          '<div class="insight-meter" role="img" aria-label="Reporting status for ' + window.UI.escapeHtml(window.UI.month(data.period)) + '">' +
            segments +
            "</div>" +
            '<ul class="insight-legend">' + legend + "</ul>" +
            '<p class="insight-foot"><i class="bi bi-calendar3" aria-hidden="true"></i> ' +
            window.UI.escapeHtml(window.UI.month(data.period)) +
            " · <strong>" + window.UI.number(reported) + "</strong> of <strong>" + window.UI.number(total) +
            "</strong> schools have submitted a monthly enrollment report.</p>"
        );
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        insightError("Reporting data could not be loaded. " + (error.message || ""));
      });
  }

  function loadEnrollmentInsight() {
    insightShell(
      "Enrollment concentration",
      "Largest schools by student population in " + scopeLabel(),
      "Students",
      "bi-people"
    );
    insightBody(insightSkeleton());
    API.get("/dashboard/enrollment", districtParams())
      .then(function (payload) {
        var schools = (payload.data && payload.data.schools) || [];
        if (!schools.length) {
          insightBody(
            window.UI.emptyState({
              icon: "bi-people",
              title: "No enrollment data",
              message: "Add a school with an enrollment count to see how student populations compare."
            })
          );
          return;
        }
        var total = schools.reduce(function (sum, school) {
          return sum + Number(school.students || 0);
        }, 0);
        var largest = schools.reduce(function (current, school) {
          return Number(school.students) > Number(current.students) ? school : current;
        }, schools[0]);
        var average = total / schools.length;
        var rows = schools.slice(0, 6).map(function (school) {
          var share = largest.students ? (Number(school.students) / Number(largest.students)) * 100 : 0;
          return (
            '<div class="insight-row">' +
              '<div class="insight-row__label"><span>' + window.UI.escapeHtml(school.name) + "</span><strong>" +
              window.UI.number(school.students) + "</strong></div>" +
              '<div class="insight-row__track"><span class="insight-row__fill insight-row__fill--blue" style="width:' +
              share.toFixed(2) + '%"></span></div>' +
            "</div>"
          );
        }).join("");
        insightBody(
          rows +
          '<p class="insight-foot"><i class="bi bi-diagram-3" aria-hidden="true"></i> Average <strong>' +
          window.UI.number(Math.round(average)) + "</strong> students per school · Largest: <strong>" +
          window.UI.escapeHtml(largest.name) + "</strong> (" + window.UI.number(largest.students) + ")</p>"
        );
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        insightError("Enrollment data could not be loaded. " + (error.message || ""));
      });
  }

  function loadPerformanceInsight() {
    insightShell(
      "Performance leaders",
      "Highest performing schools in " + scopeLabel(),
      "Scores",
      "bi-graph-up-arrow"
    );
    insightBody(insightSkeleton());
    API.get("/dashboard/performance", districtParams())
      .then(function (payload) {
        var schools = (payload.data && payload.data.schools) || [];
        if (!schools.length) {
          insightBody(
            window.UI.emptyState({
              icon: "bi-graph-up",
              title: "No performance scores",
              message: "Record a performance score for a school to begin comparing outcomes."
            })
          );
          return;
        }
        var average = schools.reduce(function (sum, school) {
          return sum + Number(school.score || 0);
        }, 0) / schools.length;
        var top = schools[0];
        var lowest = schools[schools.length - 1];
        var rows = schools.slice(0, 6).map(function (school) {
          return (
            '<div class="insight-row">' +
              '<div class="insight-row__label"><span>' + window.UI.escapeHtml(school.name) + "</span><strong>" +
              Number(school.score).toFixed(1) + "</strong></div>" +
              '<div class="insight-row__track"><span class="insight-row__fill insight-row__fill--teal" style="width:' +
              Math.max(0, Math.min(100, Number(school.score))).toFixed(2) + '%"></span></div>' +
            "</div>"
          );
        }).join("");
        insightBody(
          rows +
          '<p class="insight-foot"><i class="bi bi-award" aria-hidden="true"></i> Average score <strong>' +
          average.toFixed(1) + "</strong> · Highest: <strong>" + window.UI.escapeHtml(top.name) +
          "</strong> (" + Number(top.score).toFixed(1) + ") · Lowest: <strong>" +
          window.UI.escapeHtml(lowest.name) + "</strong> (" + Number(lowest.score).toFixed(1) + ")</p>"
        );
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        insightError("Performance data could not be loaded. " + (error.message || ""));
      });
  }

  function loadInsight() {
    if (state.view === "enrollment") {
      loadEnrollmentInsight();
      return;
    }
    if (state.view === "performance") {
      loadPerformanceInsight();
      return;
    }
    loadReportingInsight();
  }

  function refreshData() {
    loadKpis();
    loadInsight();
  }

  function readDistrictFromUrl() {
    var districtId = params().get("districtId") || "";
    if (!/^\d+$/.test(districtId)) {
      return "";
    }
    var exists = (state.session.districts || []).some(function (district) {
      return String(district.id) === districtId;
    });
    return exists ? districtId : "";
  }

  function populateDistricts() {
    var session = state.session;
    var control = document.getElementById("schoolDistrictControl");
    var select = document.getElementById("schoolDistrictFilter");
    if (!session.permissions.canSelectDistrict || !control || !select) {
      return;
    }
    var options = ['<option value="">All districts</option>'];
    (session.districts || []).forEach(function (district) {
      options.push(
        '<option value="' + district.id + '">' +
        window.UI.escapeHtml(district.name) + " (" + window.UI.escapeHtml(district.code) + ")</option>"
      );
    });
    select.innerHTML = options.join("");
    select.value = state.districtId;
    control.classList.remove("d-none");
    select.addEventListener("change", function () {
      state.districtId = select.value;
      if (state.table) {
        state.table.page = 1;
        state.table.load();
      }
      refreshData();
    });
  }

  function setupTable() {
    var session = state.session;
    var table = new window.SchoolTable({
      root: document.getElementById("schoolRegisterTable"),
      ids: {
        body: "schoolTableBody",
        meta: "schoolTableMeta",
        pagination: "schoolPagination",
        search: "schoolSearch",
        type: "schoolTypeFilter",
        status: "schoolStatusFilter",
        report: "reportStatusFilter",
        reset: "resetSchoolFilters"
      },
      pageSize: 10,
      defaultSort: state.view === "enrollment" ? "students" : state.view === "performance" ? "performance" : "name",
      defaultDirection: state.view === "register" ? "asc" : "desc",
      defaultStatus: "",
      canManage: Boolean(session.permissions.canManageSchools),
      getContext: function () {
        return { districtId: state.districtId };
      },
      onChanged: function () {
        refreshData();
      }
    });
    state.table = table;
    table.load();

    var addButton = document.getElementById("addSchoolButton");
    if (addButton && session.permissions.canManageSchools) {
      addButton.classList.remove("d-none");
      addButton.addEventListener("click", function () {
        table.openCreate();
      });
    }

    var search = params().get("search");
    if (search) {
      table.setSearch(search);
    }
  }

  function openSchoolFromUrl() {
    var schoolId = params().get("schoolId");
    if (!schoolId || !/^\d+$/.test(schoolId)) {
      return;
    }
    var session = state.session;
    var query = state.districtId ? { districtId: state.districtId } : undefined;
    API.get("/schools/" + encodeURIComponent(schoolId), query)
      .then(function (payload) {
        window.SchoolUI.openView({
          school: payload.data,
          canManage: Boolean(session.permissions.canManageSchools),
          onEdit: function (school) {
            window.SchoolUI.openForm({
              school: school,
              districts: session.districts,
              canSelectDistrict: Boolean(session.permissions.canSelectDistrict),
              onSaved: function () {
                if (state.table) {
                  state.table.afterChange();
                } else {
                  refreshData();
                }
              }
            });
          },
          onChanged: function () {
            if (state.table) {
              state.table.afterChange();
            } else {
              refreshData();
            }
          }
        });
        var clean = new URL(window.location.href);
        clean.searchParams.delete("schoolId");
        window.history.replaceState({}, "", clean.pathname + (clean.search || ""));
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        window.UI.showAlert(
          document.getElementById("schoolPageAlert"),
          "warning",
          error.status === 404
            ? "The requested school could not be found in your district scope."
            : error.message || "The school record could not be opened.",
          "School unavailable"
        );
      });
  }

  function init() {
    state.view = readView();
    applyView();

    window.AppShell.init({
      page: "schools",
      breadcrumbs: VIEWS[state.view].breadcrumbs
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      state.districtId = readDistrictFromUrl();
      populateDistricts();
      setupTable();
      if (window.SchoolImport) {
        window.SchoolImport.init({
          session: session,
          onImported: function () {
            if (state.table) {
              state.table.afterChange();
            } else {
              refreshData();
            }
          }
        });
      }
      refreshData();
      openSchoolFromUrl();
      document.addEventListener("sdms:schoolsearch", function (event) {
        if (state.table) {
          state.table.setSearch(event.detail.search);
        }
      });
      var footer = document.getElementById("footerUpdated");
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
