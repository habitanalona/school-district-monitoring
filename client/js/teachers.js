/* DepEd Learner Records — teaching personnel page */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var state = { session: null, schoolId: "", teachers: [], search: "", role: "" };

  function el(id) {
    return document.getElementById(id);
  }

  function render() {
    var query = state.search.trim().toLowerCase();
    var rows = state.teachers.filter(function (teacher) {
      if (state.role && teacher.role !== state.role) {
        return false;
      }
      return (
        !query ||
        [teacher.fullName, teacher.email, teacher.employeeNumber, teacher.username]
          .join(" ")
          .toLowerCase()
          .indexOf(query) !== -1
      );
    });
    var body = el("teacherTableBody");
    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="6" class="empty-cell">' +
        (state.search || state.role
          ? "No teacher matches your filter."
          : "No teaching personnel are registered for this school yet.") +
        "</td></tr>";
    } else {
      body.innerHTML = rows
        .map(function (teacher) {
          var roleMeta = window.UI.ROLE[teacher.role] || { label: window.UI.titleCase(teacher.role) };
          return (
            "<tr><td><div class=\"learner-table-name\"><span class=\"avatar\">" +
            L.esc(window.UI.initials(teacher.fullName)) +
            "</span><span><strong>" +
            L.esc(teacher.fullName) +
            "</strong><small>" +
            L.esc(teacher.username) +
            "</small></span></div></td><td>" +
            L.esc(roleMeta.label || teacher.role) +
            "</td><td>" +
            L.esc(teacher.employeeNumber || "—") +
            "</td><td>" +
            L.esc(teacher.email || "—") +
            '</td><td class="text-right">' +
            window.UI.number(teacher.assignmentCount) +
            '</td><td><div class="row-actions">' +
            '<a class="btn btn-light" href="subjects.html?tab=assignments' +
            (state.schoolId ? "&schoolId=" + state.schoolId : "") +
            "&teacherId=" +
            teacher.id +
            '" title="View teaching assignments"><i class="bi bi-person-workspace" aria-hidden="true"></i></a>' +
            "</div></td></tr>"
          );
        })
        .join("");
    }
    var totalAssignments = rows.reduce(function (sum, teacher) {
      return sum + Number(teacher.assignmentCount || 0);
    }, 0);
    el("teacherTableMeta").textContent =
      rows.length +
      " teaching personnel · " +
      totalAssignments +
      " assignment" +
      (totalAssignments === 1 ? "" : "s") +
      (state.search || state.role ? " · filtered" : "");
  }

  function loadTeachers() {
    if (!state.schoolId) {
      el("teacherTableBody").innerHTML =
        '<tr><td colspan="6" class="empty-cell">Choose a school to view its teaching personnel.</td></tr>';
      el("teacherTableMeta").textContent = "No school selected.";
      return;
    }
    el("teacherTableBody").innerHTML = L.skeletonRows(6, 4);
    L.apiGet("/academic/teachers", { schoolId: state.schoolId })
      .then(function (list) {
        state.teachers = list || [];
        render();
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        el("teacherTableBody").innerHTML =
          '<tr><td colspan="6" class="empty-cell">' + L.esc(L.friendlyError(error)) + "</td></tr>";
        el("teacherTableMeta").textContent = "Teaching personnel could not be loaded.";
      });
  }

  function populateSchool() {
    var fixed = L.schoolId();
    if (fixed) {
      state.schoolId = String(fixed);
      return Promise.resolve();
    }
    el("teacherSchoolControl").classList.remove("d-none");
    var select = el("teacherSchoolFilter");
    return L.schools().then(function (list) {
      var html = ['<option value="">Select a school</option>'];
      list.forEach(function (school) {
        html.push(
          '<option value="' + school.id + '">' + L.esc(school.name) + " (" + L.esc(school.code) + ")</option>"
        );
      });
      select.innerHTML = html.join("");
      if (list.length) {
        state.schoolId = String(list[0].id);
        select.value = state.schoolId;
      }
    });
  }

  function wireFilters() {
    var search = el("teacherSearch");
    search.addEventListener(
      "input",
      window.UI.debounce(function () {
        state.search = search.value;
        render();
      }, 160)
    );
    el("teacherRoleFilter").addEventListener("change", function (event) {
      state.role = event.target.value;
      render();
    });
    el("resetTeacherFilters").addEventListener("click", function () {
      state.search = "";
      state.role = "";
      search.value = "";
      el("teacherRoleFilter").value = "";
      render();
    });
    var schoolFilter = el("teacherSchoolFilter");
    if (schoolFilter) {
      schoolFilter.addEventListener("change", function () {
        state.schoolId = schoolFilter.value;
        loadTeachers();
      });
    }
  }

  function init() {
    window.AppShell.init({
      page: "teachers",
      breadcrumbs: ["Teachers"]
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      wireFilters();
      populateSchool().then(loadTeachers);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
