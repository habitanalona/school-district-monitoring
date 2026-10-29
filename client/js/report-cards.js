/* DepEd Learner Records — SF 9 report card register, finalization, and printing */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var F = window.FormsUI;
  var esc = F.esc;

  var CARD_STATUS = {
    draft: { label: "Draft", tone: "neutral" },
    submitted: { label: "Submitted", tone: "violet" },
    approved: { label: "Approved", tone: "success" },
    issued: { label: "Issued", tone: "teal" },
    finalized: { label: "Finalized", tone: "teal" },
    reopened: { label: "Reopened", tone: "warning" }
  };

  var DECISION_LABEL = {
    pending: "Pending",
    promoted: "Promoted",
    retained: "Retained",
    conditional: "Conditionally promoted",
    completed: "Completed",
    other: "Other"
  };

  var state = {
    years: [],
    yearId: "",
    sectionId: "",
    status: "",
    search: "",
    items: [],
    canFinalize: false,
    totals: {}
  };

  function el(id) {
    return document.getElementById(id);
  }

  function modulePermission(moduleKey, action) {
    var session = L.session() || {};
    var modules = (session.permissions && session.permissions.modules) || {};
    return Boolean(modules[moduleKey] && modules[moduleKey][action || "access"]);
  }

  function alertPage(tone, message, title) {
    F.pageAlert("rcAlert", tone, message, title);
  }

  function badge(key) {
    var meta = CARD_STATUS[key] || { label: window.UI.titleCase(key || "—"), tone: "neutral" };
    return window.UI.pillarBadge(meta.label, meta.tone);
  }

  function scopeParams() {
    return {
      schoolYearId: state.yearId || undefined,
      sectionId: state.sectionId || undefined,
      status: state.status || undefined,
      search: state.search || undefined
    };
  }

  function queryString(params) {
    var bits = [];
    Object.keys(params || {}).forEach(function (key) {
      var value = params[key];
      if (value !== undefined && value !== null && value !== "") {
        bits.push(encodeURIComponent(key) + "=" + encodeURIComponent(value));
      }
    });
    return bits.length ? "?" + bits.join("&") : "";
  }

  function loadYears() {
    return L.years().then(function (years) {
      state.years = years || [];
      var current = years.find(function (year) {
        return year.isCurrent;
      });
      state.yearId = (current || years[0] || {}).id || "";
      el("rcYear").innerHTML = L.yearOptions(state.years, state.yearId, "Select a school year");
      return state.yearId;
    });
  }

  function loadSections() {
    return L.sections({ schoolId: L.schoolId() || undefined, schoolYearId: state.yearId || undefined }).then(
      function (list) {
        el("rcSection").innerHTML =
          '<option value="">All my sections</option>' +
          (list || [])
            .map(function (section) {
              return L.option(section.id, section.name + " · " + (section.gradeLevel || ""));
            })
            .join("");
        return list;
      }
    );
  }

  function load() {
    el("rcBody").innerHTML = window.UI.tableLoading(8);
    return L.apiGet("/class-records/report-cards", scopeParams())
      .then(function (payload) {
        state.items = payload.items || [];
        state.canFinalize = payload.canFinalize;
        state.totals = payload.totals || {};
        window.UI.hideAlert(el("rcAlert"));
        render();
      })
      .catch(function (error) {
        el("rcBody").innerHTML = F.emptyRow(8, L.friendlyError(error));
        alertPage("danger", L.friendlyError(error), "Could not load report cards");
      });
  }

  function render() {
    var totals = state.totals;
    el("rcHint").textContent = state.items.length
      ? state.items.length + " report card(s) in the selected scope."
      : "No report cards match the selected scope.";
    el("rcTotals").innerHTML =
      window.UI.pillarBadge((totals.total || 0) + " cards", "neutral") +
      window.UI.pillarBadge((totals.ready || 0) + " ready", totals.ready ? "success" : "neutral") +
      window.UI.pillarBadge((totals.incomplete || 0) + " incomplete", totals.incomplete ? "warning" : "neutral") +
      window.UI.pillarBadge((totals.finalized || 0) + " finalized", totals.finalized ? "teal" : "neutral");

    if (!state.items.length) {
      el("rcBody").innerHTML = F.emptyRow(
        8,
        "No report cards exist for this scope yet. Generate cards from the adviser consolidation page."
      );
      return;
    }
    var canEdit = modulePermission("report_cards", "edit");
    el("rcBody").innerHTML = state.items
      .map(function (item) {
        var actions =
          '<button type="button" class="btn btn-light btn-sm" data-view-card="' + item.id + '">View</button> ' +
          '<a class="btn btn-light btn-sm" href="/api/class-records/report-cards/' + item.id +
          '/render?format=pdf" target="_blank" rel="noopener">PDF</a> ';
        if (canEdit && item.complete && item.status !== "finalized") {
          actions +=
            '<button type="button" class="btn btn-primary btn-sm" data-finalize-card="' + item.id + '">Finalize</button>';
        } else if (canEdit && item.status === "finalized") {
          actions +=
            '<button type="button" class="btn btn-warning btn-sm" data-reopen-card="' + item.id + '">Reopen</button>';
        }
        return (
          "<tr>" +
          "<td><strong>" + esc(item.learnerName) + "</strong><br><span class=\"field-hint\">" +
          esc(item.gradeLevelName || "") + "</span></td>" +
          '<td data-label="LRN">' + esc(item.lrn) + "</td>" +
          "<td>" + esc(item.sectionName || "—") + "</td>" +
          '<td data-label="Subjects">' + item.eligibleSubjects + " / " + item.subjectCount +
          (item.complete
            ? ""
            : '<br><span class="field-hint">' + item.missingSubjects.length + " subject(s) incomplete</span>") +
          "</td>" +
          '<td class="text-center">' + (item.generalAverage === null ? "—" : item.generalAverage) + "</td>" +
          "<td>" + badge(item.status) + "</td>" +
          '<td data-label="Version">v' + item.version + "</td>" +
          '<td class="text-right">' + actions + "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function openCard(id) {
    L.apiGet("/class-records/report-cards/" + encodeURIComponent(id))
      .then(function (payload) {
        var card = payload.card;
        var data = payload.data;
        var revisions = payload.revisions || [];
        var subjectRows = (data.subjects || [])
          .map(function (subject, index) {
            return (
              "<tr>" +
              "<td>" + (index + 1) + "</td>" +
              "<td>" + esc(subject.subjectName) + "</td>" +
              '<td class="text-center">' + (subject.q1 === null ? "" : subject.q1) + "</td>" +
              '<td class="text-center">' + (subject.q2 === null ? "" : subject.q2) + "</td>" +
              '<td class="text-center">' + (subject.q3 === null ? "" : subject.q3) + "</td>" +
              '<td class="text-center">' + (subject.q4 === null ? "" : subject.q4) + "</td>" +
              '<td class="text-center"><strong>' + (subject.final === null ? "—" : subject.final) + "</strong></td>" +
              "<td>" + esc(subject.status) + "</td>" +
              "</tr>"
            );
          })
          .join("");
        var missing = (data.missingSubjects || [])
          .map(function (subject) {
            return "<li>" + esc(subject.subjectName) + " — " + esc(subject.status) + "</li>";
          })
          .join("");
        var revisionRows = revisions
          .map(function (revision) {
            return (
              "<li><strong>v" + revision.version + "</strong> · " + esc(revision.reason || "—") +
              '<br><span class="field-hint">' +
              esc(revision.createdAt ? new Date(revision.createdAt).toLocaleString("en-PH") : "") +
              (revision.createdByName ? " · " + esc(revision.createdByName) : "") +
              "</span></li>"
            );
          })
          .join("");
        var canFinalize = payload.can.finalize;
        var canReopen = payload.can.reopen;
        var dialog = L.modal({
          title: data.enrollment.learnerName + " — SF 9",
          eyebrow: "Report card v" + card.version + " · " + card.statusLabel,
          size: "modal-xl",
          body:
            '<div id="rcModalAlert" class="d-none mb-3" role="alert"></div>' +
            '<div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">' +
            "<div><p class=\"field-hint m-0\">" + esc(data.enrollment.lrn) + " · " +
            esc([data.enrollment.gradeLevelName, data.enrollment.sectionName].filter(Boolean).join(" / ")) +
            " · " + esc(data.enrollment.schoolYearName) + "</p></div>" +
            "<div>" + badge(card.status) + (card.frozen ? ' <span class="status-badge status-badge--teal"><span class="status-dot"></span>Frozen snapshot</span>' : "") + "</div></div>" +
            (card.complete
              ? '<div class="info-banner mb-3"><i class="bi bi-check2-circle" aria-hidden="true"></i><div>All ' +
                data.subjects.length + " offered subjects have finalized final grades. General average: <strong>" +
                (data.generalAverage === null ? "—" : data.generalAverage) + "</strong>.</div></div>"
              : '<div class="info-banner mb-3"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><div><strong>Incomplete.</strong> ' +
                (missing ? "<ul class=\"mb-0\">" + missing + "</ul>" : "Some subjects still need finalized grades.") +
                "</div></div>") +
            '<div class="table-responsive"><table class="app-table"><thead><tr>' +
            "<th scope=\"col\">#</th><th scope=\"col\">Learning area</th>" +
            '<th scope="col" class="text-center">Q1</th><th scope="col" class="text-center">Q2</th>' +
            '<th scope="col" class="text-center">Q3</th><th scope="col" class="text-center">Q4</th>' +
            '<th scope="col" class="text-center">Final</th><th scope="col">Status</th></tr></thead><tbody>' +
            (subjectRows || '<tr><td colspan="8">No subjects are offered to this grade level.</td></tr>') +
            "</tbody></table></div>" +
            '<div class="row mt-3"><div class="col-md-6">' +
            "<h3 class=\"h6\">Attendance</h3>" +
            '<p class="field-hint">Present ' + data.attendance.present + " · Absent " + data.attendance.absent +
            " · Tardy " + data.attendance.tardy + " · Excused " + data.attendance.excused +
            " · Half day " + data.attendance.half_day + "</p>" +
            "<h3 class=\"h6 mt-3\">Promotion</h3>" +
            '<p class="field-hint">' +
            (data.promotion
              ? esc(DECISION_LABEL[data.promotion.decision] || data.promotion.decision) +
                " · workflow " + esc(data.promotion.workflowStatus)
              : "No promotion decision recorded.") +
            "</p></div>" +
            '<div class="col-md-6"><h3 class="h6">History</h3>' +
            (revisionRows ? '<ol class="review-timeline">' + revisionRows + "</ol>" : '<p class="field-hint">No saved versions yet.</p>') +
            (card.reopenReason
              ? '<p class="field-hint">Last reopen reason: ' + esc(card.reopenReason) + "</p>"
              : "") +
            "</div></div>" +
            (canFinalize || canReopen
              ? '<div class="mt-3"><label for="rcReason">' + (canReopen ? "Reopen reason (required)" : "Finalization note (optional)") +
                "</label><textarea class=\"form-control\" id=\"rcReason\" rows=\"2\" maxlength=\"1000\"></textarea></div>"
              : ""),
          footer:
            '<button type="button" class="btn btn-light" data-dismiss="modal">Close</button>' +
            '<a class="btn btn-light" href="/api/class-records/report-cards/' + card.id +
            '/render?format=html" target="_blank" rel="noopener"><i class="bi bi-printer" aria-hidden="true"></i> Print view</a>' +
            '<a class="btn btn-light" href="/api/class-records/report-cards/' + card.id +
            '/render?format=pdf" target="_blank" rel="noopener"><i class="bi bi-file-earmark-pdf" aria-hidden="true"></i> PDF</a>' +
            (canReopen
              ? '<button type="button" class="btn btn-warning" id="rcReopenConfirm"><i class="bi bi-unlock" aria-hidden="true"></i> Reopen</button>'
              : "") +
            (canFinalize
              ? '<button type="button" class="btn btn-primary" id="rcFinalizeConfirm"><i class="bi bi-lock" aria-hidden="true"></i> Finalize snapshot</button>'
              : "")
        });
        var reason = dialog.element.querySelector("#rcReason");
        var alertBox = dialog.element.querySelector("#rcModalAlert");
        var finalizeButton = dialog.element.querySelector("#rcFinalizeConfirm");
        var reopenButton = dialog.element.querySelector("#rcReopenConfirm");

        if (finalizeButton) {
          finalizeButton.addEventListener("click", function () {
            if (!data.complete) {
              window.UI.showAlert(alertBox, "danger", "Every offered subject needs a finalized final grade before this card can be finalized.");
              return;
            }
            window.UI.setButtonLoading(finalizeButton, true, "Finalizing…");
            API.post("/class-records/report-cards/" + card.id + "/finalize", {
              reason: reason ? reason.value.trim() : ""
            })
              .then(function () {
                dialog.close();
                window.UI.toast("Report card finalized", "An immutable snapshot was stored.", "success");
                load();
              })
              .catch(function (error) {
                window.UI.setButtonLoading(finalizeButton, false);
                window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Finalization failed");
              });
          });
        }
        if (reopenButton) {
          reopenButton.addEventListener("click", function () {
            var note = reason ? reason.value.trim() : "";
            if (note.length < 5) {
              if (reason) {
                reason.focus();
              }
              window.UI.showAlert(alertBox, "warning", "Enter a reason of at least 5 characters so the reopen is auditable.");
              return;
            }
            window.UI.setButtonLoading(reopenButton, true, "Reopening…");
            API.post("/class-records/report-cards/" + card.id + "/reopen", { reason: note })
              .then(function () {
                dialog.close();
                window.UI.toast("Report card reopened", "The previous snapshot remains in the revision history.", "warning");
                load();
              })
              .catch(function (error) {
                window.UI.setButtonLoading(reopenButton, false);
                window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Reopen failed");
              });
          });
        }
      })
      .catch(function (error) {
        alertPage("danger", L.friendlyError(error), "Could not open the report card");
      });
  }

  function generate() {
    if (!state.sectionId) {
      alertPage("warning", "Choose a section first. Report cards are generated for one section at a time.", "Section required");
      return;
    }
    var button = el("rcGenerate");
    window.UI.setButtonLoading(button, true, "Generating…");
    API.post("/class-records/report-cards/generate", {
      sectionId: Number(state.sectionId),
      schoolYearId: state.yearId || undefined
    })
      .then(function (payload) {
        var data = payload.data;
        window.UI.toast(
          "Report cards generated",
          data.generated + " card(s); " + data.incomplete.length + " incomplete; " + data.locked.length + " finalized and left unchanged.",
          data.incomplete.length ? "warning" : "success"
        );
        load();
      })
      .catch(function (error) {
        alertPage("danger", L.friendlyError(error), "Cards were not generated");
      })
      .then(function () {
        window.UI.setButtonLoading(button, false);
      });
  }

  function requireSectionForBatch() {
    if (!state.sectionId) {
      alertPage("warning", "Choose a section before printing a batch.", "Section required");
      return false;
    }
    return true;
  }

  function bind() {
    el("rcYear").addEventListener("change", function () {
      state.yearId = this.value;
      state.sectionId = "";
      loadSections().then(load);
    });
    el("rcSection").addEventListener("change", function () {
      state.sectionId = this.value;
      load();
    });
    el("rcStatus").addEventListener("change", function () {
      state.status = this.value;
      load();
    });
    el("rcSearch").addEventListener(
      "input",
      window.UI.debounce(function () {
        state.search = this.value.trim();
        load();
      }, 300)
    );
    el("rcGenerate").addEventListener("click", generate);
    el("rcBatchPdf").addEventListener("click", function () {
      if (requireSectionForBatch()) {
        window.open(
          "/api/class-records/report-cards/batch" + queryString({
            sectionId: state.sectionId,
            schoolYearId: state.yearId,
            format: "pdf"
          }),
          "_blank",
          "noopener"
        );
      }
    });
    el("rcBatchPrint").addEventListener("click", function () {
      if (requireSectionForBatch()) {
        window.open(
          "/api/class-records/report-cards/batch" + queryString({
            sectionId: state.sectionId,
            schoolYearId: state.yearId,
            format: "html"
          }),
          "_blank",
          "noopener"
        );
      }
    });
    el("rcExportCsv").addEventListener("click", function () {
      window.location.href = "/api/class-records/report-cards/export" + queryString(scopeParams());
    });
    el("rcBody").addEventListener("click", function (event) {
      var view = event.target.closest("[data-view-card]");
      if (view) {
        openCard(view.getAttribute("data-view-card"));
        return;
      }
      var finalize = event.target.closest("[data-finalize-card]");
      if (finalize) {
        openCard(finalize.getAttribute("data-finalize-card"));
      }
      var reopen = event.target.closest("[data-reopen-card]");
      if (reopen) {
        openCard(reopen.getAttribute("data-reopen-card"));
      }
    });
  }

  function start(session) {
    if (!session) {
      return;
    }
    bind();
    if (!modulePermission("report_cards", "access")) {
      alertPage("warning", "You do not have access to report cards.", "Restricted");
      return;
    }
    if (!modulePermission("report_cards", "add")) {
      el("rcGenerate").classList.add("d-none");
    }
    loadYears()
      .then(loadSections)
      .then(load);
  }

  function init() {
    window.AppShell.init({
      page: "report-cards",
      breadcrumbs: ["Report Cards"]
    }).then(start);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
