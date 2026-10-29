/* DepEd Learner Records — school years page */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var state = { session: null, years: [] };

  function el(id) {
    return document.getElementById(id);
  }

  function canManage() {
    return Boolean(state.session && state.session.permissions.canManageSchoolYears);
  }

  function loadYears() {
    var body = el("yearTableBody");
    body.innerHTML = L.skeletonRows(7, 5);
    L.apiGet("/academic/school-years")
      .then(function (years) {
        state.years = years || [];
        L.clearCache();
        if (!state.years.length) {
          body.innerHTML =
            '<tr><td colspan="7" class="empty-cell">No school years yet. Create the first school year to begin enrollment.</td></tr>';
        } else {
          body.innerHTML = state.years
            .map(function (year) {
              return (
                "<tr><td><strong>" +
                L.esc(year.name) +
                "</strong>" +
                (year.isCurrent ? '<span class="current-year-marker">Current</span>' : "") +
                "</td><td>" +
                window.UI.phDate(year.startsOn) +
                "</td><td>" +
                window.UI.phDate(year.endsOn) +
                "</td><td>" +
                (year.isCurrent
                  ? '<span class="status-badge status-badge--success"><span class="status-dot"></span>Current</span>'
                  : '<span class="status-badge status-badge--neutral"><span class="status-dot"></span>Archived year</span>') +
                '</td><td class="text-right">' +
                window.UI.number(year.sectionCount) +
                '</td><td class="text-right">' +
                window.UI.number(year.learnerCount) +
                '</td><td><div class="row-actions">' +
                (canManage()
                  ? (year.isCurrent
                      ? ""
                      : '<button type="button" class="btn btn-light" data-current="' +
                        year.id +
                        '" title="Set as current"><i class="bi bi-check2-circle" aria-hidden="true"></i></button>') +
                    '<button type="button" class="btn btn-light" data-edit="' +
                    year.id +
                    '" title="Edit school year"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>' +
                    '<button type="button" class="btn btn-light" data-copy="' +
                    year.id +
                    '" title="Copy structure"><i class="bi bi-copy" aria-hidden="true"></i></button>'
                  : '<span class="text-muted">—</span>') +
                "</div></td></tr>"
              );
            })
            .join("");
        }
        el("yearTableMeta").textContent =
          state.years.length + " school year" + (state.years.length === 1 ? "" : "s") + " on file";
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        body.innerHTML = '<tr><td colspan="7" class="empty-cell">' + L.esc(L.friendlyError(error)) + "</td></tr>";
        el("yearTableMeta").textContent = "School years could not be loaded.";
      });
  }

  function yearModal(year) {
    var editing = Boolean(year);
    var data = year || {};
    var dialog = L.modal({
      title: editing ? "Edit school year" : "New school year",
      eyebrow: "Academic calendar",
      size: "modal-lg",
      body:
        '<form id="yearForm" novalidate>' +
        '<div id="yearFormAlert" class="d-none mb-3" role="alert"></div>' +
        '<div class="row">' +
        '<div class="col-md-4"><div class="form-group"><label for="yearName">School year <span class="required-mark">*</span></label>' +
        '<input class="form-control" id="yearName" name="name" required maxlength="9" placeholder="2026-2027" value="' +
        L.esc(data.name) +
        '"><span class="field-hint">Use the YYYY-YYYY format.</span><span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="yearStart">Start date <span class="required-mark">*</span></label>' +
        '<input type="date" class="form-control" id="yearStart" name="startsOn" required value="' +
        L.esc(data.startsOn) +
        '"><span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="yearEnd">End date <span class="required-mark">*</span></label>' +
        '<input type="date" class="form-control" id="yearEnd" name="endsOn" required value="' +
        L.esc(data.endsOn) +
        '"><span class="field-error"></span></div></div>' +
        '<div class="col-12"><div class="custom-control custom-checkbox">' +
        '<input type="checkbox" class="custom-control-input" id="yearCurrent" name="isCurrent"' +
        (data.isCurrent ? " checked" : "") +
        '><label class="custom-control-label" for="yearCurrent">Set as the current school year</label>' +
        '<span class="field-hint d-block">Making a year current automatically clears the flag on the previous year.</span></div></div>' +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="submit" form="yearForm" class="btn btn-primary" id="saveYearButton">' +
        (editing ? "Save school year" : "Create school year") +
        "</button>"
    });
    var form = dialog.element.querySelector("#yearForm");
    var button = dialog.element.querySelector("#saveYearButton");
    var alertBox = dialog.element.querySelector("#yearFormAlert");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var values = L.formValues(form);
      if (!/^\d{4}-\d{4}$/.test(values.name)) {
        window.UI.fieldError(form.querySelector("#yearName"), "School year must use the YYYY-YYYY format.");
        return;
      }
      L.submit(
        form,
        button,
        alertBox,
        function () {
          return editing ? API.put("/academic/school-years/" + year.id, values) : API.post("/academic/school-years", values);
        },
        function () {
          dialog.close();
          window.UI.toast(editing ? "School year updated" : "School year created", values.name, "success");
          loadYears();
        }
      );
    });
  }

  function setCurrent(year) {
    window.UI.confirm({
      title: "Set " + year.name + " as current?",
      message: "Dashboards, enrollment defaults, and reports will use this school year. The previous current year stays in history.",
      confirmLabel: "Set as current"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      API.put("/academic/school-years/" + year.id, {
        name: year.name,
        startsOn: year.startsOn,
        endsOn: year.endsOn,
        isCurrent: true
      })
        .then(function () {
          window.UI.toast("Current school year updated", year.name + " is now the current school year.", "success");
          loadYears();
        })
        .catch(function (error) {
          window.UI.showAlert(el("yearPageAlert"), "danger", L.friendlyError(error), "Could not update the school year");
        });
    });
  }

  function copyModal(fromYear) {
    var dialog = L.modal({
      title: "Copy section structure",
      eyebrow: "School-year rollover",
      size: "modal-lg",
      body:
        '<form id="copyForm" novalidate>' +
        '<div id="copyFormAlert" class="d-none mb-3" role="alert"></div>' +
        '<div class="row">' +
        '<div class="col-md-6"><div class="form-group"><label for="copySchool">School <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="copySchool" name="schoolId" required><option value="">Loading schools…</option></select>' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="copyFrom">Copy from</label>' +
        '<input class="form-control" value="' + L.esc(fromYear.name) + '" readonly>' +
        '<input type="hidden" name="fromSchoolYearId" value="' + fromYear.id + '"></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="copyTo">Copy to <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="copyTo" name="toSchoolYearId" required>' +
        L.yearOptions(
          state.years.filter(function (year) {
            return year.id !== fromYear.id;
          }),
          "",
          "Select target school year"
        ) +
        "</select><span class=\"field-error\"></span></div></div>" +
        '<div class="col-md-6"><div class="form-group"><label>&nbsp;</label>' +
        '<button type="button" class="btn btn-light btn-block" id="previewCopyButton"><i class="bi bi-eye" aria-hidden="true"></i> Preview sections</button></div></div>' +
        "</div>" +
        '<div id="copyPreview" class="mt-2"></div>' +
        "</form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="submit" form="copyForm" class="btn btn-primary" id="saveCopyButton" disabled>Copy sections</button>'
    });
    var form = dialog.element.querySelector("#copyForm");
    var alertBox = dialog.element.querySelector("#copyFormAlert");
    var schoolSelect = form.querySelector("#copySchool");
    var toSelect = form.querySelector("#copyTo");
    var preview = form.querySelector("#copyPreview");
    var previewButton = form.querySelector("#previewCopyButton");
    var saveButton = dialog.element.querySelector("#saveCopyButton");

    L.fillSchoolSelect(schoolSelect, L.schoolId());

    function previewCopy() {
      var schoolId = schoolSelect.value;
      var toYearId = toSelect.value;
      if (!schoolId || !toYearId) {
        window.UI.showAlert(alertBox, "warning", "Choose the school and target school year.", "Missing details");
        return;
      }
      window.UI.hideAlert(alertBox);
      window.UI.setButtonLoading(previewButton, true, "Checking…");
      API.post("/academic/school-years/copy", {
        schoolId: schoolId,
        fromSchoolYearId: fromYear.id,
        toSchoolYearId: toYearId,
        dryRun: true
      })
        .then(function (payload) {
          window.UI.setButtonLoading(previewButton, false);
          var data = payload.data;
          if (!data.sections.length) {
            preview.innerHTML = '<p class="text-muted" style="font-size:.82rem">No sections exist in the source year for this school.</p>';
            saveButton.disabled = true;
            return;
          }
          preview.innerHTML =
            '<p class="field-hint">' +
            data.toCreate +
            " section(s) will be created; " +
            (data.sections.length - data.toCreate) +
            " already exist and will be skipped.</p>" +
            '<div class="report-preview"><div class="report-preview__scroll"><table><thead><tr><th>Grade</th><th>Section</th><th>Room</th><th>Adviser</th><th>Status</th></tr></thead><tbody>' +
            data.sections
              .map(function (section) {
                return (
                  "<tr><td>" +
                  L.esc(section.gradeLevel) +
                  "</td><td>" +
                  L.esc(section.name) +
                  "</td><td>" +
                  L.esc(section.room || "—") +
                  "</td><td>" +
                  L.esc(section.adviserName || "—") +
                  "</td><td>" +
                  (section.exists ? "Exists" : "Will create") +
                  "</td></tr>"
                );
              })
              .join("") +
            "</tbody></table></div></div>";
          saveButton.disabled = data.toCreate === 0;
        })
        .catch(function (error) {
          window.UI.setButtonLoading(previewButton, false);
          preview.innerHTML = "";
          saveButton.disabled = true;
          window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not preview sections");
        });
    }

    previewButton.addEventListener("click", previewCopy);

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var values = L.formValues(form);
      if (!values.schoolId || !values.toSchoolYearId) {
        window.UI.showAlert(alertBox, "warning", "Choose the school and target school year.", "Missing details");
        return;
      }
      L.submit(
        form,
        saveButton,
        alertBox,
        function () {
          return API.post("/academic/school-years/copy", {
            schoolId: values.schoolId,
            fromSchoolYearId: fromYear.id,
            toSchoolYearId: values.toSchoolYearId,
            dryRun: false
          });
        },
        function (payload) {
          dialog.close();
          window.UI.toast("Structure copied", payload.data.createdCount + " section(s) created.", "success");
          loadYears();
        }
      );
    });
  }

  function wireActions() {
    el("yearTableBody").addEventListener("click", function (event) {
      var edit = event.target.closest("[data-edit]");
      if (edit) {
        yearModal(
          state.years.find(function (year) {
            return String(year.id) === edit.dataset.edit;
          })
        );
        return;
      }
      var current = event.target.closest("[data-current]");
      if (current) {
        setCurrent(
          state.years.find(function (year) {
            return String(year.id) === current.dataset.current;
          })
        );
        return;
      }
      var copy = event.target.closest("[data-copy]");
      if (copy) {
        copyModal(
          state.years.find(function (year) {
            return String(year.id) === copy.dataset.copy;
          })
        );
      }
    });
  }

  function init() {
    window.AppShell.init({
      page: "school-years",
      breadcrumbs: ["School Years"]
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      if (canManage()) {
        el("newYearButton").classList.remove("d-none");
        el("newYearButton").addEventListener("click", function () {
          yearModal(null);
        });
        el("copyStructureButton").classList.remove("d-none");
        el("copyStructureButton").addEventListener("click", function () {
          var current = state.years.find(function (year) {
            return year.isCurrent;
          }) || state.years[0];
          if (!current) {
            window.UI.showAlert(el("yearPageAlert"), "warning", "Create a school year first.", "No school year");
            return;
          }
          copyModal(current);
        });
      }
      wireActions();
      loadYears();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
