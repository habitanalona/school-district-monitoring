/* DepEd Learner Records — restricted health and nutrition records */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var F = window.FormsUI;

  var STATUS = {
    severely_wasted: { label: "Severely wasted", tone: "danger" },
    wasted: { label: "Wasted", tone: "warning" },
    normal: { label: "Normal", tone: "success" },
    overweight: { label: "Overweight", tone: "warning" },
    obese: { label: "Obese", tone: "danger" },
    severely_stunted: { label: "Severely stunted", tone: "danger" },
    stunted: { label: "Stunted", tone: "warning" },
    tall: { label: "Tall", tone: "info" },
    not_assessed: { label: "Not assessed", tone: "muted" }
  };

  var state = {
    schoolId: "",
    yearId: "",
    sectionId: "",
    status: "",
    search: "",
    years: [],
    measurements: [],
    sections: []
  };

  function el(id) {
    return document.getElementById(id);
  }

  function canManage() {
    return F.permission("canManageHealth");
  }

  function failed(error) {
    return error && error.status === 401;
  }

  function alertPage(tone, message, title) {
    F.pageAlert("healthAlert", tone, message, title);
  }

  function currentSchoolId() {
    if (L.schoolId()) {
      return String(L.schoolId());
    }
    var select = el("healthSchoolFilter");
    return select && select.value ? String(select.value) : "";
  }

  function statusBadge(status) {
    return F.toneBadge(STATUS, status);
  }

  function scopeLabel() {
    var year = state.years.find(function (item) {
      return String(item.id) === String(state.yearId);
    });
    var schoolName = currentSchoolId()
      ? L.schoolName(currentSchoolId()) || "Selected school"
      : "All accessible schools";
    el("healthScopeLabel").textContent =
      schoolName + (year ? " · " + year.name : "") + " · " + state.measurements.length + " measurement(s)";
  }

  function refreshSummary() {
    return L.apiGet("/health/summary", {
      schoolId: currentSchoolId() || undefined,
      schoolYearId: state.yearId || undefined
    })
      .then(function (data) {
        el("healthTotal").textContent = window.UI.number(data.total || 0);
        el("healthSeverelyWasted").textContent = window.UI.number(data.severelyWasted || 0);
        el("healthAverageBmi").textContent = data.averageBmi === null || data.averageBmi === undefined ? "—" : data.averageBmi;
        el("healthNormal").textContent = window.UI.number((data.byStatus && data.byStatus.normal) || 0);
      })
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        alertPage("danger", L.friendlyError(error), "Could not load the aggregate summary");
      });
  }

  function render() {
    var body = el("healthBody");
    var query = state.search.trim().toLowerCase();
    var rows = state.measurements.filter(function (row) {
      return (
        !query ||
        [row.learnerName, row.lrn, row.gradeLevelName, row.sectionName]
          .join(" ")
          .toLowerCase()
          .indexOf(query) !== -1
      );
    });
    if (!rows.length) {
      body.innerHTML = F.emptyRow(11, state.measurements.length ? "No measurement matches your search." : "No measurements recorded for this filter.");
      el("healthMeta").textContent = "No measurements shown.";
      return;
    }
    body.innerHTML = rows
      .map(function (row) {
        var meta = STATUS[row.nutritionalStatus] || { label: window.UI.titleCase(row.nutritionalStatus || "—"), tone: "neutral" };
        return (
          "<tr>" +
          "<td><strong>" + F.esc(row.learnerName) + "</strong>" +
          (row.flags && row.flags.length
            ? '<span class="field-hint" title="' + F.esc(row.flags.join(" ")) + '"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i> Verify measurements</span>'
            : "") +
          "</td>" +
          '<td><code class="lrn-code">' + F.esc(row.lrn) + "</code></td>" +
          "<td>" + F.esc([row.gradeLevelName, row.sectionName].filter(Boolean).join(" · ") || "—") + "</td>" +
          "<td>" + F.esc(window.UI.phDate(row.measuredOn)) + "</td>" +
          '<td class="text-right">' + (row.ageAtMeasurement === null ? "—" : F.esc(row.ageAtMeasurement)) + "</td>" +
          '<td class="text-right">' + F.esc(row.weightKg) + "</td>" +
          '<td class="text-right">' + F.esc(row.heightCm) + "</td>" +
          '<td class="text-right">' + (row.bmi === null ? "—" : F.esc(row.bmi)) + "</td>" +
          "<td>" + window.UI.pillarBadge(meta.label, meta.tone) + "</td>" +
          "<td>" + F.esc(row.assessorName || "—") + "</td>" +
          '<td class="text-right"><div class="row-actions">' +
          '<button type="button" class="btn btn-light btn-sm" data-health-trend="' + row.learnerId + '" title="View measurement trend"><i class="bi bi-graph-up" aria-hidden="true"></i></button>' +
          (canManage()
            ? '<button type="button" class="btn btn-light btn-sm" data-health-edit="' + row.id + '" title="Correct measurement"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>'
            : "") +
          "</div></td>" +
          "</tr>"
        );
      })
      .join("");
    el("healthMeta").textContent =
      rows.length + (rows.length === 1 ? " measurement" : " measurements") + " shown · sensitive records";
  }

  function loadMeasurements() {
    el("healthBody").innerHTML = L.skeletonRows(11, 5);
    return L.apiGet("/health/measurements", {
      schoolId: currentSchoolId() || undefined,
      schoolYearId: state.yearId || undefined,
      sectionId: state.sectionId || undefined,
      status: state.status || undefined
    })
      .then(function (rows) {
        state.measurements = rows || [];
        render();
        scopeLabel();
      })
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        el("healthBody").innerHTML = F.emptyRow(11, L.friendlyError(error));
        el("healthMeta").textContent = "Health records could not be loaded.";
      });
  }

  function loadSections() {
    return L.sections({
      schoolId: currentSchoolId() || undefined,
      schoolYearId: state.yearId || undefined
    }).then(function (list) {
      state.sections = list || [];
      F.fillSelect(
        el("healthSectionFilter"),
        state.sections,
        "id",
        function (section) {
          return section.name + " · " + section.gradeLevel;
        },
        "All sections",
        state.sectionId
      );
    });
  }

  function measurementModal(item) {
    var editing = Boolean(item);
    var data = item || {};
    var schoolId = currentSchoolId() || String(data.schoolId || "");
    if (!schoolId) {
      alertPage("warning", "Choose a specific school before recording a measurement.", "School required");
      return;
    }
    if (!state.yearId) {
      alertPage("warning", "Choose a school year before recording a measurement.", "School year required");
      return;
    }
    var dialog = L.modal({
      title: editing ? "Correct measurement" : "Record measurement",
      eyebrow: "Restricted health record · SF8",
      size: "modal-lg",
      body:
        '<div class="info-banner info-banner--private"><i class="bi bi-shield-lock" aria-hidden="true"></i><div>Record only measurements taken by authorized school health personnel. BMI is calculated from weight and height on the server; the nutritional status is the assessor\'s classification using child-appropriate standards.</div></div>' +
        '<div id="measurementAlert" class="d-none mb-3" role="alert"></div>' +
        '<form id="measurementForm" novalidate>' +
        '<div class="form-row">' +
        '<div class="col-md-8"><div class="form-group"><label for="measureLearner">Learner <span class="required-mark">*</span></label>' +
        (editing
          ? '<input class="form-control" readonly value="' + F.esc(data.learnerName + " · " + data.lrn) + '">'
          : '<select class="custom-select" id="measureLearner" name="learnerId" required><option value="">Loading learners…</option></select><span class="field-error"></span>') +
        "</div></div>" +
        '<div class="col-md-4"><div class="form-group"><label for="measureDate">Measurement date <span class="required-mark">*</span></label>' +
        '<input type="date" class="form-control" id="measureDate" name="measuredOn" value="' + F.esc(data.measuredOn || F.todayIso()) + '">' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="measureWeight">Weight (kg) <span class="required-mark">*</span></label>' +
        '<input type="number" class="form-control" id="measureWeight" name="weightKg" min="1" max="500" step="0.01" inputmode="decimal" value="' +
        (data.weightKg === undefined ? "" : data.weightKg) + '"><span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="measureHeight">Height (cm) <span class="required-mark">*</span></label>' +
        '<input type="number" class="form-control" id="measureHeight" name="heightCm" min="20" max="300" step="0.1" inputmode="decimal" value="' +
        (data.heightCm === undefined ? "" : data.heightCm) + '"><span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="measureStatus">Nutritional status</label>' +
        '<select class="custom-select" id="measureStatus" name="nutritionalStatus">' +
        Object.keys(STATUS)
          .map(function (key) {
            return L.option(key, STATUS[key].label, data.nutritionalStatus || "not_assessed");
          })
          .join("") +
        "</select></div></div>" +
        '<div class="col-md-6"><div class="form-group"><label for="measureAssessor">Assessor</label>' +
        '<input class="form-control" id="measureAssessor" name="assessorName" maxlength="160" value="' +
        F.esc(data.assessorName || "") + '"></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="measureAssessment">Assessment notes</label>' +
        '<input class="form-control" id="measureAssessment" name="assessment" maxlength="2000" placeholder="Growth standard or referral note" value="' +
        F.esc(data.assessment || "") + '"></div></div>' +
        '<div class="col-12"><div class="form-group mb-0"><label for="measureRemarks">Remarks</label>' +
        '<textarea class="form-control" id="measureRemarks" name="remarks" rows="2" maxlength="2000">' +
        F.esc(data.remarks || "") +
        "</textarea></div></div>" +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="measurementSaveButton">' + (editing ? "Save correction" : "Record measurement") + "</button>"
    });
    var form = dialog.element.querySelector("#measurementForm");
    var button = dialog.element.querySelector("#measurementSaveButton");
    var alertBox = dialog.element.querySelector("#measurementAlert");
    var learnerSelect = dialog.element.querySelector("#measureLearner");

    if (learnerSelect) {
      L.apiGet("/learners", {
        schoolId: schoolId,
        schoolYearId: state.yearId,
        status: "active",
        pageSize: 300
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
                      (enrollment ? " · " + [enrollment.gradeLevel, enrollment.sectionName].filter(Boolean).join(" ") : "")
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
    }

    button.addEventListener("click", function () {
      window.UI.clearFieldErrors(form);
      window.UI.hideAlert(alertBox);
      var values = L.formValues(form);
      var weight = Number(values.weightKg);
      var height = Number(values.heightCm);
      if (!values.measuredOn) {
        window.UI.fieldError(form.querySelector("#measureDate"), "Enter the measurement date.");
        return;
      }
      if (!Number.isFinite(weight) || weight < 1 || weight > 500) {
        window.UI.fieldError(form.querySelector("#measureWeight"), "Enter a weight between 1 and 500 kg.");
        return;
      }
      if (!Number.isFinite(height) || height < 20 || height > 300) {
        window.UI.fieldError(form.querySelector("#measureHeight"), "Enter a height between 20 and 300 cm.");
        return;
      }
      if (!editing && !values.learnerId) {
        window.UI.fieldError(learnerSelect, "Choose the learner being measured.");
        return;
      }
      var payload = {
        schoolId: Number(schoolId),
        schoolYearId: Number(state.yearId),
        measuredOn: values.measuredOn,
        weightKg: weight,
        heightCm: height,
        nutritionalStatus: values.nutritionalStatus,
        assessment: values.assessment.trim(),
        assessorName: values.assessorName.trim(),
        remarks: values.remarks.trim()
      };
      if (!editing) {
        payload.learnerId = Number(values.learnerId);
      }
      window.UI.setButtonLoading(button, true, "Saving…");
      var request = editing
        ? API.put("/health/measurements/" + item.id, payload)
        : API.post("/health/measurements", payload);
      request
        .then(function () {
          window.UI.setButtonLoading(button, false);
          dialog.close();
          window.UI.toast(editing ? "Measurement corrected" : "Measurement recorded", "The restricted health record was saved and audited.", "success");
          refreshSummary();
          loadMeasurements();
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (failed(error)) {
            return;
          }
          if (!window.UI.showFieldErrors(form, error)) {
            window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not save the measurement");
          }
        });
    });
  }

  function trendModal(learnerId) {
    var dialog = L.modal({
      title: "Measurement trend",
      eyebrow: "Restricted health history",
      size: "modal-lg",
      body: '<div id="trendBody"><div class="skeleton skeleton-block"></div></div>',
      footer: '<button type="button" class="btn btn-light" data-dismiss="modal">Close</button>'
    });
    var body = dialog.element.querySelector("#trendBody");
    L.apiGet("/health/learners/" + learnerId, { schoolYearId: state.yearId || undefined })
      .then(function (payload) {
        var learner = payload.learner || {};
        var measurements = payload.measurements || [];
        body.innerHTML =
          '<div class="review-summary mb-3">' +
          "<div><span>Learner</span><strong>" + F.esc(learner.fullName || "—") + "</strong></div>" +
          "<div><span>LRN</span><strong>" + F.esc(learner.lrn || "—") + "</strong></div>" +
          "<div><span>Measurements</span><strong>" + window.UI.number(measurements.length) + "</strong></div>" +
          "</div>" +
          (measurements.length
            ? '<div class="report-preview"><div class="report-preview__scroll"><table><thead><tr><th>Date</th><th>School year</th><th class="text-right">Weight</th><th class="text-right">Height</th><th class="text-right">BMI</th><th>Status</th></tr></thead><tbody>' +
              measurements
                .map(function (row) {
                  var meta = STATUS[row.nutritionalStatus] || { label: window.UI.titleCase(row.nutritionalStatus || "—"), tone: "neutral" };
                  return (
                    "<tr><td>" + F.esc(window.UI.phDate(row.measuredOn)) + "</td>" +
                    "<td>" + F.esc(row.schoolYearName || "—") + "</td>" +
                    '<td class="text-right">' + F.esc(row.weightKg) + "</td>" +
                    '<td class="text-right">' + F.esc(row.heightCm) + "</td>" +
                    '<td class="text-right">' + (row.bmi === null ? "—" : F.esc(row.bmi)) + "</td>" +
                    "<td>" + window.UI.pillarBadge(meta.label, meta.tone) + "</td></tr>"
                  );
                })
                .join("") +
              "</tbody></table></div></div>"
            : '<p class="empty-cell">No measurements recorded for this learner.</p>') +
          '<p class="form-text">Growth interpretation requires child-appropriate standards applied by trained health personnel. This history is not a diagnosis.</p>';
      })
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        body.innerHTML = '<p class="empty-cell">' + F.esc(L.friendlyError(error)) + "</p>";
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
      el("healthYearFilter").innerHTML = L.yearOptions(state.years, state.yearId, "All school years");
    });
  }

  function reload() {
    return refreshSummary()
      .then(function () {
        return loadMeasurements();
      })
      .then(function () {
        return loadSections();
      });
  }

  function wire() {
    el("healthSchoolFilter").addEventListener("change", function () {
      state.sectionId = "";
      reload();
    });
    el("healthYearFilter").addEventListener("change", function () {
      state.yearId = el("healthYearFilter").value;
      state.sectionId = "";
      reload();
    });
    el("healthSectionFilter").addEventListener("change", function () {
      state.sectionId = el("healthSectionFilter").value;
      loadMeasurements();
    });
    el("healthStatusFilter").addEventListener("change", function () {
      state.status = el("healthStatusFilter").value;
      loadMeasurements();
    });
    el("healthSearch").addEventListener("input", window.UI.debounce(function () {
      state.search = el("healthSearch").value;
      render();
    }, 220));
    el("newMeasurementButton").addEventListener("click", function () {
      measurementModal(null);
    });
    el("healthBody").addEventListener("click", function (event) {
      var trend = event.target.closest("[data-health-trend]");
      if (trend) {
        trendModal(trend.dataset.healthTrend);
        return;
      }
      var edit = event.target.closest("[data-health-edit]");
      if (edit) {
        var item = state.measurements.find(function (row) {
          return String(row.id) === String(edit.dataset.healthEdit);
        });
        if (item) {
          measurementModal(item);
        }
      }
    });
  }

  function init() {
    AppShell.init({
      page: "health",
      breadcrumbs: ["Health & Nutrition"],
      requiredPermission: "canViewHealth"
    }).then(function (session) {
      if (!session) {
        return;
      }
      wire();
      el("newMeasurementButton").classList.toggle("d-none", !canManage());
      F.schoolFilter("healthSchoolControl", "healthSchoolFilter", L.schoolId() || "");
      return loadYears().then(reload);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})(window, document);
