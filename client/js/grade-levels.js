/* DepEd Learner Records — grade levels page */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var state = { session: null, grades: [], options: [], schoolId: "", search: "" };
  var formCounter = 0;

  function el(id) {
    return document.getElementById(id);
  }

  // The bundled Bootstrap build does not always emit hidden.bs.modal, so a
  // dynamic dialog can remain in the DOM after closing. Removing it keeps
  // repeated opens from leaving duplicate form IDs behind.
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

    // Watch after the opening transition has started, and only remove the
    // dialog once it has actually been visible, so a not-yet-shown dialog is
    // never mistaken for a closed one.
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

  // Each dialog gets its own field IDs so a dialog that is still fading out
  // can never capture the submit button of the next one.
  function nextFormKey(prefix) {
    formCounter += 1;
    return prefix + String(formCounter);
  }

  function canManage() {
    return Boolean(state.session && state.session.permissions.canManageAcademics);
  }

  function canManageOptions() {
    return Boolean(state.session && state.session.user.role === "system_admin");
  }

  function activeOptions() {
    return state.options.filter(function (option) {
      return option.isActive;
    });
  }

  function findOption(id) {
    return state.options.find(function (option) {
      return String(option.id) === String(id);
    });
  }

  function visibleGrades() {
    var query = state.search.trim().toLowerCase();
    if (!query) {
      return state.grades;
    }
    return state.grades.filter(function (grade) {
      return [grade.name, grade.schoolName].join(" ").toLowerCase().indexOf(query) !== -1;
    });
  }

  function render() {
    var body = el("gradeTableBody");
    var rows = visibleGrades();
    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="6" class="empty-cell">' +
        (state.search
          ? "No grade level matches your search."
          : "No school grade levels configured yet. Use New grade level to add the levels a school offers.") +
        "</td></tr>";
    } else {
      body.innerHTML = rows
        .map(function (grade) {
          return (
            "<tr><td><strong>" +
            L.esc(grade.name) +
            '</strong><span class="field-hint">Order ' +
            grade.sortOrder +
            "</span></td><td>" +
            L.esc(grade.schoolName || "—") +
            '</td><td class="text-right">' +
            grade.sortOrder +
            '</td><td class="text-right">' +
            window.UI.number(grade.sectionCount) +
            '</td><td class="text-right">' +
            window.UI.number(grade.learnerCount) +
            '</td><td><div class="row-actions">' +
            (canManage()
              ? '<button type="button" class="btn btn-light" data-edit="' +
                grade.id +
                '" title="Edit grade level"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>' +
                '<button type="button" class="btn btn-light" data-remove="' +
                grade.id +
                '" title="Remove grade level"><i class="bi bi-trash" aria-hidden="true"></i></button>'
              : '<span class="text-muted">—</span>') +
            "</div></td></tr>"
          );
        })
        .join("");
    }
    el("gradeTableMeta").textContent =
      rows.length +
      " grade level" +
      (rows.length === 1 ? "" : "s") +
      (state.search ? " matching your search" : " configured") +
      (state.schoolId ? " · filtered by school" : "");
  }

  function loadGrades() {
    var body = el("gradeTableBody");
    body.innerHTML = L.skeletonRows(6, 4);
    return L.apiGet("/academic/grade-levels", { schoolId: state.schoolId || undefined })
      .then(function (list) {
        state.grades = list || [];
        L.clearCache();
        render();
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        body.innerHTML = '<tr><td colspan="6" class="empty-cell">' + L.esc(L.friendlyError(error)) + "</td></tr>";
        el("gradeTableMeta").textContent = "Grade levels could not be loaded.";
      });
  }

  function loadOptions(includeInactive) {
    return L.apiGet(
      "/academic/grade-level-options",
      includeInactive ? { includeInactive: true } : undefined
    ).then(function (list) {
      state.options = list || [];
      return state.options;
    });
  }

  function ensureOptions() {
    if (state.options.length) {
      return Promise.resolve(state.options);
    }
    return loadOptions(false);
  }

  function visibleOptions() {
    var query = state.search.trim().toLowerCase();
    if (!query) {
      return state.options;
    }
    return state.options.filter(function (option) {
      return String(option.name).toLowerCase().indexOf(query) !== -1;
    });
  }

  function nextOptionOrder() {
    if (!state.options.length) {
      return 0;
    }
    return Math.min(
      100,
      state.options.reduce(function (max, option) {
        return Math.max(max, Number(option.sortOrder) || 0);
      }, 0) + 1
    );
  }

  function renderGeneral() {
    if (!canManageOptions()) {
      return;
    }
    var body = el("generalGradeTableBody");
    if (!body) {
      return;
    }
    var rows = visibleOptions();
    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="4" class="empty-cell">' +
        (state.search
          ? "No general grade level matches your search."
          : "No general grade levels yet. Use New grade level to add Kindergarten or Grade 1.") +
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
    el("generalGradeMeta").textContent =
      rows.length +
      " general grade level" +
      (rows.length === 1 ? "" : "s") +
      (state.search ? " matching your search" : " in the catalogue");
  }

  function refreshGeneral() {
    return loadOptions(true)
      .then(function () {
        renderGeneral();
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        el("generalGradeTableBody").innerHTML =
          '<tr><td colspan="4" class="empty-cell">' +
          L.esc(L.friendlyError(error)) +
          "</td></tr>";
        el("generalGradeMeta").textContent = "General grade levels could not be loaded.";
      });
  }

  // System administrators maintain the system-wide list. A general grade level
  // has no school: schools select it later from their own dropdown.
  function openGeneralGradeModal(option) {
    var editing = Boolean(option);
    var data = option || {};
    var formId = nextFormKey("generalGradeForm");
    var alertId = nextFormKey("generalGradeAlert");
    var nameId = nextFormKey("generalGradeName");
    var orderId = nextFormKey("generalGradeOrder");
    var buttonId = nextFormKey("saveGeneralGradeButton");
    var dialog = L.modal({
      title: editing ? "Edit general grade level" : "New grade level",
      eyebrow: "System administration",
      subtitle: editing
        ? "This changes the dropdown for future school grade levels. School records that already use the old name are never rewritten."
        : "This creates a general grade level. No school is assigned here; schools select it from their dropdown when they add their own grade level.",
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
        '">Grade level name <span class="required-mark">*</span></label>' +
        '<input class="form-control" id="' +
        nameId +
        '" name="name" required maxlength="32" placeholder="Kindergarten or Grade 7" value="' +
        L.esc(data.name || "") +
        '"><span class="field-hint">Examples: Kindergarten, Grade 1, Grade 12.</span><span class="field-error"></span></div></div>' +
        '<div class="col-sm-4"><div class="form-group"><label for="' +
        orderId +
        '">Sort order</label>' +
        '<input type="number" class="form-control" id="' +
        orderId +
        '" name="sortOrder" min="0" max="100" step="1" value="' +
        (data.sortOrder === undefined ? nextOptionOrder() : data.sortOrder) +
        '"><span class="field-hint">Kindergarten is usually 0. Lower numbers appear first.</span><span class="field-error"></span></div></div>' +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="submit" form="' +
        formId +
        '" class="btn btn-primary" id="' +
        buttonId +
        '">' +
        (editing ? "Save grade level" : "Create grade level") +
        "</button>"
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
        window.UI.fieldError(nameInput, "Enter a grade level name.");
        return;
      }
      var sortOrder = Number(values.sortOrder || 0);
      L.submit(
        form,
        button,
        alertBox,
        function () {
          var payload = {
            name: name,
            sortOrder: sortOrder,
            isActive: editing ? Boolean(data.isActive) : true
          };
          return editing
            ? API.put("/academic/grade-level-options/" + data.id, payload)
            : API.post("/academic/grade-level-options", payload);
        },
        function () {
          dialog.close();
          window.UI.toast(
            editing ? "General grade level updated" : "General grade level added",
            name,
            "success"
          );
          refreshGeneral();
        }
      );
    });
  }

  // Builds the administrator-managed dropdown. A legacy grade level whose
  // option was deactivated or predates the catalog stays selectable and is
  // marked "(current)" so an ordinary edit never forces a rename.
  function gradeOptionsFor(currentName) {
    var list = activeOptions().slice();
    if (
      currentName &&
      !list.some(function (option) {
        return String(option.name).toLowerCase() === String(currentName).toLowerCase();
      })
    ) {
      list.unshift({ name: currentName, sortOrder: null, legacy: true });
    }
    return list;
  }

  function gradeNameFieldHtml(currentName, selectedName, selectId) {
    var id = selectId || "gradeName";
    var list = gradeOptionsFor(currentName);
    if (!list.length) {
      return (
        '<select class="custom-select" id="' +
        id +
        '" name="name" disabled>' +
        '<option value="">No options available</option></select>' +
        '<span class="field-hint">The system administrator has not prepared any grade level options yet.</span>'
      );
    }
    var html =
      '<select class="custom-select" id="' +
      id +
      '" name="name" required>' +
      '<option value="">Select grade level</option>';
    list.forEach(function (option) {
      var hasSort = option.sortOrder !== null && option.sortOrder !== undefined;
      html +=
        '<option value="' +
        L.esc(option.name) +
        '"' +
        (hasSort ? ' data-sort="' + option.sortOrder + '"' : "") +
        (String(option.name) === String(selectedName) ? " selected" : "") +
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

  function openModal(grade) {
    ensureOptions()
      .catch(function () {
        return state.options;
      })
      .then(function () {
        var editing = Boolean(grade);
        var data = grade || {};
        var defaultOrder = 0;
        if (!editing && state.grades.length) {
          defaultOrder = Math.min(
            100,
            state.grades.reduce(function (max, item) {
              return Math.max(max, Number(item.sortOrder) || 0);
            }, 0) + 10
          );
        }
        var selectedName = editing ? data.name : "";
        var available = gradeOptionsFor(selectedName);
        var formId = nextFormKey("gradeForm");
        var alertId = nextFormKey("gradeFormAlert");
        var selectId = nextFormKey("gradeName");
        var orderId = nextFormKey("gradeOrder");
        var buttonId = nextFormKey("saveGradeButton");
        var dialog = L.modal({
          title: editing ? "Edit grade level" : "New grade level",
          eyebrow: "Academic structure",
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
            '<div class="col-sm-8"><div class="form-group"><label for="' +
            selectId +
            '">Grade level <span class="required-mark">*</span></label>' +
            gradeNameFieldHtml(selectedName, selectedName, selectId) +
            '<span class="field-error"></span></div></div>' +
            '<div class="col-sm-4"><div class="form-group"><label for="' +
            orderId +
            '">Sort order</label>' +
            '<input type="number" class="form-control" id="' +
            orderId +
            '" name="sortOrder" min="0" max="100" step="1" value="' +
            (data.sortOrder === undefined ? defaultOrder : data.sortOrder) +
            '"><span class="field-hint">Lower numbers appear first.</span><span class="field-error"></span></div></div>' +
            "</div></form>",
          footer:
            '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
            '<button type="submit" form="' +
            formId +
            '" class="btn btn-primary" id="' +
            buttonId +
            '">' +
            (editing ? "Save grade level" : "Create grade level") +
            "</button>"
        });
        ensureModalRemoval(dialog);
        var form = dialog.element.querySelector("#" + formId);
        var button = dialog.element.querySelector("#" + buttonId);
        var alertBox = dialog.element.querySelector("#" + alertId);
        var nameSelect = form.querySelector("#" + selectId);
        var orderInput = form.querySelector("#" + orderId);
        if (!editing) {
          L.fillSchoolSelect(form.querySelector("[data-school-select]"), state.schoolId);
        }
        if (!available.length) {
          button.disabled = true;
        }
        if (nameSelect && !nameSelect.disabled) {
          nameSelect.addEventListener("change", function () {
            var chosen = nameSelect.options[nameSelect.selectedIndex];
            if (chosen && chosen.dataset.sort !== undefined && chosen.dataset.sort !== "") {
              orderInput.value = chosen.dataset.sort;
            }
          });
        }
        form.addEventListener("submit", function (event) {
          event.preventDefault();
          var values = L.formValues(form);
          values.sortOrder = Number(values.sortOrder || 0);
          if (!values.name) {
            window.UI.fieldError(nameSelect, "Choose a grade level from the list.");
            return;
          }
          if (!editing && !values.schoolId) {
            window.UI.fieldError(form.querySelector("[name=schoolId]"), "Choose the school for this grade level.");
            return;
          }
          L.submit(
            form,
            button,
            alertBox,
            function () {
              return editing
                ? API.put("/academic/grade-levels/" + grade.id, {
                    name: values.name,
                    sortOrder: values.sortOrder
                  })
                : API.post("/academic/grade-levels", {
                    schoolId: values.schoolId,
                    name: values.name,
                    sortOrder: values.sortOrder
                  });
            },
            function () {
              dialog.close();
              window.UI.toast(
                editing ? "Grade level updated" : "Grade level created",
                values.name,
                "success"
              );
              loadGrades();
              if (canManageOptions()) {
                refreshGeneral();
              }
            }
          );
        });
      });
  }

  function removeGrade(grade) {
    window.UI.confirm({
      title: "Remove " + grade.name + "?",
      message:
        "Grade levels can only be removed when no sections or learner enrollments use them. Historical records are never deleted.",
      confirmLabel: "Remove grade level",
      tone: "danger"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      API.delete("/academic/grade-levels/" + grade.id)
        .then(function () {
          window.UI.toast("Grade level removed", grade.name + " was removed from " + (grade.schoolName || "the school") + ".", "success");
          loadGrades();
          if (canManageOptions()) {
            refreshGeneral();
          }
        })
        .catch(function (error) {
          window.UI.showAlert(el("gradePageAlert"), "danger", L.friendlyError(error), "Could not remove the grade level");
        });
    });
  }

  /* Administrator option manager ------------------------------------------- */

  function openOptionsManager() {
    loadOptions(true)
      .then(function () {
        var alertId = nextFormKey("optionManagerAlert");
        var formId = nextFormKey("optionForm");
        var nameId = nextFormKey("optionName");
        var orderId = nextFormKey("optionOrder");
        var buttonId = nextFormKey("saveOptionButton");
        var cancelId = nextFormKey("cancelOptionEdit");
        var tableId = nextFormKey("optionTableBody");
        var dialog = L.modal({
          title: "Grade level options",
          eyebrow: "System administration",
          subtitle:
            "Schools choose from these options when adding a grade level. Renaming an option never changes or removes grade levels that schools already configured.",
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
            '">Option name <span class="required-mark">*</span></label>' +
            '<input class="form-control" id="' +
            nameId +
            '" name="name" required maxlength="32" placeholder="Grade 7">' +
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
            '">Add option</button>' +
            '<button type="button" class="btn btn-link btn-sm btn-block d-none" id="' +
            cancelId +
            '">Cancel edit</button>' +
            "</div></div></form>" +
            '<div class="table-responsive"><table class="app-table" aria-label="Grade level options">' +
            '<thead><tr><th scope="col">Option</th><th scope="col" class="text-right">Order</th>' +
            '<th scope="col" class="text-right">Used by</th><th scope="col">Status</th>' +
            '<th scope="col" class="text-right">Actions</th></tr></thead>' +
            '<tbody id="' +
            tableId +
            '"></tbody></table></div>' +
            '<p class="field-hint mt-2 mb-0">Deactivate an option to keep it out of school dropdowns without affecting existing records. Options used by a school grade level cannot be removed.</p>',
          footer: '<button type="button" class="btn btn-light" data-dismiss="modal">Close</button>'
        });
        ensureModalRemoval(dialog, function () {
          refreshGeneral();
          loadGrades();
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
          return loadOptions(true).then(function () {
            renderOptions();
          });
        }

        function resetForm() {
          editingOptionId = null;
          form.reset();
          orderInput.value = 0;
          saveButton.textContent = "Add option";
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
          if (!state.options.length) {
            tableBody.innerHTML =
              '<tr><td colspan="5" class="empty-cell">No options yet. Add the first grade level option above.</td></tr>';
            return;
          }
          tableBody.innerHTML = state.options
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
                '<button type="button" class="btn btn-light" data-option-edit="' +
                option.id +
                '" title="Edit option"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>' +
                '<button type="button" class="btn btn-light" data-option-toggle="' +
                option.id +
                '" title="' +
                (option.isActive ? "Deactivate option" : "Reactivate option") +
                '"><i class="bi ' +
                (option.isActive ? "bi-pause-circle" : "bi-play-circle") +
                '" aria-hidden="true"></i></button>' +
                '<button type="button" class="btn btn-light" data-option-remove="' +
                option.id +
                '" title="' +
                (inUse ? "Used by a school grade level" : "Remove option") +
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
            window.UI.fieldError(nameInput, "Enter an option name.");
            return;
          }
          var editing = editingOptionId
            ? findOption(editingOptionId)
            : null;
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
                ? API.put("/academic/grade-level-options/" + editingOptionId, payload)
                : API.post("/academic/grade-level-options", payload);
            },
            function () {
              window.UI.toast(
                editingOptionId ? "Option updated" : "Option added",
                name,
                "success"
              );
              resetForm();
              refresh().then(function () {
                loadGrades();
              });
            }
          );
        });

        tableBody.addEventListener("click", function (event) {
          var edit = event.target.closest("[data-option-edit]");
          if (edit) {
            var option = findOption(edit.dataset.optionEdit);
            if (option) {
              startEdit(option);
            }
            return;
          }
          var toggle = event.target.closest("[data-option-toggle]");
          if (toggle) {
            var target = findOption(toggle.dataset.optionToggle);
            if (!target) {
              return;
            }
            API.put("/academic/grade-level-options/" + target.id, {
              name: target.name,
              sortOrder: target.sortOrder,
              isActive: !target.isActive
            })
              .then(function () {
                window.UI.toast(
                  target.isActive ? "Option deactivated" : "Option reactivated",
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
          var remove = event.target.closest("[data-option-remove]");
          if (remove) {
            var removable = findOption(remove.dataset.optionRemove);
            if (!removable) {
              return;
            }
            window.UI.confirm({
              title: "Remove " + removable.name + "?",
              message:
                "Removing an option only affects future dropdown choices. Options used by a school grade level cannot be removed; deactivate them instead.",
              confirmLabel: "Remove option",
              tone: "danger"
            }).then(function (confirmed) {
              if (!confirmed) {
                return;
              }
              API.delete("/academic/grade-level-options/" + removable.id)
                .then(function () {
                  window.UI.toast("Option removed", removable.name, "success");
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
          el("gradePageAlert"),
          "danger",
          L.friendlyError(error),
          "Could not load grade level options"
        );
      });
  }

  function wireFilters() {
    var search = el("gradeSearch");
    search.addEventListener(
      "input",
      window.UI.debounce(function () {
        state.search = search.value;
        render();
        renderGeneral();
      }, 180)
    );
    el("resetGradeSearch").addEventListener("click", function () {
      state.search = "";
      search.value = "";
      render();
      renderGeneral();
    });
    var schoolFilter = el("gradeSchoolFilter");
    if (schoolFilter) {
      schoolFilter.addEventListener("change", function () {
        state.schoolId = schoolFilter.value;
        loadGrades();
      });
    }
  }

  function init() {
    window.AppShell.init({
      page: "grade-levels",
      breadcrumbs: ["Grade Levels"]
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      state.schoolId = L.schoolId() ? String(L.schoolId()) : "";
      if (!L.schoolId()) {
        el("gradeSchoolControl").classList.remove("d-none");
        L.fillSchoolSelect(el("gradeSchoolFilter"), "");
      }
      if (canManage()) {
        el("newGradeButton").classList.remove("d-none");
        el("newGradeButton").addEventListener("click", function () {
          if (canManageOptions()) {
            openGeneralGradeModal(null);
          } else {
            openModal(null);
          }
        });
      }
      if (canManageOptions()) {
        el("generalGradeCard").classList.remove("d-none");
        el("manageOptionsButton").addEventListener("click", openOptionsManager);
      }
      el("gradeTableBody").addEventListener("click", function (event) {
        var edit = event.target.closest("[data-edit]");
        if (edit) {
          openModal(
            state.grades.find(function (item) {
              return String(item.id) === edit.dataset.edit;
            })
          );
          return;
        }
        var remove = event.target.closest("[data-remove]");
        if (remove) {
          removeGrade(
            state.grades.find(function (item) {
              return String(item.id) === remove.dataset.remove;
            })
          );
        }
      });
      wireFilters();
      if (canManageOptions()) {
        refreshGeneral();
      } else {
        loadOptions(false).catch(function () {
          return null;
        });
      }
      loadGrades();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
