/* Subject-period attendance, configurable periods, and reporting terms */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var F = window.FormsUI;

  var STATUS = {
    present: { short: "P", label: "Present" },
    absent: { short: "A", label: "Absent" },
    tardy: { short: "T", label: "Tardy" },
    excused: { short: "E", label: "Excused" }
  };

  var DAY_TYPE = {
    school_day: "School day",
    holiday: "Holiday",
    suspension: "Suspension",
    no_class: "No class",
    orientation: "Orientation"
  };

  var TERM_TONE = {
    draft: { label: "Draft", tone: "warning" },
    approved: { label: "Approved", tone: "success" }
  };

  var KEY_LETTER = { p: "present", a: "absent", t: "tardy", e: "excused" };

  var state = {
    session: null,
    yearId: "",
    sectionId: "",
    schoolId: "",
    loads: [],
    loadKey: "",
    matrix: null,
    date: F.todayIso(),
    mode: "week",
    dirty: {},
    activeTab: "",
    periodRows: [],
    periodData: null,
    terms: null,
    schools: [],
    requestedSubjectId: "",
    requestedAssignmentId: "",
    booted: false
  };

  function el(id) {
    return document.getElementById(id);
  }

  function currentLoad() {
    return state.loads.find(function (load) {
      return String(load.assignmentId) === String(state.loadKey);
    }) || null;
  }

  function currentSchoolId() {
    var select = el("attendanceSchoolFilter");
    if (select && select.value) {
      return String(select.value);
    }
    if (state.matrix && state.matrix.section) {
      return String(state.matrix.section.schoolId);
    }
    if (state.loads.length) {
      return String(state.loads[0].schoolId);
    }
    return L.schoolId() ? String(L.schoolId()) : "";
  }

  function schoolCode(schoolId) {
    var found = state.schools.find(function (school) {
      return String(school.id) === String(schoolId);
    });
    return found && found.code ? found.code : "";
  }

  function schoolLabel(schoolId) {
    var load = currentLoad();
    var name = load ? load.schoolName : "";
    var code = schoolCode(schoolId);
    if (name && code) {
      return name + " · " + code;
    }
    if (name) {
      return name + " · #" + schoolId;
    }
    return code || "#" + schoolId;
  }

  function shiftDate(iso, days) {
    var parts = String(iso).split("-");
    if (parts.length !== 3) {
      return iso;
    }
    var current = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    current.setDate(current.getDate() + days);
    var month = String(current.getMonth() + 1).padStart(2, "0");
    var day = String(current.getDate()).padStart(2, "0");
    return current.getFullYear() + "-" + month + "-" + day;
  }

  function addMinutes(value, minutes) {
    var parts = String(value || "07:30").split(":");
    var hours = Number(parts[0]);
    var mins = Number(parts[1]);
    if (Number.isNaN(hours) || Number.isNaN(mins)) {
      hours = 7;
      mins = 30;
    }
    var total = hours * 60 + mins + minutes;
    var nextHours = Math.floor(total / 60) % 24;
    var nextMins = total % 60;
    return String(nextHours).padStart(2, "0") + ":" + String(nextMins).padStart(2, "0");
  }

  function emptyRow(columns, message) {
    return '<tr><td colspan="' + columns + '" class="empty-cell">' + F.esc(message) + "</td></tr>";
  }

  function alertBox(id, tone, message, title) {
    F.pageAlert(id, tone, message, title);
  }

  function statusClass(status) {
    return status ? " status-" + status : "";
  }

  function cellKey(date, periodNo) {
    return date + "|" + periodNo;
  }

  function dirtyKey(enrollmentId, date, periodNo) {
    return enrollmentId + "|" + date + "|" + periodNo;
  }

  function recordFor(learner, date, periodNo) {
    var key = cellKey(date, periodNo);
    var dirty = state.dirty[dirtyKey(learner.enrollmentId, date, periodNo)];
    if (dirty) {
      return dirty.status;
    }
    return learner.cells[key] ? learner.cells[key].status : "";
  }

  function savedStatus(learner, date, periodNo) {
    var cell = learner.cells[cellKey(date, periodNo)];
    return cell ? cell.status : "";
  }

  /* ---------------------------------------------------------------------- */
  /* Filter plumbing                                                        */
  /* ---------------------------------------------------------------------- */

  function filtersChanged(yearId, sectionId, schoolId) {
    var changedYear = String(yearId || "") !== state.yearId;
    state.yearId = String(yearId || "");
    state.sectionId = String(sectionId || "");
    state.schoolId = schoolId ? String(schoolId) : "";
    if (changedYear) {
      state.loads = [];
      state.loadKey = "";
      state.matrix = null;
      state.dirty = {};
    }
    if (!state.booted) {
      return;
    }
    if (state.activeTab === "subject") {
      loadLoads(true);
    } else if (state.activeTab === "periods") {
      loadPeriodScopes();
    } else if (state.activeTab === "terms") {
      loadTerms();
    }
  }

  function refresh(tab) {
    state.activeTab = tab;
    if (!state.booted) {
      return;
    }
    if (tab === "subject") {
      loadLoads(false);
    } else if (tab === "periods") {
      loadPeriodScopes();
    } else if (tab === "terms") {
      loadTerms();
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Teaching loads and matrix                                              */
  /* ---------------------------------------------------------------------- */

  function loadLoads(force) {
    if (!state.yearId) {
      el("subjectMeta").textContent = "Select a school year to load subject attendance.";
      return Promise.resolve();
    }
    if (!force && state.loads.length) {
      populateLoads();
      return ensureMatrix();
    }
    var select = el("subjectLoadFilter");
    select.innerHTML = '<option value="">Loading teaching loads…</option>';
    return L.apiGet("/attendance/teacher-loads", {
      schoolYearId: state.yearId,
      schoolId: state.schoolId || undefined
    })
      .then(function (payload) {
        state.loads = (payload && payload.loads) || [];
        if (state.sectionId) {
          state.loads = state.loads.filter(function (load) {
            return String(load.sectionId) === String(state.sectionId);
          });
        }
        populateLoads();
        return ensureMatrix();
      })
      .catch(function (error) {
        if (error.status === 401) return;
        state.loads = [];
        select.innerHTML = '<option value="">Teaching loads unavailable</option>';
        el("subjectMatrixHead").innerHTML = "";
        el("subjectMatrixBody").innerHTML = emptyRow(5, L.friendlyError(error));
        el("subjectMatrixFoot").innerHTML = "";
        alertBox("subjectAlert", "danger", L.friendlyError(error), "Could not load subject attendance");
      });
  }

  function populateLoads() {
    var select = el("subjectLoadFilter");
    var current = state.loadKey;
    if (!state.loads.length) {
      select.innerHTML = '<option value="">No subject assignments for this section and school year</option>';
      state.loadKey = "";
      return;
    }
    var groups = {};
    var order = [];
    state.loads.forEach(function (load) {
      var group = load.sectionName + " · " + load.gradeLevelName;
      if (!groups[group]) {
        groups[group] = [];
        order.push(group);
      }
      groups[group].push(load);
    });
    var html = ['<option value="">Select a subject and section</option>'];
    order.forEach(function (group) {
      html.push('<optgroup label="' + F.esc(group) + '">');
      groups[group].forEach(function (load) {
        html.push(
          L.option(
            load.assignmentId,
            load.subjectName + (load.subjectCode ? " (" + load.subjectCode + ")" : "") +
              " · " + (load.teacherName || "No teacher assigned")
          )
        );
      });
      html.push("</optgroup>");
    });
    select.innerHTML = html.join("");

    var requested = state.requestedAssignmentId;
    var byRequest = requested
      ? state.loads.find(function (load) { return String(load.assignmentId) === String(requested); })
      : null;
    var bySubject = state.requestedSubjectId
      ? state.loads.find(function (load) { return String(load.subjectId) === String(state.requestedSubjectId); })
      : null;
    var selected = byRequest || bySubject || state.loads.find(function (load) {
      return String(load.assignmentId) === String(current);
    }) || state.loads[0];
    state.requestedAssignmentId = "";
    state.requestedSubjectId = "";
    state.loadKey = String(selected.assignmentId);
    select.value = state.loadKey;
  }

  function ensureMatrix() {
    if (!state.loadKey) {
      state.matrix = null;
      renderScope();
      renderMatrixEmpty("Choose a teaching load to load the matrix.");
      return Promise.resolve();
    }
    return loadMatrix();
  }

  function loadMatrix() {
    var load = currentLoad();
    if (!load) {
      renderMatrixEmpty("Choose a teaching load to load the matrix.");
      return Promise.resolve();
    }
    el("subjectMatrixBody").innerHTML = L.skeletonRows(5, 6);
    el("subjectMatrixHead").innerHTML = "";
    el("subjectMatrixFoot").innerHTML = "";
    hideWarning();
    el("subjectMeta").textContent = "Loading the subject attendance matrix…";
    return L.apiGet("/attendance/subject/matrix", {
      sectionId: load.sectionId,
      schoolYearId: state.yearId,
      subjectId: load.subjectId,
      assignmentId: load.assignmentId,
      date: state.date,
      mode: state.mode
    })
      .then(function (matrix) {
        state.matrix = matrix;
        state.dirty = {};
        state.schoolId = String(matrix.section.schoolId);
        state.date = state.mode === "day" ? matrix.weekStart : state.date;
        renderScope();
        renderMatrix();
      })
      .catch(function (error) {
        if (error.status === 401) return;
        state.matrix = null;
        el("subjectMatrixHead").innerHTML = "";
        el("subjectMatrixBody").innerHTML = emptyRow(5, L.friendlyError(error));
        el("subjectMatrixFoot").innerHTML = "";
        el("subjectMeta").textContent = "The matrix could not be loaded.";
        alertBox("subjectAlert", "danger", L.friendlyError(error), "Could not load the subject matrix");
      });
  }

  function renderScope() {
    var matrix = state.matrix;
    var load = currentLoad();
    if (!matrix) {
      ["subjectScopeSchool", "subjectScopeYear", "subjectScopeSection", "subjectScopeSubject", "subjectScopeTeacher", "subjectScopeTerm"].forEach(function (id) {
        el(id).textContent = "—";
      });
      return;
    }
    el("subjectScopeSchool").textContent = schoolLabel(matrix.section.schoolId);
    el("subjectScopeYear").textContent = matrix.section.schoolYearName || "—";
    el("subjectScopeSection").textContent =
      matrix.section.gradeLevelName + " · " + matrix.section.name +
      (matrix.section.adviserName ? " · Adviser: " + matrix.section.adviserName : "");
    el("subjectScopeSubject").textContent =
      matrix.subject.name + (matrix.subject.code ? " (" + matrix.subject.code + ")" : "");
    el("subjectScopeTeacher").textContent =
      matrix.assignment.teacherName || (load && load.teacherName) || "Not assigned";
    var anchor = matrix.dates.find(function (date) { return date.date === state.date; }) || matrix.dates[0];
    el("subjectScopeTerm").textContent = anchor && anchor.term
      ? anchor.term.name + " (" + anchor.term.startsOn + " – " + anchor.term.endsOn + ")"
      : "No approved term covers this date";
  }

  function hideWarning() {
    el("subjectWarning").classList.add("d-none");
    el("subjectWarningText").innerHTML = "";
  }

  function showWarning(html) {
    el("subjectWarning").classList.remove("d-none");
    el("subjectWarningText").innerHTML = html;
  }

  function renderMatrixEmpty(message) {
    el("subjectMatrixHead").innerHTML = "";
    el("subjectMatrixFoot").innerHTML = "";
    el("subjectMatrixBody").innerHTML = emptyRow(5, message);
    el("subjectMeta").textContent = message;
    el("subjectProgress").textContent = "—";
    ["subjectMarkAll", "subjectSave", "subjectSubmit"].forEach(function (id) {
      el(id).classList.add("d-none");
    });
  }

  function editableDates() {
    if (!state.matrix) {
      return [];
    }
    return state.matrix.dates.filter(function (date) {
      return date.dayType === "school_day" && date.meets && !date.locked && !date.submitted &&
        date.activePeriods.length > 0;
    });
  }

  function renderMatrix() {
    var matrix = state.matrix;
    if (!matrix) {
      renderMatrixEmpty("Choose a teaching load to load the matrix.");
      return;
    }
    var dates = matrix.dates;
    var periods = matrix.periods;
    var canEdit = matrix.canEdit;

    if (!matrix.configured || !periods.length) {
      showWarning(
        'No class periods are configured for this scope. <button type="button" class="btn btn-link btn-sm p-0 align-baseline" data-goto-periods>Open class periods</button> to add the school schedule.'
      );
      markMatrixActions(false);
      el("subjectMatrixHead").innerHTML = "";
      el("subjectMatrixBody").innerHTML = emptyRow(5, "Configure class periods before encoding subject attendance.");
      el("subjectMatrixFoot").innerHTML = "";
      el("subjectMeta").textContent = "Class periods are required for the subject attendance matrix.";
      return;
    }
    if (dates.some(function (date) { return date.scheduleSource === "timetable_unmatched"; })) {
      showWarning(
        "The class timetable for this subject exists, but its start times do not match the configured periods. All periods are shown so the day remains encodable — ask an administrator to align the timetable with the period schedule."
      );
    } else {
      hideWarning();
    }
    if (dates.some(function (date) { return date.submitted; })) {
      el("subjectMeta").textContent = "Submitted days are locked until the class adviser reopens them.";
    }

    var head = ['<tr>'];
    head.push('<th scope="col" rowspan="2" class="subject-index-head">#</th>');
    head.push('<th scope="col" rowspan="2" class="subject-learner">Learner</th>');
    head.push('<th scope="col" rowspan="2">LRN</th>');
    head.push('<th scope="col" rowspan="2">Sex</th>');
    dates.forEach(function (date) {
      var span = date.activePeriods.length || 1;
      var off = date.dayType !== "school_day" || !date.meets || !date.activePeriods.length;
      var title = window.UI.phDate(date.date) + " · " + (DAY_TYPE[date.dayType] || date.dayType);
      var sub = DAY_TYPE[date.dayType] || date.dayType;
      if (date.term) {
        sub += " · " + date.term.name;
      }
      if (date.locked) {
        sub += " · Validated";
      } else if (date.submitted) {
        sub += " · Submitted";
      } else if (date.submissionStatus === "reopened") {
        sub += " · Reopened";
      }
      var reopen = date.submitted && date.submissionId && matrix.canValidate
        ? ' <button type="button" class="btn btn-link btn-sm p-0 align-baseline" data-reopen-submission="' + date.submissionId + '" title="Reopen this submitted day">Reopen</button>'
        : "";
      head.push(
        '<th scope="col" colspan="' + span + '" class="subject-day-head' + (off ? " is-weekend" : "") + '" title="' + F.esc(title) + '">' +
        '<span class="subject-day-date">' + window.UI.phDate(date.date) + "</span>" +
        "<small>" + F.esc(sub) + reopen + "</small></th>"
      );
    });
    head.push('<th scope="col" rowspan="2" title="Present">P</th>');
    head.push('<th scope="col" rowspan="2" title="Absent">A</th>');
    head.push('<th scope="col" rowspan="2" title="Tardy">T</th>');
    head.push('<th scope="col" rowspan="2" title="Excused">E</th>');
    head.push('<th scope="col" rowspan="2" title="Recorded period slots">Rec</th>');
    head.push("</tr><tr>");
    dates.forEach(function (date) {
      var active = new Set(date.activePeriods);
      if (date.dayType !== "school_day" || !date.meets || !active.size) {
        head.push('<th scope="col" class="is-weekend">' + (date.dayType !== "school_day" ? "No class" : "—") + "</th>");
        return;
      }
      periods.forEach(function (period) {
        if (!active.has(period.periodNo)) {
          return;
        }
        head.push(
          '<th scope="col" class="subject-period-head" title="' + F.esc(period.label + " · " + window.UI.time(period.startTime) + "–" + window.UI.time(period.endTime)) + '">' +
          F.esc(period.label.replace(/^Period\s*/i, "P")) +
          "<small>" + F.esc(window.UI.time(period.startTime)) + "</small></th>"
        );
      });
    });
    head.push("</tr>");
    el("subjectMatrixHead").innerHTML = head.join("");

    if (!matrix.learners.length) {
      el("subjectMatrixBody").innerHTML = emptyRow(5, "No active learners are enrolled in this section.");
      el("subjectMatrixFoot").innerHTML = "";
      markMatrixActions(false);
      el("subjectMeta").textContent = "No learners in this section.";
      return;
    }

    var body = matrix.learners.map(function (learner, index) {
      var row = ['<tr data-subject-row="' + learner.enrollmentId + '">'];
      row.push('<td class="subject-index">' + (index + 1) + "</td>");
      row.push(
        '<td class="subject-learner"><strong>' + F.esc(learner.displayName || learner.fullName) + "</strong>" +
        "<small>" + F.esc(learner.fullName) + "</small></td>"
      );
      row.push('<td><code class="lrn-code">' + F.esc(learner.lrn) + "</code></td>");
      row.push("<td>" + F.esc(learner.sex === "male" ? "M" : learner.sex === "female" ? "F" : "—") + "</td>");
      dates.forEach(function (date) {
        var active = new Set(date.activePeriods);
        if (date.dayType !== "school_day") {
          row.push('<td class="is-weekend" title="' + F.esc(date.label || DAY_TYPE[date.dayType] || "No class") + '">' + F.esc(date.dayType === "no_class" ? "—" : "No class") + "</td>");
          return;
        }
        if (!date.meets || !active.size) {
          row.push('<td class="is-weekend" title="No scheduled period for this subject">—</td>');
          return;
        }
        periods.forEach(function (period) {
          if (!active.has(period.periodNo)) {
            return;
          }
          var value = recordFor(learner, date.date, period.periodNo);
          var disabled = !canEdit || date.locked || date.submitted;
          var key = dirtyKey(learner.enrollmentId, date.date, period.periodNo);
          row.push(
            '<td class="subject-cell-cell">' +
            '<select class="subject-cell' + statusClass(value) + (state.dirty[key] ? " is-dirty" : "") + '"' +
            ' data-subject-cell data-enrollment="' + learner.enrollmentId + '"' +
            ' data-date="' + date.date + '" data-period="' + period.periodNo + '"' +
            (disabled ? " disabled" : "") +
            (date.locked ? ' title="Validated by the class adviser — locked"' : date.submitted ? ' title="Submitted to the class adviser — reopen to edit"' : "") +
            ' aria-label="' + F.esc((learner.displayName || learner.fullName) + " · " + window.UI.phDate(date.date) + " · " + period.label) + '">' +
            '<option value="">·</option>' +
            '<option value="present"' + (value === "present" ? " selected" : "") + ">P</option>" +
            '<option value="absent"' + (value === "absent" ? " selected" : "") + ">A</option>" +
            '<option value="tardy"' + (value === "tardy" ? " selected" : "") + ">T</option>" +
            '<option value="excused"' + (value === "excused" ? " selected" : "") + ">E</option>" +
            "</select></td>"
          );
        });
      });
      var totals = liveTotals(learner);
      row.push('<td data-row-total="present">' + totals.present + "</td>");
      row.push('<td data-row-total="absent">' + totals.absent + "</td>");
      row.push('<td data-row-total="tardy">' + totals.tardy + "</td>");
      row.push('<td data-row-total="excused">' + totals.excused + "</td>");
      row.push('<td data-row-total="recorded">' + totals.recorded + "</td>");
      row.push("</tr>");
      return row.join("");
    });
    el("subjectMatrixBody").innerHTML = body.join("");

    var foot = ['<tr><td colspan="4" class="subject-foot-label">Class total <span class="field-hint" id="subjectFootHint"></span></td>'];
    dates.forEach(function (date) {
      foot.push('<td colspan="' + (date.activePeriods.length || 1) + '"></td>');
    });
    ["present", "absent", "tardy", "excused", "recorded"].forEach(function (key) {
      foot.push('<td data-foot-total="' + key + '">0</td>');
    });
    foot.push("</tr>");
    el("subjectMatrixFoot").innerHTML = foot.join("");

    markMatrixActions(canEdit && editableDates().length > 0);
    updateProgress();
    var weekLabel = matrix.mode === "week"
      ? "Week of " + window.UI.phDate(matrix.weekStart) + " – " + window.UI.phDate(matrix.weekEnd)
      : window.UI.phDate(matrix.weekStart);
    el("subjectMeta").textContent =
      matrix.section.schoolName + " · " + matrix.section.name + " · " + matrix.subject.name +
      " · " + weekLabel + " · " + matrix.learners.length + " learners";
  }

  function markMatrixActions(visible) {
    ["subjectMarkAll", "subjectSave", "subjectSubmit"].forEach(function (id) {
      el(id).classList.toggle("d-none", !visible);
    });
  }

  function liveTotals(learner) {
    var totals = { present: 0, absent: 0, tardy: 0, excused: 0, recorded: 0 };
    state.matrix.dates.forEach(function (date) {
      var active = new Set(date.activePeriods);
      if (date.dayType !== "school_day" || !date.meets || !active.size) {
        return;
      }
      state.matrix.periods.forEach(function (period) {
        if (!active.has(period.periodNo)) {
          return;
        }
        var value = recordFor(learner, date.date, period.periodNo);
        if (value) {
          totals[value] += 1;
          totals.recorded += 1;
        }
      });
    });
    return totals;
  }

  function updateRowTotals(row) {
    var enrollmentId = Number(row.dataset.subjectRow);
    var learner = state.matrix && state.matrix.learners.find(function (entry) {
      return Number(entry.enrollmentId) === enrollmentId;
    });
    if (!learner) {
      return;
    }
    var totals = liveTotals(learner);
    Object.keys(totals).forEach(function (key) {
      var cell = row.querySelector('[data-row-total="' + key + '"]');
      if (cell) {
        cell.textContent = totals[key];
      }
    });
  }

  function updateProgress() {
    var cells = document.querySelectorAll("[data-subject-cell]");
    var recorded = 0;
    cells.forEach(function (select) {
      if (select.value) {
        recorded += 1;
      }
    });
    var totals = { present: 0, absent: 0, tardy: 0, excused: 0, recorded: 0 };
    document.querySelectorAll("#subjectMatrixBody tr[data-subject-row]").forEach(function (row) {
      ["present", "absent", "tardy", "excused", "recorded"].forEach(function (key) {
        var cell = row.querySelector('[data-row-total="' + key + '"]');
        if (cell) {
          totals[key] += Number(cell.textContent) || 0;
        }
      });
    });
    ["present", "absent", "tardy", "excused", "recorded"].forEach(function (key) {
      var cell = document.querySelector('[data-foot-total="' + key + '"]');
      if (cell) {
        cell.textContent = totals[key];
      }
    });
    var dirtyCount = Object.keys(state.dirty).length;
    el("subjectProgress").textContent =
      recorded + " of " + cells.length + " period slots recorded" +
      (dirtyCount ? " · " + dirtyCount + " unsaved change" + (dirtyCount === 1 ? "" : "s") : "");
  }

  function applyCellValue(select, value) {
    var enrollmentId = Number(select.dataset.enrollment);
    var date = select.dataset.date;
    var periodNo = Number(select.dataset.period);
    var learner = state.matrix.learners.find(function (entry) {
      return Number(entry.enrollmentId) === enrollmentId;
    });
    if (!learner) {
      return;
    }
    var original = savedStatus(learner, date, periodNo);
    var key = dirtyKey(enrollmentId, date, periodNo);
    if ((value || "") === (original || "")) {
      delete state.dirty[key];
    } else {
      state.dirty[key] = {
        enrollmentId: enrollmentId,
        date: date,
        periodNo: periodNo,
        status: value || ""
      };
    }
    select.value = value || "";
    select.className = "subject-cell" + statusClass(value) + (state.dirty[key] ? " is-dirty" : "");
    var row = select.closest("tr[data-subject-row]");
    if (row) {
      updateRowTotals(row);
    }
  }

  function handleCellChange(event) {
    var select = event.target.closest("[data-subject-cell]");
    if (!select || !state.matrix) {
      return;
    }
    applyCellValue(select, select.value);
    updateProgress();
  }

  function handleCellKeydown(event) {
    var select = event.target.closest("[data-subject-cell]");
    if (!select || select.disabled) {
      return;
    }
    var key = String(event.key || "").toLowerCase();
    if (KEY_LETTER[key]) {
      event.preventDefault();
      applyCellValue(select, KEY_LETTER[key]);
      updateProgress();
      return;
    }
    if (key === "x" || key === "delete" || key === "backspace") {
      event.preventDefault();
      applyCellValue(select, "");
      updateProgress();
    }
  }

  function markAllPresent() {
    var selects = Array.prototype.slice.call(
      document.querySelectorAll("#subjectMatrixBody [data-subject-cell]:not([disabled])")
    );
    var toMark = selects.filter(function (select) { return select.value !== "present"; });
    if (!toMark.length) {
      window.UI.toast("Nothing to change", "Every editable period slot is already marked present.", "info");
      return;
    }
    window.UI.confirm({
      title: "Mark all present?",
      message: toMark.length + " editable period slot" + (toMark.length === 1 ? "" : "s") +
        " will be marked present. Nothing is saved until you review the sheet and choose Save draft or Submit to adviser.",
      confirmLabel: "Mark all present",
      tone: "primary"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      toMark.forEach(function (select) {
        applyCellValue(select, "present");
      });
      updateProgress();
      window.UI.toast("Roster marked present", toMark.length + " slots changed. Review absences or tardiness before saving.", "info");
    });
  }

  function collectEntries(submit) {
    var cells = document.querySelectorAll("#subjectMatrixBody [data-subject-cell]");
    var entries = [];
    cells.forEach(function (select) {
      var key = dirtyKey(Number(select.dataset.enrollment), select.dataset.date, Number(select.dataset.period));
      var shouldInclude = submit ? true : Boolean(state.dirty[key]);
      if (!shouldInclude) {
        return;
      }
      var dirty = state.dirty[key];
      entries.push({
        enrollmentId: Number(select.dataset.enrollment),
        date: select.dataset.date,
        periodNo: Number(select.dataset.period),
        status: select.value || (dirty ? dirty.status : ""),
        remarks: ""
      });
    });
    return entries;
  }

  function saveMatrix(submit) {
    var matrix = state.matrix;
    var load = currentLoad();
    if (!matrix || !load) {
      return;
    }
    var entries = collectEntries(submit);
    if (!entries.length) {
      window.UI.toast("No changes to save", "Record or change at least one period before saving.", "info");
      return;
    }
    var actionable = submit ? entries : entries.filter(function (entry) { return Boolean(entry.status); });
    if (!submit && !actionable.length && !Object.keys(state.dirty).length) {
      window.UI.toast("No changes to save", "Record or change at least one period before saving.", "info");
      return;
    }
    var blank = 0;
    if (submit) {
      document.querySelectorAll("#subjectMatrixBody [data-subject-cell]").forEach(function (select) {
        if (!select.value) {
          blank += 1;
        }
      });
    }
    var prompt = submit
      ? window.UI.confirm({
          title: "Submit subject attendance?",
          message: "Submit " + matrix.subject.name + " attendance for " + matrix.section.name +
            " (" + (matrix.mode === "week" ? "week of " + window.UI.phDate(matrix.weekStart) : window.UI.phDate(matrix.weekStart)) + ")?" +
            (blank ? " " + blank + " period slot" + (blank === 1 ? " is" : "s are") + " still not recorded and will be submitted as not recorded." : "") +
            " The class adviser must still validate the official daily attendance.",
          confirmLabel: "Submit to adviser",
          tone: "primary"
        })
      : Promise.resolve(true);

    prompt.then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      var button = el(submit ? "subjectSubmit" : "subjectSave");
      window.UI.setButtonLoading(button, true, submit ? "Submitting…" : "Saving…");
      API.put("/attendance/subject/matrix", {
        sectionId: load.sectionId,
        schoolYearId: Number(state.yearId),
        subjectId: load.subjectId,
        assignmentId: load.assignmentId,
        date: state.date,
        entries: entries,
        submit: Boolean(submit)
      })
        .then(function (payload) {
          window.UI.setButtonLoading(button, false);
          state.matrix = payload.data;
          state.dirty = {};
          renderScope();
          renderMatrix();
          var submittedDays = (payload.data.dates || []).filter(function (date) { return date.submitted; }).length;
          window.UI.toast(
            submit ? "Subject attendance submitted" : "Draft attendance saved",
            submit
              ? entries.length + " entries saved · " + submittedDays + " day" + (submittedDays === 1 ? "" : "s") + " submitted to the class adviser."
              : entries.length + " entries saved.",
            "success"
          );
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (error.status === 401) return;
          alertBox("subjectAlert", "danger", L.friendlyError(error), submit ? "Could not submit attendance" : "Could not save attendance");
        });
    });
  }

  function reopenSubmission(submissionId) {
    window.UI.confirm({
      title: "Reopen this submitted day?",
      message: "The subject teacher will be able to edit this day again. The adviser validation, if any, is not removed.",
      confirmLabel: "Reopen day",
      tone: "warning"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      API.post("/attendance/subject/submissions/" + submissionId + "/reopen", { remarks: "Reopened from subject attendance matrix" })
        .then(function () {
          window.UI.toast("Submission reopened", "The subject teacher may edit and resubmit this day.", "success");
          loadMatrix();
        })
        .catch(function (error) {
          if (error.status === 401) return;
          alertBox("subjectAlert", "danger", L.friendlyError(error), "Could not reopen the submission");
        });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Reporting terms                                                        */
  /* ---------------------------------------------------------------------- */

  function loadTerms() {
    var schoolId = currentSchoolId();
    if (!state.yearId) {
      el("termsBody").innerHTML = emptyRow(6, "Select a school year to configure reporting terms.");
      return Promise.resolve();
    }
    if (!schoolId) {
      el("termsBody").innerHTML = emptyRow(6, "Select a school or a section so the terms of that school can be loaded.");
      return Promise.resolve();
    }
    el("termsBody").innerHTML = L.skeletonRows(6, 4);
    return L.apiGet("/attendance/terms", { schoolId: schoolId, schoolYearId: state.yearId })
      .then(function (data) {
        state.terms = data;
        renderTerms();
      })
      .catch(function (error) {
        if (error.status === 401) return;
        el("termsBody").innerHTML = emptyRow(6, L.friendlyError(error));
        alertBox("termsAlert", "danger", L.friendlyError(error), "Could not load reporting terms");
      });
  }

  function renderTerms() {
    var data = state.terms;
    if (!data) {
      return;
    }
    var modelLabel = data.termModel === "three_term"
      ? "three-term calendar"
      : data.termModel === "four_quarter"
        ? "four-quarter calendar"
        : "custom term calendar";
    el("termsMeta").textContent =
      data.schoolName + " · " + data.schoolYearName + " · " + data.terms.length + " term" +
      (data.terms.length === 1 ? "" : "s") + " · " + modelLabel;

    var canConfigure = Boolean(data.canConfigure);
    var provision = el("termsProvision");
    provision.textContent = "";
    provision.innerHTML = '<i class="bi bi-calendar-plus" aria-hidden="true"></i> ' +
      (data.termModel === "three_term" ? "Generate three terms" : "Generate terms");
    provision.classList.toggle("d-none", !canConfigure || Boolean(data.terms.length));
    el("termsSave").classList.toggle("d-none", !canConfigure || !data.terms.length);
    el("termsApprove").classList.toggle("d-none", !data.canApprove || !data.terms.length);

    if (!data.terms.length) {
      el("termsBody").innerHTML = emptyRow(6, "No reporting terms are configured for this school year. Approve a school calendar and generate the default terms to begin.");
      el("termsHint").textContent = "No terms configured. Term detection is unavailable until terms exist and are approved.";
      return;
    }
    el("termsBody").innerHTML = data.terms.map(function (term) {
      var nameCell = canConfigure
        ? '<input class="form-control form-control-sm" data-term-name maxlength="64" value="' + F.esc(term.name) + '" aria-label="Term ' + term.termNo + ' name">'
        : "<strong>" + F.esc(term.name) + "</strong>";
      var startCell = canConfigure
        ? '<input type="date" class="form-control form-control-sm" data-term-start value="' + F.esc(term.startsOn) + '" aria-label="Term ' + term.termNo + ' start date">'
        : F.esc(term.startsOn);
      var endCell = canConfigure
        ? '<input type="date" class="form-control form-control-sm" data-term-end value="' + F.esc(term.endsOn) + '" aria-label="Term ' + term.termNo + ' end date">'
        : F.esc(term.endsOn);
      return (
        '<tr data-term-row data-term-no="' + term.termNo + '">' +
        "<td>" + term.termNo + "</td>" +
        "<td>" + nameCell + "</td>" +
        "<td>" + startCell + "</td>" +
        "<td>" + endCell + "</td>" +
        "<td>" + F.toneBadge(TERM_TONE, term.status) + "</td>" +
        "<td>" + (term.approvedAt ? F.esc(window.UI.phDateTime(term.approvedAt)) : "—") + "</td>" +
        "</tr>"
      );
    }).join("");
    var approved = data.terms.filter(function (term) { return term.status === "approved"; }).length;
    el("termsHint").textContent =
      approved + " of " + data.terms.length + " term" + (data.terms.length === 1 ? "" : "s") + " approved. " +
      "Approved terms are used for automatic term detection and term summaries.";
  }

  function collectTerms() {
    var terms = [];
    document.querySelectorAll("#termsBody tr[data-term-row]").forEach(function (row) {
      var name = row.querySelector("[data-term-name]");
      var start = row.querySelector("[data-term-start]");
      var end = row.querySelector("[data-term-end]");
      terms.push({
        termNo: Number(row.dataset.termNo),
        name: name ? name.value.trim() : "",
        startsOn: start ? start.value : "",
        endsOn: end ? end.value : ""
      });
    });
    return terms;
  }

  function saveTerms() {
    var schoolId = currentSchoolId();
    var terms = collectTerms();
    if (!schoolId) {
      alertBox("termsAlert", "warning", "Select a school before saving the terms.", "School required");
      return;
    }
    var invalid = terms.find(function (term) {
      return !term.name || !term.startsOn || !term.endsOn || term.endsOn < term.startsOn;
    });
    if (invalid) {
      alertBox("termsAlert", "warning", "Every term needs a name, start date, and an end date that is not earlier than the start.", "Check the term rows");
      return;
    }
    var button = el("termsSave");
    window.UI.setButtonLoading(button, true, "Saving…");
    API.put("/attendance/terms", {
      schoolId: Number(schoolId),
      schoolYearId: Number(state.yearId),
      terms: terms
    })
      .then(function (payload) {
        window.UI.setButtonLoading(button, false);
        state.terms = payload.data;
        renderTerms();
        window.UI.toast("Terms saved", "Terms were saved as drafts. Approve them when the school calendar is final.", "success");
      })
      .catch(function (error) {
        window.UI.setButtonLoading(button, false);
        if (error.status === 401) return;
        alertBox("termsAlert", "danger", L.friendlyError(error), "Could not save the terms");
      });
  }

  function approveTerms() {
    var schoolId = currentSchoolId();
    if (!schoolId) {
      return;
    }
    window.UI.confirm({
      title: "Approve reporting terms?",
      message: "Approved terms become the official term calendar for attendance detection, SF 2, SF 9, and SF 10. Confirm the dates match the school calendar.",
      confirmLabel: "Approve terms",
      tone: "success"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      var button = el("termsApprove");
      window.UI.setButtonLoading(button, true, "Approving…");
      API.post("/attendance/terms/approve", { schoolId: Number(schoolId), schoolYearId: Number(state.yearId) })
        .then(function (payload) {
          window.UI.setButtonLoading(button, false);
          state.terms = payload.data;
          renderTerms();
          window.UI.toast("Terms approved", "Automatic term detection is now active for this school year.", "success");
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (error.status === 401) return;
          alertBox("termsAlert", "danger", L.friendlyError(error), "Could not approve the terms");
        });
    });
  }

  function provisionTerms() {
    var schoolId = currentSchoolId();
    if (!schoolId) {
      alertBox("termsAlert", "warning", "Select a school before generating terms.", "School required");
      return;
    }
    window.UI.confirm({
      title: "Generate reporting terms?",
      message: "This creates draft terms spanning the school year. Review and adjust the dates before approving them.",
      confirmLabel: "Generate terms",
      tone: "primary"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      var button = el("termsProvision");
      window.UI.setButtonLoading(button, true, "Generating…");
      API.post("/attendance/terms", { schoolId: Number(schoolId), schoolYearId: Number(state.yearId) })
        .then(function (payload) {
          window.UI.setButtonLoading(button, false);
          state.terms = payload.data;
          renderTerms();
          window.UI.toast("Terms generated", "Review the dates, then approve the calendar.", "success");
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (error.status === 401) return;
          alertBox("termsAlert", "danger", L.friendlyError(error), "Could not generate terms");
        });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Class periods                                                          */
  /* ---------------------------------------------------------------------- */

  function loadPeriodScopes() {
    var select = el("periodScopeFilter");
    var previous = select.value;
    select.innerHTML = '<option value="">School-wide default</option>';
    var schoolId = currentSchoolId();
    return Promise.all([
      L.grades(schoolId || undefined).catch(function () { return []; }),
      L.sections({ schoolId: schoolId || undefined, schoolYearId: state.yearId || undefined }).catch(function () { return []; })
    ]).then(function (results) {
      var grades = results[0] || [];
      var sections = results[1] || [];
      grades.forEach(function (grade) {
        select.innerHTML += '<option value="g:' + grade.id + '">Grade level · ' + F.esc(grade.name) + "</option>";
      });
      sections.forEach(function (section) {
        select.innerHTML += '<option value="s:' + section.id + '">Section · ' + F.esc(section.name + " · " + section.gradeLevel) + "</option>";
      });
      if (state.sectionId) {
        var exists = Array.prototype.some.call(select.options, function (option) {
          return option.value === "s:" + state.sectionId;
        });
        if (exists) {
          select.value = "s:" + state.sectionId;
        }
      } else if (previous) {
        select.value = previous;
      }
      return loadPeriods();
    });
  }

  function scopeSelection() {
    var value = el("periodScopeFilter").value || "";
    if (value.indexOf("s:") === 0) {
      return { sectionId: Number(value.slice(2)), gradeLevelId: null };
    }
    if (value.indexOf("g:") === 0) {
      return { sectionId: null, gradeLevelId: Number(value.slice(2)) };
    }
    return { sectionId: null, gradeLevelId: null };
  }

  function loadPeriods() {
    var schoolId = currentSchoolId();
    if (!state.yearId || !schoolId) {
      el("periodBody").innerHTML = emptyRow(5, "Select a school year and a school or section to configure periods.");
      return Promise.resolve();
    }
    var scope = scopeSelection();
    el("periodBody").innerHTML = L.skeletonRows(5, 4);
    return L.apiGet("/attendance/periods", {
      schoolId: schoolId,
      schoolYearId: state.yearId,
      sectionId: scope.sectionId || undefined,
      gradeLevelId: scope.gradeLevelId || undefined
    })
      .then(function (data) {
        state.periodData = data;
        state.periodRows = data.periods.map(function (period) {
          return {
            id: period.id,
            periodNo: period.periodNo,
            label: period.label,
            startTime: period.startTime,
            endTime: period.endTime
          };
        });
        renderPeriods();
      })
      .catch(function (error) {
        if (error.status === 401) return;
        el("periodBody").innerHTML = emptyRow(5, L.friendlyError(error));
        alertBox("periodAlert", "danger", L.friendlyError(error), "Could not load class periods");
      });
  }

  function scopeLabel() {
    var value = el("periodScopeFilter").value || "";
    var option = el("periodScopeFilter").selectedOptions && el("periodScopeFilter").selectedOptions[0];
    return option ? option.textContent : "School-wide default";
  }

  function renderPeriods() {
    var data = state.periodData;
    if (!data) {
      return;
    }
    var canConfigure = Boolean(data.canConfigure);
    el("periodSave").classList.toggle("d-none", !canConfigure);
    el("periodAdd").classList.toggle("d-none", !canConfigure);
    el("periodSuggested").classList.toggle("d-none", !canConfigure || !data.suggested.length);
    el("periodCopyEffective").classList.toggle(
      "d-none",
      !canConfigure || state.periodRows.length > 0 || !data.effective.length
    );
    if (!canConfigure) {
      el("periodAlert").classList.add("d-none");
    }

    if (!state.periodRows.length) {
      el("periodBody").innerHTML = emptyRow(5, "No periods are configured at this scope. Apply the suggested layout, copy the effective layout, or add periods manually.");
      var effectiveNote = data.effective.length
        ? " This section currently uses " + data.effective.length + " effective periods from a broader scope."
        : "";
      el("periodMeta").textContent = scopeLabel() + " · no periods configured." + effectiveNote;
      return;
    }

    el("periodBody").innerHTML = state.periodRows.map(function (period, index) {
      var readonly = canConfigure ? "" : " readonly";
      return (
        '<tr data-period-row data-index="' + index + '">' +
        '<td class="period-no">' + period.periodNo + "</td>" +
        '<td><input class="form-control form-control-sm" data-period-field="label" maxlength="64" value="' + F.esc(period.label) + '" aria-label="Period ' + period.periodNo + ' label"' + readonly + "></td>" +
        '<td><input type="time" class="form-control form-control-sm" data-period-field="startTime" value="' + F.esc(period.startTime) + '" aria-label="Period ' + period.periodNo + ' start time"' + readonly + "></td>" +
        '<td><input type="time" class="form-control form-control-sm" data-period-field="endTime" value="' + F.esc(period.endTime) + '" aria-label="Period ' + period.periodNo + ' end time"' + readonly + "></td>" +
        '<td class="text-right">' +
        (canConfigure
          ? '<button type="button" class="btn btn-light" data-remove-period="' + index + '" title="Remove period"><i class="bi bi-trash" aria-hidden="true"></i></button>'
          : "") +
        "</td></tr>"
      );
    }).join("");
    var effectiveNote = data.sectionId && data.effective.length
      ? " Effective for this section: " + data.effective.length + " periods."
      : "";
    el("periodMeta").textContent = scopeLabel() + " · " + state.periodRows.length + " period" +
      (state.periodRows.length === 1 ? "" : "s") + " configured." + effectiveNote;
  }

  function onPeriodInput(event) {
    var input = event.target.closest("[data-period-field]");
    if (!input) {
      return;
    }
    var row = input.closest("[data-period-row]");
    var index = Number(row.dataset.index);
    if (!state.periodRows[index]) {
      return;
    }
    state.periodRows[index][input.dataset.periodField] = input.value;
  }

  function addPeriod() {
    if (state.periodRows.length >= 12) {
      alertBox("periodAlert", "warning", "A scope may contain at most 12 periods.", "Limit reached");
      return;
    }
    var last = state.periodRows[state.periodRows.length - 1];
    var nextNo = last ? Number(last.periodNo) + 1 : 1;
    var start = last && last.endTime ? last.endTime : "07:30";
    state.periodRows.push({
      periodNo: nextNo,
      label: "Period " + nextNo,
      startTime: start,
      endTime: addMinutes(start, 45)
    });
    renderPeriods();
  }

  function copyEffective() {
    if (!state.periodData || !state.periodData.effective.length) {
      return;
    }
    state.periodRows = state.periodData.effective.map(function (period) {
      return {
        periodNo: period.periodNo,
        label: period.label,
        startTime: period.startTime,
        endTime: period.endTime
      };
    });
    renderPeriods();
    window.UI.toast("Effective layout copied", "Review the times, then save to create an override at this scope.", "info");
  }

  function applySuggested() {
    if (!state.periodData || !state.periodData.suggested.length) {
      return;
    }
    window.UI.confirm({
      title: "Apply the suggested period layout?",
      message: "This replaces the rows in this scope with the suggested 9-period layout. Existing records are not deleted, but the period numbering and times will change.",
      confirmLabel: "Apply layout",
      tone: "primary"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      state.periodRows = state.periodData.suggested.map(function (period) {
        return {
          periodNo: period.periodNo,
          label: period.label,
          startTime: period.startTime,
          endTime: period.endTime
        };
      });
      renderPeriods();
      window.UI.toast("Suggested layout applied", "Review the times and save the periods.", "info");
    });
  }

  function removePeriod(index) {
    state.periodRows.splice(index, 1);
    renderPeriods();
  }

  function savePeriods() {
    var schoolId = currentSchoolId();
    if (!schoolId) {
      alertBox("periodAlert", "warning", "Select a school before saving class periods.", "School required");
      return;
    }
    if (!state.periodRows.length) {
      alertBox("periodAlert", "warning", "Add at least one period before saving.", "No periods");
      return;
    }
    var invalid = state.periodRows.find(function (row) {
      return !row.startTime || !row.endTime || row.endTime <= row.startTime;
    });
    if (invalid) {
      alertBox("periodAlert", "warning", "Every period needs a start and end time, and the end must be later than the start.", "Check the period times");
      return;
    }
    var scope = scopeSelection();
    var button = el("periodSave");
    window.UI.setButtonLoading(button, true, "Saving…");
    API.put("/attendance/periods", {
      schoolId: Number(schoolId),
      schoolYearId: Number(state.yearId),
      sectionId: scope.sectionId || undefined,
      gradeLevelId: scope.gradeLevelId || undefined,
      periods: state.periodRows.map(function (row) {
        return {
          periodNo: Number(row.periodNo),
          label: row.label.trim(),
          startTime: row.startTime,
          endTime: row.endTime
        };
      })
    })
      .then(function (payload) {
        window.UI.setButtonLoading(button, false);
        state.periodData = payload.data;
        state.periodRows = payload.data.periods.map(function (period) {
          return {
            id: period.id,
            periodNo: period.periodNo,
            label: period.label,
            startTime: period.startTime,
            endTime: period.endTime
          };
        });
        state.matrix = null;
        renderPeriods();
        window.UI.toast("Class periods saved", state.periodRows.length + " periods are now configured for " + scopeLabel() + ".", "success");
      })
      .catch(function (error) {
        window.UI.setButtonLoading(button, false);
        if (error.status === 401) return;
        alertBox("periodAlert", "danger", L.friendlyError(error), "Could not save the class periods");
      });
  }

  /* ---------------------------------------------------------------------- */
  /* Wiring                                                                 */
  /* ---------------------------------------------------------------------- */

  function bind() {
    el("subjectLoadFilter").addEventListener("change", function (event) {
      state.loadKey = event.target.value;
      state.dirty = {};
      state.matrix = null;
      if (state.loadKey) {
        loadMatrix();
      } else {
        renderMatrixEmpty("Choose a teaching load to load the matrix.");
      }
    });
    el("subjectWeekDate").addEventListener("change", function (event) {
      state.date = event.target.value || F.todayIso();
      loadMatrix();
    });
    el("subjectPrev").addEventListener("click", function () {
      state.date = shiftDate(state.date, state.mode === "week" ? -7 : -1);
      el("subjectWeekDate").value = state.date;
      loadMatrix();
    });
    el("subjectNext").addEventListener("click", function () {
      state.date = shiftDate(state.date, state.mode === "week" ? 7 : 1);
      el("subjectWeekDate").value = state.date;
      loadMatrix();
    });
    document.querySelectorAll("[data-subject-mode]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.mode = button.dataset.subjectMode;
        document.querySelectorAll("[data-subject-mode]").forEach(function (item) {
          item.classList.toggle("is-active", item === button);
        });
        loadMatrix();
      });
    });
    el("subjectMatrixBody").addEventListener("change", handleCellChange);
    el("subjectMatrixBody").addEventListener("keydown", handleCellKeydown);
    el("subjectMatrixHead").addEventListener("click", function (event) {
      var button = event.target.closest("[data-reopen-submission]");
      if (button) {
        reopenSubmission(button.dataset.reopenSubmission);
      }
    });
    el("subjectWarning").addEventListener("click", function (event) {
      if (event.target.closest("[data-goto-periods]")) {
        var tab = document.querySelector('.module-tabs [data-tab="periods"]');
        if (tab) {
          tab.click();
        }
      }
    });
    el("subjectMarkAll").addEventListener("click", markAllPresent);
    el("subjectSave").addEventListener("click", function () { saveMatrix(false); });
    el("subjectSubmit").addEventListener("click", function () { saveMatrix(true); });

    el("termsProvision").addEventListener("click", provisionTerms);
    el("termsSave").addEventListener("click", saveTerms);
    el("termsApprove").addEventListener("click", approveTerms);

    el("periodScopeFilter").addEventListener("change", loadPeriods);
    el("periodAdd").addEventListener("click", addPeriod);
    el("periodCopyEffective").addEventListener("click", copyEffective);
    el("periodSuggested").addEventListener("click", applySuggested);
    el("periodSave").addEventListener("click", savePeriods);
    el("periodBody").addEventListener("input", onPeriodInput);
    el("periodBody").addEventListener("change", onPeriodInput);
    el("periodBody").addEventListener("click", function (event) {
      var remove = event.target.closest("[data-remove-period]");
      if (remove) {
        removePeriod(Number(remove.dataset.removePeriod));
      }
    });
  }

  function init() {
    if (!window.LearnerUI || !window.FormsUI) {
      return;
    }
    state.booted = true;
    var params = new URLSearchParams(window.location.search);
    if (params.get("date")) {
      state.date = params.get("date");
    }
    if (params.get("subjectId")) {
      state.requestedSubjectId = params.get("subjectId");
    }
    if (params.get("assignmentId")) {
      state.requestedAssignmentId = params.get("assignmentId");
    }
    el("subjectWeekDate").value = state.date;
    bind();
    L.schools()
      .then(function (list) {
        state.schools = list || [];
      })
      .catch(function () {
        state.schools = [];
      });
  }

  window.SubjectAttendance = {
    filtersChanged: filtersChanged,
    refresh: refresh
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
