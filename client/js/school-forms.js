/* School Forms Center page */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var F = window.FormsUI;
  var state = {
    session: null,
    definitions: [],
    cards: [],
    submissions: [],
    deadlines: [],
    templates: [],
    schoolId: "",
    yearId: "",
    gradeId: "",
    sectionId: "",
    month: "",
    formFilter: "",
    statusFilter: "",
    tab: "forms",
    loaded: {}
  };

  function el(id) {
    return document.getElementById(id);
  }

  function params(extra) {
    var query = {
      schoolId: state.schoolId || undefined,
      schoolYearId: state.yearId || undefined,
      gradeLevelId: state.gradeId || undefined,
      sectionId: state.sectionId || undefined
    };
    return Object.assign(query, extra || {});
  }

  function definition(code) {
    return state.definitions.find(function (item) {
      return item.code === code;
    }) || { code: code, title: code.toUpperCase() };
  }

  function canManage() {
    return F.permission("canManageSchoolForms");
  }

  function canSetDeadlines() {
    return canManage() && ["system_admin", "district_admin", "psds"].indexOf(F.role()) !== -1;
  }

  function canManageTemplates() {
    return canManage() && ["system_admin", "district_admin"].indexOf(F.role()) !== -1;
  }

  function updateScopeLabel() {
    var session = state.session;
    var school = state.schoolId ? L.schoolName(state.schoolId) : (session.user.schoolName || "All schools");
    var year = (state.years || []).find(function (item) {
      return String(item.id) === String(state.yearId);
    });
    el("formsScopeLabel").textContent =
      (school || "All schools") + (year ? " · " + year.name : "") +
      (state.month ? " · " + state.month : "");
  }

  function loadFilters() {
    return Promise.all([F.schoolFilter("formsSchoolControl", "formsSchoolFilter", state.schoolId), L.years()])
      .then(function (results) {
        state.years = results[1] || [];
        var yearSelect = el("formsYearFilter");
        var current = state.years.find(function (year) {
          return year.isCurrent;
        });
        if (!state.yearId) {
          state.yearId = current ? String(current.id) : state.years[0] ? String(state.years[0].id) : "";
        }
        yearSelect.innerHTML = L.yearOptions(state.years, state.yearId, "Select school year");
        el("formsMonthFilter").innerHTML = '<option value="">Whole school year</option>' + F.monthOptions(state.month);
        el("submissionFormFilter").innerHTML = '<option value="">All forms</option>' +
          F_definitionOptions();
        wireFilterEvents();
        return refreshGradesAndSections();
      });
  }

  function F_definitionOptions() {
    return state.definitions
      .map(function (item) {
        return '<option value="' + item.code + '">' + F.esc(item.code.toUpperCase() + " · " + item.title) + "</option>";
      })
      .join("");
  }

  function refreshGradesAndSections() {
    var school = state.schoolId || L.schoolId() || "";
    return Promise.all([
      F.filteredGrades(school, el("formsGradeFilter"), state.gradeId),
      F.filteredSections(school, state.yearId, el("formsSectionFilter"), state.sectionId)
    ]).then(function () {
      el("formsGradeFilter").value = state.gradeId;
      el("formsSectionFilter").value = state.sectionId;
    });
  }

  function wireFilterEvents() {
    el("formsYearFilter").addEventListener("change", function (event) {
      state.yearId = event.target.value;
      loadAll();
    });
    el("formsSchoolFilter").addEventListener("change", function (event) {
      state.schoolId = event.target.value;
      state.gradeId = "";
      state.sectionId = "";
      refreshGradesAndSections().then(loadAll);
    });
    el("formsGradeFilter").addEventListener("change", function (event) {
      state.gradeId = event.target.value;
      state.sectionId = "";
      F.filteredSections(state.schoolId || L.schoolId(), state.yearId, el("formsSectionFilter"), "").then(loadCards);
    });
    el("formsSectionFilter").addEventListener("change", function (event) {
      state.sectionId = event.target.value;
      loadCards();
    });
    el("formsMonthFilter").addEventListener("change", function (event) {
      state.month = event.target.value;
      loadCards();
      if (state.tab === "deadlines") {
        loadDeadlines();
      }
    });
    el("formsResetFilters").addEventListener("click", function () {
      state.gradeId = "";
      state.sectionId = "";
      state.month = "";
      if (!L.schoolId()) {
        state.schoolId = "";
        el("formsSchoolFilter").value = "";
      }
      el("formsGradeFilter").value = "";
      el("formsSectionFilter").value = "";
      el("formsMonthFilter").value = "";
      refreshGradesAndSections().then(loadAll);
    });
    el("submissionFormFilter").addEventListener("change", function (event) {
      state.formFilter = event.target.value;
      loadSubmissions();
    });
    el("submissionStatusFilter").addEventListener("change", function (event) {
      state.statusFilter = event.target.value;
      loadSubmissions();
    });
    el("refreshFormsButton").addEventListener("click", loadAll);
  }

  function loadAll() {
    updateScopeLabel();
    loadCards();
    if (state.tab === "submissions") loadSubmissions();
    if (state.tab === "deadlines") loadDeadlines();
    if (state.tab === "templates") loadTemplates();
  }

  function loadCards() {
    var grid = el("formsGrid");
    if (!state.schoolId && !L.schoolId()) {
      state.cards = [];
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="bi bi-building" aria-hidden="true"></i><p>Select a school before continuing. Form cards are generated for one school at a time.</p></div>';
      return Promise.resolve();
    }
    grid.innerHTML = '<div class="skeleton skeleton-block" style="height:190px"></div><div class="skeleton skeleton-block" style="height:190px"></div><div class="skeleton skeleton-block" style="height:190px"></div>';
    return L.apiGet("/school-forms/cards", {
      schoolId: state.schoolId || undefined,
      schoolYearId: state.yearId || undefined,
      month: state.month || undefined
    })
      .then(function (payload) {
        state.cards = payload.cards || [];
        el("formsScopeLabel").textContent =
          payload.school.name + " · " + payload.schoolYear.name + (payload.month ? " · " + payload.month : "");
        renderCards();
      })
      .catch(function (error) {
        if (error.status === 401) return;
        grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="bi bi-cloud-slash" aria-hidden="true"></i><p>' +
          F.esc(L.friendlyError(error)) + "</p></div>";
      });
  }

  function submissionMeta(card) {
    var submission = card.submission;
    if (!submission) {
      return '<span class="status-badge status-badge--neutral"><span class="status-dot"></span>Not generated</span>';
    }
    return F.statusBadge(submission.status) +
      '<span class="form-tile__deadline">v' + submission.version + " · " + F.esc(window.UI.phDateTime(submission.updatedAt)) + "</span>";
  }

  function deadlineMeta(card) {
    if (!card.deadline) {
      return "";
    }
    return (
      '<span class="form-tile__deadline' + (card.overdue ? " is-overdue" : "") + '">' +
      '<i class="bi ' + (card.overdue ? "bi-exclamation-circle" : "bi-calendar-event") + '" aria-hidden="true"></i> ' +
      (card.overdue ? "Overdue: " : "Due: ") + F.esc(window.UI.phDate(card.deadline.dueDate)) +
      "</span>"
    );
  }

  function renderCards() {
    var grid = el("formsGrid");
    if (!state.cards.length) {
      grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="bi bi-file-earmark" aria-hidden="true"></i><p>No forms are available for this scope.</p></div>';
      return;
    }
    grid.innerHTML = state.cards
      .map(function (card) {
        var submission = card.submission;
        var actions = ['<button type="button" class="btn btn-light" data-preview="' + card.code + '"><i class="bi bi-eye" aria-hidden="true"></i> Preview</button>'];
        if (canManage()) {
          actions.push(
            '<button type="button" class="btn btn-primary" data-generate="' + card.code + '"><i class="bi bi-arrow-repeat" aria-hidden="true"></i> ' +
              (submission ? "Regenerate" : "Generate") + "</button>"
          );
        }
        if (submission) {
          actions.push(
            '<button type="button" class="btn btn-outline-primary" data-open="' + submission.id + '"><i class="bi bi-folder2-open" aria-hidden="true"></i> Open</button>'
          );
          if (submission.hasSnapshot) {
            actions.push(
              '<button type="button" class="btn btn-outline-secondary" data-pdf="' + submission.id + '" title="Download the saved PDF"><i class="bi bi-file-earmark-pdf" aria-hidden="true"></i></button>'
            );
          }
        }
        return (
          '<article class="form-tile' + (card.restricted ? " form-tile--restricted" : "") + '">' +
          '<div class="form-tile__top"><span class="form-code">' + F.esc(card.code.toUpperCase()) + "</span>" +
          submissionMeta(card) + "</div>" +
          "<h3>" + F.esc(card.title) + "</h3>" +
          "<p>" + F.esc(card.purpose) + "</p>" +
          '<div class="form-tile__meta">' +
          (submission ? F.completion(submission.completeness) : "") +
          (submission && (submission.validation.errorCount || submission.validation.warningCount)
            ? '<span class="validation-counts">' +
              (submission.validation.errorCount ? '<span class="is-error">' + submission.validation.errorCount + " errors</span>" : "") +
              (submission.validation.warningCount ? "<span>" + submission.validation.warningCount + " warnings</span>" : "") +
              "</span>"
            : "") +
          deadlineMeta(card) +
          (card.restricted ? '<span class="status-badge status-badge--violet"><span class="status-dot"></span>Restricted</span>' : "") +
          "</div>" +
          '<div class="form-tile__actions">' + actions.join("") + "</div>" +
          "</article>"
        );
      })
      .join("");
  }

  function requireContext(card) {
    if (card.requiresSection && !state.sectionId) {
      F.pageAlert("formsPageAlert", "warning", "Select a section before generating " + card.code.toUpperCase() + ".", "Section required");
      return false;
    }
    if (card.usesMonth && !state.month) {
      F.pageAlert("formsPageAlert", "warning", "Select a reporting month before generating " + card.code.toUpperCase() + ".", "Month required");
      return false;
    }
    return true;
  }

  function learnerDialog(card, onReady) {
    var dialog = L.modal({
      title: "Choose learners for " + card.code.toUpperCase(),
      eyebrow: card.title,
      size: "modal-lg",
      body:
        '<p class="field-hint">' + F.esc(card.purpose) + "</p>" +
        '<div class="info-banner"><i class="bi bi-person-check" aria-hidden="true"></i><div>Select one learner for an individual record. ' +
        (card.code === "sf10"
          ? "SF 10 is always issued per learner and includes verified history across school years."
          : "SF 9 may be previewed for a single learner or for the whole selected section.") +
        "</div></div>" +
        '<div id="learnerDialogAlert" class="d-none mb-3" role="alert"></div>' +
        '<div class="form-group"><label for="formLearnerSelect">Learner</label>' +
        '<select class="custom-select" id="formLearnerSelect"><option value="">Loading learners…</option></select></div>',
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="learnerContinue">Continue</button>'
    });
    var select = dialog.element.querySelector("#formLearnerSelect");
    F.learnerSelect(select, {
      schoolId: state.schoolId || L.schoolId() || undefined,
      schoolYearId: state.yearId || undefined,
      sectionId: state.sectionId || undefined
    }).catch(function (error) {
      select.innerHTML = '<option value="">Learners unavailable</option>';
      window.UI.showAlert(dialog.element.querySelector("#learnerDialogAlert"), "danger", L.friendlyError(error), "Could not load learners");
    });
    dialog.element.querySelector("#learnerContinue").addEventListener("click", function () {
      if (!select.value) {
        window.UI.showAlert(dialog.element.querySelector("#learnerDialogAlert"), "warning", "Choose a learner to continue.", "Learner required");
        return;
      }
      dialog.close();
      onReady(select.value);
    });
  }

  function previewCard(card) {
    if (card.code === "sf10" || (card.code === "sf9" && !state.sectionId)) {
      learnerDialog(card, function (learnerId) {
        F.previewForm(card.code, params({ learnerId: learnerId }), {
          title: card.title,
          eyebrow: "SF " + card.code.replace("sf", "") + " · " + card.title,
          onGenerated: loadAll
        });
      });
      return;
    }
    if (!requireContext(card)) {
      return;
    }
    F.previewForm(card.code, params({ month: state.month || undefined }), {
      title: card.title,
      eyebrow: "SF " + card.code.replace("sf", "") + " · " + card.title,
      onGenerated: loadAll
    });
  }

  function generateCard(card) {
    var run = function (learnerId) {
      var payload = params({ month: state.month || undefined, learnerId: learnerId || undefined });
      var confirmMessage = card.submission
        ? "Regenerate " + card.code.toUpperCase() + "? The current draft snapshot will be replaced with a new version. Approved and finalized submissions are locked."
        : "Generate " + card.code.toUpperCase() + " from the current records?";
      window.UI.confirm({
        title: card.submission ? "Regenerate " + card.code.toUpperCase() + "?" : "Generate " + card.code.toUpperCase() + "?",
        message: confirmMessage,
        confirmLabel: card.submission ? "Regenerate" : "Generate",
        tone: "primary"
      }).then(function (confirmed) {
        if (!confirmed) return;
        window.UI.setButtonLoading(el("refreshFormsButton"), true, "Working…");
        API.post("/school-forms/generate/" + card.code, payload)
          .then(function (result) {
            window.UI.setButtonLoading(el("refreshFormsButton"), false);
            window.UI.toast(
              "Form generated",
              result.data.formCode.toUpperCase() + " saved as " + result.data.statusLabel + " (" + result.data.validation.errorCount + " errors, " + result.data.validation.warningCount + " warnings).",
              result.data.validation.errorCount ? "warning" : "success"
            );
            loadAll();
          })
          .catch(function (error) {
            window.UI.setButtonLoading(el("refreshFormsButton"), false);
            F.pageAlert("formsPageAlert", "danger", L.friendlyError(error), "Could not generate the form");
          });
      });
    };
    if (card.code === "sf10" || (card.code === "sf9" && !state.sectionId)) {
      learnerDialog(card, run);
      return;
    }
    if (!requireContext(card)) {
      return;
    }
    run(null);
  }

  /* Submissions ---------------------------------------------------------- */
  function loadSubmissions() {
    var body = el("submissionsBody");
    body.innerHTML = L.skeletonRows(8, 4);
    return L.apiGet("/school-forms/submissions", {
      schoolId: state.schoolId || undefined,
      schoolYearId: state.yearId || undefined,
      formCode: state.formFilter || undefined,
      status: state.statusFilter || undefined,
      period: state.month || undefined
    })
      .then(function (rows) {
        state.submissions = (rows || []).filter(function (submission) {
          if (state.sectionId && String(submission.sectionId) !== String(state.sectionId)) {
            return false;
          }
          if (state.gradeId && String(submission.gradeLevelId) !== String(state.gradeId)) {
            return false;
          }
          return true;
        });
        renderSubmissions();
      })
      .catch(function (error) {
        if (error.status === 401) return;
        body.innerHTML = F.emptyRow(8, L.friendlyError(error));
        el("submissionsMeta").textContent = "Submissions could not be loaded.";
      });
  }

  function renderSubmissions() {
    var body = el("submissionsBody");
    if (!state.submissions.length) {
      body.innerHTML = F.emptyRow(8, "No form submissions match this filter yet.");
    } else {
      body.innerHTML = state.submissions
        .map(function (submission) {
          return (
            "<tr><td><strong>" + F.esc(submission.formCode.toUpperCase()) + "</strong>" +
            '<span class="record-note">' + F.esc(submission.formTitle) + "</span></td>" +
            "<td>" + F.esc(submission.schoolName || "—") +
            '<span class="record-note">' +
            F.esc(
              submission.learnerName
                ? submission.learnerName + (submission.sectionName ? " · " + submission.sectionName : "")
                : [submission.gradeLevelName, submission.sectionName].filter(Boolean).join(" · ") || "School-wide"
            ) +
            "</span></td>" +
            "<td>" + F.esc(submission.period || "Whole year") + "</td>" +
            "<td>v" + submission.version + "</td>" +
            "<td>" + F.completion(submission.completeness) + "</td>" +
            "<td>" + F.statusBadge(submission.status) + "</td>" +
            "<td>" + F.esc(window.UI.phDateTime(submission.updatedAt)) + "</td>" +
            '<td><div class="row-actions">' +
            '<button type="button" class="btn btn-light" data-open="' + submission.id + '" title="Open submission"><i class="bi bi-folder2-open" aria-hidden="true"></i></button>' +
            (submission.hasSnapshot
              ? '<button type="button" class="btn btn-light" data-pdf="' + submission.id + '" title="Download PDF"><i class="bi bi-file-earmark-pdf" aria-hidden="true"></i></button>'
              : "") +
            "</div></td></tr>"
          );
        })
        .join("");
    }
    el("submissionsMeta").textContent =
      state.submissions.length + (state.submissions.length === 1 ? " submission" : " submissions") +
      (state.formFilter ? " for " + state.formFilter.toUpperCase() : "");
  }

  /* Deadlines ------------------------------------------------------------ */
  function loadDeadlines() {
    var body = el("deadlinesBody");
    body.innerHTML = L.skeletonRows(6, 3);
    return L.apiGet("/school-forms/deadlines", {
      schoolId: state.schoolId || undefined,
      schoolYearId: state.yearId || undefined
    })
      .then(function (rows) {
        state.deadlines = rows || [];
        renderDeadlines();
      })
      .catch(function (error) {
        if (error.status === 401) return;
        body.innerHTML = F.emptyRow(6, L.friendlyError(error));
      });
  }

  function renderDeadlines() {
    var body = el("deadlinesBody");
    if (!state.deadlines.length) {
      body.innerHTML = F.emptyRow(6, "No reporting deadlines have been set for this school year.");
      return;
    }
    body.innerHTML = state.deadlines
      .map(function (deadline) {
        var scope = deadline.schoolName || deadline.districtName || "All schools";
        return (
          "<tr><td><strong>" + F.esc(deadline.formCode.toUpperCase()) + "</strong>" +
          '<span class="record-note">' + F.esc(deadline.formTitle) + "</span></td>" +
          "<td>" + F.esc(deadline.title) + "</td>" +
          "<td>" + F.esc(window.UI.phDate(deadline.dueDate)) +
          (deadline.overdue ? ' <span class="status-badge status-badge--danger"><span class="status-dot"></span>Passed</span>' : "") +
          "</td>" +
          "<td>" + F.esc(scope) + "</td>" +
          "<td>" + F.esc(deadline.period || "Whole year") + "</td>" +
          '<td><div class="row-actions">' +
          (canSetDeadlines()
            ? '<button type="button" class="btn btn-light" data-edit-deadline="' + deadline.id + '" title="Edit deadline"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>' +
              '<button type="button" class="btn btn-light" data-remove-deadline="' + deadline.id + '" title="Remove deadline"><i class="bi bi-trash" aria-hidden="true"></i></button>'
            : "") +
          "</div></td></tr>"
        );
      })
      .join("");
  }

  function deadlineModal(deadline) {
    var editing = Boolean(deadline);
    var data = deadline || {};
    var dialog = L.modal({
      title: editing ? "Edit reporting deadline" : "Set reporting deadline",
      eyebrow: "Forms calendar",
      size: "modal-lg",
      body:
        '<div id="deadlineAlert" class="d-none mb-3" role="alert"></div>' +
        '<form id="deadlineForm" novalidate><div class="form-row">' +
        '<div class="col-md-6"><div class="form-group"><label for="deadlineFormCode">Form <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="deadlineFormCode" name="formCode" required>' +
        state.definitions.map(function (item) {
          return L.option(item.code, item.code.toUpperCase() + " · " + item.title, data.formCode || "");
        }).join("") +
        '</select><span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="deadlineTitle">Deadline title <span class="required-mark">*</span></label>' +
        '<input class="form-control" id="deadlineTitle" name="title" maxlength="160" required value="' + F.esc(data.title || "") + '" placeholder="First quarter submission">' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="deadlineDate">Due date <span class="required-mark">*</span></label>' +
        '<input type="date" class="form-control" id="deadlineDate" name="dueDate" required value="' + F.esc(data.dueDate || "") + '">' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="deadlinePeriod">Reporting month</label>' +
        '<select class="custom-select" id="deadlinePeriod" name="period"><option value="">Whole school year</option>' +
        F.monthOptions(data.period || "") + '</select></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="deadlineScope">Applies to</label>' +
        '<select class="custom-select" id="deadlineScope" name="scope">' +
        '<option value="school">This school</option>' +
        (state.session.user.districtId ? '<option value="district">Whole district</option>' : "") +
        '</select></div></div>' +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="saveDeadlineButton">' + (editing ? "Save deadline" : "Set deadline") + "</button>"
    });
    var form = dialog.element.querySelector("#deadlineForm");
    var button = dialog.element.querySelector("#saveDeadlineButton");
    var alertBox = dialog.element.querySelector("#deadlineAlert");
    button.addEventListener("click", function () {
      var values = F_values(form);
      if (!values.title.trim() || !values.dueDate) {
        window.UI.showAlert(alertBox, "warning", "Enter a deadline title and due date.", "Missing details");
        return;
      }
      var payload = {
        id: editing ? data.id : undefined,
        formCode: values.formCode,
        title: values.title.trim(),
        dueDate: values.dueDate,
        period: values.period || null,
        schoolYearId: state.yearId,
        schoolId: values.scope === "district" ? null : (state.schoolId || L.schoolId() || null),
        districtId: values.scope === "district" || !state.schoolId ? (state.session.user.districtId || null) : null
      };
      window.UI.setButtonLoading(button, true, "Saving…");
      API.post("/school-forms/deadlines", payload)
        .then(function () {
          window.UI.setButtonLoading(button, false);
          dialog.close();
          window.UI.toast("Deadline saved", payload.title, "success");
          loadDeadlines();
          loadCards();
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not save the deadline");
        });
    });
  }

  function F_values(form) {
    var values = {};
    Array.prototype.forEach.call(form.elements, function (field) {
      if (field.name) {
        values[field.name] = field.value;
      }
    });
    return values;
  }

  function removeDeadline(deadline) {
    window.UI.confirm({
      title: "Remove this deadline?",
      message: deadline.title + " (" + deadline.formCode.toUpperCase() + ") will no longer appear on the forms overview.",
      confirmLabel: "Remove deadline",
      tone: "danger"
    }).then(function (confirmed) {
      if (!confirmed) return;
      API.delete("/school-forms/deadlines/" + deadline.id)
        .then(function () {
          window.UI.toast("Deadline removed", deadline.title, "success");
          loadDeadlines();
          loadCards();
        })
        .catch(function (error) {
          F.pageAlert("formsPageAlert", "danger", L.friendlyError(error), "Could not remove the deadline");
        });
    });
  }

  /* Templates ------------------------------------------------------------ */
  function loadTemplates() {
    var body = el("templatesBody");
    body.innerHTML = L.skeletonRows(7, 3);
    return L.apiGet("/school-forms/templates")
      .then(function (rows) {
        state.templates = rows || [];
        renderTemplates();
      })
      .catch(function (error) {
        if (error.status === 401) return;
        body.innerHTML = F.emptyRow(7, L.friendlyError(error));
      });
  }

  function renderTemplates() {
    var body = el("templatesBody");
    if (!state.templates.length) {
      body.innerHTML = F.emptyRow(7, "No templates are configured. System layouts are used by default.");
      return;
    }
    body.innerHTML = state.templates
      .map(function (template) {
        return (
          "<tr><td><strong>" + F.esc(template.formCode.toUpperCase()) + "</strong></td>" +
          "<td>" + F.esc(template.name) +
          '<span class="record-note">' + F.esc(template.sourceNote || "No source recorded") + "</span></td>" +
          "<td>" + F.esc(template.version) + "</td>" +
          "<td>" + F.esc(template.paperSize + " · " + template.orientation) + "</td>" +
          "<td>" + (template.isOfficial
            ? '<span class="status-badge status-badge--success"><span class="status-dot"></span>Official</span>'
            : '<span class="status-badge status-badge--neutral"><span class="status-dot"></span>System layout</span>') + "</td>" +
          "<td>" + (template.isActive
            ? '<span class="status-badge status-badge--primary"><span class="status-dot"></span>Active</span>'
            : '<span class="status-badge status-badge--muted"><span class="status-dot"></span>Inactive</span>') + "</td>" +
          '<td><div class="row-actions">' +
          (canManageTemplates() && !template.isActive
            ? '<button type="button" class="btn btn-light" data-activate-template="' + template.id + '" title="Activate template"><i class="bi bi-check2-circle" aria-hidden="true"></i></button>'
            : "") +
          "</div></td></tr>"
        );
      })
      .join("");
  }

  function templateModal() {
    var dialog = L.modal({
      title: "Add form template",
      eyebrow: "Layout configuration",
      size: "modal-lg",
      body:
        '<div class="info-banner info-banner--warning"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><div>' +
        "Only mark a template official when it reproduces a DepEd-issued form and the source is recorded. Otherwise leave it as a system layout." +
        "</div></div>" +
        '<div id="templateAlert" class="d-none mb-3" role="alert"></div>' +
        '<form id="templateForm" novalidate><div class="form-row">' +
        '<div class="col-md-6"><div class="form-group"><label for="templateFormCode">Form <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="templateFormCode" name="formCode">' +
        state.definitions.map(function (item) {
          return L.option(item.code, item.code.toUpperCase() + " · " + item.title, "");
        }).join("") +
        '</select><span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="templateName">Template name <span class="required-mark">*</span></label>' +
        '<input class="form-control" id="templateName" name="name" maxlength="160" required placeholder="School-adjusted SF 2 layout">' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-3"><div class="form-group"><label for="templateVersion">Version</label>' +
        '<input class="form-control" id="templateVersion" name="version" maxlength="32" value="custom-1"></div></div>' +
        '<div class="col-md-3"><div class="form-group"><label for="templatePaper">Paper size</label>' +
        '<select class="custom-select" id="templatePaper" name="paperSize">' +
        ["A4", "Letter", "Legal", "Folio"].map(function (size) {
          return L.option(size, size, "Legal");
        }).join("") + "</select></div></div>" +
        '<div class="col-md-3"><div class="form-group"><label for="templateOrientation">Orientation</label>' +
        '<select class="custom-select" id="templateOrientation" name="orientation">' +
        L.option("portrait", "Portrait", "portrait") + L.option("landscape", "Landscape", "") +
        "</select></div></div>" +
        '<div class="col-md-3"><div class="form-group"><label>&nbsp;</label>' +
        '<div class="custom-control custom-checkbox mt-2"><input type="checkbox" class="custom-control-input" id="templateOfficial" name="isOfficial">' +
        '<label class="custom-control-label" for="templateOfficial">Marked official</label></div></div></div>' +
        '<div class="col-12"><div class="form-group"><label for="templateSource">Layout source note</label>' +
        '<textarea class="form-control" id="templateSource" name="sourceNote" rows="2" maxlength="2000" placeholder="DepEd Order No. ___ / official file reference. Required when marked official."></textarea>' +
        "</div></div></div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="saveTemplateButton">Add template</button>'
    });
    var form = dialog.element.querySelector("#templateForm");
    var button = dialog.element.querySelector("#saveTemplateButton");
    var alertBox = dialog.element.querySelector("#templateAlert");
    button.addEventListener("click", function () {
      var values = F_values(form);
      var official = form.querySelector("#templateOfficial").checked;
      if (!values.name.trim()) {
        window.UI.showAlert(alertBox, "warning", "Enter a template name.", "Missing details");
        return;
      }
      if (official && !values.sourceNote.trim()) {
        window.UI.showAlert(alertBox, "warning", "Record the official source before marking a template official.", "Source required");
        return;
      }
      var payload = {
        formCode: values.formCode,
        name: values.name.trim(),
        version: values.version.trim() || "custom-1",
        paperSize: values.paperSize,
        orientation: values.orientation,
        isOfficial: official,
        sourceNote: values.sourceNote.trim()
      };
      window.UI.setButtonLoading(button, true, "Saving…");
      API.post("/school-forms/templates", payload)
        .then(function () {
          window.UI.setButtonLoading(button, false);
          dialog.close();
          window.UI.toast("Template added", payload.name + " is now the active layout for " + payload.formCode.toUpperCase() + ".", "success");
          loadTemplates();
          loadCards();
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not save the template");
        });
    });
  }

  function activateTemplate(template) {
    window.UI.confirm({
      title: "Activate " + template.name + "?",
      message: "This becomes the active layout for " + template.formCode.toUpperCase() + ". Existing snapshots keep the layout they were generated with.",
      confirmLabel: "Activate",
      tone: "primary"
    }).then(function (confirmed) {
      if (!confirmed) return;
      API.post("/school-forms/templates/" + template.id + "/activate", {})
        .then(function () {
          window.UI.toast("Template activated", template.name, "success");
          loadTemplates();
        })
        .catch(function (error) {
          F.pageAlert("formsPageAlert", "danger", L.friendlyError(error), "Could not activate the template");
        });
    });
  }

  /* Tabs ----------------------------------------------------------------- */
  function setTab(name) {
    state.tab = name;
    ["forms", "submissions", "deadlines", "templates"].forEach(function (key) {
      var tab = el("tab" + key.charAt(0).toUpperCase() + key.slice(1));
      var panel = el("panel" + key.charAt(0).toUpperCase() + key.slice(1));
      var active = key === name;
      tab.setAttribute("aria-selected", String(active));
      panel.classList.toggle("d-none", !active);
    });
    if (name === "submissions") loadSubmissions();
    if (name === "deadlines") loadDeadlines();
    if (name === "templates") loadTemplates();
  }

  function wireActions() {
    el("formsGrid").addEventListener("click", function (event) {
      var preview = event.target.closest("[data-preview]");
      var generate = event.target.closest("[data-generate]");
      var open = event.target.closest("[data-open]");
      var pdf = event.target.closest("[data-pdf]");
      if (preview) {
        return previewCard(definition(preview.dataset.preview));
      }
      if (generate) {
        return generateCard(definition(generate.dataset.generate));
      }
      if (open) {
        F.openSubmission(open.dataset.open, { onChanged: loadAll });
        return;
      }
      if (pdf) {
        F.downloadPdf(pdf.dataset.pdf);
      }
    });

    el("submissionsBody").addEventListener("click", function (event) {
      var open = event.target.closest("[data-open]");
      var pdf = event.target.closest("[data-pdf]");
      if (open) {
        F.openSubmission(open.dataset.open, { onChanged: loadAll });
      } else if (pdf) {
        F.downloadPdf(pdf.dataset.pdf);
      }
    });

    el("deadlinesBody").addEventListener("click", function (event) {
      var edit = event.target.closest("[data-edit-deadline]");
      var remove = event.target.closest("[data-remove-deadline]");
      if (edit) {
        deadlineModal(state.deadlines.find(function (item) {
          return String(item.id) === edit.dataset.editDeadline;
        }));
      } else if (remove) {
        removeDeadline(state.deadlines.find(function (item) {
          return String(item.id) === remove.dataset.removeDeadline;
        }));
      }
    });

    el("templatesBody").addEventListener("click", function (event) {
      var activate = event.target.closest("[data-activate-template]");
      if (activate) {
        activateTemplate(state.templates.find(function (item) {
          return String(item.id) === activate.dataset.activateTemplate;
        }));
      }
    });

    document.querySelectorAll(".module-tabs [data-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        setTab(button.dataset.tab);
      });
    });

    el("newDeadlineButton").addEventListener("click", function () {
      deadlineModal(null);
    });
    el("newTemplateButton").addEventListener("click", templateModal);
  }

  function init() {
    window.AppShell.init({
      page: "school-forms",
      breadcrumbs: ["School Forms"],
      requiredPermission: "canViewSchoolForms"
    }).then(function (session) {
      if (!session) return;
      state.session = session;
      var params = new URLSearchParams(window.location.search);
      if (!L.schoolId() && params.get("schoolId")) {
        state.schoolId = params.get("schoolId");
      }
      if (params.get("schoolYearId")) {
        state.yearId = params.get("schoolYearId");
      }
      if (params.get("gradeId")) {
        state.gradeId = params.get("gradeId");
      }
      if (params.get("sectionId")) {
        state.sectionId = params.get("sectionId");
      }
      if (params.get("month")) {
        state.month = params.get("month");
      }
      if (canSetDeadlines()) {
        el("newDeadlineButton").classList.remove("d-none");
      }
      if (canManageTemplates()) {
        el("newTemplateButton").classList.remove("d-none");
      }
      wireActions();
      L.apiGet("/school-forms/definitions")
        .then(function (definitions) {
          state.definitions = definitions || [];
          return loadFilters();
        })
        .then(loadAll)
        .catch(function (error) {
          if (error.status === 401) return;
          F.pageAlert("formsPageAlert", "danger", L.friendlyError(error), "School Forms Center unavailable");
        });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
