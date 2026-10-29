/* DepEd Learner Records — grades, promotion, and report cards */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var F = window.FormsUI;

  var state = {
    schoolId: "",
    yearId: "",
    sectionId: "",
    sectionSchoolId: "",
    sections: [],
    subjectId: "",
    period: "q1",
    tab: "entry",
    entry: null,
    promotion: [],
    cards: [],
    policy: null,
    years: []
  };

  var DECISION_LABELS = {
    pending: { label: "Pending", tone: "neutral" },
    promoted: { label: "Promoted", tone: "success" },
    retained: { label: "Retained", tone: "danger" },
    conditional: { label: "Conditional", tone: "warning" },
    completed: { label: "Completed", tone: "teal" },
    other: { label: "Other", tone: "muted" }
  };

  var WORKFLOW_LABELS = {
    recommended: { label: "Recommended", tone: "info" },
    approved: { label: "Approved", tone: "success" },
    finalized: { label: "Finalized", tone: "teal" }
  };

  var CARD_LABELS = {
    draft: { label: "Draft", tone: "neutral" },
    submitted: { label: "Submitted", tone: "info" },
    approved: { label: "Approved", tone: "success" },
    issued: { label: "Issued", tone: "teal" }
  };

  function el(id) {
    return document.getElementById(id);
  }

  function canManage() {
    return F.permission("canManageGrades");
  }

  function canCorrect() {
    var role = F.role();
    return (
      canManage() &&
      (role === "system_admin" || role === "district_admin" || role === "school_head")
    );
  }

  function failed(error) {
    return error && error.status === 401;
  }

  function alertPage(tone, message, title) {
    F.pageAlert("gradesAlert", tone, message, title);
  }

  function activeScope() {
    return {
      sectionId: state.sectionId || undefined,
      schoolYearId: state.yearId || undefined
    };
  }

  function requireSection() {
    if (!state.sectionId) {
      alertPage("warning", "Choose a section to load its academic records.", "Section required");
      return false;
    }
    return true;
  }

  function sectionLabel() {
    var entry = state.entry;
    if (!entry || !entry.section) {
      return "Choose a section to begin.";
    }
    return (
      entry.section.schoolName +
      " · " +
      entry.section.gradeLevelName +
      " " +
      entry.section.name +
      " · " +
      entry.section.schoolYearName +
      (entry.section.adviserName ? " · Adviser: " + entry.section.adviserName : "")
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Grade entry                                                            */
  /* ---------------------------------------------------------------------- */

  function gradeNote(entry) {
    var note = el("gradePolicyNote");
    if (!note || !entry) {
      return;
    }
    var policy = entry.policy || {};
    var formula =
      policy.finalFormula === "weighted"
        ? "weighted quarters (" + (policy.quarterWeights || []).join(" / ") + ")"
        : "average of four quarters";
    note.textContent =
      "Passing grade " +
      (policy.passingGrade === undefined ? "75" : policy.passingGrade) +
      " · Final grade = " +
      formula +
      "." +
      (policy.isDefault
        ? " This is the system default policy; the school has not saved an approved policy for this year."
        : " Source: the school's saved grading policy.");
  }

  function recordFor(enrollmentId, records) {
    for (var index = 0; index < records.length; index += 1) {
      if (String(records[index].enrollmentId) === String(enrollmentId)) {
        return records[index];
      }
    }
    return null;
  }

  function renderEntry() {
    var entry = state.entry;
    var body = el("gradeBody");
    var meta = el("gradeMeta");
    if (!entry) {
      body.innerHTML = F.emptyRow(7, "Choose a section, subject, and quarter.");
      return;
    }
    el("gradesScopeLabel").textContent = sectionLabel();
    var subjectSelect = el("gradeSubject");
    var options = (entry.subjects || []).map(function (subject) {
      return L.option(subject.id, subject.name + (subject.code ? " (" + subject.code + ")" : ""), state.subjectId);
    });
    subjectSelect.innerHTML = options.length
      ? options.join("")
      : '<option value="">No subjects offered for this grade level</option>';

    var subject = (entry.subjects || []).find(function (item) {
      return String(item.id) === String(state.subjectId);
    });
    var records = (entry.records || []).filter(function (record) {
      return record.period === state.period && String(record.subjectId) === String(state.subjectId);
    });

    if (!entry.learners.length) {
      body.innerHTML = F.emptyRow(7, "No enrolled learners in this section.");
    } else {
      body.innerHTML = entry.learners
        .map(function (learner, index) {
          var record = recordFor(learner.enrollmentId, records);
          var locked = record && record.status === "finalized";
          var statusBadge = record
            ? window.UI.pillarBadge(
                record.status === "finalized"
                  ? "Finalized"
                  : record.status === "submitted"
                  ? "Submitted"
                  : "Draft",
                record.status === "finalized" ? "teal" : record.status === "submitted" ? "info" : "neutral"
              )
            : window.UI.pillarBadge("Not entered", "muted");
          return (
            "<tr>" +
            "<td>" + (index + 1) + "</td>" +
            "<td><strong>" + F.esc(learner.fullName) + "</strong>" +
            (learner.enrollmentStatus && learner.enrollmentStatus !== "enrolled"
              ? '<span class="field-hint">' + F.esc(L.ENROLLMENT_STATUS[learner.enrollmentStatus] ? L.ENROLLMENT_STATUS[learner.enrollmentStatus].label : learner.enrollmentStatus) + "</span>"
              : "") +
            "</td>" +
            '<td><code class="lrn-code">' + F.esc(learner.lrn) + "</code></td>" +
            '<td><input type="number" class="form-control form-control-sm grade-input" min="0" max="100" step="0.01" ' +
            'inputmode="decimal" data-enrollment="' + learner.enrollmentId + '" ' +
            'aria-label="Grade for ' + F.esc(learner.fullName) + '" value="' +
            (record ? F.esc(record.grade) : "") + '"' + (locked ? " disabled" : "") + "></td>" +
            "<td>" + statusBadge + "</td>" +
            '<td><input type="text" class="form-control form-control-sm" maxlength="255" ' +
            'data-remarks="' + learner.enrollmentId + '" placeholder="Optional" value="' +
            F.esc(record && record.remarks ? record.remarks : "") + '"' + (locked ? " disabled" : "") + "></td>" +
            '<td class="text-right">' +
            (locked && canCorrect()
              ? '<button type="button" class="btn btn-light btn-sm" data-correct="' + learner.enrollmentId + '">Correct</button>'
              : locked
              ? '<span class="field-hint">Locked</span>'
              : "") +
            "</td>" +
            "</tr>"
          );
        })
        .join("");
    }

    var entered = records.length;
    var expected = entry.learners.length;
    var drafted = records.filter(function (record) {
      return record.status === "draft";
    }).length;
    var submitted = records.filter(function (record) {
      return record.status === "submitted";
    }).length;
    meta.textContent =
      (subject ? subject.name : "Subject") +
      " · " +
      (state.period || "").toUpperCase() +
      " · " +
      entered +
      " of " +
      expected +
      " learners entered" +
      (drafted ? " · " + drafted + " draft" : "") +
      (submitted ? " · " + submitted + " submitted" : "") +
      " · Final grades are computed on the server from the configured policy.";

    el("saveGradesButton").classList.toggle("d-none", !canManage());
    el("submitGradesButton").classList.toggle("d-none", !canManage() || !drafted);
    el("finalizeGradesButton").classList.toggle("d-none", !canManage() || !submitted);
    gradeNote(entry);
  }

  function loadEntry() {
    if (!requireSection()) {
      return Promise.resolve();
    }
    el("gradeBody").innerHTML = L.skeletonRows(7, 5);
    return L.apiGet("/grades/entry", {
      sectionId: state.sectionId,
      schoolYearId: state.yearId || undefined,
      subjectId: state.subjectId || undefined
    })
      .then(function (entry) {
        state.entry = entry;
        if (entry.schoolYearId) {
          state.yearId = String(entry.schoolYearId);
        }
        var subjects = entry.subjects || [];
        var exists = subjects.some(function (subject) {
          return String(subject.id) === String(state.subjectId);
        });
        if (!exists) {
          state.subjectId = subjects.length ? String(subjects[0].id) : "";
        }
        if (!subjects.length) {
          renderEntry();
          return null;
        }
        if (!state.subjectId) {
          renderEntry();
          return null;
        }
        return L.apiGet("/grades/entry", {
          sectionId: state.sectionId,
          schoolYearId: state.yearId || undefined,
          subjectId: state.subjectId
        }).then(function (filtered) {
          state.entry = filtered;
          renderEntry();
          return filtered;
        });
      })
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        el("gradeBody").innerHTML = F.emptyRow(7, L.friendlyError(error));
        el("gradeMeta").textContent = "Grades could not be loaded.";
        alertPage("danger", L.friendlyError(error), "Could not load grades");
      });
  }

  function collectEntries() {
    var entry = state.entry;
    var records = (entry.records || []).filter(function (record) {
      return record.period === state.period && String(record.subjectId) === String(state.subjectId);
    });
    var out = [];
    Array.prototype.forEach.call(el("gradeBody").querySelectorAll("[data-enrollment]"), function (input) {
      var enrollmentId = input.dataset.enrollment;
      var existing = recordFor(enrollmentId, records);
      var remarksInput = el("gradeBody").querySelector('[data-remarks="' + enrollmentId + '"]');
      var raw = input.value.trim();
      var grade = raw === "" ? null : Number(raw);
      if (raw !== "" && (!Number.isFinite(grade) || grade < 0 || grade > 100)) {
        throw new Error("Grades must be numbers between 0 and 100.");
      }
      if (grade === null && !existing) {
        return;
      }
      if (existing && existing.status === "finalized") {
        return;
      }
      out.push({
        enrollmentId: Number(enrollmentId),
        grade: grade,
        remarks: remarksInput ? remarksInput.value.trim() : ""
      });
    });
    return out;
  }

  function saveEntry() {
    if (!requireSection() || !state.subjectId) {
      return;
    }
    var entries;
    try {
      entries = collectEntries();
    } catch (error) {
      alertPage("warning", error.message, "Check the grade values");
      return;
    }
    if (!entries.length) {
      alertPage("warning", "Enter at least one grade before saving.", "No grades entered");
      return;
    }
    var button = el("saveGradesButton");
    window.UI.setButtonLoading(button, true, "Saving…");
    API.put("/grades/entry", {
      sectionId: Number(state.sectionId),
      schoolYearId: state.yearId ? Number(state.yearId) : undefined,
      subjectId: Number(state.subjectId),
      period: state.period,
      entries: entries
    })
      .then(function () {
        window.UI.setButtonLoading(button, false);
        window.UI.toast("Grades saved", entries.length + " draft record" + (entries.length === 1 ? "" : "s") + " saved.", "success");
        return loadEntry();
      })
      .catch(function (error) {
        window.UI.setButtonLoading(button, false);
        if (failed(error)) {
          return;
        }
        alertPage("danger", L.friendlyError(error), "Could not save grades");
      });
  }

  function submitEntry() {
    if (!requireSection() || !state.subjectId) {
      return;
    }
    window.UI.confirm({
      title: "Submit quarter grades",
      message: "Submit " + (state.period || "").toUpperCase() + " grades for this subject to the school head for validation? Draft records become submitted.",
      confirmLabel: "Submit grades",
      tone: "primary"
    }).then(function (ok) {
      if (!ok) {
        return;
      }
      var button = el("submitGradesButton");
      window.UI.setButtonLoading(button, true, "Submitting…");
      API.post("/grades/submit", {
        sectionId: Number(state.sectionId),
        subjectId: Number(state.subjectId),
        period: state.period
      })
        .then(function (payload) {
          window.UI.setButtonLoading(button, false);
          var data = payload.data || {};
          window.UI.toast(
            "Quarter submitted",
            (data.submitted || 0) + " record(s) submitted" + (data.missing ? " · " + data.missing + " learner(s) still missing a grade" : "."),
            data.missing ? "warning" : "success"
          );
          return loadEntry();
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (failed(error)) {
            return;
          }
          alertPage("danger", L.friendlyError(error), "Could not submit grades");
        });
    });
  }

  function finalizeEntry() {
    if (!requireSection() || !state.subjectId) {
      return;
    }
    window.UI.confirm({
      title: "Finalize quarter grades",
      message: "Finalizing locks these submitted grades. Later changes require an authorized correction with a recorded reason. Continue?",
      confirmLabel: "Finalize grades",
      tone: "danger"
    }).then(function (ok) {
      if (!ok) {
        return;
      }
      var button = el("finalizeGradesButton");
      window.UI.setButtonLoading(button, true, "Finalizing…");
      API.post("/grades/finalize", {
        sectionId: Number(state.sectionId),
        subjectId: Number(state.subjectId),
        period: state.period
      })
        .then(function (payload) {
          window.UI.setButtonLoading(button, false);
          var data = payload.data || {};
          window.UI.toast(
            "Quarter finalized",
            (data.finalized || 0) + " record(s) locked · " + (data.finalsComputed || 0) + " subject final(s) computed" +
              (data.missingFinals ? " · " + data.missingFinals + " learner(s) incomplete" : "."),
            "success"
          );
          return loadEntry();
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (failed(error)) {
            return;
          }
          alertPage("danger", L.friendlyError(error), "Could not finalize grades");
        });
    });
  }

  function correctionModal(enrollmentId) {
    var entry = state.entry;
    var learner = (entry.learners || []).find(function (row) {
      return String(row.enrollmentId) === String(enrollmentId);
    });
    var records = (entry.records || []).filter(function (record) {
      return (
        record.period === state.period &&
        String(record.subjectId) === String(state.subjectId) &&
        String(record.enrollmentId) === String(enrollmentId)
      );
    });
    var record = records[0];
    var subject = (entry.subjects || []).find(function (item) {
      return String(item.id) === String(state.subjectId);
    });
    var dialog = L.modal({
      title: "Correct finalized grade",
      eyebrow: learner ? learner.fullName : "Grade correction",
      size: "",
      body:
        '<div class="info-banner info-banner--warning"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><div>Only the school head or an administrator may correct a finalized grade. The reason and previous value are preserved in the audit trail.</div></div>' +
        '<div id="correctionAlert" class="d-none mb-3" role="alert"></div>' +
        '<form id="correctionForm" novalidate>' +
        '<div class="form-group"><label>Subject and period</label><input class="form-control" readonly value="' +
        F.esc((subject ? subject.name : "Subject") + " · " + (state.period || "").toUpperCase()) +
        '"></div>' +
        '<div class="form-group"><label for="correctionGrade">Corrected grade <span class="required-mark">*</span></label>' +
        '<input type="number" class="form-control" id="correctionGrade" name="grade" min="0" max="100" step="0.01" value="' +
        (record ? F.esc(record.grade) : "") +
        '"><span class="field-error"></span></div>' +
        '<div class="form-group"><label for="correctionRemarks">Remarks</label>' +
        '<input class="form-control" id="correctionRemarks" name="remarks" maxlength="255" value="' +
        F.esc(record && record.remarks ? record.remarks : "") +
        '"></div>' +
        '<div class="form-group mb-0"><label for="correctionReason">Reason for correction <span class="required-mark">*</span></label>' +
        '<textarea class="form-control" id="correctionReason" name="reason" rows="3" minlength="5" maxlength="500" placeholder="Explain the verified basis for the correction…"></textarea>' +
        '<span class="field-error"></span></div>' +
        "</form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="button" class="btn btn-warning" id="correctionSaveButton">Save correction</button>'
    });
    var form = dialog.element.querySelector("#correctionForm");
    var button = dialog.element.querySelector("#correctionSaveButton");
    var alertBox = dialog.element.querySelector("#correctionAlert");

    button.addEventListener("click", function () {
      window.UI.clearFieldErrors(form);
      window.UI.hideAlert(alertBox);
      var values = L.formValues(form);
      var grade = values.grade === "" ? null : Number(values.grade);
      var reason = values.reason.trim();
      if (grade === null || !Number.isFinite(grade) || grade < 0 || grade > 100) {
        window.UI.fieldError(form.querySelector("#correctionGrade"), "Enter a grade between 0 and 100.");
        return;
      }
      if (reason.length < 5) {
        window.UI.fieldError(form.querySelector("#correctionReason"), "Provide a reason of at least 5 characters.");
        return;
      }
      window.UI.setButtonLoading(button, true, "Saving…");
      API.post("/grades/correction", {
        sectionId: Number(state.sectionId),
        subjectId: Number(state.subjectId),
        period: state.period,
        enrollmentId: Number(enrollmentId),
        grade: grade,
        reason: reason,
        remarks: values.remarks.trim()
      })
        .then(function () {
          window.UI.setButtonLoading(button, false);
          dialog.close();
          window.UI.toast("Grade corrected", "The change and reason were recorded in the audit trail.", "success");
          loadEntry();
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (failed(error)) {
            return;
          }
          window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not correct the grade");
        });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Promotion                                                              */
  /* ---------------------------------------------------------------------- */

  function renderPromotion() {
    var body = el("promotionBody");
    if (!state.promotion.length) {
      body.innerHTML = F.emptyRow(8, "No learners in this section, or finals are not yet available. Finalize grades before computing promotion.");
      return;
    }
    body.innerHTML = state.promotion
      .map(function (row) {
        var decision = row.decision;
        var decisionBadge = decision
          ? window.UI.pillarBadge(
              (DECISION_LABELS[decision.decision] || DECISION_LABELS.pending).label,
              (DECISION_LABELS[decision.decision] || DECISION_LABELS.pending).tone
            )
          : window.UI.pillarBadge("Not computed", "neutral");
        var workflowBadge = decision
          ? window.UI.pillarBadge(
              (WORKFLOW_LABELS[decision.workflowStatus] || { label: window.UI.titleCase(decision.workflowStatus || "—"), tone: "neutral" }).label,
              (WORKFLOW_LABELS[decision.workflowStatus] || { tone: "neutral" }).tone
            )
          : "—";
        var missing = (row.missingSubjects || []).length;
        return (
          "<tr>" +
          "<td><strong>" + F.esc(row.fullName) + "</strong></td>" +
          '<td><code class="lrn-code">' + F.esc(row.lrn) + "</code></td>" +
          '<td class="text-right">' + (row.generalAverage === null || row.generalAverage === undefined ? "—" : F.esc(row.generalAverage)) + "</td>" +
          '<td class="text-right">' + F.esc((row.finalGrades || []).length) + " / " + F.esc(row.expectedSubjects || 0) + "</td>" +
          "<td>" +
          (missing
            ? '<span class="status-badge status-badge--warning"><span class="status-dot"></span>' + missing + " missing</span>"
            : '<span class="field-hint">Complete</span>') +
          "</td>" +
          "<td>" + decisionBadge + "</td>" +
          "<td>" + workflowBadge + "</td>" +
          '<td class="text-right">' +
          (decision && canManage() && decision.workflowStatus !== "finalized"
            ? '<button type="button" class="btn btn-light btn-sm" data-decide="' + decision.id + '">Review</button>'
            : decision
            ? '<span class="field-hint">Locked</span>'
            : '<span class="field-hint">Compute first</span>') +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function loadPromotion() {
    if (!requireSection()) {
      return Promise.resolve();
    }
    el("promotionBody").innerHTML = L.skeletonRows(8, 5);
    return L.apiGet("/grades/promotion", activeScope())
      .then(function (rows) {
        state.promotion = rows || [];
        renderPromotion();
        el("computePromotionButton").classList.toggle("d-none", !canManage());
      })
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        el("promotionBody").innerHTML = F.emptyRow(8, L.friendlyError(error));
      });
  }

  function computePromotion() {
    if (!requireSection()) {
      return;
    }
    var button = el("computePromotionButton");
    window.UI.setButtonLoading(button, true, "Computing…");
    API.post("/grades/promotion/compute", {
      sectionId: Number(state.sectionId),
      schoolYearId: state.yearId ? Number(state.yearId) : undefined
    })
      .then(function (payload) {
        window.UI.setButtonLoading(button, false);
        var data = payload.data || {};
        window.UI.toast(
          "Recommendations computed",
          (data.recommended || 0) + " learner(s) updated under passing grade " +
            ((data.policy && data.policy.passingGrade) || 75) +
            ". Approved or finalized decisions were left unchanged.",
          "success"
        );
        state.promotion = data.rows || [];
        renderPromotion();
      })
      .catch(function (error) {
        window.UI.setButtonLoading(button, false);
        if (failed(error)) {
          return;
        }
        alertPage("danger", L.friendlyError(error), "Could not compute promotion");
      });
  }

  function decisionModal(id) {
    var row = state.promotion.find(function (item) {
      return item.decision && String(item.decision.id) === String(id);
    });
    if (!row) {
      return;
    }
    var decision = row.decision;
    var role = F.role();
    var canApprove = role === "school_head" || role === "district_admin" || role === "system_admin";
    var dialog = L.modal({
      title: "Promotion decision",
      eyebrow: row.fullName + " · LRN " + row.lrn,
      size: "",
      body:
        '<div id="decisionAlert" class="d-none mb-3" role="alert"></div>' +
        '<div class="review-summary mb-3">' +
        "<div><span>General average</span><strong>" + F.esc(row.generalAverage === null ? "—" : row.generalAverage) + "</strong></div>" +
        "<div><span>Finalized subjects</span><strong>" + F.esc((row.finalGrades || []).length) + " / " + F.esc(row.expectedSubjects || 0) + "</strong></div>" +
        "<div><span>Missing finals</span><strong>" + F.esc((row.missingSubjects || []).length) + "</strong></div>" +
        "</div>" +
        (canApprove
          ? ""
          : '<div class="info-banner info-banner--warning"><i class="bi bi-shield-lock" aria-hidden="true"></i><div>You can record adviser remarks, but only the school head or an administrator may approve or finalize this decision.</div></div>') +
        '<form id="decisionForm" novalidate>' +
        '<div class="form-row">' +
        '<div class="col-md-6"><div class="form-group"><label for="decisionOutcome">Outcome</label>' +
        '<select class="custom-select" id="decisionOutcome" name="decision">' +
        ["promoted", "retained", "conditional", "completed", "other"]
          .map(function (key) {
            return L.option(key, DECISION_LABELS[key].label, decision.decision);
          })
          .join("") +
        "</select></div></div>" +
        '<div class="col-md-6"><div class="form-group"><label for="decisionWorkflow">Workflow</label>' +
        '<select class="custom-select" id="decisionWorkflow" name="workflowStatus">' +
        ["recommended", "approved", "finalized"]
          .filter(function (key) {
            return canApprove || key === "recommended";
          })
          .map(function (key) {
            return L.option(key, WORKFLOW_LABELS[key].label, decision.workflowStatus);
          })
          .join("") +
        "</select></div></div>" +
        '<div class="col-12"><div class="form-group"><label for="decisionAdviser">Adviser remarks</label>' +
        '<textarea class="form-control" id="decisionAdviser" name="adviserRemarks" rows="2" maxlength="2000">' +
        F.esc(decision.adviserRemarks || "") +
        "</textarea></div></div>" +
        '<div class="col-12"><div class="form-group mb-0"><label for="decisionHead">School head remarks</label>' +
        '<textarea class="form-control" id="decisionHead" name="headRemarks" rows="2" maxlength="2000">' +
        F.esc(decision.headRemarks || "") +
        "</textarea></div></div>" +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="decisionSaveButton">Save decision</button>'
    });
    var form = dialog.element.querySelector("#decisionForm");
    var button = dialog.element.querySelector("#decisionSaveButton");
    var alertBox = dialog.element.querySelector("#decisionAlert");
    button.addEventListener("click", function () {
      var values = L.formValues(form);
      window.UI.setButtonLoading(button, true, "Saving…");
      API.patch("/grades/promotion/" + id, {
        decision: values.decision,
        workflowStatus: values.workflowStatus,
        adviserRemarks: values.adviserRemarks.trim(),
        headRemarks: values.headRemarks.trim()
      })
        .then(function () {
          window.UI.setButtonLoading(button, false);
          dialog.close();
          window.UI.toast("Decision saved", row.fullName + " · " + DECISION_LABELS[values.decision].label + " (" + WORKFLOW_LABELS[values.workflowStatus].label + ")", "success");
          loadPromotion();
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (failed(error)) {
            return;
          }
          window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not save the decision");
        });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Report cards                                                           */
  /* ---------------------------------------------------------------------- */

  function renderCards() {
    var body = el("reportBody");
    if (!state.cards.length) {
      body.innerHTML = F.emptyRow(
        9,
        "No report cards prepared for this section yet. Finalize every subject, then generate report cards."
      );
      return;
    }
    body.innerHTML = state.cards
      .map(function (card) {
        var meta = CARD_LABELS[card.status] || { label: window.UI.titleCase(card.status || "—"), tone: "neutral" };
        var promotion = DECISION_LABELS[card.promotionStatus] || { label: card.promotionStatus ? window.UI.titleCase(card.promotionStatus) : "—", tone: "neutral" };
        var actions = ['<button type="button" class="btn btn-light btn-sm" data-card-view="' + card.id + '" title="View report card"><i class="bi bi-eye" aria-hidden="true"></i></button>'];
        if (canManage()) {
          if (card.status === "draft") {
            actions.push('<button type="button" class="btn btn-light btn-sm" data-card-action="submit" data-card-id="' + card.id + '" title="Submit for approval">Submit</button>');
          } else if (card.status === "submitted") {
            actions.push('<button type="button" class="btn btn-light btn-sm" data-card-action="approve" data-card-id="' + card.id + '" title="Approve report card">Approve</button>');
          } else if (card.status === "approved") {
            actions.push('<button type="button" class="btn btn-light btn-sm" data-card-action="issue" data-card-id="' + card.id + '" title="Issue report card">Issue</button>');
          } else if (card.status === "issued") {
            actions.push('<button type="button" class="btn btn-light btn-sm" data-card-action="reissue" data-card-id="' + card.id + '" title="Reissue report card">Reissue</button>');
          }
        }
        return (
          "<tr>" +
          "<td><strong>" + F.esc(card.learnerName) + "</strong></td>" +
          '<td><code class="lrn-code">' + F.esc(card.lrn) + "</code></td>" +
          "<td>" + F.esc([card.gradeLevelName, card.sectionName].filter(Boolean).join(" · ")) + "</td>" +
          '<td class="text-right">' + (card.generalAverage === null ? "—" : F.esc(card.generalAverage)) + "</td>" +
          "<td>" + window.UI.pillarBadge(promotion.label, promotion.tone) + "</td>" +
          "<td>" + window.UI.pillarBadge(meta.label, meta.tone) + "</td>" +
          "<td>v" + F.esc(card.version) + "</td>" +
          "<td>" + F.esc(card.issuedOn ? window.UI.phDate(card.issuedOn) : "Not issued") + "</td>" +
          '<td class="text-right"><div class="row-actions">' + actions.join("") + "</div></td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function loadCards() {
    if (!requireSection()) {
      return Promise.resolve();
    }
    el("reportBody").innerHTML = L.skeletonRows(9, 5);
    return L.apiGet("/grades/report-cards", activeScope())
      .then(function (rows) {
        state.cards = rows || [];
        renderCards();
        el("generateCardsButton").classList.toggle("d-none", !canManage());
      })
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        el("reportBody").innerHTML = F.emptyRow(9, L.friendlyError(error));
      });
  }

  function generateCards() {
    if (!requireSection()) {
      return;
    }
    var button = el("generateCardsButton");
    window.UI.setButtonLoading(button, true, "Generating…");
    API.post("/grades/report-cards/generate", {
      sectionId: Number(state.sectionId),
      schoolYearId: state.yearId ? Number(state.yearId) : undefined
    })
      .then(function (payload) {
        window.UI.setButtonLoading(button, false);
        var data = payload.data || {};
        state.cards = data.items || [];
        renderCards();
        window.UI.toast(
          "Report cards generated",
          (data.generated || 0) + " report card(s) prepared" +
            ((data.missing || []).length ? " · incomplete finals for " + data.missing.join(", ") : "."),
          (data.missing || []).length ? "warning" : "success"
        );
      })
      .catch(function (error) {
        window.UI.setButtonLoading(button, false);
        if (failed(error)) {
          return;
        }
        alertPage("danger", L.friendlyError(error), "Could not generate report cards");
      });
  }

  function cardDetail(id) {
    var dialog = L.modal({
      title: "Report card",
      eyebrow: "SF9 working report card",
      size: "modal-xl",
      body: '<div id="cardDetail"><div class="skeleton skeleton-block"></div></div>',
      footer: '<button type="button" class="btn btn-light" data-dismiss="modal">Close</button>'
    });
    var mount = dialog.element.querySelector("#cardDetail");
    L.apiGet("/grades/report-cards/" + id)
      .then(function (payload) {
        var card = payload.card || {};
        var enrollment = payload.enrollment || {};
        var meta = CARD_LABELS[card.status] || { label: window.UI.titleCase(card.status || "—"), tone: "neutral" };
        var subjects = payload.subjects || [];
        mount.innerHTML =
          '<div class="review-summary">' +
          "<div><span>Learner</span><strong>" + F.esc(enrollment.learnerName || "—") + "</strong></div>" +
          "<div><span>LRN</span><strong>" + F.esc(enrollment.lrn || "—") + "</strong></div>" +
          "<div><span>School</span><strong>" + F.esc(enrollment.schoolName || "—") + "</strong></div>" +
          "<div><span>Grade / Section</span><strong>" + F.esc([enrollment.gradeLevelName, enrollment.sectionName].filter(Boolean).join(" · ") || "—") + "</strong></div>" +
          "<div><span>School year</span><strong>" + F.esc(enrollment.schoolYearName || "—") + "</strong></div>" +
          "<div><span>Adviser</span><strong>" + F.esc(enrollment.adviserName || "Not assigned") + "</strong></div>" +
          "<div><span>General average</span><strong>" + F.esc(card.generalAverage === null ? "—" : card.generalAverage) + "</strong></div>" +
          "<div><span>Status</span><strong>" + window.UI.pillarBadge(meta.label, meta.tone) + "</strong></div>" +
          "<div><span>Version</span><strong>v" + F.esc(card.version) + "</strong></div>" +
          "<div><span>Issued</span><strong>" + F.esc(card.issuedOn ? window.UI.phDate(card.issuedOn) : "Not issued") + "</strong></div>" +
          "</div>" +
          (subjects.length
            ? '<div class="report-preview"><div class="report-preview__scroll"><table><thead><tr><th>Subject</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>Final</th></tr></thead><tbody>' +
              subjects
                .map(function (subject) {
                  return (
                    "<tr><td>" + F.esc(subject.subjectName) + "</td>" +
                    "<td>" + F.esc(subject.q1 === null ? "—" : subject.q1) + "</td>" +
                    "<td>" + F.esc(subject.q2 === null ? "—" : subject.q2) + "</td>" +
                    "<td>" + F.esc(subject.q3 === null ? "—" : subject.q3) + "</td>" +
                    "<td>" + F.esc(subject.q4 === null ? "—" : subject.q4) + "</td>" +
                    "<td><strong>" + F.esc(subject.final) + "</strong></td></tr>"
                  );
                })
                .join("") +
              "</tbody></table></div></div>"
            : '<p class="empty-cell">No finalized subjects yet.</p>') +
          '<p class="form-text">This is a working report card view. It is not an official SF9 until reviewed, approved, and issued under the school\'s records process.</p>';
      })
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        mount.innerHTML = '<p class="empty-cell">' + F.esc(L.friendlyError(error)) + "</p>";
      });
  }

  function cardAction(id, action, card) {
    if (action === "reissue") {
      var dialog = L.modal({
        title: "Reissue report card",
        eyebrow: card.learnerName,
        size: "",
        body:
          '<div class="info-banner info-banner--warning"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><div>The issued version is preserved in the revision history. Provide the verified reason for reissuing.</div></div>' +
          '<div id="reissueAlert" class="d-none mb-3" role="alert"></div>' +
          '<div class="form-group mb-0"><label for="reissueReason">Reason <span class="required-mark">*</span></label>' +
          '<textarea class="form-control" id="reissueReason" rows="3" maxlength="2000" placeholder="Why a new version is required…"></textarea></div>',
        footer:
          '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
          '<button type="button" class="btn btn-warning" id="reissueButton">Reissue</button>'
      });
      var button = dialog.element.querySelector("#reissueButton");
      var alertBox = dialog.element.querySelector("#reissueAlert");
      var reason = dialog.element.querySelector("#reissueReason");
      button.addEventListener("click", function () {
        if (!reason.value.trim()) {
          window.UI.fieldError(reason, "A reason is required for a reissue.");
          return;
        }
        runCardAction(dialog, button, alertBox, id, action, { reason: reason.value.trim() });
      });
      return;
    }
    var labels = {
      submit: { title: "Submit report card", message: "Submit this report card for school head approval?", confirm: "Submit", tone: "primary" },
      approve: { title: "Approve report card", message: "Approve this report card? Approved cards can then be issued.", confirm: "Approve", tone: "success" },
      issue: { title: "Issue report card", message: "Issue this report card to the learner record? The issued version and date are recorded.", confirm: "Issue", tone: "primary" }
    };
    var meta = labels[action];
    if (!meta) {
      return;
    }
    window.UI.confirm({
      title: meta.title,
      message: meta.message,
      confirmLabel: meta.confirm,
      tone: meta.tone
    }).then(function (ok) {
      if (!ok) {
        return;
      }
      runCardAction(null, null, null, id, action, {});
    });
  }

  function runCardAction(dialog, button, alertBox, id, action, payload) {
    if (button) {
      window.UI.setButtonLoading(button, true, "Working…");
    }
    API.post("/grades/report-cards/" + id + "/" + action, payload)
      .then(function () {
        if (button) {
          window.UI.setButtonLoading(button, false);
        }
        if (dialog) {
          dialog.close();
        }
        window.UI.toast("Report card updated", "The report card is now " + action + "ed.", "success");
        loadCards();
      })
      .catch(function (error) {
        if (button) {
          window.UI.setButtonLoading(button, false);
        }
        if (failed(error)) {
          return;
        }
        if (alertBox) {
          window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not update the report card");
        } else {
          alertPage("danger", L.friendlyError(error), "Could not update the report card");
        }
      });
  }

  /* ---------------------------------------------------------------------- */
  /* Grading policy                                                         */
  /* ---------------------------------------------------------------------- */

  function sectionRecord(sectionId) {
    for (var index = 0; index < state.sections.length; index += 1) {
      if (String(state.sections[index].id) === String(sectionId)) {
        return state.sections[index];
      }
    }
    return null;
  }

  function currentSchoolId() {
    if (L.schoolId()) {
      return String(L.schoolId());
    }
    var select = el("gradesSchoolFilter");
    if (select && select.value) {
      return String(select.value);
    }
    if (state.entry && state.entry.section && state.entry.section.schoolId) {
      return String(state.entry.section.schoolId);
    }
    var section = sectionRecord(state.sectionId);
    if (section && section.schoolId) {
      return String(section.schoolId);
    }
    return state.sectionSchoolId ? String(state.sectionSchoolId) : "";
  }

  function renderPolicy(policy) {
    state.policy = policy;
    var badge = el("policyBadge");
    if (!policy) {
      badge.className = "status-badge status-badge--warning";
      badge.innerHTML = '<span class="status-dot"></span>No policy loaded';
      el("policyStatus").textContent = "Choose a school and school year to view its grading policy.";
      el("savePolicyButton").classList.add("d-none");
      return;
    }
    var isDefault = Boolean(policy.isDefault);
    badge.className = "status-badge status-badge--" + (isDefault ? "warning" : "success");
    badge.innerHTML = '<span class="status-dot"></span>' + (isDefault ? "Default policy in use" : "School policy saved");
    el("policyPassing").value = policy.passingGrade === undefined ? 75 : policy.passingGrade;
    el("policyFormula").value = policy.finalFormula || "average";
    var weights = policy.quarterWeights || [0.25, 0.25, 0.25, 0.25];
    [1, 2, 3, 4].forEach(function (index) {
      el("policyW" + index).value = weights[index - 1] === undefined ? 0.25 : weights[index - 1];
    });
    el("policyNotes").value = policy.notes || "";
    el("policyScope").value = (policy.schoolName || "School") + " · " + (policy.schoolYearName || "") + " · Whole school";
    el("policyStatus").textContent = isDefault
      ? "No saved policy for this school year. The default below is a system fallback and must be replaced with the school's approved policy."
      : "Saved policy for this school year. Changes are recorded in the audit trail.";
    el("savePolicyButton").classList.toggle("d-none", !canManage());
    syncWeightFields();
  }

  function syncWeightFields() {
    var weighted = el("policyFormula").value === "weighted";
    el("weightFields").classList.toggle("d-none", !weighted);
  }

  function loadPolicy() {
    var schoolId = currentSchoolId();
    if (!schoolId) {
      renderPolicy(null);
      return Promise.resolve();
    }
    return L.apiGet("/grades/policy", {
      schoolId: schoolId,
      schoolYearId: state.yearId || undefined
    })
      .then(renderPolicy)
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        renderPolicy(null);
        F.pageAlert("policyAlert", "danger", L.friendlyError(error), "Could not load the grading policy");
      });
  }

  function savePolicy() {
    var schoolId = currentSchoolId();
    if (!schoolId || !state.yearId) {
      alertPage("warning", "Choose a school and school year before saving a policy.", "Policy scope required");
      return;
    }
    var form = el("policyForm");
    var button = el("savePolicyButton");
    var alertBox = el("policyAlert");
    window.UI.clearFieldErrors(form);
    window.UI.hideAlert(alertBox);
    var passing = Number(el("policyPassing").value);
    if (!Number.isFinite(passing) || passing < 0 || passing > 100) {
      window.UI.fieldError(el("policyPassing"), "Enter a passing grade between 0 and 100.");
      return;
    }
    var formula = el("policyFormula").value;
    var weights = [1, 2, 3, 4].map(function (index) {
      return Number(el("policyW" + index).value);
    });
    if (formula === "weighted") {
      var invalid = weights.some(function (value) {
        return !Number.isFinite(value) || value < 0 || value > 1;
      });
      if (invalid) {
        alertPage("warning", "Quarter weights must be between 0 and 1.", "Check the weights");
        return;
      }
      var total = weights.reduce(function (sum, value) {
        return sum + value;
      }, 0);
      if (Math.abs(total - 1) > 0.001) {
        alertPage("warning", "Quarter weights must add up to 1. Current total: " + Math.round(total * 1000) / 1000 + ".", "Weights do not balance");
        return;
      }
    }
    window.UI.setButtonLoading(button, true, "Saving…");
    API.put("/grades/policy", {
      schoolId: Number(schoolId),
      schoolYearId: Number(state.yearId),
      gradeLevelId: null,
      passingGrade: passing,
      finalFormula: formula,
      quarterWeights: formula === "weighted" ? weights : [0.25, 0.25, 0.25, 0.25],
      notes: el("policyNotes").value.trim()
    })
      .then(function (payload) {
        window.UI.setButtonLoading(button, false);
        renderPolicy(payload.data);
        window.UI.toast("Policy saved", "The school grading policy was updated and audited.", "success");
        if (state.entry) {
          loadEntry();
        }
      })
      .catch(function (error) {
        window.UI.setButtonLoading(button, false);
        if (failed(error)) {
          return;
        }
        window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not save the policy");
      });
  }

  /* ---------------------------------------------------------------------- */
  /* Tabs and filters                                                       */
  /* ---------------------------------------------------------------------- */

  function switchTab(tab) {
    state.tab = tab;
    ["entry", "promotion", "report", "policy"].forEach(function (key) {
      var button = el("tab" + window.UI.titleCase(key));
      var panel = el("panel" + window.UI.titleCase(key));
      if (button) {
        button.setAttribute("aria-selected", key === tab ? "true" : "false");
        button.classList.toggle("is-active", key === tab);
      }
      if (panel) {
        panel.classList.toggle("d-none", key !== tab);
      }
    });
    if (tab === "entry") {
      loadEntry();
    } else if (tab === "promotion") {
      loadPromotion();
    } else if (tab === "report") {
      loadCards();
    } else if (tab === "policy") {
      loadPolicy();
    }
  }

  function loadYears() {
    return L.years().then(function (years) {
      state.years = years || [];
      var current = state.years.find(function (year) {
        return year.isCurrent;
      });
      if (!state.yearId) {
        state.yearId = current ? String(current.id) : "";
      }
      el("gradesYearFilter").innerHTML = L.yearOptions(state.years, state.yearId, "All school years");
    });
  }

  function refreshSections(selected) {
    return F.filteredSections(currentSchoolId(), state.yearId, el("gradesSectionFilter"), selected || state.sectionId)
      .then(function (list) {
        state.sections = list || [];
        if (!state.sectionId && list.length) {
          state.sectionId = String(list[0].id);
          el("gradesSectionFilter").value = state.sectionId;
        }
        if (!list.length) {
          state.sectionId = "";
          state.sectionSchoolId = "";
          el("gradesScopeLabel").textContent = "No section matches the selected school and year.";
        }
        var section = sectionRecord(state.sectionId);
        state.sectionSchoolId = section && section.schoolId ? String(section.schoolId) : "";
        return list;
      });
  }

  function wire() {
    var tabs = document.querySelectorAll(".module-tabs [data-tab]");
    Array.prototype.forEach.call(tabs, function (button) {
      button.addEventListener("click", function () {
        switchTab(button.dataset.tab);
      });
    });

    el("gradesSchoolFilter").addEventListener("change", function () {
      state.sectionId = "";
      state.entry = null;
      state.policy = null;
      refreshSections("").then(function () {
        if (state.tab === "entry") {
          loadEntry();
        } else if (state.tab === "policy") {
          loadPolicy();
        }
      });
    });

    el("gradesYearFilter").addEventListener("change", function () {
      state.yearId = el("gradesYearFilter").value;
      state.sectionId = "";
      state.entry = null;
      refreshSections("").then(function () {
        if (state.tab === "entry") {
          loadEntry();
        } else if (state.tab === "policy") {
          loadPolicy();
        } else if (state.tab === "promotion") {
          loadPromotion();
        } else {
          loadCards();
        }
      });
    });

    el("gradesSectionFilter").addEventListener("change", function () {
      state.sectionId = el("gradesSectionFilter").value;
      var section = sectionRecord(state.sectionId);
      state.sectionSchoolId = section && section.schoolId ? String(section.schoolId) : "";
      loadEntry();
      if (state.tab === "promotion") {
        loadPromotion();
      } else if (state.tab === "report") {
        loadCards();
      }
    });

    el("gradeSubject").addEventListener("change", function () {
      state.subjectId = el("gradeSubject").value;
      loadEntry();
    });

    el("gradePeriod").addEventListener("change", function () {
      state.period = el("gradePeriod").value;
      renderEntry();
    });

    el("saveGradesButton").addEventListener("click", saveEntry);
    el("submitGradesButton").addEventListener("click", submitEntry);
    el("finalizeGradesButton").addEventListener("click", finalizeEntry);

    el("gradeBody").addEventListener("click", function (event) {
      var button = event.target.closest("[data-correct]");
      if (button) {
        correctionModal(button.dataset.correct);
      }
    });

    el("computePromotionButton").addEventListener("click", computePromotion);
    el("promotionBody").addEventListener("click", function (event) {
      var button = event.target.closest("[data-decide]");
      if (button) {
        decisionModal(button.dataset.decide);
      }
    });

    el("generateCardsButton").addEventListener("click", generateCards);
    el("reportBody").addEventListener("click", function (event) {
      var view = event.target.closest("[data-card-view]");
      if (view) {
        cardDetail(view.dataset.cardView);
        return;
      }
      var action = event.target.closest("[data-card-action]");
      if (action) {
        var card = state.cards.find(function (item) {
          return String(item.id) === String(action.dataset.cardId);
        });
        cardAction(action.dataset.cardId, action.dataset.cardAction, card || {});
      }
    });

    el("policyFormula").addEventListener("change", syncWeightFields);
    el("savePolicyButton").addEventListener("click", savePolicy);
  }

  function init() {
    AppShell.init({
      page: "grades",
      breadcrumbs: ["Grades & Promotion"],
      requiredPermission: "canViewGrades"
    }).then(function (session) {
      if (!session) {
        return;
      }
      wire();
      F.schoolFilter("gradesSchoolControl", "gradesSchoolFilter", L.schoolId() || "");
      return loadYears()
        .then(function () {
          return refreshSections("");
        })
        .then(function () {
          if (state.sectionId) {
            return loadEntry();
          }
          return loadPolicy();
        });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})(window, document);
