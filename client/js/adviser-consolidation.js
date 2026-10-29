/* DepEd Learner Records — class adviser review and learner consolidation */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var F = window.FormsUI;
  var esc = F.esc;

  var QUARTERS = ["q1", "q2", "q3", "q4"];

  var SUBMISSION_STATUS = {
    not_started: { label: "Not started", tone: "neutral" },
    draft: { label: "Draft", tone: "neutral" },
    submitted: { label: "Submitted", tone: "violet" },
    under_review: { label: "Under review", tone: "warning" },
    returned: { label: "Returned", tone: "danger" },
    accepted: { label: "Accepted", tone: "success" },
    finalized: { label: "Finalized", tone: "teal" }
  };

  var CARD_STATUS = {
    draft: { label: "Draft", tone: "neutral" },
    submitted: { label: "Submitted", tone: "violet" },
    approved: { label: "Approved", tone: "success" },
    issued: { label: "Issued", tone: "teal" },
    finalized: { label: "Finalized", tone: "teal" },
    reopened: { label: "Reopened", tone: "warning" }
  };

  var state = {
    years: [],
    yearId: "",
    sectionId: "",
    search: "",
    tab: "submissions",
    overview: null,
    consolidation: null
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
    F.pageAlert("acAlert", tone, message, title);
  }

  function badge(map, key) {
    var meta = map[key] || { label: window.UI.titleCase(key || "—"), tone: "neutral" };
    return window.UI.pillarBadge(meta.label, meta.tone);
  }

  function loadYears() {
    return L.years().then(function (years) {
      state.years = years || [];
      var current = years.find(function (year) {
        return year.isCurrent;
      });
      state.yearId = (current || years[0] || {}).id || "";
      el("acYear").innerHTML = L.yearOptions(state.years, state.yearId, "Select a school year");
      return state.yearId;
    });
  }

  function loadSections() {
    return L.sections({ schoolId: L.schoolId() || undefined, schoolYearId: state.yearId || undefined }).then(
      function (list) {
        var select = el("acSection");
        select.innerHTML =
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

  function loadOverview() {
    var mount = el("acOverview");
    mount.innerHTML = window.UI.tableLoading(6);
    return L.apiGet("/class-records/adviser/overview", {
      schoolYearId: state.yearId || undefined,
      sectionId: state.sectionId || undefined,
      search: state.search || undefined
    })
      .then(function (payload) {
        state.overview = payload;
        renderOverview();
      })
      .catch(function (error) {
        mount.innerHTML = '<div class="empty-state">' + esc(L.friendlyError(error)) + "</div>";
      });
  }

  function renderOverview() {
    var payload = state.overview || { sections: [] };
    var sections = payload.sections || [];
    el("acScopeHint").textContent =
      (payload.schoolYear ? "School year " + payload.schoolYear.name + " · " : "") +
      sections.length +
      " section(s) in review scope.";
    if (!sections.length) {
      el("acOverview").innerHTML =
        '<div class="empty-state"><i class="bi bi-inboxes" aria-hidden="true"></i><h3>No sections found</h3><p>Ask the school head to assign you as the class adviser, or choose another school year.</p></div>';
      return;
    }
    el("acOverview").innerHTML = sections
      .map(function (section) {
        var rows = (section.subjects || [])
          .map(function (subject) {
            var cells = QUARTERS.map(function (quarter) {
              var period = subject.periods[quarter] || { status: "not_started" };
              if (period.submissionId) {
                return (
                  '<td data-label="' + quarter.toUpperCase() + '">' +
                  '<button type="button" class="btn btn-link btn-sm p-0" data-review-submission="' + period.submissionId + '">' +
                  badge(SUBMISSION_STATUS, period.status) +
                  ' <span class="field-hint">v' + period.version + "</span></button></td>"
                );
              }
              return '<td data-label="' + quarter.toUpperCase() + '">' + badge(SUBMISSION_STATUS, period.status) + "</td>";
            }).join("");
            return (
              "<tr>" +
              "<td><strong>" + esc(subject.subjectName) + "</strong><br><span class=\"field-hint\">" + esc(subject.subjectCode) + "</span></td>" +
              '<td data-label="Teacher">' + (subject.teacherName ? esc(subject.teacherName) : '<span class="field-hint">Unassigned</span>') + "</td>" +
              cells +
              "</tr>"
            );
          })
          .join("");
        var cards = section.reportCards || { total: 0, finalized: 0, draft: 0 };
        return (
          '<section class="adviser-section" style="padding:0 18px 18px">' +
          '<div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">' +
          "<div><h3 class=\"mb-1\">" + esc(section.section.name) + " · " + esc(section.section.gradeLevelName) + "</h3>" +
          '<p class="field-hint m-0">' +
          esc(section.section.schoolName) +
          " · " + section.section.learnerCount + " learners · Adviser " + esc(section.section.adviserName || "—") +
          "</p></div>" +
          '<div class="d-flex gap-2 flex-wrap">' +
          window.UI.pillarBadge(cards.finalized + " finalized", cards.finalized ? "success" : "neutral") +
          window.UI.pillarBadge(cards.draft + " open", cards.draft ? "warning" : "neutral") +
          '<button type="button" class="btn btn-light btn-sm" data-consolidate-section="' + section.section.id + '">Open consolidation</button>' +
          "</div></div>" +
          '<div class="table-responsive"><table class="app-table"><thead><tr>' +
          "<th scope=\"col\">Subject</th><th scope=\"col\">Teacher</th>" +
          QUARTERS.map(function (quarter) {
            return '<th scope="col">' + quarter.toUpperCase() + "</th>";
          }).join("") +
          "</tr></thead><tbody>" +
          (rows || '<tr><td colspan="6">This section has no offered subjects.</td></tr>') +
          "</tbody></table></div></section>"
        );
      })
      .join("");
  }

  function loadConsolidation() {
    var mount = el("acConsolidation");
    if (!state.sectionId) {
      mount.innerHTML =
        '<div class="empty-state"><i class="bi bi-diagram-3" aria-hidden="true"></i><h3>Select a section</h3><p>Learner consolidation is available one section at a time.</p></div>';
      return Promise.resolve();
    }
    mount.innerHTML = window.UI.tableLoading(6);
    return L.apiGet("/class-records/consolidation", {
      sectionId: state.sectionId,
      schoolYearId: state.yearId || undefined
    })
      .then(function (payload) {
        state.consolidation = payload;
        renderConsolidation();
      })
      .catch(function (error) {
        mount.innerHTML = '<div class="empty-state">' + esc(L.friendlyError(error)) + "</div>";
      });
  }

  function renderConsolidation() {
    var payload = state.consolidation;
    if (!payload) {
      return;
    }
    var subjects = payload.subjects || [];
    var summary = payload.summary || {};
    var head =
      "<tr><th scope=\"col\">Learner</th><th scope=\"col\">LRN</th>" +
      subjects
        .map(function (subject) {
          return '<th scope="col" class="text-center">' + esc(subject.subjectCode) + "</th>";
        })
        .join("") +
      '<th scope="col">Ready</th><th scope="col">Report card</th></tr>';
    var body = (payload.learners || [])
      .map(function (learner) {
        var cells = learner.subjects
          .map(function (subject) {
            var chips = QUARTERS.map(function (quarter) {
              var row = subject.quarters[quarter];
              return (
                '<span class="badge badge-light" title="' + esc(quarter.toUpperCase() + " " + row.status) + '">' +
                (row.grade === null ? "—" : row.grade) +
                "</span>"
              );
            }).join(" ");
            return (
              '<td class="text-center"><div class="d-flex flex-column align-items-center">' +
              '<span class="field-hint">' + esc(subject.subjectCode) + " final: " +
              (subject.finalGrade === null ? "—" : subject.finalGrade) + "</span>" +
              '<span class="mt-1">' + chips + "</span></div></td>"
            );
          })
          .join("");
        return (
          "<tr>" +
          "<td><strong>" + esc(learner.fullName) + "</strong></td>" +
          '<td data-label="LRN">' + esc(learner.lrn) + "</td>" +
          cells +
          "<td>" +
          (learner.readyForReportCard
            ? '<span class="status-badge status-badge--success"><span class="status-dot"></span>Ready</span>'
            : '<span class="status-badge status-badge--warning"><span class="status-dot"></span>' +
              learner.missingSubjects.length + " missing</span>") +
          "</td>" +
          "<td>" +
          (learner.reportCard
            ? badge(CARD_STATUS, learner.reportCard.status) + ' <span class="field-hint">v' + learner.reportCard.version + "</span>"
            : '<span class="field-hint">Not generated</span>') +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
    el("acConsolidation").innerHTML =
      '<div class="d-flex justify-content-between align-items-start flex-wrap gap-2 px-3 pt-3">' +
      "<div><h3 class=\"mb-1\">" + esc(payload.section.name) + " · " + esc(payload.section.gradeLevelName) + "</h3>" +
      '<p class="field-hint m-0">' + esc(payload.section.schoolName) + " · " + esc(payload.section.schoolYearName) +
      " · Adviser " + esc(payload.section.adviserName || "—") + "</p></div>" +
      '<div class="d-flex gap-2 flex-wrap align-items-center">' +
      window.UI.pillarBadge(summary.ready + " ready", summary.ready ? "success" : "neutral") +
      window.UI.pillarBadge(summary.incomplete + " incomplete", summary.incomplete ? "warning" : "neutral") +
      window.UI.pillarBadge(summary.reportCardsFinalized + " finalized cards", summary.reportCardsFinalized ? "teal" : "neutral") +
      (modulePermission("report_cards", "add")
        ? '<button type="button" class="btn btn-light btn-sm" data-generate-cards="' + payload.section.id + '">' +
          '<i class="bi bi-file-earmark-plus" aria-hidden="true"></i> Generate cards</button>'
        : "") +
      '<a class="btn btn-primary btn-sm" href="report-cards.html">Open report cards</a>' +
      "</div></div>" +
      '<div class="info-banner mx-3 my-3"><i class="bi bi-shield-check" aria-hidden="true"></i><div>' +
      "Quarter grades are accepted only by the class adviser (or an authorized school head). Accepted quarters feed the final grade; report card finalization is a separate, audited step." +
      "</div></div>" +
      '<div class="table-responsive"><table class="app-table"><thead>' + head + "</thead><tbody>" +
      (body || '<tr><td colspan="' + (subjects.length + 4) + '">No learners are enrolled in this section.</td></tr>') +
      "</tbody></table></div>";
  }

  function reviewSubmission(id) {
    L.apiGet("/class-records/submissions/" + encodeURIComponent(id))
      .then(function (payload) {
        var submission = payload.submission;
        var items = payload.items || [];
        var reviews = payload.reviews || [];
        var canReview = payload.canReview;
        var reviewRows = reviews
          .map(function (review) {
            return (
              "<li><strong>" + esc(window.UI.titleCase(review.action)) + "</strong> · " +
              esc(F.todayIso && review.createdAt ? new Date(review.createdAt).toLocaleString("en-PH") : review.createdAt || "") +
              (review.actorName ? " · " + esc(review.actorName) : "") +
              (review.comments ? "<br><span class=\"field-hint\">" + esc(review.comments) + "</span>" : "") +
              "</li>"
            );
          })
          .join("");
        var itemRows = items
          .map(function (item) {
            return (
              "<tr><td>" + esc(item.fullName) + "</td><td>" + esc(item.lrn) + "</td>" +
              '<td class="text-center">' + (item.initialGrade === null ? "—" : item.initialGrade) + "</td>" +
              '<td class="text-center"><strong>' + (item.quarterlyGrade === null ? "—" : item.quarterlyGrade) + "</strong></td></tr>"
            );
          })
          .join("");
        var dialog = L.modal({
          title: submission.subjectName + " · " + submission.sectionName,
          eyebrow: "Quarter submission · " + String(submission.period).toUpperCase(),
          size: "modal-xl",
          body:
            '<div id="acReviewAlert" class="d-none mb-3" role="alert"></div>' +
            '<div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">' +
            "<div><p class=\"field-hint m-0\">Teacher: " + esc(submission.teacherName || "—") +
            " · Version " + submission.version + "</p></div>" +
            "<div>" + badge(SUBMISSION_STATUS, submission.status) + "</div></div>" +
            '<div class="table-responsive"><table class="app-table"><thead><tr>' +
            "<th scope=\"col\">Learner</th><th scope=\"col\">LRN</th>" +
            '<th scope="col" class="text-center">Initial</th><th scope="col" class="text-center">Quarterly</th>' +
            "</tr></thead><tbody>" + (itemRows || '<tr><td colspan="4">No learner items were submitted.</td></tr>') +
            "</tbody></table></div>" +
            '<div class="row mt-3"><div class="col-md-7">' +
            "<h3 class=\"h6\">Review history</h3>" +
            (reviewRows ? '<ol class="review-timeline">' + reviewRows + "</ol>" : '<p class="field-hint">No reviews yet.</p>') +
            "</div><div class=\"col-md-5\">" +
            "<label for=\"acReviewComments\">Review note</label>" +
            '<textarea class="form-control" id="acReviewComments" rows="4" maxlength="1000" placeholder="Required when returning for correction (at least 5 characters).">' +
            esc(submission.reviewNotes || "") + "</textarea>" +
            "</div></div>",
          footer:
            '<button type="button" class="btn btn-light" data-dismiss="modal">Close</button>' +
            (canReview && ["submitted", "under_review"].includes(submission.status)
              ? '<button type="button" class="btn btn-warning" id="acReturnButton"><i class="bi bi-arrow-return-left" aria-hidden="true"></i> Return for correction</button>' +
                '<button type="button" class="btn btn-success" id="acAcceptButton"><i class="bi bi-check2-circle" aria-hidden="true"></i> Accept quarter</button>'
              : "")
        });
        var accept = dialog.element.querySelector("#acAcceptButton");
        var returnButton = dialog.element.querySelector("#acReturnButton");
        var comments = dialog.element.querySelector("#acReviewComments");
        var alertBox = dialog.element.querySelector("#acReviewAlert");

        function act(button, path, successTitle) {
          var note = comments.value.trim();
          if (path === "return" && note.length < 5) {
            comments.focus();
            window.UI.showAlert(alertBox, "warning", "Enter a review note with at least 5 characters so the teacher knows what to correct.");
            return;
          }
          window.UI.setButtonLoading(button, true);
          API.post("/class-records/submissions/" + submission.id + "/" + path, { comments: note })
            .then(function () {
              window.UI.toast(successTitle, "The subject teacher was notified.", "success");
              dialog.close();
              loadOverview();
              if (state.tab === "consolidation") {
                loadConsolidation();
              }
            })
            .catch(function (error) {
              window.UI.setButtonLoading(button, false);
              window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Review could not be saved");
            });
        }

        if (accept) {
          accept.addEventListener("click", function () {
            act(accept, "accept", "Quarter accepted");
          });
        }
        if (returnButton) {
          returnButton.addEventListener("click", function () {
            act(returnButton, "return", "Returned for correction");
          });
        }
      })
      .catch(function (error) {
        alertPage("danger", L.friendlyError(error), "Could not open the submission");
      });
  }

  function generateCards(sectionId) {
    var button = document.querySelector('[data-generate-cards="' + sectionId + '"]');
    if (button) {
      window.UI.setButtonLoading(button, true, "Generating…");
    }
    API.post("/class-records/report-cards/generate", {
      sectionId: Number(sectionId),
      schoolYearId: state.yearId || undefined
    })
      .then(function (payload) {
        var data = payload.data;
        window.UI.toast(
          "Report cards prepared",
          data.generated + " card(s) generated; " + data.incomplete.length + " still incomplete.",
          data.incomplete.length ? "warning" : "success"
        );
        loadConsolidation();
        loadOverview();
      })
      .catch(function (error) {
        alertPage("danger", L.friendlyError(error), "Report cards were not generated");
      })
      .then(function () {
        if (button) {
          window.UI.setButtonLoading(button, false);
        }
      });
  }

  function switchTab(tab) {
    state.tab = tab;
    Array.prototype.forEach.call(document.querySelectorAll("[data-ac-tab]"), function (button) {
      button.setAttribute("aria-selected", String(button.getAttribute("data-ac-tab") === tab));
    });
    el("acSubmissionsPanel").classList.toggle("d-none", tab !== "submissions");
    el("acConsolidationPanel").classList.toggle("d-none", tab !== "consolidation");
    if (tab === "consolidation") {
      loadConsolidation();
    }
  }

  function bind() {
    el("acYear").addEventListener("change", function () {
      state.yearId = this.value;
      state.sectionId = "";
      loadSections().then(function () {
        loadOverview();
        if (state.tab === "consolidation") {
          loadConsolidation();
        }
      });
    });
    el("acSection").addEventListener("change", function () {
      state.sectionId = this.value;
      if (state.tab === "consolidation") {
        loadConsolidation();
      }
    });
    el("acSearch").addEventListener(
      "input",
      window.UI.debounce(function () {
        state.search = this.value.trim();
        loadOverview();
      }, 300)
    );
    el("acRefresh").addEventListener("click", function () {
      loadOverview();
      if (state.tab === "consolidation") {
        loadConsolidation();
      }
    });
    document.querySelector(".module-tabs").addEventListener("click", function (event) {
      var button = event.target.closest("[data-ac-tab]");
      if (button) {
        switchTab(button.getAttribute("data-ac-tab"));
      }
    });
    el("acOverview").addEventListener("click", function (event) {
      var review = event.target.closest("[data-review-submission]");
      if (review) {
        reviewSubmission(review.getAttribute("data-review-submission"));
        return;
      }
      var consolidate = event.target.closest("[data-consolidate-section]");
      if (consolidate) {
        var sectionId = consolidate.getAttribute("data-consolidate-section");
        var select = el("acSection");
        select.value = sectionId;
        state.sectionId = sectionId;
        switchTab("consolidation");
      }
    });
    el("acConsolidation").addEventListener("click", function (event) {
      var generate = event.target.closest("[data-generate-cards]");
      if (generate) {
        generateCards(generate.getAttribute("data-generate-cards"));
      }
    });
  }

  function start(session) {
    if (!session) {
      return;
    }
    bind();
    if (!modulePermission("grade_submissions", "access")) {
      alertPage("warning", "You do not have access to adviser consolidation.", "Restricted");
      return;
    }
    loadYears()
      .then(loadSections)
      .then(loadOverview);
  }

  function init() {
    window.AppShell.init({
      page: "adviser-consolidation",
      breadcrumbs: ["Adviser Consolidation"]
    }).then(start);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
