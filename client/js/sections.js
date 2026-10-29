/* DepEd Learner Records — sections and advisers page */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var state = {
    session: null,
    sections: [],
    years: [],
    schoolId: "",
    yearId: "",
    gradeLevelId: "",
    search: ""
  };

  function el(id) {
    return document.getElementById(id);
  }

  function canManage() {
    return Boolean(state.session && state.session.permissions.canManageAcademics);
  }

  function filtered() {
    var query = state.search.trim().toLowerCase();
    if (!query) {
      return state.sections;
    }
    return state.sections.filter(function (section) {
      return [
        section.name,
        section.gradeLevel,
        section.adviserName,
        section.room,
        section.schoolName
      ]
        .join(" ")
        .toLowerCase()
        .indexOf(query) !== -1;
    });
  }

  function render() {
    var rows = filtered();
    var body = el("sectionTableBody");
    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="7" class="empty-cell">' +
        (state.search
          ? "No section matches your search."
          : "No sections for this filter yet. Create a section or copy the prior-year structure.") +
        "</td></tr>";
    } else {
      body.innerHTML = rows
        .map(function (section) {
          return (
            "<tr><td><strong>" +
            L.esc(section.name) +
            "</strong>" +
            (section.schoolYearName ? '<span class="field-hint">' + L.esc(section.schoolYearName) + "</span>" : "") +
            "</td><td>" +
            L.esc(section.gradeLevel || "—") +
            "</td><td>" +
            L.esc(section.schoolName || "—") +
            "</td><td>" +
            (section.adviserName
              ? L.esc(section.adviserName)
              : '<span class="text-muted">No adviser</span>') +
            "</td><td>" +
            L.esc(section.room || "—") +
            '</td><td class="text-right">' +
            window.UI.number(section.learnerCount) +
            '</td><td><div class="row-actions">' +
            '<a class="btn btn-light" href="learners.html?sectionId=' +
            section.id +
            "&schoolYearId=" +
            section.schoolYearId +
            "&gradeLevelId=" +
            section.gradeLevelId +
            '" title="Open class roster"><i class="bi bi-people" aria-hidden="true"></i></a>' +
            (canManage()
              ? '<button type="button" class="btn btn-light" data-edit="' +
                section.id +
                '" title="Edit section"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>' +
                '<button type="button" class="btn btn-light" data-remove="' +
                section.id +
                '" title="Remove section"><i class="bi bi-trash" aria-hidden="true"></i></button>'
              : "") +
            "</div></td></tr>"
          );
        })
        .join("");
    }
    var year = state.years.find(function (item) {
      return String(item.id) === String(state.yearId);
    });
    el("sectionTableMeta").textContent =
      rows.length +
      " section" +
      (rows.length === 1 ? "" : "s") +
      (year ? " · " + year.name : "") +
      (state.search ? " matching your search" : "");
  }

  function loadSections() {
    var body = el("sectionTableBody");
    body.innerHTML = L.skeletonRows(7, 4);
    L.apiGet("/academic/sections", {
      schoolId: state.schoolId || undefined,
      schoolYearId: state.yearId || undefined,
      gradeLevelId: state.gradeLevelId || undefined
    })
      .then(function (list) {
        state.sections = list || [];
        L.clearCache();
        render();
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        body.innerHTML = '<tr><td colspan="7" class="empty-cell">' + L.esc(L.friendlyError(error)) + "</td></tr>";
        el("sectionTableMeta").textContent = "Sections could not be loaded.";
      });
  }

  function populateYears() {
    return L.years().then(function (years) {
      state.years = years || [];
      el("sectionYearFilter").innerHTML = L.yearOptions(state.years, state.yearId, "All school years");
      var current = state.years.find(function (year) {
        return year.isCurrent;
      });
      if (!state.yearId) {
        state.yearId = current ? String(current.id) : state.years[0] ? String(state.years[0].id) : "";
        el("sectionYearFilter").value = state.yearId;
      }
    });
  }

  function populateGrades() {
    return L.grades(state.schoolId || undefined).then(function (grades) {
      el("sectionGradeFilter").innerHTML = L.gradeOptions(grades, state.gradeLevelId, "All grade levels");
      return grades;
    });
  }

  function populateSchoolFilter() {
    if (L.schoolId()) {
      state.schoolId = String(L.schoolId());
      return Promise.resolve();
    }
    el("sectionSchoolControl").classList.remove("d-none");
    var select = el("sectionSchoolFilter");
    return L.schools().then(function (list) {
      var html = ['<option value="">All schools</option>'];
      list.forEach(function (school) {
        html.push(
          '<option value="' + school.id + '">' + L.esc(school.name) + " (" + L.esc(school.code) + ")</option>"
        );
      });
      select.innerHTML = html.join("");
    });
  }

  function sectionModal(section) {
    var editing = Boolean(section);
    var data = section || {};
    var dialog = L.modal({
      title: editing ? "Edit section" : "New section",
      eyebrow: "Academic structure",
      size: "modal-lg",
      body:
        '<form id="sectionForm" novalidate>' +
        '<div id="sectionFormAlert" class="d-none mb-3" role="alert"></div>' +
        (editing
          ? '<div class="form-group"><label>School</label><input class="form-control" value="' +
            L.esc(data.schoolName || "") +
            '" readonly></div>'
          : L.schoolFieldHtml(state.schoolId)) +
        '<div class="form-row">' +
        '<div class="col-md-4"><div class="form-group"><label for="sectionYear">School year <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="sectionYear" name="schoolYearId" required' +
        (editing ? " disabled" : "") +
        ">" +
        L.yearOptions(state.years, data.schoolYearId || state.yearId, "Select school year") +
        "</select>" +
        (editing
          ? '<input type="hidden" name="schoolYearId" value="' + data.schoolYearId + '">'
          : "") +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="sectionGrade">Grade level <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="sectionGrade" name="gradeLevelId" required><option value="">Loading grade levels…</option></select>' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="sectionName">Section name <span class="required-mark">*</span></label>' +
        '<input class="form-control" id="sectionName" name="name" required maxlength="64" placeholder="Section A" value="' +
        L.esc(data.name || "") +
        '"><span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="sectionAdviser">Adviser</label>' +
        '<select class="custom-select" id="sectionAdviser" name="adviserId"><option value="">Not assigned</option></select>' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="sectionRoom">Room</label>' +
        '<input class="form-control" id="sectionRoom" name="room" maxlength="64" placeholder="Room 201" value="' +
        L.esc(data.room || "") +
        '"><span class="field-error"></span></div></div>' +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="submit" form="sectionForm" class="btn btn-primary" id="saveSectionButton">' +
        (editing ? "Save section" : "Create section") +
        "</button>"
    });
    var form = dialog.element.querySelector("#sectionForm");
    var button = dialog.element.querySelector("#saveSectionButton");
    var alertBox = dialog.element.querySelector("#sectionFormAlert");
    var gradeSelect = form.querySelector("#sectionGrade");
    var adviserSelect = form.querySelector("#sectionAdviser");
    var schoolSelect = form.querySelector("[data-school-select]");

    if (schoolSelect) {
      L.fillSchoolSelect(schoolSelect, state.schoolId || data.schoolId);
    }

    function schoolValue() {
      return schoolSelect ? schoolSelect.value : String(data.schoolId || L.schoolId() || "");
    }

    function loadSchoolOptions() {
      var school = schoolValue();
      if (!school) {
        gradeSelect.innerHTML = '<option value="">Select a school first</option>';
        adviserSelect.innerHTML = '<option value="">Not assigned</option>';
        return;
      }
      L.grades(school).then(function (grades) {
        gradeSelect.innerHTML = L.gradeOptions(grades, data.gradeLevelId, "Select grade level");
      });
      L.teachers(school).then(function (teachers) {
        adviserSelect.innerHTML = L.teacherOptions(teachers, data.adviserId);
      });
    }

    if (schoolSelect) {
      schoolSelect.addEventListener("change", function () {
        data.gradeLevelId = null;
        data.adviserId = null;
        loadSchoolOptions();
      });
    }
    loadSchoolOptions();

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var values = L.formValues(form);
      if (!values.schoolYearId || !values.gradeLevelId || !values.name.trim()) {
        window.UI.showAlert(alertBox, "warning", "Choose the school year and grade level, then name the section.", "Missing details");
        return;
      }
      if (!editing && !values.schoolId) {
        window.UI.fieldError(form.querySelector("[name=schoolId]"), "Choose the school for this section.");
        return;
      }
      var payload = {
        schoolId: editing ? undefined : values.schoolId,
        schoolYearId: values.schoolYearId,
        gradeLevelId: values.gradeLevelId,
        name: values.name.trim(),
        adviserId: values.adviserId || null,
        room: values.room.trim()
      };
      L.submit(
        form,
        button,
        alertBox,
        function () {
          return editing
            ? API.put("/academic/sections/" + section.id, payload)
            : API.post("/academic/sections", payload);
        },
        function () {
          dialog.close();
          L.clearCache();
          var year = state.years.find(function (item) {
            return String(item.id) === String(payload.schoolYearId);
          });
          window.UI.toast(
            editing ? "Section updated" : "Section created",
            payload.name + (year ? " · " + year.name : ""),
            "success"
          );
          loadSections();
        }
      );
    });
  }

  function removeSection(section) {
    window.UI.confirm({
      title: "Remove " + section.name + "?",
      message:
        "Sections with learners or teaching assignments cannot be removed. Historical enrollments are preserved even when sections change.",
      confirmLabel: "Remove section",
      tone: "danger"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      API.delete("/academic/sections/" + section.id)
        .then(function () {
          window.UI.toast("Section removed", section.name + " was removed.", "success");
          loadSections();
        })
        .catch(function (error) {
          window.UI.showAlert(el("sectionPageAlert"), "danger", L.friendlyError(error), "Could not remove the section");
        });
    });
  }

  function wireFilters() {
    var search = el("sectionSearch");
    search.addEventListener(
      "input",
      window.UI.debounce(function () {
        state.search = search.value;
        render();
      }, 180)
    );
    el("sectionYearFilter").addEventListener("change", function (event) {
      state.yearId = event.target.value;
      loadSections();
    });
    el("sectionGradeFilter").addEventListener("change", function (event) {
      state.gradeLevelId = event.target.value;
      loadSections();
    });
    var schoolFilter = el("sectionSchoolFilter");
    if (schoolFilter) {
      schoolFilter.addEventListener("change", function () {
        state.schoolId = schoolFilter.value;
        state.gradeLevelId = "";
        populateGrades().then(loadSections);
      });
    }
    el("resetSectionFilters").addEventListener("click", function () {
      state.gradeLevelId = "";
      state.search = "";
      search.value = "";
      el("sectionGradeFilter").value = "";
      populateGrades();
      loadSections();
    });
  }

  function init() {
    window.AppShell.init({
      page: "sections",
      breadcrumbs: ["Sections"]
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      if (canManage()) {
        el("newSectionButton").classList.remove("d-none");
        el("newSectionButton").addEventListener("click", function () {
          sectionModal(null);
        });
      }
      el("sectionTableBody").addEventListener("click", function (event) {
        var edit = event.target.closest("[data-edit]");
        if (edit) {
          sectionModal(
            state.sections.find(function (item) {
              return String(item.id) === edit.dataset.edit;
            })
          );
          return;
        }
        var remove = event.target.closest("[data-remove]");
        if (remove) {
          removeSection(
            state.sections.find(function (item) {
              return String(item.id) === remove.dataset.remove;
            })
          );
        }
      });
      wireFilters();
      populateSchoolFilter()
        .then(populateYears)
        .then(function () {
          return populateGrades();
        })
        .then(loadSections);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
