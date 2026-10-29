/* DepEd Learner Records — learner register page */
(function (window, document) {
  "use strict";

  var state = {
    session: null,
    schoolYearId: "",
    gradeLevelId: "",
    sectionId: "",
    enrollmentStatus: "",
    status: "active",
    search: "",
    sort: "name",
    direction: "asc",
    page: 1,
    pageSize: 10,
    totalPages: 1,
    sequence: 0
  };

  function el(id) {
    return document.getElementById(id);
  }

  function params() {
    return {
      schoolYearId: state.schoolYearId || undefined,
      gradeLevelId: state.gradeLevelId || undefined,
      sectionId: state.sectionId || undefined,
      enrollmentStatus: state.enrollmentStatus || undefined,
      status: state.status,
      search: state.search || undefined,
      sort: state.sort,
      direction: state.direction,
      page: state.page,
      pageSize: state.pageSize
    };
  }

  function loadSummaries() {
    window.LearnerUI.apiGet("/learners/summary", {
      schoolYearId: state.schoolYearId || undefined
    })
      .then(function (summary) {
        var totals = summary.totals || {};
        var year = summary.schoolYear;
        el("learnerKpiTotal").textContent = window.UI.number(totals.learners);
        el("learnerKpiEnrolled").textContent = window.UI.number(totals.enrolled);
        el("learnerKpiIncomplete").textContent = window.UI.number(totals.incomplete);
        el("learnerKpiSections").textContent = window.UI.number(totals.sections);
        el("learnerKpiYear").textContent = year ? year.name : "No SY";
        el("learnerKpiEnrolledNote").textContent = year
          ? "Enrolled for " + year.name
          : "No current school year configured";
        el("learnerKpiSectionsNote").textContent =
          window.UI.number(totals.advisers) +
          " adviser" +
          (Number(totals.advisers) === 1 ? "" : "s") +
          " · " +
          window.UI.number(totals.teachers) +
          " teacher" +
          (Number(totals.teachers) === 1 ? "" : "s");
        var total = Number(totals.learners || 0);
        var incomplete = Number(totals.incomplete || 0);
        el("learnerKpiIncompleteRate").textContent = total
          ? Math.round((incomplete / total) * 100) + "% flagged"
          : "No learners";
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        ["learnerKpiTotal", "learnerKpiEnrolled", "learnerKpiIncomplete", "learnerKpiSections"].forEach(function (id) {
          var node = el(id);
          if (node) {
            node.textContent = "—";
          }
        });
      });
  }

  function populateYears() {
    return window.LearnerUI.years().then(function (years) {
      var select = el("learnerYearFilter");
      select.innerHTML = window.LearnerUI.yearOptions(years, state.schoolYearId, "Select school year");
      if (!state.schoolYearId) {
        var current = years.find(function (year) {
          return year.isCurrent;
        });
        state.schoolYearId = current ? String(current.id) : years[0] ? String(years[0].id) : "";
        select.value = state.schoolYearId;
      }
    });
  }

  function populateGrades() {
    return window.LearnerUI.grades().then(function (grades) {
      var select = el("learnerGradeFilter");
      select.innerHTML = window.LearnerUI.gradeOptions(grades, state.gradeLevelId, "All grade levels");
      select.classList.toggle("d-none", !grades.length);
    });
  }

  function populateSections() {
    var select = el("learnerSectionFilter");
    if (!state.gradeLevelId && !state.schoolYearId) {
      select.innerHTML = '<option value="">All sections</option>';
      return Promise.resolve();
    }
    return window.LearnerUI.sections({
      schoolYearId: state.schoolYearId || undefined,
      gradeLevelId: state.gradeLevelId || undefined
    }).then(function (list) {
      select.innerHTML = window.LearnerUI.options(
        list,
        "id",
        function (section) {
          return section.name + " · " + section.gradeLevel;
        },
        state.sectionId,
        "All sections"
      );
    });
  }

  function rowHtml(learner) {
    var enrollment = learner.currentEnrollment;
    var gradeSection = enrollment
      ? window.UI.escapeHtml((enrollment.gradeLevel || "—") + (enrollment.sectionName ? " · " + enrollment.sectionName : ""))
      : '<span class="text-muted">Not enrolled</span>';
    var missing = learner.profileComplete
      ? ""
      : '<span class="field-hint">Missing: ' + window.UI.escapeHtml(learner.missingFields.join(", ")) + "</span>";
    return (
      "<tr>" +
      '<td><code class="lrn-code">' + window.UI.escapeHtml(learner.lrn) + "</code></td>" +
      '<td><div class="learner-table-name"><span class="avatar">' +
      window.UI.escapeHtml(window.UI.initials(learner.fullName)) +
      "</span><span><strong><a href=\"learner.html?id=" +
      learner.id +
      '">' +
      window.UI.escapeHtml(learner.formalName) +
      "</a></strong><small>" +
      window.UI.escapeHtml(learner.fullName) +
      (learner.isArchived ? " · archived" : "") +
      "</small></span></div></td>" +
      "<td>" +
      window.UI.escapeHtml(window.UI.titleCase(learner.sex)) +
      " · " +
      (learner.age === null || learner.age === undefined ? "—" : learner.age + " yrs") +
      "</td>" +
      "<td>" +
      gradeSection +
      (enrollment ? "" : '<small class="d-block text-muted">No record for this year</small>') +
      "</td>" +
      "<td>" +
      window.UI.escapeHtml((enrollment && enrollment.adviserName) || "—") +
      "</td>" +
      "<td>" +
      (enrollment
        ? window.LearnerUI.badge(enrollment.status)
        : '<span class="status-badge status-badge--neutral"><span class="status-dot"></span>Not enrolled</span>') +
      "</td>" +
      '<td><div class="d-flex flex-column">' +
      window.LearnerUI.profileBadge(learner.profileComplete) +
      missing +
      "</div></td>" +
      '<td><div class="row-actions">' +
      '<a class="btn btn-light" href="learner.html?id=' +
      learner.id +
      '" title="Open profile"><i class="bi bi-eye" aria-hidden="true"></i><span class="sr-only">View</span></a>' +
      (window.LearnerUI.permission("canManageLearners")
        ? '<button type="button" class="btn btn-light" data-edit="' +
          learner.id +
          '" title="Edit profile"><i class="bi bi-pencil-square" aria-hidden="true"></i><span class="sr-only">Edit</span></button>' +
          (learner.isArchived
            ? '<button type="button" class="btn btn-light" data-restore="' +
              learner.id +
              '" title="Restore record"><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i><span class="sr-only">Restore</span></button>'
            : '<button type="button" class="btn btn-light" data-archive="' +
              learner.id +
              '" title="Archive record"><i class="bi bi-archive" aria-hidden="true"></i><span class="sr-only">Archive</span></button>')
        : "") +
      "</div></td>" +
      "</tr>"
    );
  }

  function cacheRows(list) {
    state.rows = {};
    list.forEach(function (learner) {
      state.rows[learner.id] = learner;
    });
  }

  function loadTable() {
    var sequence = ++state.sequence;
    var body = el("learnerTableBody");
    var meta = el("learnerTableMeta");
    body.innerHTML = window.LearnerUI.skeletonRows(8, 6);
    meta.textContent = "Loading learners…";
    API.get("/learners", params())
      .then(function (payload) {
        if (sequence !== state.sequence) {
          return;
        }
        var list = payload.data || [];
        cacheRows(list);
        state.totalPages = payload.pagination ? payload.pagination.totalPages : 1;
        if (!list.length) {
          body.innerHTML =
            '<tr><td colspan="8" class="empty-cell">' +
            window.UI.escapeHtml(
              state.search
                ? "No learners match your search and filters."
                : "No learner records yet. Register the first learner to begin."
            ) +
            "</td></tr>";
        } else {
          body.innerHTML = list.map(rowHtml).join("");
        }
        meta.textContent =
          window.UI.number(payload.pagination.total) +
          " learner" +
          (payload.pagination.total === 1 ? "" : "s") +
          (payload.meta && payload.meta.schoolYear ? " · " + payload.meta.schoolYear.name : "");
        window.UI.pagination(el("learnerPagination"), payload.pagination, function (page) {
          state.page = page;
          loadTable();
          window.UI.scrollToTop();
        });
      })
      .catch(function (error) {
        if (sequence !== state.sequence || error.status === 401) {
          return;
        }
        body.innerHTML =
          '<tr><td colspan="8" class="empty-cell">' +
          window.UI.escapeHtml(window.LearnerUI.friendlyError(error)) +
          "</td></tr>";
        meta.textContent = "Learners could not be loaded.";
      });
  }

  function openCreate() {
    window.LearnerForm.open({
      onSaved: function () {
        refreshAll();
      }
    });
  }

  function openEdit(id) {
    var learner = state.rows ? state.rows[id] : null;
    if (!learner) {
      return;
    }
    window.LearnerForm.open({
      learner: learner,
      onSaved: function () {
        refreshAll();
      }
    });
  }

  function archiveLearner(id, restore) {
    var learner = state.rows ? state.rows[id] : null;
    if (!learner) {
      return;
    }
    window.UI.confirm({
      title: restore ? "Restore learner record?" : "Archive learner record?",
      message: restore
        ? learner.fullName + " will return to the active learner register. Historical records are preserved."
        : learner.fullName +
          " will be removed from the active register. The permanent profile, enrollment history, and audit trail are preserved and can be restored.",
      confirmLabel: restore ? "Restore" : "Archive",
      tone: restore ? "primary" : "danger"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      API.patch("/learners/" + id + (restore ? "/restore" : "/archive"))
        .then(function () {
          window.UI.toast(
            restore ? "Learner restored" : "Learner archived",
            learner.fullName + (restore ? " is active again." : " was archived."),
            "success"
          );
          refreshAll();
        })
        .catch(function (error) {
          if (error.status === 401) {
            return;
          }
          window.UI.showAlert(
            el("learnerPageAlert"),
            "danger",
            window.LearnerUI.friendlyError(error),
            "Could not update the learner"
          );
        });
    });
  }

  function refreshAll() {
    loadSummaries();
    loadTable();
  }

  function wireTableActions() {
    el("learnerTableBody").addEventListener("click", function (event) {
      var edit = event.target.closest("[data-edit]");
      if (edit) {
        openEdit(edit.dataset.edit);
        return;
      }
      var archive = event.target.closest("[data-archive]");
      if (archive) {
        archiveLearner(archive.dataset.archive, false);
        return;
      }
      var restore = event.target.closest("[data-restore]");
      if (restore) {
        archiveLearner(restore.dataset.restore, true);
      }
    });

    document.querySelectorAll("#learnerTable thead [data-sort]").forEach(function (button) {
      button.addEventListener("click", function () {
        var sort = button.dataset.sort;
        if (state.sort === sort) {
          state.direction = state.direction === "asc" ? "desc" : "asc";
        } else {
          state.sort = sort;
          state.direction = "asc";
        }
        state.page = 1;
        loadTable();
      });
    });
  }

  function wireFilters() {
    var search = el("learnerSearch");
    search.addEventListener(
      "input",
      window.UI.debounce(function () {
        state.search = search.value.trim();
        state.page = 1;
        loadTable();
      }, 260)
    );

    el("learnerYearFilter").addEventListener("change", function (event) {
      state.schoolYearId = event.target.value;
      state.sectionId = "";
      state.page = 1;
      populateSections();
      refreshAll();
    });

    el("learnerGradeFilter").addEventListener("change", function (event) {
      state.gradeLevelId = event.target.value;
      state.sectionId = "";
      state.page = 1;
      populateSections();
      loadTable();
    });

    el("learnerSectionFilter").addEventListener("change", function (event) {
      state.sectionId = event.target.value;
      state.page = 1;
      loadTable();
    });

    el("learnerEnrollmentFilter").addEventListener("change", function (event) {
      state.enrollmentStatus = event.target.value;
      state.page = 1;
      loadTable();
    });

    el("learnerStatusFilter").addEventListener("change", function (event) {
      state.status = event.target.value;
      state.page = 1;
      loadTable();
    });

    el("resetLearnerFilters").addEventListener("click", function () {
      state.gradeLevelId = "";
      state.sectionId = "";
      state.enrollmentStatus = "";
      state.status = "active";
      state.search = "";
      state.sort = "name";
      state.direction = "asc";
      state.page = 1;
      search.value = "";
      el("learnerGradeFilter").value = "";
      el("learnerSectionFilter").value = "";
      el("learnerEnrollmentFilter").value = "";
      el("learnerStatusFilter").value = "active";
      populateSections();
      loadTable();
    });
  }

  function init() {
    window.AppShell.init({
      page: "learners",
      breadcrumbs: ["Learners"]
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      if (session.permissions.canManageLearners) {
        el("newLearnerButton").classList.remove("d-none");
        el("newLearnerButton").addEventListener("click", openCreate);
      }
      var searchParam = new URLSearchParams(window.location.search).get("search");
      if (searchParam) {
        state.search = searchParam;
        el("learnerSearch").value = searchParam;
      }
      var urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get("sectionId")) {
        state.sectionId = urlParams.get("sectionId");
      }
      if (urlParams.get("schoolYearId")) {
        state.schoolYearId = urlParams.get("schoolYearId");
      }
      if (urlParams.get("gradeLevelId")) {
        state.gradeLevelId = urlParams.get("gradeLevelId");
      }
      wireTableActions();
      wireFilters();
      populateYears()
        .then(function () {
          return Promise.all([populateGrades(), populateSections()]);
        })
        .then(function () {
          refreshAll();
        });
      var footer = el("footerUpdated");
      if (footer) {
        footer.textContent =
          "Data refreshed " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
