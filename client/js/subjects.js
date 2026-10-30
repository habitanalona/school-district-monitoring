/* DepEd Learner Records — subjects, teaching assignments, and timetable */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var state = {
    session: null,
    tab: "subjects",
    years: [],
    schoolId: "",
    subjectGradeId: "",
    subjectSearch: "",
    subjects: [],
    subjectOptions: [],
    assignmentYearId: "",
    assignmentSectionId: "",
    assignmentTeacherId: "",
    assignmentSearch: "",
    assignments: [],
    timetableSchoolId: "",
    timetableYearId: "",
    timetableSectionId: "",
    timetable: null
  };
  var formCounter = 0;

  function el(id) {
    return document.getElementById(id);
  }

  function canManage() {
    return Boolean(state.session && state.session.permissions.canManageAcademics);
  }

  function canManageOptions() {
    return Boolean(state.session && state.session.user.role === "system_admin");
  }

  // Dynamic dialogs are removed after closing so a repeated open cannot
  // leave duplicate form IDs behind in this Bootstrap build.
  function ensureModalRemoval(dialog, onHidden) {
    var element = dialog.element;
    var scheduled = false;
    var wasVisible = false;

    function remove() {
      if (scheduled) {
        return;
      }
      scheduled = true;
      window.setTimeout(function () {
        if (element.parentNode) {
          element.parentNode.removeChild(element);
        }
        if (typeof onHidden === "function") {
          onHidden();
        }
      }, 350);
    }

    function isHidden() {
      return (
        element.getAttribute("aria-hidden") === "true" ||
        window.getComputedStyle(element).display === "none"
      );
    }

    element.addEventListener("hidden.bs.modal", remove);

    if (typeof window.MutationObserver !== "function") {
      return;
    }

    window.setTimeout(function () {
      if (!element.parentNode) {
        return;
      }
      if (!isHidden()) {
        wasVisible = true;
      }
      var observer = new window.MutationObserver(function () {
        if (!isHidden()) {
          wasVisible = true;
          return;
        }
        if (wasVisible) {
          observer.disconnect();
          remove();
        }
      });
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["aria-hidden", "class", "style"]
      });
    }, 0);
  }

  function nextFormKey(prefix) {
    formCounter += 1;
    return prefix + String(formCounter);
  }

  function fixedSchool() {
    return L.schoolId() ? String(L.schoolId()) : "";
  }

  function sectionLabel(section) {
    return (
      (section.gradeLevel ? section.gradeLevel + " · " : "") +
      section.name +
      (section.schoolName && !fixedSchool() ? " (" + section.schoolName + ")" : "")
    );
  }

  /* Subject options (system administrator catalog) ------------------------- */

  function activeSubjectOptions() {
    return state.subjectOptions.filter(function (option) {
      return option.isActive;
    });
  }

  function findSubjectOption(id) {
    return state.subjectOptions.find(function (option) {
      return String(option.id) === String(id);
    });
  }

  function loadSubjectOptions(includeInactive) {
    return L.apiGet(
      "/academic/subject-options",
      includeInactive ? { includeInactive: true } : undefined
    ).then(function (list) {
      state.subjectOptions = list || [];
      return state.subjectOptions;
    });
  }

  function ensureSubjectOptions() {
    if (state.subjectOptions.length) {
      return Promise.resolve(state.subjectOptions);
    }
    return loadSubjectOptions(false);
  }

  function visibleSubjectOptions() {
    var query = state.subjectSearch.trim().toLowerCase();
    if (!query) {
      return state.subjectOptions;
    }
    return state.subjectOptions.filter(function (option) {
      return String(option.name).toLowerCase().indexOf(query) !== -1;
    });
  }

  function nextSubjectOptionOrder() {
    if (!state.subjectOptions.length) {
      return 0;
    }
    return Math.min(
      100,
      state.subjectOptions.reduce(function (max, option) {
        return Math.max(max, Number(option.sortOrder) || 0);
      }, 0) + 1
    );
  }

  function suggestSubjectCode(name) {
    return String(name || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32);
  }

  function renderGeneralSubjects() {
    if (!canManageOptions()) {
      return;
    }
    var body = el("generalSubjectTableBody");
    if (!body) {
      return;
    }
    var rows = visibleSubjectOptions();
    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="4" class="empty-cell">' +
        (state.subjectSearch
          ? "No general subject matches your search."
          : "No general subjects yet. Use New subject to add the first one.") +
        "</td></tr>";
    } else {
      body.innerHTML = rows
        .map(function (option) {
          return (
            "<tr><td><strong>" +
            L.esc(option.name) +
            '</strong></td><td class="text-right">' +
            option.sortOrder +
            '</td><td class="text-right">' +
            window.UI.number(option.usageCount) +
            "</td><td>" +
            window.UI.pillarBadge(
              option.isActive ? "Active" : "Inactive",
              option.isActive ? "success" : "neutral"
            ) +
            "</td></tr>"
          );
        })
        .join("");
    }
    el("generalSubjectMeta").textContent =
      rows.length +
      " general subject" +
      (rows.length === 1 ? "" : "s") +
      (state.subjectSearch ? " matching your search" : " in the catalogue");
  }

  function refreshGeneralSubjects() {
    return loadSubjectOptions(true)
      .then(function () {
        renderGeneralSubjects();
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        el("generalSubjectTableBody").innerHTML =
          '<tr><td colspan="4" class="empty-cell">' +
          L.esc(L.friendlyError(error)) +
          "</td></tr>";
        el("generalSubjectMeta").textContent = "General subjects could not be loaded.";
      });
  }

  /* Tabs ------------------------------------------------------------------ */

  function setTab(tab) {
    state.tab = tab;
    ["subjects", "assignments", "timetable"].forEach(function (name) {
      var button = el("tab-" + name);
      var panel = el("panel-" + name);
      var active = name === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      panel.hidden = !active;
    });
    if (tab === "timetable" && !state.timetable && state.timetableSectionId) {
      loadTimetable();
    }
    var url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url);
  }

  /* School/year pickers ---------------------------------------------------- */

  function populateYears() {
    return L.years().then(function (years) {
      state.years = years || [];
      el("assignmentYearFilter").innerHTML = L.yearOptions(state.years, state.assignmentYearId, "All school years");
      el("timetableYearFilter").innerHTML = L.yearOptions(state.years, state.timetableYearId, "Select school year");
      var current = state.years.find(function (year) {
        return year.isCurrent;
      });
      if (!state.assignmentYearId) {
        state.assignmentYearId = current ? String(current.id) : "";
        el("assignmentYearFilter").value = state.assignmentYearId;
      }
      if (!state.timetableYearId) {
        state.timetableYearId = current ? String(current.id) : state.years[0] ? String(state.years[0].id) : "";
        el("timetableYearFilter").value = state.timetableYearId;
      }
    });
  }

  function fillSchoolFilter(select, onAll) {
    if (!select) {
      return Promise.resolve();
    }
    return L.schools().then(function (list) {
      var html = ['<option value="">' + (onAll || "All schools") + "</option>"];
      list.forEach(function (school) {
        html.push(
          '<option value="' + school.id + '">' + L.esc(school.name) + " (" + L.esc(school.code) + ")</option>"
        );
      });
      select.innerHTML = html.join("");
    });
  }

  /* Subject catalog -------------------------------------------------------- */

  function renderSubjects() {
    var body = el("subjectTableBody");
    var query = state.subjectSearch.trim().toLowerCase();
    var rows = state.subjects.filter(function (subject) {
      return (
        !query ||
        [subject.code, subject.name, subject.gradeLevel].join(" ").toLowerCase().indexOf(query) !== -1
      );
    });
    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="5" class="empty-cell">' +
        (state.subjectSearch ? "No subject matches your search." : "No subjects configured yet.") +
        "</td></tr>";
    } else {
      body.innerHTML = rows
        .map(function (subject) {
          return (
            '<tr><td><code class="lrn-code">' +
            L.esc(subject.code) +
            "</code></td><td><strong>" +
            L.esc(subject.name) +
            '</strong><span class="field-hint">' +
            L.esc(subject.schoolName || "") +
            "</span></td><td>" +
            L.esc(subject.gradeLevel || "All grades") +
            '</td><td class="text-right">' +
            window.UI.number(subject.assignmentCount) +
            '</td><td><div class="row-actions">' +
            (canManage()
              ? '<button type="button" class="btn btn-light" data-edit-subject="' +
                subject.id +
                '" title="Edit subject"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>' +
                '<button type="button" class="btn btn-light" data-remove-subject="' +
                subject.id +
                '" title="Remove subject"><i class="bi bi-trash" aria-hidden="true"></i></button>'
              : '<span class="text-muted">—</span>') +
            "</div></td></tr>"
          );
        })
        .join("");
    }
    el("subjectTableMeta").textContent =
      rows.length + " subject" + (rows.length === 1 ? "" : "s") + (state.subjectSearch ? " matching your search" : " in the catalog");
  }

  function loadSubjects() {
    el("subjectTableBody").innerHTML = L.skeletonRows(5, 4);
    return L.apiGet("/academic/subjects", {
      schoolId: state.schoolId || undefined,
      gradeLevelId: state.subjectGradeId || undefined
    })
      .then(function (list) {
        state.subjects = list || [];
        renderSubjects();
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        el("subjectTableBody").innerHTML =
          '<tr><td colspan="5" class="empty-cell">' + L.esc(L.friendlyError(error)) + "</td></tr>";
        el("subjectTableMeta").textContent = "Subjects could not be loaded.";
      });
  }

  function populateSubjectGrades() {
    return L.grades(state.schoolId || undefined).then(function (grades) {
      el("subjectGradeFilter").innerHTML = L.gradeOptions(grades, state.subjectGradeId, "All grade levels");
    });
  }

  // Builds the administrator-managed subject dropdown. A legacy subject name
  // (predating the catalog or whose option was deactivated) stays selectable
  // and is marked "(current)" so an ordinary edit never forces a rename.
  function subjectNameFieldHtml(currentName, selectedName, selectId) {
    var id = selectId || "subjectName";
    var list = activeSubjectOptions().slice();
    if (
      currentName &&
      !list.some(function (option) {
        return String(option.name).toLowerCase() === String(currentName).toLowerCase();
      })
    ) {
      list.unshift({ name: currentName, legacy: true });
    }
    if (!list.length) {
      return (
        '<select class="custom-select" id="' +
        id +
        '" name="name" disabled>' +
        '<option value="">No options available</option></select>' +
        '<span class="field-hint">The system administrator has not prepared any subject options yet.</span>'
      );
    }
    var html =
      '<select class="custom-select" id="' +
      id +
      '" name="name" required>' +
      '<option value="">Select subject</option>';
    list.forEach(function (option) {
      html +=
        '<option value="' +
        L.esc(option.name) +
        '"' +
        (String(option.name).toLowerCase() === String(selectedName).toLowerCase()
          ? " selected"
          : "") +
        ">" +
        L.esc(option.name) +
        (option.legacy ? " (current)" : "") +
        "</option>";
    });
    return (
      html +
      '</select><span class="field-hint">Options are maintained by the system administrator.</span>'
    );
  }

  function subjectModal(subject) {
    ensureSubjectOptions()
      .catch(function () {
        return state.subjectOptions;
      })
      .then(function () {
        var editing = Boolean(subject);
        var data = subject || {};
        var selectedName = editing ? data.name : "";
        var available = activeSubjectOptions();
        var formId = nextFormKey("subjectForm");
        var alertId = nextFormKey("subjectFormAlert");
        var codeId = nextFormKey("subjectCode");
        var nameId = nextFormKey("subjectName");
        var gradeId = nextFormKey("subjectGrade");
        var buttonId = nextFormKey("saveSubjectButton");
        var dialog = L.modal({
          title: editing ? "Edit subject" : "New subject",
          eyebrow: "Subject catalog",
          body:
            '<form id="' +
            formId +
            '" novalidate>' +
            '<div id="' +
            alertId +
            '" class="d-none mb-3" role="alert"></div>' +
            (editing
              ? '<div class="form-group"><label>School</label><input class="form-control" value="' +
                L.esc(data.schoolName || "") +
                '" readonly></div>'
              : L.schoolFieldHtml(state.schoolId)) +
            '<div class="form-row">' +
            '<div class="col-sm-4"><div class="form-group"><label for="' +
            codeId +
            '">Subject code <span class="required-mark">*</span></label>' +
            '<input class="form-control text-uppercase" id="' +
            codeId +
            '" name="code" required maxlength="32" placeholder="MATH7" value="' +
            L.esc(data.code || "") +
            '"><span class="field-hint">Letters, numbers, dots, underscores, hyphens.</span><span class="field-error"></span></div></div>' +
            '<div class="col-sm-8"><div class="form-group"><label for="' +
            nameId +
            '">Subject <span class="required-mark">*</span></label>' +
            subjectNameFieldHtml(selectedName, selectedName, nameId) +
            '<span class="field-error"></span></div></div>' +
            '<div class="col-sm-6"><div class="form-group"><label for="' +
            gradeId +
            '">Grade level</label>' +
            '<select class="custom-select" id="' +
            gradeId +
            '" name="gradeLevelId"><option value="">All grade levels</option></select>' +
            '<span class="field-hint">Leave blank if the subject applies to several grades.</span><span class="field-error"></span></div></div>' +
            "</div></form>",
          footer:
            '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
            '<button type="submit" form="' +
            formId +
            '" class="btn btn-primary" id="' +
            buttonId +
            '">' +
            (editing ? "Save subject" : "Create subject") +
            "</button>"
        });
        ensureModalRemoval(dialog);
        var form = dialog.element.querySelector("#" + formId);
        var button = dialog.element.querySelector("#" + buttonId);
        var alertBox = dialog.element.querySelector("#" + alertId);
        var schoolSelect = form.querySelector("[data-school-select]");
        var codeInput = form.querySelector("#" + codeId);
        var nameSelect = form.querySelector("#" + nameId);
        var gradeSelect = form.querySelector("#" + gradeId);

        if (!available.length) {
          button.disabled = true;
        }
        if (nameSelect && !nameSelect.disabled) {
          nameSelect.addEventListener("change", function () {
            if (!codeInput.value.trim()) {
              codeInput.value = suggestSubjectCode(nameSelect.value);
            }
          });
        }
        if (schoolSelect) {
          L.fillSchoolSelect(schoolSelect, state.schoolId);
        }
        function loadGrades() {
          var school = schoolSelect ? schoolSelect.value : String(data.schoolId || fixedSchool());
          if (!school) {
            gradeSelect.innerHTML = '<option value="">Select a school first</option>';
            return;
          }
          L.grades(school).then(function (grades) {
            gradeSelect.innerHTML = L.gradeOptions(grades, data.gradeLevelId, "All grade levels");
          });
        }
        if (schoolSelect) {
          schoolSelect.addEventListener("change", loadGrades);
        }
        loadGrades();

        form.addEventListener("submit", function (event) {
          event.preventDefault();
          var values = L.formValues(form);
          values.code = values.code.trim().toUpperCase();
          values.name = String(values.name || "").trim();
          if (!values.name) {
            window.UI.fieldError(nameSelect, "Choose a subject from the list.");
            return;
          }
          if (!values.code) {
            window.UI.showAlert(alertBox, "warning", "Enter the subject code.", "Missing details");
            return;
          }
          if (!editing && !values.schoolId) {
            window.UI.fieldError(form.querySelector("[name=schoolId]"), "Choose the school for this subject.");
            return;
          }
          var payload = {
            schoolId: values.schoolId,
            code: values.code,
            name: values.name,
            gradeLevelId: values.gradeLevelId || null
          };
          L.submit(
            form,
            button,
            alertBox,
            function () {
              return editing
                ? API.put("/academic/subjects/" + subject.id, payload)
                : API.post("/academic/subjects", payload);
            },
            function () {
              dialog.close();
              L.clearCache();
              window.UI.toast(
                editing ? "Subject updated" : "Subject created",
                values.code + " · " + values.name,
                "success"
              );
              loadSubjects();
              if (canManageOptions()) {
                refreshGeneralSubjects();
              }
            }
          );
        });
      });
  }

  function removeSubject(subject) {
    window.UI.confirm({
      title: "Remove " + subject.code + "?",
      message: "Subjects with teaching assignments cannot be removed. Remove its assignments first.",
      confirmLabel: "Remove subject",
      tone: "danger"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      API.delete("/academic/subjects/" + subject.id)
        .then(function () {
          window.UI.toast("Subject removed", subject.code + " was removed from the catalog.", "success");
          loadSubjects();
        })
        .catch(function (error) {
          window.UI.showAlert(el("subjectPageAlert"), "danger", L.friendlyError(error), "Could not remove the subject");
        });
    });
  }

  // System administrators maintain the system-wide list. A general subject
  // has no school and no grade level: schools select it later from their own
  // subject form.
  function generalSubjectModal() {
    var formId = nextFormKey("generalSubjectForm");
    var alertId = nextFormKey("generalSubjectAlert");
    var nameId = nextFormKey("generalSubjectName");
    var orderId = nextFormKey("generalSubjectOrder");
    var buttonId = nextFormKey("saveGeneralSubjectButton");
    var dialog = L.modal({
      title: "New subject",
      eyebrow: "System administration",
      subtitle:
        "This creates a general subject. No school and no grade level are assigned here; schools select it from their dropdown when they add their own subject.",
      body:
        '<form id="' +
        formId +
        '" novalidate>' +
        '<div id="' +
        alertId +
        '" class="d-none mb-3" role="alert"></div>' +
        '<div class="form-row">' +
        '<div class="col-sm-8"><div class="form-group"><label for="' +
        nameId +
        '">Subject name <span class="required-mark">*</span></label>' +
        '<input class="form-control" id="' +
        nameId +
        '" name="name" required maxlength="160" placeholder="Mathematics">' +
        '<span class="field-hint">Examples: Mathematics, Araling Panlipunan, General Chemistry 1.</span><span class="field-error"></span></div></div>' +
        '<div class="col-sm-4"><div class="form-group"><label for="' +
        orderId +
        '">Sort order</label>' +
        '<input type="number" class="form-control" id="' +
        orderId +
        '" name="sortOrder" min="0" max="100" step="1" value="' +
        nextSubjectOptionOrder() +
        '"><span class="field-hint">Lower numbers appear first.</span><span class="field-error"></span></div></div>' +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="submit" form="' +
        formId +
        '" class="btn btn-primary" id="' +
        buttonId +
        '">Create subject</button>'
    });
    ensureModalRemoval(dialog);
    var form = dialog.element.querySelector("#" + formId);
    var button = dialog.element.querySelector("#" + buttonId);
    var alertBox = dialog.element.querySelector("#" + alertId);
    var nameInput = form.querySelector("#" + nameId);
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var values = L.formValues(form);
      var name = String(values.name || "").trim();
      if (!name) {
        window.UI.fieldError(nameInput, "Enter a subject name.");
        return;
      }
      L.submit(
        form,
        button,
        alertBox,
        function () {
          return API.post("/academic/subject-options", {
            name: name,
            sortOrder: Number(values.sortOrder || 0),
            isActive: true
          });
        },
        function () {
          dialog.close();
          window.UI.toast("General subject added", name, "success");
          refreshGeneralSubjects();
        }
      );
    });
  }

  function openSubjectOptionsManager() {
    loadSubjectOptions(true)
      .then(function () {
        var alertId = nextFormKey("subjectManagerAlert");
        var formId = nextFormKey("subjectOptionForm");
        var nameId = nextFormKey("subjectOptionName");
        var orderId = nextFormKey("subjectOptionOrder");
        var buttonId = nextFormKey("saveSubjectOptionButton");
        var cancelId = nextFormKey("cancelSubjectOptionEdit");
        var tableId = nextFormKey("subjectOptionTableBody");
        var dialog = L.modal({
          title: "Subject options",
          eyebrow: "System administration",
          subtitle:
            "Schools choose from these options when adding a subject. Renaming an option never changes or removes subjects that schools already configured.",
          size: "modal-lg",
          body:
            '<div id="' +
            alertId +
            '" class="d-none mb-3" role="alert"></div>' +
            '<form id="' +
            formId +
            '" class="form-row align-items-start" novalidate>' +
            '<div class="col-sm-6"><div class="form-group"><label for="' +
            nameId +
            '">Subject name <span class="required-mark">*</span></label>' +
            '<input class="form-control" id="' +
            nameId +
            '" name="name" required maxlength="160" placeholder="Mathematics">' +
            '<span class="field-error"></span></div></div>' +
            '<div class="col-sm-3"><div class="form-group"><label for="' +
            orderId +
            '">Sort order</label>' +
            '<input type="number" class="form-control" id="' +
            orderId +
            '" name="sortOrder" min="0" max="100" step="1" value="0">' +
            '<span class="field-error"></span></div></div>' +
            '<div class="col-sm-3"><div class="form-group"><label class="d-none d-sm-block">&nbsp;</label>' +
            '<button type="submit" class="btn btn-primary btn-block" id="' +
            buttonId +
            '">Add subject</button>' +
            '<button type="button" class="btn btn-link btn-sm btn-block d-none" id="' +
            cancelId +
            '">Cancel edit</button>' +
            "</div></div></form>" +
            '<div class="table-responsive"><table class="app-table" aria-label="Subject options">' +
            '<thead><tr><th scope="col">Subject</th><th scope="col" class="text-right">Order</th>' +
            '<th scope="col" class="text-right">Used by</th><th scope="col">Status</th>' +
            '<th scope="col" class="text-right">Actions</th></tr></thead>' +
            '<tbody id="' +
            tableId +
            '"></tbody></table></div>' +
            '<p class="field-hint mt-2 mb-0">Deactivate an option to keep it out of school dropdowns without affecting existing records. Options used by a school subject cannot be removed.</p>',
          footer: '<button type="button" class="btn btn-light" data-dismiss="modal">Close</button>'
        });
        ensureModalRemoval(dialog, function () {
          refreshGeneralSubjects();
          loadSubjects();
        });

        var form = dialog.element.querySelector("#" + formId);
        var tableBody = dialog.element.querySelector("#" + tableId);
        var alertBox = dialog.element.querySelector("#" + alertId);
        var nameInput = dialog.element.querySelector("#" + nameId);
        var orderInput = dialog.element.querySelector("#" + orderId);
        var saveButton = dialog.element.querySelector("#" + buttonId);
        var cancelEdit = dialog.element.querySelector("#" + cancelId);
        var editingOptionId = null;

        function refresh() {
          return loadSubjectOptions(true).then(function () {
            renderOptions();
          });
        }

        function resetForm() {
          editingOptionId = null;
          form.reset();
          orderInput.value = 0;
          saveButton.textContent = "Add subject";
          cancelEdit.classList.add("d-none");
          window.UI.clearFieldErrors(form);
        }

        function startEdit(option) {
          editingOptionId = option.id;
          nameInput.value = option.name;
          orderInput.value = option.sortOrder;
          saveButton.textContent = "Save changes";
          cancelEdit.classList.remove("d-none");
          window.UI.clearFieldErrors(form);
          nameInput.focus();
          dialog.body.scrollTop = 0;
        }

        function renderOptions() {
          if (!state.subjectOptions.length) {
            tableBody.innerHTML =
              '<tr><td colspan="5" class="empty-cell">No options yet. Add the first subject option above.</td></tr>';
            return;
          }
          tableBody.innerHTML = state.subjectOptions
            .map(function (option) {
              var inUse = Number(option.usageCount) > 0;
              return (
                "<tr><td><strong>" +
                L.esc(option.name) +
                '</strong></td><td class="text-right">' +
                option.sortOrder +
                '</td><td class="text-right">' +
                window.UI.number(option.usageCount) +
                "</td><td>" +
                window.UI.pillarBadge(
                  option.isActive ? "Active" : "Inactive",
                  option.isActive ? "success" : "neutral"
                ) +
                '</td><td><div class="row-actions">' +
                '<button type="button" class="btn btn-light" data-subject-option-edit="' +
                option.id +
                '" title="Edit option"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>' +
                '<button type="button" class="btn btn-light" data-subject-option-toggle="' +
                option.id +
                '" title="' +
                (option.isActive ? "Deactivate option" : "Reactivate option") +
                '"><i class="bi ' +
                (option.isActive ? "bi-pause-circle" : "bi-play-circle") +
                '" aria-hidden="true"></i></button>' +
                '<button type="button" class="btn btn-light" data-subject-option-remove="' +
                option.id +
                '" title="' +
                (inUse ? "Used by a school subject" : "Remove option") +
                '"' +
                (inUse ? " disabled" : "") +
                '><i class="bi bi-trash" aria-hidden="true"></i></button>' +
                "</div></td></tr>"
              );
            })
            .join("");
        }

        cancelEdit.addEventListener("click", resetForm);

        form.addEventListener("submit", function (event) {
          event.preventDefault();
          var values = L.formValues(form);
          var name = String(values.name || "").trim();
          var sortOrder = Number(values.sortOrder || 0);
          if (!name) {
            window.UI.fieldError(nameInput, "Enter a subject option name.");
            return;
          }
          var editing = editingOptionId ? findSubjectOption(editingOptionId) : null;
          var payload = {
            name: name,
            sortOrder: sortOrder,
            isActive: editing ? editing.isActive : true
          };
          L.submit(
            form,
            saveButton,
            alertBox,
            function () {
              return editingOptionId
                ? API.put("/academic/subject-options/" + editingOptionId, payload)
                : API.post("/academic/subject-options", payload);
            },
            function () {
              window.UI.toast(
                editingOptionId ? "Subject option updated" : "Subject option added",
                name,
                "success"
              );
              resetForm();
              refresh().then(function () {
                loadSubjects();
              });
            }
          );
        });

        tableBody.addEventListener("click", function (event) {
          var edit = event.target.closest("[data-subject-option-edit]");
          if (edit) {
            var option = findSubjectOption(edit.dataset.subjectOptionEdit);
            if (option) {
              startEdit(option);
            }
            return;
          }
          var toggle = event.target.closest("[data-subject-option-toggle]");
          if (toggle) {
            var target = findSubjectOption(toggle.dataset.subjectOptionToggle);
            if (!target) {
              return;
            }
            API.put("/academic/subject-options/" + target.id, {
              name: target.name,
              sortOrder: target.sortOrder,
              isActive: !target.isActive
            })
              .then(function () {
                window.UI.toast(
                  target.isActive ? "Subject option deactivated" : "Subject option reactivated",
                  target.name,
                  "success"
                );
                if (editingOptionId && String(editingOptionId) === String(target.id)) {
                  resetForm();
                }
                refresh();
              })
              .catch(function (error) {
                window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not update the option");
              });
            return;
          }
          var remove = event.target.closest("[data-subject-option-remove]");
          if (remove) {
            var removable = findSubjectOption(remove.dataset.subjectOptionRemove);
            if (!removable) {
              return;
            }
            window.UI.confirm({
              title: "Remove " + removable.name + "?",
              message:
                "Removing an option only affects future dropdown choices. Options used by a school subject cannot be removed; deactivate them instead.",
              confirmLabel: "Remove option",
              tone: "danger"
            }).then(function (confirmed) {
              if (!confirmed) {
                return;
              }
              API.delete("/academic/subject-options/" + removable.id)
                .then(function () {
                  window.UI.toast("Subject option removed", removable.name, "success");
                  if (editingOptionId && String(editingOptionId) === String(removable.id)) {
                    resetForm();
                  }
                  refresh();
                })
                .catch(function (error) {
                  window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not remove the option");
                });
            });
          }
        });

        renderOptions();
      })
      .catch(function (error) {
        window.UI.showAlert(
          el("subjectPageAlert"),
          "danger",
          L.friendlyError(error),
          "Could not load subject options"
        );
      });
  }

  /* Teaching assignments --------------------------------------------------- */

  function populateAssignmentSections() {
    var select = el("assignmentSectionFilter");
    return L.sections({
      schoolId: state.schoolId || undefined,
      schoolYearId: state.assignmentYearId || undefined
    }).then(function (list) {
      select.innerHTML = L.options(list, "id", sectionLabel, state.assignmentSectionId, "All sections");
    });
  }

  function populateAssignmentTeachers() {
    var select = el("assignmentTeacherFilter");
    if (!select) {
      return Promise.resolve();
    }
    if (!state.schoolId) {
      select.classList.add("d-none");
      return Promise.resolve();
    }
    select.classList.remove("d-none");
    return L.teachers(state.schoolId).then(function (list) {
      select.innerHTML = L.options(list, "id", "fullName", state.assignmentTeacherId, "All teachers");
    });
  }

  function renderAssignments() {
    var body = el("assignmentTableBody");
    var rows = state.assignments;
    var query = state.assignmentSearch.trim().toLowerCase();
    if (query) {
      rows = rows.filter(function (item) {
        return [item.subjectCode, item.subjectName, item.sectionName, item.gradeLevel, item.teacherName]
          .join(" ")
          .toLowerCase()
          .indexOf(query) !== -1;
      });
    }
    el("assignmentCount").textContent = state.assignments.length;
    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="6" class="empty-cell">' +
        (query ? "No assignment matches your search." : "No teaching assignments yet.") +
        "</td></tr>";
    } else {
      body.innerHTML = rows
        .map(function (item) {
          return (
            '<tr><td><strong>' +
            L.esc(item.subjectCode || "—") +
            "</strong><span class=\"field-hint\">" +
            L.esc(item.subjectName || "") +
            "</span></td><td>" +
            L.esc((item.gradeLevel || "—") + " · " + (item.sectionName || "—")) +
            "</td><td>" +
            (item.teacherName ? L.esc(item.teacherName) : '<span class="text-muted">Unassigned</span>') +
            "</td><td>" +
            L.esc(item.employeeNumber || "—") +
            '</td><td class="text-right">' +
            window.UI.number(item.scheduleCount) +
            '</td><td><div class="row-actions">' +
            '<button type="button" class="btn btn-light" data-schedule="' +
            item.id +
            '" title="Manage class schedule"><i class="bi bi-calendar-week" aria-hidden="true"></i></button>' +
            (canManage()
              ? '<button type="button" class="btn btn-light" data-edit-assignment="' +
                item.id +
                '" title="Edit assignment"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>' +
                '<button type="button" class="btn btn-light" data-remove-assignment="' +
                item.id +
                '" title="Remove assignment"><i class="bi bi-trash" aria-hidden="true"></i></button>'
              : "") +
            "</div></td></tr>"
          );
        })
        .join("");
    }
    el("assignmentTableMeta").textContent =
      rows.length +
      " assignment" +
      (rows.length === 1 ? "" : "s") +
      (state.assignmentYearId
        ? " · " +
          (state.years.find(function (year) {
            return String(year.id) === String(state.assignmentYearId);
          }) || { name: "" }).name
        : "");
  }

  function loadAssignments() {
    el("assignmentTableBody").innerHTML = L.skeletonRows(6, 4);
    return L.apiGet("/academic/assignments", {
      schoolId: state.schoolId || undefined,
      schoolYearId: state.assignmentYearId || undefined,
      sectionId: state.assignmentSectionId || undefined,
      teacherId: state.assignmentTeacherId || undefined,
      search: state.assignmentSearch.trim() || undefined
    })
      .then(function (list) {
        state.assignments = list || [];
        renderAssignments();
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        el("assignmentTableBody").innerHTML =
          '<tr><td colspan="6" class="empty-cell">' + L.esc(L.friendlyError(error)) + "</td></tr>";
        el("assignmentTableMeta").textContent = "Assignments could not be loaded.";
      });
  }

  function assignmentModal(assignment) {
    var editing = Boolean(assignment);
    var data = assignment || {};
    var dialog = L.modal({
      title: editing ? "Edit teaching assignment" : "New teaching assignment",
      eyebrow: "Subjects and teachers",
      size: "modal-lg",
      body:
        '<form id="assignmentForm" novalidate>' +
        '<div id="assignmentFormAlert" class="d-none mb-3" role="alert"></div>' +
        (editing
          ? '<div class="form-group"><label>School</label><input class="form-control" value="' +
            L.esc(L.schoolName(data.schoolId) || "School") +
            '" readonly></div>'
          : L.schoolFieldHtml(state.schoolId)) +
        '<div class="form-row">' +
        '<div class="col-md-6"><div class="form-group"><label for="assignmentYear">School year <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="assignmentYear" name="schoolYearId" required>' +
        L.yearOptions(state.years, data.schoolYearId || state.assignmentYearId, "Select school year") +
        '</select><span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="assignmentSection">Section <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="assignmentSection" name="sectionId" required><option value="">Loading sections…</option></select>' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="assignmentSubject">Subject <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="assignmentSubject" name="subjectId" required data-selected="' +
        (data.subjectId || "") +
        '"><option value="">Loading subjects…</option></select><span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="assignmentTeacher">Teacher</label>' +
        '<select class="custom-select" id="assignmentTeacher" name="teacherId"><option value="">Unassigned</option></select>' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="assignmentEmployee">Employee number</label>' +
        '<input class="form-control" id="assignmentEmployee" name="employeeNumber" maxlength="32" placeholder="e.g. T-1042" value="' +
        L.esc(data.employeeNumber || "") +
        '"><span class="field-hint">Overrides the teacher\'s default employee number for this assignment.</span></div></div>' +
        '<div class="col-12"><div class="form-group"><label for="assignmentRemarks">Remarks</label>' +
        '<textarea class="form-control" id="assignmentRemarks" name="remarks" rows="2" maxlength="2000">' +
        L.esc(data.remarks || "") +
        "</textarea></div></div>" +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="submit" form="assignmentForm" class="btn btn-primary" id="saveAssignmentButton">' +
        (editing ? "Save assignment" : "Create assignment") +
        "</button>"
    });
    var form = dialog.element.querySelector("#assignmentForm");
    var button = dialog.element.querySelector("#saveAssignmentButton");
    var alertBox = dialog.element.querySelector("#assignmentFormAlert");
    var schoolSelect = form.querySelector("[data-school-select]");
    var yearSelect = form.querySelector("#assignmentYear");
    var sectionSelect = form.querySelector("#assignmentSection");
    var subjectSelect = form.querySelector("#assignmentSubject");
    var teacherSelect = form.querySelector("#assignmentTeacher");

    if (schoolSelect) {
      L.fillSchoolSelect(schoolSelect, state.schoolId || data.schoolId);
    }

    function schoolValue() {
      return schoolSelect ? schoolSelect.value : String(data.schoolId || fixedSchool());
    }

    function loadSections() {
      var school = schoolValue();
      var year = yearSelect.value;
      if (!school) {
        sectionSelect.innerHTML = '<option value="">Select a school first</option>';
        return;
      }
      sectionSelect.innerHTML = '<option value="">Loading sections…</option>';
      L.sections({ schoolId: school, schoolYearId: year || undefined }).then(function (list) {
        if (!document.body.contains(sectionSelect)) {
          return;
        }
        sectionSelect.innerHTML = L.options(list, "id", sectionLabel, data.sectionId, "Select section");
      });
    }

    function loadSubjects() {
      var school = schoolValue();
      if (!school) {
        subjectSelect.innerHTML = '<option value="">Select a school first</option>';
        return;
      }
      subjectSelect.innerHTML = '<option value="">Loading subjects…</option>';
      L.subjects(school).then(function (list) {
        if (!document.body.contains(subjectSelect)) {
          return;
        }
        subjectSelect.innerHTML = L.options(
          list,
          "id",
          function (subject) {
            return subject.code + " · " + subject.name;
          },
          data.subjectId,
          "Select subject"
        );
      });
    }

    function loadTeachers() {
      var school = schoolValue();
      if (!school) {
        teacherSelect.innerHTML = '<option value="">Unassigned</option>';
        return;
      }
      L.teachers(school).then(function (list) {
        if (!document.body.contains(teacherSelect)) {
          return;
        }
        teacherSelect.innerHTML = L.teacherOptions(list, data.teacherId);
      });
    }

    function loadAll() {
      data.sectionId = null;
      data.subjectId = null;
      data.teacherId = null;
      loadSections();
      loadSubjects();
      loadTeachers();
    }

    if (schoolSelect) {
      schoolSelect.addEventListener("change", loadAll);
    }
    yearSelect.addEventListener("change", loadSections);
    loadSections();
    loadSubjects();
    loadTeachers();

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var values = L.formValues(form);
      if (!values.schoolYearId || !values.sectionId || !values.subjectId) {
        window.UI.showAlert(alertBox, "warning", "Choose the school year, section, and subject.", "Missing details");
        return;
      }
      if (!editing && !values.schoolId) {
        window.UI.fieldError(form.querySelector("[name=schoolId]"), "Choose the school for this assignment.");
        return;
      }
      var payload = {
        schoolId: values.schoolId,
        schoolYearId: values.schoolYearId,
        sectionId: values.sectionId,
        subjectId: values.subjectId,
        teacherId: values.teacherId || null,
        employeeNumber: values.employeeNumber.trim(),
        remarks: values.remarks.trim()
      };
      L.submit(
        form,
        button,
        alertBox,
        function () {
          return editing
            ? API.put("/academic/assignments/" + assignment.id, payload)
            : API.post("/academic/assignments", payload);
        },
        function () {
          var subjectLabel =
            subjectSelect.options[subjectSelect.selectedIndex] &&
            subjectSelect.options[subjectSelect.selectedIndex].text;
          dialog.close();
          L.clearCache();
          window.UI.toast(
            editing ? "Assignment updated" : "Assignment created",
            subjectLabel || "Teaching assignment saved.",
            "success"
          );
          loadAssignments();
        }
      );
    });
  }

  function removeAssignment(assignment) {
    window.UI.confirm({
      title: "Remove this assignment?",
      message:
        (assignment.subjectCode || "Subject") +
        " · " +
        (assignment.sectionName || "Section") +
        ". Remove its class schedule first if one exists.",
      confirmLabel: "Remove assignment",
      tone: "danger"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      API.delete("/academic/assignments/" + assignment.id)
        .then(function () {
          window.UI.toast("Assignment removed", assignment.subjectName || "Teaching assignment removed.", "success");
          loadAssignments();
        })
        .catch(function (error) {
          window.UI.showAlert(el("subjectPageAlert"), "danger", L.friendlyError(error), "Could not remove the assignment");
        });
    });
  }

  /* Class schedules -------------------------------------------------------- */

  function conflictDetails(error) {
    var conflicts = error && error.details && error.details.conflicts;
    if (!conflicts || !conflicts.length) {
      return "";
    }
    return (
      '<ul class="missing-list">' +
      conflicts
        .map(function (conflict) {
          return (
            "<li>" +
            L.esc(L.DAY_NAMES[conflict.day_of_week] || "Day " + conflict.day_of_week) +
            ": " +
            L.esc(conflict.start_time + "–" + conflict.end_time) +
            " · " +
            L.esc(conflict.subject_code || "") +
            " · " +
            L.esc(conflict.section_name || "") +
            (conflict.teacher_name ? " · " + L.esc(conflict.teacher_name) : "") +
            "</li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }

  function scheduleModal(assignment) {
    var dialog = L.modal({
      title: "Class schedule",
      eyebrow: (assignment.subjectCode || "Subject") + " · " + (assignment.sectionName || "Section"),
      size: "modal-lg",
      body:
        '<div id="scheduleAlert" class="d-none mb-3" role="alert"></div>' +
        '<div id="scheduleList" class="mb-3"><div class="skeleton skeleton-block"></div></div>' +
        '<p class="form-section-label">Add class period</p>' +
        '<form id="scheduleForm" novalidate>' +
        '<div class="form-row">' +
        '<div class="col-sm-4"><div class="form-group"><label for="scheduleDay">Day <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="scheduleDay" name="dayOfWeek" required>' +
        [1, 2, 3, 4, 5, 6, 7]
          .map(function (day) {
            return L.option(day, L.DAY_NAMES[day]);
          })
          .join("") +
        '</select><span class="field-error"></span></div></div>' +
        '<div class="col-sm-4"><div class="form-group"><label for="scheduleStart">Start time <span class="required-mark">*</span></label>' +
        '<input type="time" class="form-control" id="scheduleStart" name="startTime" required step="60"><span class="field-error"></span></div></div>' +
        '<div class="col-sm-4"><div class="form-group"><label for="scheduleEnd">End time <span class="required-mark">*</span></label>' +
        '<input type="time" class="form-control" id="scheduleEnd" name="endTime" required step="60"><span class="field-error"></span></div></div>' +
        '<div class="col-sm-6"><div class="form-group"><label for="scheduleRoom">Room</label>' +
        '<input class="form-control" id="scheduleRoom" name="room" maxlength="64" placeholder="Room 201"></div></div>' +
        '<div class="col-sm-6"><div class="form-group"><label for="scheduleRemarks">Remarks</label>' +
        '<input class="form-control" id="scheduleRemarks" name="remarks" maxlength="2000"></div></div>' +
        "</div>" +
        '<button type="submit" class="btn btn-primary btn-sm" id="addScheduleButton"><i class="bi bi-plus-lg" aria-hidden="true"></i> Add class period</button>' +
        "</form>",
      footer: '<button type="button" class="btn btn-light" data-dismiss="modal">Close</button>'
    });
    var list = dialog.element.querySelector("#scheduleList");
    var alertBox = dialog.element.querySelector("#scheduleAlert");
    var form = dialog.element.querySelector("#scheduleForm");
    var addButton = dialog.element.querySelector("#addScheduleButton");

    function renderList(entries) {
      if (!entries.length) {
        list.innerHTML = '<p class="text-muted" style="font-size:.82rem">No class periods yet. Add the first schedule below.</p>';
        return;
      }
      list.innerHTML =
        '<div class="report-preview"><div class="report-preview__scroll"><table><thead><tr><th>Day</th><th>Time</th><th>Room</th><th>Remarks</th><th></th></tr></thead><tbody>' +
        entries
          .map(function (entry) {
            return (
              "<tr><td>" +
              L.esc(L.DAY_NAMES[entry.dayOfWeek] || entry.dayName) +
              "</td><td>" +
              window.UI.time(entry.startTime) +
              " – " +
              window.UI.time(entry.endTime) +
              "</td><td>" +
              L.esc(entry.room || "—") +
              "</td><td>" +
              L.esc(entry.remarks || "—") +
              '</td><td class="text-right">' +
              '<button type="button" class="btn btn-light btn-sm" data-remove-schedule="' +
              entry.id +
              '" title="Remove class period"><i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table></div></div>";
    }

    function loadSchedules() {
      L.apiGet("/academic/schedules", { sectionId: assignment.sectionId })
        .then(function (entries) {
          renderList(
            (entries || []).filter(function (entry) {
              return Number(entry.assignmentId) === Number(assignment.id);
            })
          );
        })
        .catch(function (error) {
          if (error.status === 401) {
            return;
          }
          list.innerHTML = '<p class="empty-cell">' + L.esc(L.friendlyError(error)) + "</p>";
        });
    }

    list.addEventListener("click", function (event) {
      var remove = event.target.closest("[data-remove-schedule]");
      if (!remove) {
        return;
      }
      API.delete("/academic/schedules/" + remove.dataset.removeSchedule)
        .then(function () {
          window.UI.toast("Class period removed", "The timetable was updated.", "success");
          loadSchedules();
          loadAssignments();
        })
        .catch(function (error) {
          window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not remove the class period");
        });
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var values = L.formValues(form);
      if (!values.startTime || !values.endTime) {
        window.UI.fieldError(form.querySelector("#scheduleStart"), "Enter the start and end time.");
        return;
      }
      if (values.endTime <= values.startTime) {
        window.UI.fieldError(form.querySelector("#scheduleEnd"), "End time must be after the start time.");
        return;
      }
      window.UI.hideAlert(alertBox);
      window.UI.setButtonLoading(addButton, true, "Adding…");
      API.post("/academic/schedules", {
        assignmentId: assignment.id,
        dayOfWeek: values.dayOfWeek,
        startTime: values.startTime,
        endTime: values.endTime,
        room: values.room.trim() || null,
        remarks: values.remarks.trim()
      })
        .then(function () {
          window.UI.setButtonLoading(addButton, false);
          form.reset();
          window.UI.toast("Class period added", L.DAY_NAMES[values.dayOfWeek] + " · " + values.startTime + "–" + values.endTime, "success");
          loadSchedules();
          loadAssignments();
        })
        .catch(function (error) {
          window.UI.setButtonLoading(addButton, false);
          if (error.status === 401) {
            return;
          }
          window.UI.showAlert(
            alertBox,
            "danger",
            L.friendlyError(error) + conflictDetails(error),
            "Could not add the class period"
          );
        });
    });

    loadSchedules();
  }

  /* Timetable -------------------------------------------------------------- */

  function populateTimetableSections() {
    var select = el("timetableSectionFilter");
    return L.sections({
      schoolId: state.timetableSchoolId || undefined,
      schoolYearId: state.timetableYearId || undefined
    }).then(function (list) {
      select.innerHTML = L.options(list, "id", sectionLabel, state.timetableSectionId, "Select a section");
    });
  }

  function timetableMarkup(data, forPrint) {
    var head =
      "<tr><th>Monday</th><th>Tuesday</th><th>Wednesday</th><th>Thursday</th><th>Friday</th><th>Saturday</th><th>Sunday</th></tr>";
    var cells = data.days.map(function (day) {
      if (!day.entries.length) {
        return '<td><span class="timetable-empty">No classes</span></td>';
      }
      return (
        "<td>" +
        day.entries
          .map(function (entry) {
            if (forPrint) {
              return (
                "<div>" +
                "<strong>" +
                window.UI.time(entry.startTime) +
                "–" +
                window.UI.time(entry.endTime) +
                "</strong><br>" +
                L.esc(entry.subjectCode || entry.subjectName || "Class") +
                (entry.teacherName ? " · " + L.esc(entry.teacherName) : "") +
                (entry.room ? " · " + L.esc(entry.room) : "") +
                "</div>"
              );
            }
            return (
              '<span class="timetable-entry">' +
              L.esc(entry.subjectCode || entry.subjectName || "Class") +
              "<small>" +
              window.UI.time(entry.startTime) +
              "–" +
              window.UI.time(entry.endTime) +
              (entry.teacherName ? " · " + L.esc(entry.teacherName) : "") +
              (entry.room ? " · " + L.esc(entry.room) : "") +
              "</small></span>"
            );
          })
          .join("") +
        "</td>"
      );
    });
    return (
      "<table class=\"timetable\">" +
      (forPrint ? "<thead>" + head + "</thead>" : "") +
      "<tbody><tr>" +
      cells.join("") +
      "</tr></tbody></table>"
    );
  }

  function renderTimetable(data) {
    state.timetable = data;
    var section = data.section;
    el("timetableSubtitle").textContent =
      (section.gradeLevel ? section.gradeLevel + " · " : "") +
      section.name +
      " · " +
      (section.schoolName || "School") +
      " · " +
      (section.schoolYearName || "") +
      (section.adviserName ? " · Adviser: " + section.adviserName : "");
    var hasEntries = data.days.some(function (day) {
      return day.entries.length;
    });
    if (!hasEntries) {
      el("timetableContent").innerHTML =
        '<p class="empty-cell">No class periods have been scheduled for this section yet.</p>';
      return;
    }
    el("timetableContent").innerHTML = timetableMarkup(data, false);
  }

  function loadTimetable() {
    if (!state.timetableSectionId) {
      state.timetable = null;
      el("timetableContent").innerHTML = '<p class="empty-cell">Select a section to view its weekly schedule.</p>';
      el("timetableSubtitle").textContent = "Choose a section to view its Monday-to-Sunday class schedule.";
      return;
    }
    el("timetableContent").innerHTML = '<div class="skeleton skeleton-block"></div>';
    L.apiGet("/academic/timetable", { sectionId: state.timetableSectionId })
      .then(renderTimetable)
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        el("timetableContent").innerHTML = '<p class="empty-cell">' + L.esc(L.friendlyError(error)) + "</p>";
      });
  }

  function printTimetable() {
    if (!state.timetable) {
      window.UI.showAlert(el("subjectPageAlert"), "warning", "Choose a section with a timetable first.", "Nothing to print");
      return;
    }
    var data = state.timetable;
    var section = data.section;
    var meta =
      (section.gradeLevel ? section.gradeLevel + " · " : "") +
      section.name +
      " · " +
      (section.schoolName || "") +
      " · " +
      (section.schoolYearName || "") +
      (section.adviserName ? " · Adviser: " + section.adviserName : "");
    L.printHtml(
      "Weekly timetable",
      "<h1>Weekly class timetable</h1><p class=\"print-meta\">" +
        L.esc(meta) +
        "</p>" +
        timetableMarkup(data, true)
    );
  }

  /* Wiring ----------------------------------------------------------------- */

  function wireTabs() {
    document.querySelectorAll("[data-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        setTab(button.dataset.tab);
      });
    });
  }

  function wireSubjectEvents() {
    var search = el("subjectSearch");
    search.addEventListener(
      "input",
      window.UI.debounce(function () {
        state.subjectSearch = search.value;
        renderSubjects();
        renderGeneralSubjects();
      }, 160)
    );
    el("subjectGradeFilter").addEventListener("change", function (event) {
      state.subjectGradeId = event.target.value;
      loadSubjects();
    });
    el("resetSubjectFilters").addEventListener("click", function () {
      state.subjectGradeId = "";
      state.subjectSearch = "";
      search.value = "";
      populateSubjectGrades();
      loadSubjects();
      renderGeneralSubjects();
    });
    var schoolFilter = el("subjectSchoolFilter");
    if (schoolFilter) {
      schoolFilter.addEventListener("change", function () {
        state.schoolId = schoolFilter.value;
        state.subjectGradeId = "";
        L.clearCache();
        populateSubjectGrades();
        loadSubjects();
        populateAssignmentSections();
        populateAssignmentTeachers();
        loadAssignments();
      });
    }
    el("subjectTableBody").addEventListener("click", function (event) {
      var edit = event.target.closest("[data-edit-subject]");
      if (edit) {
        subjectModal(
          state.subjects.find(function (item) {
            return String(item.id) === edit.dataset.editSubject;
          })
        );
        return;
      }
      var remove = event.target.closest("[data-remove-subject]");
      if (remove) {
        removeSubject(
          state.subjects.find(function (item) {
            return String(item.id) === remove.dataset.removeSubject;
          })
        );
      }
    });
  }

  function wireAssignmentEvents() {
    el("assignmentYearFilter").addEventListener("change", function (event) {
      state.assignmentYearId = event.target.value;
      state.assignmentSectionId = "";
      populateAssignmentSections();
      loadAssignments();
    });
    el("assignmentSectionFilter").addEventListener("change", function (event) {
      state.assignmentSectionId = event.target.value;
      loadAssignments();
    });
    var teacherFilter = el("assignmentTeacherFilter");
    if (teacherFilter) {
      teacherFilter.addEventListener("change", function (event) {
        state.assignmentTeacherId = event.target.value;
        loadAssignments();
      });
    }
    var search = el("assignmentSearch");
    search.addEventListener(
      "input",
      window.UI.debounce(function () {
        state.assignmentSearch = search.value;
        renderAssignments();
      }, 160)
    );
    el("resetAssignmentFilters").addEventListener("click", function () {
      state.assignmentSectionId = "";
      state.assignmentTeacherId = "";
      state.assignmentSearch = "";
      search.value = "";
      el("assignmentSectionFilter").value = "";
      if (teacherFilter) {
        teacherFilter.value = "";
      }
      populateAssignmentSections();
      loadAssignments();
    });
    el("assignmentTableBody").addEventListener("click", function (event) {
      var schedule = event.target.closest("[data-schedule]");
      if (schedule) {
        scheduleModal(
          state.assignments.find(function (item) {
            return String(item.id) === schedule.dataset.schedule;
          })
        );
        return;
      }
      var edit = event.target.closest("[data-edit-assignment]");
      if (edit) {
        assignmentModal(
          state.assignments.find(function (item) {
            return String(item.id) === edit.dataset.editAssignment;
          })
        );
        return;
      }
      var remove = event.target.closest("[data-remove-assignment]");
      if (remove) {
        removeAssignment(
          state.assignments.find(function (item) {
            return String(item.id) === remove.dataset.removeAssignment;
          })
        );
      }
    });
  }

  function wireTimetableEvents() {
    el("timetableYearFilter").addEventListener("change", function (event) {
      state.timetableYearId = event.target.value;
      state.timetableSectionId = "";
      el("timetableSectionFilter").value = "";
      populateTimetableSections();
      loadTimetable();
    });
    el("timetableSectionFilter").addEventListener("change", function (event) {
      state.timetableSectionId = event.target.value;
      state.timetable = null;
      loadTimetable();
    });
    var schoolFilter = el("timetableSchoolFilter");
    if (schoolFilter) {
      schoolFilter.addEventListener("change", function () {
        state.timetableSchoolId = schoolFilter.value;
        state.timetableSectionId = "";
        populateTimetableSections();
        loadTimetable();
      });
    }
    el("printTimetableButton").addEventListener("click", printTimetable);
  }

  function init() {
    window.AppShell.init({
      page: "subjects",
      breadcrumbs: ["Subjects"]
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      var params = new URLSearchParams(window.location.search);
      var school = fixedSchool();
      if (school) {
        state.schoolId = school;
        state.timetableSchoolId = school;
      } else {
        el("subjectSchoolControl").classList.remove("d-none");
        el("timetableSchoolControl").classList.remove("d-none");
        if (params.get("schoolId")) {
          state.schoolId = params.get("schoolId");
          state.timetableSchoolId = params.get("schoolId");
        }
      }
      if (params.get("teacherId")) {
        state.assignmentTeacherId = params.get("teacherId");
      }
      if (params.get("sectionId")) {
        state.timetableSectionId = params.get("sectionId");
      }
      if (canManage()) {
        el("newSubjectButton").classList.remove("d-none");
        el("newAssignmentButton").classList.remove("d-none");
        el("newSubjectButton").addEventListener("click", function () {
          if (canManageOptions()) {
            generalSubjectModal();
          } else {
            subjectModal(null);
          }
        });
        el("newAssignmentButton").addEventListener("click", function () {
          assignmentModal(null);
        });
      }
      if (canManageOptions()) {
        el("generalSubjectCard").classList.remove("d-none");
        el("manageSubjectOptionsButton").addEventListener("click", openSubjectOptionsManager);
        refreshGeneralSubjects();
      } else {
        ensureSubjectOptions().catch(function () {
          return null;
        });
      }
      wireTabs();
      wireSubjectEvents();
      wireAssignmentEvents();
      wireTimetableEvents();
      Promise.all([
        populateYears(),
        L.schools().then(function () {
          if (!school) {
            return Promise.all([
              fillSchoolFilter(el("subjectSchoolFilter")),
              fillSchoolFilter(el("timetableSchoolFilter"))
            ]);
          }
          return null;
        })
      ])
        .then(function () {
          if (!school) {
            if (state.schoolId) {
              el("subjectSchoolFilter").value = state.schoolId;
            }
            if (state.timetableSchoolId) {
              el("timetableSchoolFilter").value = state.timetableSchoolId;
            }
          }
          return Promise.all([
            populateSubjectGrades(),
            populateAssignmentSections(),
            populateAssignmentTeachers(),
            populateTimetableSections()
          ]);
        })
        .then(function () {
          loadSubjects();
          loadAssignments();
          var tab = params.get("tab") || params.get("view");
          setTab(tab === "assignments" || tab === "timetable" ? tab : "subjects");
        });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
