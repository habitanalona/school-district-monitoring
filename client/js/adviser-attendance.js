/* Class adviser attendance consolidation, validation, corrections, and term summary */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var F = window.FormsUI;

  var STATUS = {
    present: { label: "Present", short: "P", tone: "success" },
    absent: { label: "Absent", short: "A", tone: "danger" },
    tardy: { label: "Tardy", short: "T", tone: "warning" },
    excused: { label: "Excused", short: "E", tone: "info" },
    half_day: { label: "Half day", short: "H", tone: "violet" }
  };

  var DAY_TYPE = {
    school_day: { label: "School day", tone: "success" },
    holiday: { label: "Holiday", tone: "warning" },
    suspension: { label: "Suspension", tone: "danger" },
    no_class: { label: "No class", tone: "muted" },
    orientation: { label: "Orientation", tone: "info" }
  };

  var CORRECTION_TONE = {
    pending: { label: "Pending", tone: "warning" },
    approved: { label: "Approved", tone: "success" },
    rejected: { label: "Rejected", tone: "danger" }
  };

  var TABS = [
    { key: "daily", tab: "tabDailyValidation", panel: "panelDailyValidation" },
    { key: "corrections", tab: "tabCorrections", panel: "panelCorrections" },
    { key: "term", tab: "tabTerm", panel: "panelTerm" }
  ];

  var state = {
    session: null,
    yearId: "",
    schoolId: "",
    sectionId: "",
    date: F.todayIso(),
    tab: "daily",
    data: null,
    corrections: null,
    terms: null,
    termSummary: null,
    termValue: ""
  };

  function el(id) {
    return document.getElementById(id);
  }

  function sectionSchoolId() {
    if (state.data && state.data.section) {
      return String(state.data.section.schoolId);
    }
    return state.schoolId || (L.schoolId() ? String(L.schoolId()) : "");
  }

  function alertBox(id, tone, message, title) {
    F.pageAlert(id, tone, message, title);
  }

  function emptyRow(columns, message) {
    return '<tr><td colspan="' + columns + '" class="empty-cell">' + F.esc(message) + "</td></tr>";
  }

  function statusMark(status) {
    var meta = STATUS[status];
    if (!meta) {
      return '<span class="text-muted">·</span>';
    }
    return '<span class="attendance-mark attendance-mark--' + status + '" title="' + F.esc(meta.label) + '">' + meta.short + "</span>";
  }

  function statusBadge(status) {
    var meta = STATUS[status] || { label: window.UI.titleCase(status || "—"), tone: "neutral" };
    return window.UI.pillarBadge(meta.label, meta.tone);
  }

  /* ---------------------------------------------------------------------- */
  /* Filters                                                                */
  /* ---------------------------------------------------------------------- */

  function setupFilters() {
    return Promise.all([
      F.schoolFilter("adviserSchoolControl", "adviserSchoolFilter", state.schoolId),
      L.years()
    ]).then(function (results) {
      var years = results[1] || [];
      var current = years.find(function (year) { return year.isCurrent; });
      state.yearId = state.yearId || (current ? String(current.id) : years[0] ? String(years[0].id) : "");
      el("adviserYearFilter").innerHTML = L.yearOptions(years, state.yearId, "Select school year");
      el("adviserDate").value = state.date;
      wire();
      return loadSections();
    });
  }

  function loadSections() {
    var select = el("adviserSectionFilter");
    select.innerHTML = '<option value="">Loading sections…</option>';
    return F.filteredSections(state.schoolId || L.schoolId(), state.yearId, select, state.sectionId)
      .then(function (list) {
        if (!list.length) {
          select.innerHTML = '<option value="">No sections for this school year</option>';
          el("adviserValidateMeta").textContent = "Create a section for this school year before monitoring attendance.";
          return;
        }
        if (!state.sectionId) {
          state.sectionId = String(list[0].id);
          select.value = state.sectionId;
        }
        loadDaily();
      });
  }

  function wire() {
    el("adviserYearFilter").addEventListener("change", function (event) {
      state.yearId = event.target.value;
      state.sectionId = "";
      state.data = null;
      loadSections();
    });
    el("adviserSchoolFilter").addEventListener("change", function (event) {
      state.schoolId = event.target.value;
      state.sectionId = "";
      state.data = null;
      loadSections();
    });
    el("adviserSectionFilter").addEventListener("change", function (event) {
      state.sectionId = event.target.value;
      state.data = null;
      if (state.tab === "daily") {
        loadDaily();
      } else if (state.tab === "corrections") {
        loadCorrections();
      } else {
        loadTermSummary();
      }
    });
    el("adviserDate").addEventListener("change", function (event) {
      state.date = event.target.value || F.todayIso();
      if (state.tab === "daily") {
        loadDaily();
      }
    });
    document.querySelectorAll("[data-adv-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        setTab(button.dataset.advTab);
      });
    });
    el("adviserRefresh").addEventListener("click", function () {
      if (state.tab === "corrections") {
        loadCorrections();
      } else if (state.tab === "term") {
        loadTermSummary();
      } else {
        loadDaily();
      }
    });
    el("adviserValidateButton").addEventListener("click", validateDay);
    el("adviserReopenValidation").addEventListener("click", reopenValidationDay);
    el("adviserSubjectsBody").addEventListener("click", function (event) {
      var reopen = event.target.closest("[data-reopen]");
      if (reopen) {
        reopenSubmission(reopen.dataset.reopen);
      }
    });
    el("adviserLearnersBody").addEventListener("change", function (event) {
      var select = event.target.closest("[data-official-status]");
      if (select) {
        var manual = select.value !== (select.dataset.suggested || "");
        select.classList.toggle("is-manual", manual);
      }
    });
    el("correctionStatusFilter").addEventListener("change", loadCorrections);
    el("correctionsRefresh").addEventListener("click", loadCorrections);
    el("correctionsBody").addEventListener("click", function (event) {
      var button = event.target.closest("[data-review-correction]");
      if (button) {
        reviewCorrection(Number(button.dataset.reviewCorrection), button.dataset.decision);
      }
    });
    el("termFilter").addEventListener("change", function (event) {
      state.termValue = event.target.value;
      loadTermSummary();
    });
    el("termPrintButton").addEventListener("click", printTermSummary);
  }

  function setTab(name) {
    state.tab = name;
    TABS.forEach(function (entry) {
      var tab = el(entry.tab);
      var panel = el(entry.panel);
      var active = entry.key === name;
      tab.setAttribute("aria-selected", String(active));
      panel.classList.toggle("d-none", !active);
    });
    if (name === "daily" && !state.data) {
      loadDaily();
    } else if (name === "corrections") {
      loadCorrections();
    } else if (name === "term") {
      loadTermSummary();
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Daily consolidation                                                    */
  /* ---------------------------------------------------------------------- */

  function loadDaily() {
    if (!state.sectionId || !state.yearId) {
      return Promise.resolve();
    }
    el("adviserSubjectsBody").innerHTML = L.skeletonRows(6, 3);
    el("adviserLearnersBody").innerHTML = L.skeletonRows(6, 6);
    el("adviserMatrixHead").innerHTML = "";
    el("adviserValidateButton").classList.add("d-none");
    el("adviserReopenValidation").classList.add("d-none");
    return L.apiGet("/attendance/adviser/consolidation", {
      sectionId: state.sectionId,
      schoolYearId: state.yearId,
      date: state.date
    })
      .then(function (data) {
        state.data = data;
        renderDaily();
      })
      .catch(function (error) {
        if (error.status === 401) return;
        state.data = null;
        el("adviserSubjectsBody").innerHTML = emptyRow(6, L.friendlyError(error));
        el("adviserLearnersBody").innerHTML = emptyRow(6, L.friendlyError(error));
        alertBox("adviserAlert", "danger", L.friendlyError(error), "Could not load adviser attendance");
      });
  }

  function renderDaily() {
    var data = state.data;
    if (!data) {
      return;
    }
    var dayMeta = DAY_TYPE[data.dayType] || DAY_TYPE.school_day;
    el("adviserDayBadge").innerHTML = '<span class="status-dot"></span>' + F.esc(dayMeta.label);
    el("adviserDayBadge").className = "status-badge status-badge--" + dayMeta.tone;
    el("adviserScopeLabel").textContent =
      data.section.schoolName + " · " + data.section.name + " · " + data.section.gradeLevelName +
      " · " + data.section.schoolYearName + (data.section.adviserName ? " · Adviser: " + data.section.adviserName : "");

    var submitted = data.subjects.filter(function (subject) { return subject.submitted; }).length;
    var chips = [
      { label: window.UI.phDate(data.date), value: dayMeta.label + (data.term ? " · " + data.term.name : " · No term"), tone: dayMeta.tone },
      { label: "Subject submissions", value: submitted + " of " + data.subjects.length, tone: submitted === data.subjects.length ? "success" : "warning" },
      { label: "Conflicts", value: String(data.conflicts), tone: data.conflicts ? "warning" : "success" },
      { label: "Validated learners", value: data.validatedCount + " of " + data.learners.length, tone: data.validatedCount === data.learners.length && data.learners.length ? "success" : "neutral" },
      { label: "Corrections", value: String(data.corrections.length), tone: data.corrections.length ? "info" : "neutral" }
    ];
    el("adviserSummary").classList.remove("d-none");
    el("adviserSummary").innerHTML = chips.map(function (chip) {
      return (
        '<div class="adviser-chip adviser-chip--' + chip.tone + '">' +
        "<span>" + F.esc(chip.label) + "</span>" +
        "<strong>" + F.esc(chip.value) + "</strong>" +
        "</div>"
      );
    }).join("");

    renderSubjects(data);
    renderLearners(data);

    var warnings = [];
    if (data.missingSubjects) {
      warnings.push(data.missingSubjects + " subject" + (data.missingSubjects === 1 ? " has" : "s have") + " not submitted attendance for this day.");
    }
    if (data.conflicts) {
      warnings.push(data.conflicts + " learner" + (data.conflicts === 1 ? " has" : "s have") + " conflicting subject statuses (absent in one subject, present in another).");
    }
    if (data.dayType !== "school_day") {
      warnings.push("This date is marked as " + dayMeta.label + "; official attendance is normally not required.");
    }
    if (warnings.length) {
      alertBox("adviserAlert", "warning", warnings.join(" "), "Review before validating");
    } else {
      window.UI.hideAlert(el("adviserAlert"));
    }

    el("adviserValidateMeta").textContent =
      data.validatedCount + " of " + data.learners.length + " learners validated · " +
      data.missingSubjects + " subject submission" + (data.missingSubjects === 1 ? "" : "s") + " missing · " +
      data.corrections.length + " correction request" + (data.corrections.length === 1 ? "" : "s");
    el("adviserValidateButton").classList.toggle(
      "d-none",
      !(data.canValidate && data.learners.length && data.dayType === "school_day")
    );
    el("adviserReopenValidation").classList.toggle(
      "d-none",
      !(data.canValidate && data.validatedCount > 0)
    );
  }

  function renderSubjects(data) {
    el("adviserSubjectsMeta").textContent =
      data.subjects.length + " assigned subject" + (data.subjects.length === 1 ? "" : "s") + " · " +
      data.subjects.filter(function (subject) { return subject.submitted; }).length + " submitted";
    if (!data.subjects.length) {
      el("adviserSubjectsBody").innerHTML = emptyRow(6, "No subject teacher assignments exist for this section and school year.");
      return;
    }
    el("adviserSubjectsBody").innerHTML = data.subjects.map(function (subject) {
      var status = subject.submitted
        ? '<span class="status-badge status-badge--success"><span class="status-dot"></span>Submitted</span>'
        : subject.submissionStatus === "reopened"
          ? '<span class="status-badge status-badge--warning"><span class="status-dot"></span>Reopened</span>'
          : '<span class="status-badge status-badge--danger"><span class="status-dot"></span>Not submitted</span>';
      var open =
        '<a class="btn btn-light btn-sm" href="attendance.html?tab=subject&sectionId=' + data.section.id +
        "&subjectId=" + subject.subjectId +
        "&assignmentId=" + subject.assignmentId +
        "&date=" + encodeURIComponent(data.date) +
        '" title="Open the subject attendance matrix"><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i> Open</a>';
      var reopen = subject.submitted && subject.submissionId && data.canValidate
        ? '<button type="button" class="btn btn-light btn-sm" data-reopen="' + subject.submissionId + '"><i class="bi bi-arrow-repeat" aria-hidden="true"></i> Reopen</button>'
        : "";
      return (
        "<tr>" +
        "<td><strong>" + F.esc(subject.subjectName) + "</strong>" +
        (subject.subjectCode ? '<span class="record-note">' + F.esc(subject.subjectCode) + "</span>" : "") + "</td>" +
        "<td>" + F.esc(subject.teacherName || "Not assigned") + "</td>" +
        "<td>" + status + "</td>" +
        "<td>" + subject.recorded + " period" + (subject.recorded === 1 ? "" : "s") + "</td>" +
        "<td>" + (subject.submittedAt ? F.esc(window.UI.phDateTime(subject.submittedAt)) : "—") + "</td>" +
        '<td><div class="row-actions">' + open + reopen + "</div></td>" +
        "</tr>"
      );
    }).join("");
  }

  function renderLearners(data) {
    var subjects = data.subjects;
    var head = ["#", "Learner", "LRN", "Sex"];
    subjects.forEach(function (subject) {
      head.push(subject.subjectCode || subject.subjectName);
    });
    head.push("Suggested");
    head.push("Official daily status");
    head.push("Flags");
    el("adviserMatrixHead").innerHTML =
      '<tr><th scope="col">#</th><th scope="col" class="subject-learner">Learner</th><th scope="col">LRN</th><th scope="col">Sex</th>' +
      subjects.map(function (subject) {
        return '<th scope="col" title="' + F.esc(subject.subjectName + " · " + (subject.teacherName || "No teacher")) + '">' + F.esc(subject.subjectCode || subject.subjectName) + "</th>";
      }).join("") +
      '<th scope="col">Suggested</th><th scope="col">Official daily status</th><th scope="col">Flags</th></tr>';

    el("adviserLearnersMeta").textContent =
      data.learners.length + " learner" + (data.learners.length === 1 ? "" : "s") + " · " +
      data.learners.filter(function (learner) { return learner.recordedPeriods > 0; }).length + " with subject records";

    if (!data.learners.length) {
      el("adviserLearnersBody").innerHTML = emptyRow(head.length, "No active learners are enrolled in this section.");
      return;
    }

    el("adviserLearnersBody").innerHTML = data.learners.map(function (learner, index) {
      var row = ['<tr data-learner-row="' + learner.enrollmentId + '">'];
      row.push("<td>" + (index + 1) + "</td>");
      row.push(
        '<td class="subject-learner"><strong>' + F.esc(learner.fullName) + "</strong>" +
        (learner.validated ? '<small>Validated ' + F.esc(window.UI.phDateTime(learner.validated.validatedAt)) + "</small>" : "") + "</td>"
      );
      row.push('<td><code class="lrn-code">' + F.esc(learner.lrn) + "</code></td>");
      row.push("<td>" + F.esc(learner.sex === "male" ? "M" : learner.sex === "female" ? "F" : "—") + "</td>");
      subjects.forEach(function (subject) {
        var mark = learner.subjects[String(subject.subjectId)];
        row.push('<td title="' + F.esc(subject.subjectName + (mark ? " · " + (STATUS[mark.status] || {}).label : " · No record")) + '">' +
          (mark ? statusMark(mark.status) : '<span class="text-muted">·</span>') + "</td>");
      });
      row.push("<td>" + (learner.suggestedStatus ? statusBadge(learner.suggestedStatus) : '<span class="field-hint">—</span>') + "</td>");
      var official;
      if (data.canValidate) {
        official =
          '<select class="custom-select custom-select-sm adviser-status-select" data-official-status data-enrollment="' + learner.enrollmentId + '" data-suggested="' + F.esc(learner.suggestedStatus || "") + '" aria-label="Official daily status for ' + F.esc(learner.fullName) + '">' +
          '<option value="">Not validated</option>' +
          ["present", "absent", "tardy", "excused", "half_day"].map(function (key) {
            var current = learner.validated ? learner.validated.status : "";
            return '<option value="' + key + '"' + (current === key ? " selected" : "") + ">" + F.esc(STATUS[key].label) + "</option>";
          }).join("") +
          "</select>";
      } else {
        official = learner.validated ? statusBadge(learner.validated.status) : '<span class="field-hint">Not validated</span>';
      }
      row.push("<td>" + official + "</td>");
      var flags = [];
      if (learner.validated) {
        flags.push('<span class="record-note">Validated by ' + F.esc(learner.validated.validatedBy || "adviser") + "</span>");
      }
      if (learner.conflict) {
        flags.push('<span class="record-note record-note--warning">Subject conflict</span>');
      }
      if (!learner.recordedPeriods) {
        flags.push('<span class="record-note">No subject records</span>');
      } else if (learner.absentSubjects > 1) {
        flags.push('<span class="record-note">' + learner.absentSubjects + " subject absences · counts once</span>");
      }
      row.push("<td>" + (flags.join(" ") || "—") + "</td>");
      row.push("</tr>");
      return row.join("");
    }).join("");
  }

  function validateDay() {
    var data = state.data;
    if (!data) {
      return;
    }
    var learners = [];
    document.querySelectorAll("#adviserLearnersBody [data-official-status]").forEach(function (select) {
      var learner = data.learners.find(function (entry) {
        return String(entry.enrollmentId) === String(select.dataset.enrollment);
      });
      learners.push({
        enrollmentId: Number(select.dataset.enrollment),
        status: select.value || null,
        remarks: learner && learner.validated ? learner.validated.remarks || "" : "",
        manual: select.value !== (select.dataset.suggested || "")
      });
    });
    var missing = learners.filter(function (learner) { return !learner.status; }).length;
    var manual = learners.filter(function (learner) { return learner.status && learner.manual; }).length;
    var warnings = [];
    if (data.missingSubjects) {
      warnings.push(data.missingSubjects + " subject submission" + (data.missingSubjects === 1 ? " is" : "s are") + " missing.");
    }
    if (data.conflicts) {
      warnings.push(data.conflicts + " learner" + (data.conflicts === 1 ? " has" : "s have") + " a subject conflict.");
    }
    if (missing) {
      warnings.push(missing + " learner" + (missing === 1 ? " has" : "s have") + " no official status and will be left unvalidated.");
    }
    if (manual) {
      warnings.push(manual + " status" + (manual === 1 ? " was" : "es were") + " changed from the suggested value.");
    }
    window.UI.confirm({
      title: "Validate official attendance?",
      message: "Validate " + window.UI.phDate(data.date) + " for " + data.section.name + "? " +
        warnings.join(" ") +
        " Validated daily attendance feeds SF 2, SF 9, and SF 10 and is recorded in the audit trail.",
      confirmLabel: "Validate day",
      tone: "primary"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      var button = el("adviserValidateButton");
      window.UI.setButtonLoading(button, true, "Validating…");
      API.post("/attendance/adviser/validate", {
        sectionId: Number(state.sectionId),
        schoolYearId: Number(state.yearId),
        date: data.date,
        learners: learners
      })
        .then(function (payload) {
          window.UI.setButtonLoading(button, false);
          state.data = payload.data;
          renderDaily();
          window.UI.toast("Official attendance validated", payload.data.validatedCount + " learners now have validated daily attendance for " + window.UI.phDate(data.date) + ".", "success");
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (error.status === 401) return;
          alertBox("adviserAlert", "danger", L.friendlyError(error), "Could not validate attendance");
        });
    });
  }

  function reopenValidationDay() {
    var data = state.data;
    if (!data) {
      return;
    }
    window.UI.confirm({
      title: "Reopen this validated day?",
      message: "This removes the official daily attendance for " + window.UI.phDate(data.date) +
        " and returns learners to Not validated. Use it when a subject teacher still needs to submit or correct attendance before the day is validated again. Subject submissions are not reopened automatically.",
      confirmLabel: "Reopen validation",
      tone: "warning"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      var button = el("adviserReopenValidation");
      window.UI.setButtonLoading(button, true, "Reopening…");
      API.post("/attendance/adviser/reopen-validation", {
        sectionId: Number(state.sectionId),
        schoolYearId: Number(state.yearId),
        date: data.date
      })
        .then(function (payload) {
          window.UI.setButtonLoading(button, false);
          state.data = payload.data;
          renderDaily();
          window.UI.toast("Validation reopened", "The day can now accept late subject attendance. Validate again when all submissions are in.", "success");
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (error.status === 401) return;
          alertBox("adviserAlert", "danger", L.friendlyError(error), "Could not reopen validation");
        });
    });
  }

  function reopenSubmission(id) {
    window.UI.confirm({
      title: "Reopen this subject submission?",
      message: "The subject teacher will be able to correct and resubmit this day. Already validated official attendance is not removed.",
      confirmLabel: "Reopen",
      tone: "warning"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      API.post("/attendance/subject/submissions/" + id + "/reopen", { remarks: "Reopened by the class adviser" })
        .then(function () {
          window.UI.toast("Submission reopened", "The subject teacher may now correct the day.", "success");
          loadDaily();
        })
        .catch(function (error) {
          if (error.status === 401) return;
          alertBox("adviserAlert", "danger", L.friendlyError(error), "Could not reopen the submission");
        });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Corrections                                                            */
  /* ---------------------------------------------------------------------- */

  function loadCorrections() {
    if (!state.sectionId || !state.yearId) {
      return Promise.resolve();
    }
    el("correctionsBody").innerHTML = L.skeletonRows(9, 4);
    return L.apiGet("/attendance/corrections", {
      sectionId: state.sectionId,
      schoolYearId: state.yearId,
      status: el("correctionStatusFilter").value || undefined
    })
      .then(function (data) {
        state.corrections = data;
        renderCorrections();
      })
      .catch(function (error) {
        if (error.status === 401) return;
        el("correctionsBody").innerHTML = emptyRow(9, L.friendlyError(error));
        alertBox("correctionsAlert", "danger", L.friendlyError(error), "Could not load correction requests");
      });
  }

  function renderCorrections() {
    var data = state.corrections;
    if (!data) {
      return;
    }
    if (!data.corrections.length) {
      el("correctionsBody").innerHTML = emptyRow(9, "No correction requests match this filter.");
      el("correctionsMeta").textContent = "No correction requests.";
      return;
    }
    el("correctionsMeta").textContent =
      data.corrections.length + " request" + (data.corrections.length === 1 ? "" : "s") +
      (data.canReview ? " · You may review pending requests." : " · Review is limited to the class adviser.");
    el("correctionsBody").innerHTML = data.corrections.map(function (correction) {
      var actions = "";
      if (correction.status === "pending" && data.canReview) {
        actions =
          '<div class="row-actions">' +
          '<button type="button" class="btn btn-success btn-sm" data-review-correction="' + correction.id + '" data-decision="approved"><i class="bi bi-check2" aria-hidden="true"></i> Approve</button>' +
          '<button type="button" class="btn btn-outline-danger btn-sm" data-review-correction="' + correction.id + '" data-decision="rejected"><i class="bi bi-x" aria-hidden="true"></i> Reject</button>' +
          "</div>";
      } else if (correction.reviewedBy) {
        actions = '<span class="record-note">Reviewed by ' + F.esc(correction.reviewedBy) +
          (correction.reviewNotes ? " · " + F.esc(correction.reviewNotes) : "") + "</span>";
      }
      return (
        "<tr>" +
        "<td>" + F.esc(window.UI.phDate(correction.date)) + "</td>" +
        "<td><strong>" + F.esc(correction.learnerName) + "</strong>" +
        '<span class="record-note">' + F.esc(correction.lrn) + "</span></td>" +
        "<td>" + F.esc(correction.subjectName) + "</td>" +
        "<td>P" + correction.periodNo + "</td>" +
        "<td>" + statusBadge(correction.proposedStatus) + "</td>" +
        "<td class=\"adviser-note-cell\">" + F.esc(correction.reason) + "</td>" +
        "<td>" + F.esc(correction.requestedBy || "—") + "</td>" +
        "<td>" + F.toneBadge(CORRECTION_TONE, correction.status) + "</td>" +
        '<td class="text-right">' + actions + "</td>" +
        "</tr>"
      );
    }).join("");
  }

  function reviewCorrection(id, decision) {
    var approve = decision === "approved";
    var dialog = L.modal({
      title: approve ? "Approve correction" : "Reject correction",
      eyebrow: "Correction request #" + id,
      body:
        '<div id="correctionReviewAlert" class="d-none mb-3" role="alert"></div>' +
        '<p style="font-size:.78rem;color:#334b63">' +
        (approve
          ? "Approving updates the original subject attendance record to the proposed status."
          : "Rejecting leaves the original subject attendance unchanged.") +
        " The decision and notes are recorded in the audit trail.</p>" +
        '<div class="form-group mb-0"><label for="correctionReviewNotes">Review notes (optional)</label>' +
        '<textarea class="form-control" id="correctionReviewNotes" rows="3" maxlength="1000" placeholder="Explain the decision for the school records…"></textarea></div>',
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="button" class="btn btn-' + (approve ? "success" : "danger") + '" id="correctionReviewConfirm">' +
        (approve ? "Approve correction" : "Reject correction") + "</button>"
    });
    var button = dialog.element.querySelector("#correctionReviewConfirm");
    var notes = dialog.element.querySelector("#correctionReviewNotes");
    var alert = dialog.element.querySelector("#correctionReviewAlert");
    button.addEventListener("click", function () {
      window.UI.setButtonLoading(button, true, "Saving…");
      API.post("/attendance/corrections/" + id + "/review", {
        decision: decision,
        notes: notes.value.trim()
      })
        .then(function () {
          window.UI.setButtonLoading(button, false);
          dialog.close();
          window.UI.toast("Correction " + decision, "The subject attendance record was " + (approve ? "updated." : "left unchanged."), "success");
          loadCorrections();
          if (state.data) {
            loadDaily();
          }
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (error.status === 401) return;
          window.UI.showAlert(alert, "danger", L.friendlyError(error), "Could not review the correction");
        });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Term summary                                                           */
  /* ---------------------------------------------------------------------- */

  function loadTerms() {
    var schoolId = sectionSchoolId();
    if (!schoolId || !state.yearId) {
      el("termFilter").innerHTML = '<option value="">Full school year</option>';
      state.terms = null;
      return Promise.resolve();
    }
    return L.apiGet("/attendance/terms", { schoolId: schoolId, schoolYearId: state.yearId })
      .then(function (data) {
        state.terms = data;
        el("termFilter").innerHTML =
          '<option value="">Full school year</option>' +
          data.terms.map(function (term) {
            return L.option(term.termNo, term.name + " (" + term.startsOn + " – " + term.endsOn + ")" + (term.status === "approved" ? "" : " · draft"), state.termValue);
          }).join("");
        if (state.termValue) {
          el("termFilter").value = state.termValue;
        }
      })
      .catch(function () {
        state.terms = null;
      });
  }

  function loadTermSummary() {
    if (!state.sectionId || !state.yearId) {
      return Promise.resolve();
    }
    el("termBody").innerHTML = L.skeletonRows(12, 6);
    el("termWarning").classList.add("d-none");
    return loadTerms()
      .then(function () {
        return L.apiGet("/attendance/term-summary", {
          sectionId: state.sectionId,
          schoolYearId: state.yearId,
          termNo: state.termValue || undefined
        });
      })
      .then(function (data) {
        state.termSummary = data;
        renderTermSummary();
      })
      .catch(function (error) {
        if (error.status === 401) return;
        el("termBody").innerHTML = emptyRow(12, L.friendlyError(error));
        alertBox("adviserAlert", "danger", L.friendlyError(error), "Could not load the term summary");
      });
  }

  function renderTermSummary() {
    var data = state.termSummary;
    if (!data) {
      return;
    }
    el("termMeta").textContent =
      data.section.schoolName + " · " + data.section.name + " · " + data.term.name +
      " · " + data.schoolDays + " school days · " +
      (data.attendanceRate === null ? "No attendance recorded" : data.attendanceRate + "% attendance rate");
    var warnings = [];
    if (data.term.status === "draft") {
      warnings.push("The selected term is still a draft. Approve the reporting terms before using this summary for official reporting.");
    }
    var missing = data.learners.reduce(function (total, learner) { return total + learner.missingDays; }, 0);
    if (missing) {
      warnings.push(missing + " learner-day" + (missing === 1 ? " is" : "s are") + " still unrecorded. Missing days are not assumed present.");
    }
    if (warnings.length) {
      el("termWarning").classList.remove("d-none");
      el("termWarningText").innerHTML = "<strong>Review required.</strong> " + F.esc(warnings.join(" "));
    } else {
      el("termWarning").classList.add("d-none");
    }
    if (!data.learners.length) {
      el("termBody").innerHTML = emptyRow(12, "No active learners are enrolled in this section.");
      return;
    }
    el("termBody").innerHTML = data.learners.map(function (learner, index) {
      return (
        "<tr>" +
        "<td>" + (index + 1) + "</td>" +
        '<td><strong>' + F.esc(learner.fullName) + "</strong></td>" +
        '<td><code class="lrn-code">' + F.esc(learner.lrn) + "</code></td>" +
        "<td>" + F.esc(learner.sex === "male" ? "M" : learner.sex === "female" ? "F" : "—") + "</td>" +
        "<td>" + learner.totals.present + "</td>" +
        "<td>" + learner.totals.absent + "</td>" +
        "<td>" + learner.totals.tardy + "</td>" +
        "<td>" + learner.totals.excused + "</td>" +
        "<td>" + learner.totals.half_day + "</td>" +
        "<td>" + learner.totals.recorded + "</td>" +
        "<td>" + (learner.missingDays ? '<span class="record-note record-note--warning">' + learner.missingDays + "</span>" : "0") + "</td>" +
        "<td>" + (learner.attendanceRate === null ? "—" : learner.attendanceRate + "%") + "</td>" +
        "</tr>"
      );
    }).join("");
  }

  function printTermSummary() {
    var data = state.termSummary;
    if (!data) {
      window.UI.toast("Nothing to print", "Load a term summary first.", "info");
      return;
    }
    var head = "<tr><th>#</th><th>Learner</th><th>LRN</th><th>Sex</th><th>P</th><th>A</th><th>T</th><th>E</th><th>H</th><th>Recorded</th><th>Missing</th><th>Rate</th></tr>";
    var rows = data.learners.map(function (learner, index) {
      return "<tr><td>" + (index + 1) + "</td><td>" + F.esc(learner.fullName) + "</td><td>" + F.esc(learner.lrn) +
        "</td><td>" + F.esc(learner.sex === "male" ? "M" : learner.sex === "female" ? "F" : "—") + "</td>" +
        "<td>" + learner.totals.present + "</td><td>" + learner.totals.absent + "</td><td>" + learner.totals.tardy +
        "</td><td>" + learner.totals.excused + "</td><td>" + learner.totals.half_day + "</td><td>" + learner.totals.recorded +
        "</td><td>" + learner.missingDays + "</td><td>" + (learner.attendanceRate === null ? "" : learner.attendanceRate + "%") + "</td></tr>";
    }).join("");
    L.printHtml(
      "Term attendance summary — " + data.section.name,
      "<h1>Term Attendance Summary</h1>" +
      '<p class="print-meta">' + F.esc(data.section.schoolName + " · " + data.section.gradeLevelName + " · " + data.section.name) +
      "<br>" + F.esc(data.term.name + " · " + data.range.start + " – " + data.range.end + " · " + data.schoolDays + " school days") +
      ". Derived from validated daily attendance. This working summary is not an official DepEd form.</p>" +
      "<table><thead>" + head + "</thead><tbody>" + rows + "</tbody></table>" +
      '<div class="print-sign"><div>Class Adviser</div><div>School Head</div></div>'
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Start                                                                  */
  /* ---------------------------------------------------------------------- */

  function init() {
    window.AppShell.init({
      page: "adviser-attendance",
      breadcrumbs: ["Attendance", "Adviser Attendance"],
      requiredPermission: "canValidateAttendance"
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      var params = new URLSearchParams(window.location.search);
      if (params.get("sectionId")) {
        state.sectionId = params.get("sectionId");
      }
      if (params.get("date")) {
        state.date = params.get("date");
      }
      var tab = params.get("tab");
      if (tab && ["daily", "corrections", "term"].indexOf(tab) !== -1) {
        state.tab = tab;
      }
      setupFilters()
        .then(function () {
          setTab(state.tab);
        })
        .catch(function (error) {
          if (error.status === 401) {
            return;
          }
          alertBox("adviserAlert", "danger", L.friendlyError(error), "Adviser attendance could not start");
        });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
