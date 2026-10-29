/* DepEd Learner Records — learner movement register */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var F = window.FormsUI;

  var STATUS = {
    pending: { label: "Pending", tone: "warning" },
    approved: { label: "Approved", tone: "success" },
    rejected: { label: "Rejected", tone: "danger" }
  };

  var state = {
    schoolId: "",
    yearId: "",
    month: "",
    movementType: "",
    status: "",
    search: "",
    years: [],
    movements: [],
    summary: null
  };

  function el(id) {
    return document.getElementById(id);
  }

  function canManage() {
    return F.permission("canManageMovements");
  }

  function failed(error) {
    return error && error.status === 401;
  }

  function alertPage(tone, message, title) {
    F.pageAlert("movementsAlert", tone, message, title);
  }

  function currentSchoolId() {
    if (L.schoolId()) {
      return String(L.schoolId());
    }
    var select = el("movementsSchoolFilter");
    return select && select.value ? String(select.value) : "";
  }

  function typeLabel(type) {
    return F.MOVEMENT[type] || window.UI.titleCase(type || "—");
  }

  function scopeLabel() {
    var year = state.years.find(function (item) {
      return String(item.id) === String(state.yearId);
    });
    var schoolName = currentSchoolId()
      ? L.schoolName(currentSchoolId()) || "Selected school"
      : "All accessible schools";
    el("movementsScopeLabel").textContent =
      schoolName + (year ? " · " + year.name : "") + (state.month ? " · " + state.month : " · All months");
  }

  function renderSummary() {
    var data = state.summary || {};
    el("movementIn").textContent = window.UI.number(data.transferred_in || 0);
    el("movementOut").textContent = window.UI.number(data.transferred_out || 0);
    el("movementDrop").textContent = window.UI.number(data.dropped_out || 0);
    el("movementReinstate").textContent = window.UI.number(data.reinstated || 0);
    el("movementPending").textContent = window.UI.number(data.pending || 0);
  }

  function render() {
    var body = el("movementsBody");
    if (!state.movements.length) {
      body.innerHTML = F.emptyRow(9, "No movements match this filter.");
      el("movementsMeta").textContent = "No movements recorded.";
      return;
    }
    body.innerHTML = state.movements
      .map(function (row) {
        var meta = STATUS[row.status] || { label: window.UI.titleCase(row.status || "—"), tone: "neutral" };
        var actions = [];
        if (canManage() && row.status === "pending") {
          actions.push('<button type="button" class="btn btn-light btn-sm" data-decide="' + row.id + '" data-decision="approved" title="Approve movement"><i class="bi bi-check2" aria-hidden="true"></i></button>');
          actions.push('<button type="button" class="btn btn-light btn-sm" data-decide="' + row.id + '" data-decision="rejected" title="Reject movement"><i class="bi bi-x" aria-hidden="true"></i></button>');
        }
        if (canManage() && row.status !== "approved") {
          actions.push('<button type="button" class="btn btn-light btn-sm" data-remove-movement="' + row.id + '" title="Delete pending or rejected record"><i class="bi bi-trash" aria-hidden="true"></i></button>');
        }
        return (
          "<tr>" +
          "<td><strong>" + F.esc(row.learnerName) + "</strong></td>" +
          '<td><code class="lrn-code">' + F.esc(row.lrn) + "</code></td>" +
          "<td>" + F.esc([row.gradeLevelName, row.sectionName].filter(Boolean).join(" · ") || "—") + "</td>" +
          "<td>" + F.esc(typeLabel(row.movementType)) + "</td>" +
          "<td>" + F.esc(window.UI.phDate(row.effectiveDate)) + "</td>" +
          "<td>" + F.esc(row.counterpartSchoolName || "—") +
          (row.referenceNo ? '<span class="field-hint">Ref. ' + F.esc(row.referenceNo) + "</span>" : "") +
          "</td>" +
          '<td class="record-note">' + F.esc(row.reason || "—") + "</td>" +
          "<td>" + window.UI.pillarBadge(meta.label, meta.tone) +
          (row.approvedByName ? '<span class="field-hint">' + F.esc(row.approvedByName) + "</span>" : "") +
          "</td>" +
          '<td class="text-right"><div class="row-actions">' + actions.join("") + "</div></td>" +
          "</tr>"
        );
      })
      .join("");
    el("movementsMeta").textContent =
      state.movements.length + (state.movements.length === 1 ? " movement" : " movements") + " shown · approved records are permanent";
  }

  function loadMovements() {
    el("movementsBody").innerHTML = L.skeletonRows(9, 5);
    return L.apiGet("/movements", {
      schoolId: currentSchoolId() || undefined,
      schoolYearId: state.yearId || undefined,
      month: state.month || undefined,
      movementType: state.movementType || undefined,
      status: state.status || undefined,
      search: state.search.trim() || undefined
    })
      .then(function (payload) {
        state.movements = (payload && payload.items) || [];
        state.summary = (payload && payload.summary) || null;
        render();
        renderSummary();
        scopeLabel();
      })
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        el("movementsBody").innerHTML = F.emptyRow(9, L.friendlyError(error));
        el("movementsMeta").textContent = "Movements could not be loaded.";
      });
  }

  function movementModal() {
    if (!state.yearId) {
      alertPage("warning", "Choose a school year before recording a movement.", "School year required");
      return;
    }
    var dialog = L.modal({
      title: "Record learner movement",
      eyebrow: "Enrollment movement · SF4 source",
      size: "modal-lg",
      body:
        '<div class="info-banner"><i class="bi bi-info-circle" aria-hidden="true"></i><div>Movements start as pending. Once approved, the learner\'s enrollment status changes and the movement becomes a permanent record.</div></div>' +
        '<div id="movementFormAlert" class="d-none mb-3" role="alert"></div>' +
        '<form id="movementForm" novalidate>' +
        '<div class="form-row">' +
        '<div class="col-12"><div class="form-group"><label for="movementLearner">Learner <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="movementLearner" name="learnerId" required><option value="">Loading learners…</option></select>' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="movementType">Movement type <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="movementType" name="movementType">' +
        Object.keys(F.MOVEMENT)
          .map(function (key) {
            return L.option(key, F.MOVEMENT[key], "transferred_out");
          })
          .join("") +
        '<span class="field-error"></span></select></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="movementDate">Effective date <span class="required-mark">*</span></label>' +
        '<input type="date" class="form-control" id="movementDate" name="effectiveDate" value="' + F.todayIso() + '">' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-8"><div class="form-group"><label for="movementSchool">Other school</label>' +
        '<input class="form-control" id="movementSchool" name="counterpartSchoolName" maxlength="160" placeholder="School name for a transfer">' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="movementReference">Reference number</label>' +
        '<input class="form-control" id="movementReference" name="referenceNo" maxlength="80" placeholder="Transfer or request no."></div></div>' +
        '<div class="col-12"><div class="form-group mb-0"><label for="movementReason">Reason <span class="required-mark js-reason-mark d-none">*</span></label>' +
        '<textarea class="form-control" id="movementReason" name="reason" rows="2" maxlength="2000" placeholder="Verified reason for the movement"></textarea>' +
        '<span class="field-error"></span></div></div>' +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="movementSaveButton">Record movement</button>'
    });
    var form = dialog.element.querySelector("#movementForm");
    var button = dialog.element.querySelector("#movementSaveButton");
    var alertBox = dialog.element.querySelector("#movementFormAlert");
    var learnerSelect = dialog.element.querySelector("#movementLearner");
    var typeSelect = dialog.element.querySelector("#movementType");
    var schoolInput = dialog.element.querySelector("#movementSchool");
    var reasonMark = dialog.element.querySelector(".js-reason-mark");

    L.apiGet("/learners", {
      schoolId: currentSchoolId() || undefined,
      schoolYearId: state.yearId,
      status: "active",
      pageSize: 500
    })
      .then(function (rows) {
        learnerSelect.innerHTML = (rows || []).length
          ? '<option value="">Select a learner</option>' +
            rows
              .map(function (learner) {
                var enrollment = learner.currentEnrollment;
                return L.option(
                  learner.id,
                  learner.lrn + " · " + learner.fullName +
                    (enrollment ? " · " + [enrollment.gradeLevel, enrollment.sectionName].filter(Boolean).join(" ") : "") +
                    (learner.schoolName ? " · " + learner.schoolName : "")
                );
              })
              .join("")
          : '<option value="">No active learners for this school year</option>';
      })
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        learnerSelect.innerHTML = '<option value="">Learners unavailable</option>';
      });

    function syncType() {
      var type = typeSelect.value;
      var transfer = type === "transferred_in" || type === "transferred_out";
      reasonMark.classList.toggle("d-none", !(type === "dropped_out" || type === "other"));
      schoolInput.required = transfer;
      schoolInput.placeholder = transfer ? "Required for a transfer" : "Optional other school";
    }
    typeSelect.addEventListener("change", syncType);
    syncType();

    button.addEventListener("click", function () {
      window.UI.clearFieldErrors(form);
      window.UI.hideAlert(alertBox);
      var values = L.formValues(form);
      if (!values.learnerId) {
        window.UI.fieldError(learnerSelect, "Choose the learner.");
        return;
      }
      if (!values.effectiveDate) {
        window.UI.fieldError(form.querySelector("#movementDate"), "Enter the effective date.");
        return;
      }
      var transfer = values.movementType === "transferred_in" || values.movementType === "transferred_out";
      if (transfer && !values.counterpartSchoolName.trim()) {
        window.UI.fieldError(schoolInput, "Name the other school for a transfer.");
        return;
      }
      if ((values.movementType === "dropped_out" || values.movementType === "other") && !values.reason.trim()) {
        window.UI.fieldError(form.querySelector("#movementReason"), "A reason is required for this movement type.");
        return;
      }
      window.UI.setButtonLoading(button, true, "Recording…");
      API.post("/movements", {
        learnerId: Number(values.learnerId),
        schoolYearId: Number(state.yearId),
        movementType: values.movementType,
        effectiveDate: values.effectiveDate,
        counterpartSchoolName: values.counterpartSchoolName.trim(),
        referenceNo: values.referenceNo.trim(),
        reason: values.reason.trim()
      })
        .then(function () {
          window.UI.setButtonLoading(button, false);
          dialog.close();
          window.UI.toast("Movement recorded", "The movement is pending approval.", "success");
          loadMovements();
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (failed(error)) {
            return;
          }
          if (!window.UI.showFieldErrors(form, error)) {
            window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not record the movement");
          }
        });
    });
  }

  function decideModal(row, decision) {
    var approving = decision === "approved";
    var dialog = L.modal({
      title: approving ? "Approve movement" : "Reject movement",
      eyebrow: row.learnerName + " · " + typeLabel(row.movementType),
      size: "",
      body:
        '<div id="decideAlert" class="d-none mb-3" role="alert"></div>' +
        (approving
          ? '<div class="info-banner info-banner--warning"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><div>Approving updates the learner\'s enrollment status to match this movement. This cannot be undone; corrections require a new movement record.</div></div>'
          : "") +
        '<div class="review-summary mb-3">' +
        "<div><span>Effective date</span><strong>" + F.esc(window.UI.phDate(row.effectiveDate)) + "</strong></div>" +
        "<div><span>Other school</span><strong>" + F.esc(row.counterpartSchoolName || "—") + "</strong></div>" +
        "<div><span>Reference</span><strong>" + F.esc(row.referenceNo || "—") + "</strong></div>" +
        "</div>" +
        '<div class="form-group mb-0"><label for="decideComments">Comments' + (approving ? " (optional)" : " <span class=\"required-mark\">*</span>") + "</label>" +
        '<textarea class="form-control" id="decideComments" rows="3" maxlength="2000" placeholder="' +
        (approving ? "Optional decision note" : "Explain why the movement is rejected") +
        '"></textarea><span class="field-error"></span></div>',
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="button" class="btn btn-' + (approving ? "success" : "danger") + '" id="decideButton">' +
        (approving ? "Approve movement" : "Reject movement") +
        "</button>"
    });
    var button = dialog.element.querySelector("#decideButton");
    var alertBox = dialog.element.querySelector("#decideAlert");
    var comments = dialog.element.querySelector("#decideComments");
    button.addEventListener("click", function () {
      if (!approving && !comments.value.trim()) {
        window.UI.fieldError(comments, "Provide a reason for rejecting the movement.");
        return;
      }
      window.UI.setButtonLoading(button, true, "Saving…");
      API.patch("/movements/" + row.id + "/" + decision, { comments: comments.value.trim() })
        .then(function () {
          window.UI.setButtonLoading(button, false);
          dialog.close();
          window.UI.toast(
            approving ? "Movement approved" : "Movement rejected",
            approving ? "The enrollment status was updated." : "The record was rejected and retained for audit.",
            "success"
          );
          loadMovements();
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (failed(error)) {
            return;
          }
          window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not update the movement");
        });
    });
  }

  function removeMovement(row) {
    window.UI.confirm({
      title: "Delete movement",
      message: "Delete this pending or rejected movement record for " + row.learnerName + "? Approved movements cannot be deleted and must be corrected by a new movement.",
      confirmLabel: "Delete",
      tone: "danger"
    }).then(function (ok) {
      if (!ok) {
        return;
      }
      API.delete("/movements/" + row.id)
        .then(function () {
          window.UI.toast("Movement deleted", "The unapproved record was removed.", "success");
          loadMovements();
        })
        .catch(function (error) {
          if (failed(error)) {
            return;
          }
          alertPage("danger", L.friendlyError(error), "Could not delete the movement");
        });
    });
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
      el("movementsYearFilter").innerHTML = L.yearOptions(state.years, state.yearId, "All school years");
      el("movementsMonthFilter").innerHTML =
        '<option value="">All months</option>' + F.monthOptions(state.month || "");
    });
  }

  function wire() {
    el("movementsSchoolFilter").addEventListener("change", loadMovements);
    el("movementsYearFilter").addEventListener("change", function () {
      state.yearId = el("movementsYearFilter").value;
      loadMovements();
    });
    el("movementsMonthFilter").addEventListener("change", function () {
      state.month = el("movementsMonthFilter").value;
      loadMovements();
    });
    el("movementsTypeFilter").addEventListener("change", function () {
      state.movementType = el("movementsTypeFilter").value;
      loadMovements();
    });
    el("movementsStatusFilter").addEventListener("change", function () {
      state.status = el("movementsStatusFilter").value;
      loadMovements();
    });
    el("movementsSearch").addEventListener("input", window.UI.debounce(function () {
      state.search = el("movementsSearch").value;
      loadMovements();
    }, 300));
    el("newMovementButton").addEventListener("click", movementModal);
    el("movementsBody").addEventListener("click", function (event) {
      var decide = event.target.closest("[data-decide]");
      if (decide) {
        var row = state.movements.find(function (item) {
          return String(item.id) === String(decide.dataset.decide);
        });
        if (row) {
          decideModal(row, decide.dataset.decision);
        }
        return;
      }
      var remove = event.target.closest("[data-remove-movement]");
      if (remove) {
        var target = state.movements.find(function (item) {
          return String(item.id) === String(remove.dataset.removeMovement);
        });
        if (target) {
          removeMovement(target);
        }
      }
    });
  }

  function init() {
    AppShell.init({
      page: "movements",
      breadcrumbs: ["Learner Movements"],
      requiredPermission: "canViewMovements"
    }).then(function (session) {
      if (!session) {
        return;
      }
      wire();
      el("newMovementButton").classList.toggle("d-none", !canManage());
      F.schoolFilter("movementsSchoolControl", "movementsSchoolFilter", L.schoolId() || "");
      return loadYears().then(loadMovements);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})(window, document);
