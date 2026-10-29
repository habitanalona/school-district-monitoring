/* DepEd Learner Records — subject teacher class records and quarterly grading */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var F = window.FormsUI;
  var esc = F.esc;

  var QUARTERS = ["q1", "q2", "q3", "q4"];
  var QUARTER_LABEL = { q1: "First quarter", q2: "Second quarter", q3: "Third quarter", q4: "Fourth quarter" };

  var RECORD_STATUS = {
    draft: { label: "Draft", tone: "neutral" },
    in_progress: { label: "In progress", tone: "info" },
    ready_for_submission: { label: "Ready to submit", tone: "primary" },
    submitted: { label: "Submitted", tone: "violet" },
    under_review: { label: "Under review", tone: "warning" },
    returned: { label: "Returned", tone: "warning" },
    accepted: { label: "Accepted", tone: "success" },
    finalized: { label: "Finalized", tone: "teal" }
  };

  var SUBMISSION_STATUS = {
    not_started: { label: "Not started", tone: "neutral" },
    draft: { label: "Draft", tone: "neutral" },
    submitted: { label: "Submitted", tone: "violet" },
    under_review: { label: "Under review", tone: "warning" },
    returned: { label: "Returned", tone: "danger" },
    accepted: { label: "Accepted", tone: "success" },
    finalized: { label: "Finalized", tone: "teal" }
  };

  var state = {
    years: [],
    yearId: "",
    sectionId: "",
    subjectId: "",
    search: "",
    items: [],
    detail: null,
    quarter: "q1"
  };

  function el(id) {
    return document.getElementById(id);
  }

  function modulePermission(moduleKey, action) {
    var session = L.session() || {};
    var modules = (session.permissions && session.permissions.modules) || {};
    return Boolean(modules[moduleKey] && modules[moduleKey][action || "access"]);
  }

  function canEdit() {
    return modulePermission("class_records", "edit");
  }

  function canAdd() {
    return modulePermission("class_records", "add");
  }

  function alertPage(tone, message, title) {
    F.pageAlert("crAlert", tone, message, title);
  }

  function badge(map, key) {
    var meta = map[key] || { label: window.UI.titleCase(key || "—"), tone: "neutral" };
    return window.UI.pillarBadge(meta.label, meta.tone);
  }

  function formatNumber(value) {
    return value === null || value === undefined || value === "" ? "—" : value;
  }

  function quarterFor(date) {
    var month = Number(String(date || "").slice(5, 7));
    if (!month) {
      return "q1";
    }
    if (month <= 8) {
      return "q1";
    }
    if (month <= 11) {
      return "q2";
    }
    return month === 12 ? "q3" : "q4";
  }

  function loadYears() {
    return L.years().then(function (years) {
      state.years = years || [];
      state.yearId = L.session() && L.session().user && L.session().user.schoolId
        ? (years.find(function (year) { return year.isCurrent; }) || years[0] || {}).id || ""
        : (years.find(function (year) { return year.isCurrent; }) || years[0] || {}).id || "";
      var select = el("crYear");
      select.innerHTML = L.yearOptions(state.years, state.yearId, "Select a school year");
      return state.yearId;
    });
  }

  function loadSections() {
    return L.sections({ schoolId: L.schoolId() || undefined, schoolYearId: state.yearId || undefined }).then(
      function (list) {
        var select = el("crSection");
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

  function loadDashboard() {
    var body = el("crDashboardBody");
    body.innerHTML = window.UI.tableLoading(9);
    el("crDashboardHint").textContent = "Loading teaching assignments…";
    return L.apiGet("/class-records/dashboard", {
      schoolYearId: state.yearId || undefined,
      sectionId: state.sectionId || undefined,
      subjectId: state.subjectId || undefined,
      search: state.search || undefined
    })
      .then(function (payload) {
        state.items = (payload && payload.items) || [];
        renderDashboard(payload);
      })
      .catch(function (error) {
        body.innerHTML = F.emptyRow(9, L.friendlyError(error));
        alertPage("danger", L.friendlyError(error), "Could not load class records");
      });
  }

  function renderDashboard(payload) {
    var items = state.items;
    var body = el("crDashboardBody");
    el("crCountLabel").textContent = items.length + (items.length === 1 ? " class" : " classes");
    el("crDashboardHint").textContent = payload && payload.schoolYear
      ? "School year " + payload.schoolYear.name + " · " + items.length + " teaching assignment(s)."
      : "No teaching assignments were found.";
    if (!items.length) {
      body.innerHTML = F.emptyRow(9, "No teaching assignments match this selection. Ask the school head to assign subjects to you.");
      return;
    }
    body.innerHTML = items
      .map(function (item, index) {
        var quarters = QUARTERS.map(function (quarter) {
          var period = item.periods[quarter] || { status: "not_started" };
          return '<td data-label="' + QUARTER_LABEL[quarter] + '">' + badge(SUBMISSION_STATUS, period.status) + "</td>";
        }).join("");
        var action = item.classRecordId
          ? '<button type="button" class="btn btn-primary btn-sm" data-open-record="' + item.classRecordId + '">Open record</button>'
          : '<button type="button" class="btn btn-light btn-sm" data-init-index="' + index + '">Start record</button>';
        return (
          "<tr>" +
          "<td data-label=\"Section\"><strong>" + esc(item.sectionName) + "</strong><br><span class=\"field-hint\">" + esc(item.gradeLevelName) + "<\/span></td>" +
          "<td data-label=\"Subject\">" + esc(item.subjectName) + "<br><span class=\"field-hint\">" + esc(item.subjectCode) + "<\/span></td>" +
          '<td data-label="Learners">' + item.learnerCount + "</td>" +
          quarters +
          "<td data-label=\"Record\">" + badge(RECORD_STATUS, item.classRecordStatus || "draft") + "</td>" +
          '<td data-label="Action" class="text-right">' + action + "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function openRecord(id) {
    var card = el("crDetailCard");
    el("crDashboardCard").classList.add("d-none");
    card.classList.remove("d-none");
    el("crDetailHeading").textContent = "Loading class record…";
    el("crDetailScope").textContent = "";
    el("crMatrixHead").innerHTML = "";
    el("crMatrixBody").innerHTML = '<tr><td>Loading roster and assessments…</td></tr>';
    L.apiGet("/class-records/" + encodeURIComponent(id))
      .then(function (detail) {
        state.detail = detail;
        state.quarter = QUARTERS.find(function (quarter) {
          var submission = (detail.submissions || []).find(function (row) { return row.period === quarter; });
          return !submission || submission.status === "returned";
        }) || "q1";
        renderDetail();
        window.scrollTo({ top: 0, behavior: "smooth" });
      })
      .catch(function (error) {
        alertPage("danger", L.friendlyError(error), "Could not open the class record");
        closeRecord();
      });
  }

  function closeRecord() {
    state.detail = null;
    el("crDetailCard").classList.add("d-none");
    el("crDashboardCard").classList.remove("d-none");
  }

  function renderDetail() {
    var detail = state.detail;
    if (!detail) {
      return;
    }
    var record = detail.record;
    var template = detail.template;
    el("crDetailEyebrow").textContent = record.subjectCode + " · " + record.schoolYearName;
    el("crDetailHeading").textContent = record.sectionName + " — " + record.subjectName;
    el("crDetailScope").textContent =
      [record.gradeLevelName, record.schoolName, record.adviserName ? "Adviser: " + record.adviserName : ""]
        .filter(Boolean)
        .join(" · ");
    el("crRecordStatus").innerHTML = badge(RECORD_STATUS, record.status);

    var weights = (template.config.components || [])
      .map(function (component) {
        return esc(component.label) + " " + Math.round(Number(component.weight) * 100) + "%";
      })
      .join(" · ");
    el("crTemplateNote").innerHTML =
      '<i class="bi bi-sliders" aria-hidden="true"></i><div>' +
      "<strong>" + esc(template.name) + "</strong> (version " + esc(template.version) + "). " +
      (template.isOfficial
        ? "Marked as an official template."
        : "This configuration is not marked as an official DepEd template.") +
      "<br><span class=\"field-hint\">" + (weights || "No assessment components are configured.") +
      " · Rounding: " + esc(template.config.rounding || "not set") +
      " · Transmutation: " + esc((template.config.transmutation && template.config.transmutation.mode) || "none") +
      (template.curriculumName ? " · Curriculum: " + esc(template.curriculumName) + " " + esc(template.curriculumVersionName || "") : "") +
      "</span>" +
      (template.sourceNote ? '<br><span class="field-hint">' + esc(template.sourceNote) + "</span>" : "") +
      "</div>";

    Array.prototype.forEach.call(document.querySelectorAll("#crQuarterTabs [data-quarter]"), function (button) {
      var quarter = button.getAttribute("data-quarter");
      var submission = submissionFor(quarter);
      var locked = quarterLocked(quarter);
      button.setAttribute("aria-selected", String(quarter === state.quarter));
      button.className = quarter === state.quarter ? "is-active" : "";
      button.innerHTML =
        QUARTER_LABEL[quarter].replace(" quarter", "") +
        (submission
          ? ' <span class="field-hint">' + esc((SUBMISSION_STATUS[submission.status] || {}).label || submission.status) + "</span>"
          : locked
            ? ' <span class="field-hint">locked</span>'
            : "");
    });

    var components = el("crAssessmentComponent");
    components.innerHTML = (template.config.components || [])
      .map(function (component) {
        return L.option(component.key, component.label + " (" + Math.round(Number(component.weight) * 100) + "%)");
      })
      .join("");
    if (!components.innerHTML) {
      components.innerHTML = '<option value="">Configure a component first</option>';
    }
    el("crAssessmentDate").value = L.todayIso();

    renderQuarter();
  }

  function submissionFor(quarter) {
    if (!state.detail) {
      return null;
    }
    return (state.detail.submissions || []).find(function (row) {
      return row.period === quarter;
    }) || null;
  }

  function quarterLocked(quarter) {
    var submission = submissionFor(quarter);
    return Boolean(submission && ["submitted", "under_review", "accepted", "finalized"].includes(submission.status));
  }

  function renderQuarter() {
    var detail = state.detail;
    var quarter = state.quarter;
    var periodData = detail.computation.periods[quarter] || { learners: {} };
    var assessments = (detail.assessments || []).filter(function (assessment) {
      return assessment.period === quarter;
    });
    var scores = {};
    (detail.scores || []).forEach(function (row) {
      scores[row.assessmentId + ":" + row.enrollmentId] = row.score;
    });
    var submission = submissionFor(quarter);
    var locked = quarterLocked(quarter);

    var statusText = submission
      ? "Submission " + (SUBMISSION_STATUS[submission.status] || {}).label +
        " · version " + submission.version +
        (submission.reviewNotes ? " · Adviser note: " + submission.reviewNotes : "")
      : "No submission for this quarter yet.";
    el("crQuarterStatus").innerHTML =
      '<i class="bi bi-info-circle" aria-hidden="true"></i><div>' +
      esc(statusText) +
      (periodData.available
        ? " · " + (periodData.complete ? "All scores encoded for every learner." : "Some scores or assessments are still missing.")
        : " · Add assessments to begin this quarter.") +
      "</div>";

    el("crAddAssessment").disabled = locked || !canEdit();
    el("crSaveScores").disabled = locked || !canEdit();
    el("crSubmitQuarter").disabled = locked || !canAdd();
    el("crAssessmentTitle").disabled = locked;
    el("crAssessmentMax").disabled = locked;
    el("crAssessmentDate").disabled = locked;
    el("crAssessmentComponent").disabled = locked;

    var head =
      "<tr>" +
      '<th scope="col">#</th>' +
      '<th scope="col">Learner</th>' +
      '<th scope="col">LRN</th>' +
      assessments
        .map(function (assessment) {
          return (
            '<th scope="col" class="text-center">' +
            esc(assessment.title) +
            '<br><span class="field-hint">max ' + assessment.maxScore + " · " + esc(assessment.componentKey.toUpperCase()) + "</span>" +
            '<br><button type="button" class="btn btn-link btn-sm p-0" data-archive-assessment="' + assessment.id + '"' +
            (locked ? " disabled" : "") +
            ">Archive</button></th>"
          );
        })
        .join("") +
      '<th scope="col" class="text-center">Initial</th>' +
      '<th scope="col" class="text-center">Quarterly</th>' +
      '<th scope="col">Status</th>' +
      "</tr>";
    el("crMatrixHead").innerHTML = head;

    if (!assessments.length) {
      el("crMatrixBody").innerHTML =
        '<tr><td colspan="' + (6 + assessments.length) + '">No assessments have been added for this quarter. Add the school-approved written work, performance task, or quarterly assessment first.</td></tr>';
      return;
    }

    el("crMatrixBody").innerHTML = (detail.roster || [])
      .map(function (learner, index) {
        var computed = periodData.learners[learner.enrollmentId] || {};
        var inputs = assessments
          .map(function (assessment) {
            var key = assessment.id + ":" + learner.enrollmentId;
            var value = scores[key] === undefined || scores[key] === null ? "" : scores[key];
            return (
              '<td class="text-center">' +
              '<input type="number" class="form-control form-control-sm score-input" inputmode="decimal" ' +
              'min="0" max="' + assessment.maxScore + '" step="0.01" ' +
              'data-assessment-id="' + assessment.id + '" data-enrollment-id="' + learner.enrollmentId + '" ' +
              'value="' + esc(value) + '" aria-label="' + esc(assessment.title + " score for " + learner.fullName) + '"' +
              (locked ? " disabled" : "") +
              ">" +
              "</td>"
            );
          })
          .join("");
        var missing = (computed.missing || []).length;
        return (
          "<tr>" +
          "<td>" + (index + 1) + "</td>" +
          "<td data-label=\"Learner\"><strong>" + esc(learner.fullName) + "</strong></td>" +
          "<td data-label=\"LRN\">" + esc(learner.lrn) + "</td>" +
          inputs +
          '<td class="text-center">' + formatNumber(computed.initialGrade) + "</td>" +
          '<td class="text-center"><strong>' + formatNumber(computed.quarterlyGrade) + "</strong></td>" +
          "<td>" +
          (computed.complete
            ? '<span class="status-badge status-badge--success"><span class="status-dot"></span>Complete</span>'
            : '<span class="status-badge status-badge--warning"><span class="status-dot"></span>' +
              (missing ? missing + " missing item(s)" : "Incomplete") +
              "</span>") +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function collectScores() {
    var entries = [];
    var invalid = [];
    Array.prototype.forEach.call(document.querySelectorAll("#crMatrixBody .score-input"), function (input) {
      var raw = input.value.trim();
      var max = Number(input.getAttribute("max"));
      var score = null;
      if (raw !== "") {
        score = Number(raw);
        if (!Number.isFinite(score) || score < 0 || score > max) {
          invalid.push(input);
          return;
        }
      }
      entries.push({
        assessmentId: Number(input.getAttribute("data-assessment-id")),
        enrollmentId: Number(input.getAttribute("data-enrollment-id")),
        score: score
      });
    });
    return { entries: entries, invalid: invalid };
  }

  function saveScores() {
    var detail = state.detail;
    if (!detail) {
      return;
    }
    var collected = collectScores();
    if (collected.invalid.length) {
      collected.invalid[0].focus();
      alertPage("danger", "A score is outside the allowed range. Scores cannot be negative or above the assessment maximum.", "Check the scores");
      return;
    }
    if (!collected.entries.length) {
      alertPage("warning", "Add at least one assessment before saving scores.", "Nothing to save");
      return;
    }
    var button = el("crSaveScores");
    window.UI.setButtonLoading(button, true, "Saving…");
    API.put("/class-records/" + detail.record.id + "/scores", {
      period: state.quarter,
      entries: collected.entries
    })
      .then(function (payload) {
        state.detail = payload.data;
        renderDetail();
        window.UI.toast("Scores saved", "The computed initial and quarterly grades were recalculated.", "success");
      })
      .catch(function (error) {
        alertPage("danger", L.friendlyError(error), "Scores were not saved");
      })
      .then(function () {
        window.UI.setButtonLoading(button, false);
      });
  }

  function addAssessment() {
    var detail = state.detail;
    if (!detail) {
      return;
    }
    var title = el("crAssessmentTitle").value.trim();
    var maxScore = Number(el("crAssessmentMax").value);
    var componentKey = el("crAssessmentComponent").value;
    if (!componentKey) {
      alertPage("warning", "Configure the class record template before adding assessments.", "No components");
      return;
    }
    if (title.length < 2) {
      el("crAssessmentTitle").focus();
      alertPage("warning", "Enter a title for the assessment.", "Title required");
      return;
    }
    if (!Number.isFinite(maxScore) || maxScore <= 0) {
      el("crAssessmentMax").focus();
      alertPage("warning", "The highest possible score must be greater than zero.", "Invalid maximum");
      return;
    }
    var button = el("crAddAssessment");
    window.UI.setButtonLoading(button, true, "Adding…");
    API.post("/class-records/" + detail.record.id + "/assessments", {
      period: state.quarter,
      componentKey: componentKey,
      title: title,
      maxScore: maxScore,
      assessmentDate: el("crAssessmentDate").value || null
    })
      .then(function (payload) {
        state.detail = payload.data;
        el("crAssessmentTitle").value = "";
        renderDetail();
        window.UI.toast("Assessment added", "Encode the learner scores for " + title + ".", "success");
      })
      .catch(function (error) {
        alertPage("danger", L.friendlyError(error), "Assessment was not added");
      })
      .then(function () {
        window.UI.setButtonLoading(button, false);
      });
  }

  function archiveAssessment(id) {
    var detail = state.detail;
    if (!detail) {
      return;
    }
    var button = document.querySelector('[data-archive-assessment="' + id + '"]');
    window.UI.confirm({
      title: "Archive this assessment?",
      message: "Archived assessments stop counting toward the quarter grade. Existing scores remain in the audit trail.",
      confirmLabel: "Archive",
      tone: "danger"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      if (button) {
        window.UI.setButtonLoading(button, true);
      }
      API.delete("/class-records/" + detail.record.id + "/assessments/" + id)
        .then(function (payload) {
          state.detail = payload.data;
          renderDetail();
          window.UI.toast("Assessment archived", "The quarter grade was recomputed without it.", "success");
        })
        .catch(function (error) {
          alertPage("danger", L.friendlyError(error), "Assessment was not archived");
        })
        .then(function () {
          if (button) {
            window.UI.setButtonLoading(button, false);
          }
        });
    });
  }

  function submitQuarter() {
    var detail = state.detail;
    if (!detail) {
      return;
    }
    var quarter = state.quarter;
    var periodData = detail.computation.periods[quarter];
    if (!periodData || !periodData.complete) {
      var reasons = (periodData && periodData.issues) || [];
      alertPage(
        "warning",
        reasons.length
          ? reasons.join(" ")
          : "Every learner needs a score for every configured component before this quarter can be submitted.",
        "Quarter is not complete"
      );
      return;
    }
    var notes = window.prompt
      ? window.prompt("Optional note for the class adviser:", "")
      : "";
    if (notes === null) {
      return;
    }
    var button = el("crSubmitQuarter");
    window.UI.setButtonLoading(button, true, "Submitting…");
    API.post("/class-records/" + detail.record.id + "/submit", {
      period: quarter,
      notes: notes || ""
    })
      .then(function (payload) {
        state.detail = payload.data;
        renderDetail();
        window.UI.toast(
          "Quarter submitted",
          QUARTER_LABEL[quarter] + " was sent to the class adviser for review.",
          "success"
        );
      })
      .catch(function (error) {
        alertPage("danger", L.friendlyError(error), "Quarter was not submitted");
      })
      .then(function () {
        window.UI.setButtonLoading(button, false);
      });
  }

  function startRecord(index) {
    var item = state.items[Number(index)];
    if (!item) {
      return;
    }
    var payload = {
      sectionId: item.sectionId,
      subjectId: item.subjectId,
      schoolYearId: state.yearId,
      assignmentId: item.assignmentId
    };
    var button = document.querySelector('[data-init-index="' + index + '"]');
    if (button) {
      window.UI.setButtonLoading(button, true, "Opening…");
    }
    API.post("/class-records", payload)
      .then(function (result) {
        openRecord(result.data.record.id);
      })
      .catch(function (error) {
        alertPage("danger", L.friendlyError(error), "Class record was not created");
        if (button) {
          window.UI.setButtonLoading(button, false);
        }
      });
  }

  function bind() {
    el("crYear").addEventListener("change", function () {
      state.yearId = this.value;
      loadSections().then(loadDashboard);
    });
    el("crSection").addEventListener("change", function () {
      state.sectionId = this.value;
      loadDashboard();
    });
    el("crSubject").addEventListener("change", function () {
      state.subjectId = this.value;
      loadDashboard();
    });
    el("crSearch").addEventListener(
      "input",
      window.UI.debounce(function () {
        state.search = this.value.trim();
        loadDashboard();
      }, 300)
    );
    el("crRefresh").addEventListener("click", loadDashboard);
    el("crBackToClasses").addEventListener("click", function () {
      closeRecord();
      loadDashboard();
    });
    el("crDashboardBody").addEventListener("click", function (event) {
      var open = event.target.closest("[data-open-record]");
      if (open) {
        openRecord(open.getAttribute("data-open-record"));
        return;
      }
      var init = event.target.closest("[data-init-index]");
      if (init) {
        startRecord(init.getAttribute("data-init-index"));
      }
    });
    el("crQuarterTabs").addEventListener("click", function (event) {
      var button = event.target.closest("[data-quarter]");
      if (!button) {
        return;
      }
      state.quarter = button.getAttribute("data-quarter");
      renderDetail();
    });
    el("crSaveScores").addEventListener("click", saveScores);
    el("crAddAssessment").addEventListener("click", addAssessment);
    el("crSubmitQuarter").addEventListener("click", submitQuarter);
    el("crMatrixBody").addEventListener("click", function (event) {
      var archive = event.target.closest("[data-archive-assessment]");
      if (archive && !archive.disabled) {
        archiveAssessment(archive.getAttribute("data-archive-assessment"));
      }
    });
    el("crMatrixBody").addEventListener("change", function (event) {
      var input = event.target.closest(".score-input");
      if (input) {
        input.classList.remove("is-invalid");
      }
    });
  }

  function start(session) {
    if (!session) {
      return;
    }
    bind();
    if (!modulePermission("class_records", "access")) {
      alertPage("warning", "You do not have access to class records.", "Restricted");
      return;
    }
    if (!modulePermission("class_records", "add")) {
      alertPage(
        "warning",
        "You can open class records you are assigned to, but only subject teachers with the add right can create or submit them.",
        "Limited access"
      );
    }
    loadYears()
      .then(loadSections)
      .then(function () {
        return L.subjects(L.schoolId() || undefined);
      })
      .then(function (subjects) {
        el("crSubject").innerHTML =
          '<option value="">All subjects</option>' +
          (subjects || [])
            .map(function (subject) {
              return L.option(subject.id, subject.code + " · " + subject.name);
            })
            .join("");
      })
      .then(loadDashboard);
  }

  function init() {
    window.AppShell.init({ page: "class-records", breadcrumbs: ["Class Records"] }).then(start);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
