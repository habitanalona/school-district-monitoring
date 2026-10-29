/* DepEd Learner Records — grade levels page */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var state = { session: null, grades: [], schoolId: "", search: "" };

  function el(id) {
    return document.getElementById(id);
  }

  function canManage() {
    return Boolean(state.session && state.session.permissions.canManageAcademics);
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
          : "No grade levels configured yet. Add the levels offered by each school.") +
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
    L.apiGet("/academic/grade-levels", { schoolId: state.schoolId || undefined })
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

  function openModal(grade) {
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
    var dialog = L.modal({
      title: editing ? "Edit grade level" : "New grade level",
      eyebrow: "Academic structure",
      body:
        '<form id="gradeForm" novalidate>' +
        '<div id="gradeFormAlert" class="d-none mb-3" role="alert"></div>' +
        (editing
          ? '<div class="form-group"><label>School</label><input class="form-control" value="' +
            L.esc(data.schoolName || "") +
            '" readonly></div>'
          : L.schoolFieldHtml(state.schoolId)) +
        '<div class="form-row">' +
        '<div class="col-sm-8"><div class="form-group"><label for="gradeName">Grade level <span class="required-mark">*</span></label>' +
        '<input class="form-control" id="gradeName" name="name" required maxlength="32" placeholder="Grade 7" value="' +
        L.esc(data.name || "") +
        '"><span class="field-error"></span></div></div>' +
        '<div class="col-sm-4"><div class="form-group"><label for="gradeOrder">Sort order</label>' +
        '<input type="number" class="form-control" id="gradeOrder" name="sortOrder" min="0" max="100" step="1" value="' +
        (data.sortOrder === undefined ? defaultOrder : data.sortOrder) +
        '"><span class="field-hint">Lower numbers appear first.</span><span class="field-error"></span></div></div>' +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="submit" form="gradeForm" class="btn btn-primary" id="saveGradeButton">' +
        (editing ? "Save grade level" : "Create grade level") +
        "</button>"
    });
    var form = dialog.element.querySelector("#gradeForm");
    var button = dialog.element.querySelector("#saveGradeButton");
    var alertBox = dialog.element.querySelector("#gradeFormAlert");
    if (!editing) {
      L.fillSchoolSelect(form.querySelector("[data-school-select]"), state.schoolId);
    }
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var values = L.formValues(form);
      values.sortOrder = Number(values.sortOrder || 0);
      if (!values.name || !values.name.trim()) {
        window.UI.fieldError(form.querySelector("#gradeName"), "Enter the grade level name.");
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
                name: values.name.trim(),
                sortOrder: values.sortOrder
              })
            : API.post("/academic/grade-levels", {
                schoolId: values.schoolId,
                name: values.name.trim(),
                sortOrder: values.sortOrder
              });
        },
        function () {
          dialog.close();
          window.UI.toast(
            editing ? "Grade level updated" : "Grade level created",
            values.name.trim(),
            "success"
          );
          loadGrades();
        }
      );
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
        })
        .catch(function (error) {
          window.UI.showAlert(el("gradePageAlert"), "danger", L.friendlyError(error), "Could not remove the grade level");
        });
    });
  }

  function wireFilters() {
    var search = el("gradeSearch");
    search.addEventListener(
      "input",
      window.UI.debounce(function () {
        state.search = search.value;
        render();
      }, 180)
    );
    el("resetGradeSearch").addEventListener("click", function () {
      state.search = "";
      search.value = "";
      render();
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
          openModal(null);
        });
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
      loadGrades();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
