/* Daily and monthly attendance workspace */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var F = window.FormsUI;
  var state = {
    session: null,
    yearId: "",
    schoolId: "",
    sectionId: "",
    date: F.todayIso(),
    month: F.monthNow(),
    tab: "daily",
    sheet: null,
    monthly: null
  };

  var DAY_TYPE = {
    school_day: { label: "School day", tone: "success" },
    holiday: { label: "Holiday", tone: "warning" },
    suspension: { label: "Suspension", tone: "danger" },
    no_class: { label: "No class", tone: "muted" },
    orientation: { label: "Orientation", tone: "info" }
  };

  var MARK = { present: "P", absent: "A", tardy: "T", excused: "E", half_day: "H" };

  function el(id) {
    return document.getElementById(id);
  }

  function canEdit() {
    return F.permission("canManageAttendance");
  }

  function setupFilters() {
    return Promise.all([F.schoolFilter("attendanceSchoolControl", "attendanceSchoolFilter", state.schoolId), L.years()])
      .then(function (results) {
        state.years = results[1] || [];
        var current = state.years.find(function (year) {
          return year.isCurrent;
        });
        state.yearId = state.yearId || (current ? String(current.id) : state.years[0] ? String(state.years[0].id) : "");
        el("attendanceYearFilter").innerHTML = L.yearOptions(state.years, state.yearId, "Select school year");
        el("attendanceMonth").innerHTML = F.monthOptions(state.month);
        el("calendarMonth").innerHTML = F.monthOptions(state.month);
        el("attendanceDate").value = state.date;
        wire();
        return loadSections();
      });
  }

  function loadSections() {
    var select = el("attendanceSectionFilter");
    select.innerHTML = '<option value="">Loading sections…</option>';
    return F.filteredSections(state.schoolId || L.schoolId(), state.yearId, select, state.sectionId)
      .then(function (list) {
        if (!list.length) {
          select.innerHTML = '<option value="">No sections for this school year</option>';
          el("attendanceMeta").textContent = "Create a section for this school year before recording attendance.";
          return;
        }
        if (!state.sectionId) {
          state.sectionId = String(list[0].id);
          select.value = state.sectionId;
        }
        refreshView();
      });
  }

  function wire() {
    el("attendanceYearFilter").addEventListener("change", function (event) {
      state.yearId = event.target.value;
      state.sectionId = "";
      loadSections();
    });
    el("attendanceSchoolFilter").addEventListener("change", function (event) {
      state.schoolId = event.target.value;
      state.sectionId = "";
      loadSections();
    });
    el("attendanceSectionFilter").addEventListener("change", function (event) {
      state.sectionId = event.target.value;
      refreshView();
    });
    el("attendanceDate").addEventListener("change", function (event) {
      state.date = event.target.value || F.todayIso();
      if (state.tab === "daily") loadSheet();
    });
    el("attendanceMonth").addEventListener("change", function (event) {
      state.month = event.target.value;
      if (state.tab === "monthly") loadMonthly();
    });
    el("calendarMonth").addEventListener("change", function (event) {
      state.month = event.target.value;
      loadCalendar();
    });
    document.querySelectorAll(".module-tabs [data-tab]").forEach(function (button) {
      button.addEventListener("click", function () {
        setTab(button.dataset.tab);
      });
    });
    el("markAllPresentButton").addEventListener("click", function () {
      document.querySelectorAll("#attendanceBody select[data-status]").forEach(function (select) {
        select.value = "present";
      });
      window.UI.toast("Roster marked present", "Review any absences or tardiness before saving.", "info");
    });
    el("saveAttendanceButton").addEventListener("click", saveSheet);
    el("attendanceCalendarButton").addEventListener("click", function () {
      setTab("calendar");
    });
    el("addCalendarButton").addEventListener("click", function () {
      calendarModal();
    });
    el("calendarBody").addEventListener("click", function (event) {
      var remove = event.target.closest("[data-remove-calendar]");
      if (remove) {
        removeCalendar(remove.dataset.removeCalendar);
      }
    });
    el("printMonthlyButton").addEventListener("click", printMonthly);
  }

  function setTab(name) {
    state.tab = name;
    ["daily", "monthly", "calendar"].forEach(function (key) {
      var tab = el("tab" + key.charAt(0).toUpperCase() + key.slice(1));
      var panel = el("panel" + key.charAt(0).toUpperCase() + key.slice(1));
      var active = key === name;
      tab.setAttribute("aria-selected", String(active));
      panel.classList.toggle("d-none", !active);
    });
    el("attendanceDateField").classList.toggle("d-none", name !== "daily");
    el("attendanceMonthField").classList.toggle("d-none", name === "daily");
    el("attendanceDayBadge").classList.toggle("d-none", name !== "daily");
    refreshView();
  }

  function refreshView() {
    if (!state.sectionId) {
      return;
    }
    if (state.tab === "daily") loadSheet();
    if (state.tab === "monthly") loadMonthly();
    if (state.tab === "calendar") loadCalendar();
  }

  function loadSheet() {
    var body = el("attendanceBody");
    body.innerHTML = L.skeletonRows(6, 6);
    el("saveAttendanceButton").classList.toggle("d-none", !canEdit());
    el("markAllPresentButton").classList.toggle("d-none", !canEdit());
    el("attendanceMeta").textContent = "Loading the class roster…";
    return L.apiGet("/attendance/sheet", {
      sectionId: state.sectionId,
      schoolYearId: state.yearId,
      date: state.date
    })
      .then(function (sheet) {
        state.sheet = sheet;
        var dayMeta = DAY_TYPE[sheet.dayType] || DAY_TYPE.school_day;
        el("attendanceDayBadge").innerHTML = '<span class="status-dot"></span>' + F.esc(dayMeta.label);
        el("attendanceDayBadge").className = "status-badge status-badge--" + dayMeta.tone;
        el("attendanceScopeLabel").textContent =
          sheet.section.schoolName + " · " + sheet.section.name + " · " + sheet.section.gradeLevelName +
          " · " + sheet.section.schoolYearName;
        el("attendanceDate").value = sheet.date;
        if (!sheet.learners.length) {
          body.innerHTML = F.emptyRow(6, "No active learners are enrolled in this section.");
          el("attendanceMeta").textContent = "No learners in this section.";
          return;
        }
        var isClassDay = sheet.dayType === "school_day";
        body.innerHTML = sheet.learners
          .map(function (learner, index) {
            return (
              '<tr data-enrollment="' + learner.enrollmentId + '">' +
              '<td>' + (index + 1) + "</td>" +
              '<td class="attendance-name"><strong>' + F.esc(learner.displayName) + "</strong>" +
              '<small>' + F.esc(learner.fullName === learner.displayName ? learner.lrn : learner.lrn) + "</small></td>" +
              "<td><code class=\"lrn-code\">" + F.esc(learner.lrn) + "</code></td>" +
              "<td>" + F.esc(learner.sex === "male" ? "M" : learner.sex === "female" ? "F" : "—") + "</td>" +
              '<td><select class="custom-select attendance-status" data-status aria-label="Attendance status for ' + F.esc(learner.displayName) + '"' + (canEdit() ? "" : " disabled") + ">" +
              '<option value="">Not recorded</option>' +
              Object.keys(F.ATTENDANCE).map(function (key) {
                return L.option(key, F.ATTENDANCE[key], learner.status || "");
              }).join("") +
              "</select>" +
              (!isClassDay && !learner.status
                ? '<span class="record-note record-note--warning">' + F.esc(dayMeta.label) + "</span>"
                : "") +
              "</td>" +
              '<td><input type="text" class="form-control attendance-remarks" data-remarks maxlength="255" value="' + F.esc(learner.remarks || "") + '" aria-label="Remarks for ' + F.esc(learner.displayName) + '"' + (canEdit() ? "" : " readonly") + "></td>" +
              "</tr>"
            );
          })
          .join("");
        el("attendanceMeta").textContent =
          sheet.entered + " of " + sheet.total + " learners recorded · " + window.UI.phDate(sheet.date) +
          (isClassDay ? "" : " · " + dayMeta.label + " — attendance is not required but may be recorded.");
      })
      .catch(function (error) {
        if (error.status === 401) return;
        body.innerHTML = F.emptyRow(6, L.friendlyError(error));
        el("attendanceMeta").textContent = "Attendance could not be loaded.";
      });
  }

  function saveSheet() {
    if (!state.sheet || !state.sectionId) {
      return;
    }
    var records = [];
    document.querySelectorAll("#attendanceBody tr[data-enrollment]").forEach(function (row) {
      var select = row.querySelector("[data-status]");
      var remarks = row.querySelector("[data-remarks]");
      if (select && select.value) {
        records.push({
          enrollmentId: Number(row.dataset.enrollment),
          status: select.value,
          remarks: remarks ? remarks.value.trim() : ""
        });
      }
    });
    if (!records.length) {
      F.pageAlert("attendanceAlert", "warning", "Record at least one attendance status before saving.", "Nothing to save");
      return;
    }
    var button = el("saveAttendanceButton");
    window.UI.setButtonLoading(button, true, "Saving…");
    API.put("/attendance/sheet", {
      sectionId: Number(state.sectionId),
      schoolYearId: Number(state.yearId),
      date: state.date,
      records: records
    })
      .then(function (sheet) {
        window.UI.setButtonLoading(button, false);
        window.UI.toast("Attendance saved", records.length + " learner records updated for " + window.UI.phDate(state.date) + ".", "success");
        state.sheet = sheet;
        loadSheet();
        if (state.tab === "monthly") loadMonthly();
      })
      .catch(function (error) {
        window.UI.setButtonLoading(button, false);
        if (error.status === 401) return;
        F.pageAlert("attendanceAlert", "danger", L.friendlyError(error), "Could not save attendance");
      });
  }

  function loadMonthly() {
    var head = el("monthlyHead");
    var body = el("monthlyBody");
    head.innerHTML = "";
    body.innerHTML = '<tr><td class="empty-cell">Loading monthly register…</td></tr>';
    return L.apiGet("/attendance/month", {
      sectionId: state.sectionId,
      schoolYearId: state.yearId,
      month: state.month
    })
      .then(function (sheet) {
        state.monthly = sheet;
        el("monthlyMeta").textContent =
          sheet.section.schoolName + " · " + sheet.section.name + " · " + sheet.month +
          " · " + sheet.schoolDays + " school days";
        var warning = el("monthlyWarning");
        var messages = [];
        if (sheet.missingDates.length) {
          messages.push(sheet.missingDates.length + " school day" + (sheet.missingDates.length === 1 ? "" : "s") + " have no attendance at all (" + sheet.missingDates.slice(0, 5).join(", ") + (sheet.missingDates.length > 5 ? "…" : "") + ").");
        }
        if (sheet.partialDates.length) {
          messages.push(sheet.partialDates.length + " day" + (sheet.partialDates.length === 1 ? "" : "s") + " have only partial rosters (" + sheet.partialDates.slice(0, 5).join(", ") + (sheet.partialDates.length > 5 ? "…" : "") + ").");
        }
        if (messages.length) {
          warning.classList.remove("d-none");
          el("monthlyWarningText").innerHTML = "<strong>Register incomplete.</strong> " + F.esc(messages.join(" ")) +
            " SF 2 cannot be submitted until these days are complete.";
        } else {
          warning.classList.add("d-none");
        }

        var days = sheet.days;
        head.innerHTML =
          "<tr><th class=\"learner-col\">Learner</th>" +
          days.map(function (day) {
            var weekend = day.weekday === 0 || day.weekday === 6;
            return '<th scope="col" class="' + (weekend || day.dayType !== "school_day" ? "is-weekend" : "") +
              '" title="' + F.esc(window.UI.phDate(day.date) + " · " + (DAY_TYPE[day.dayType] || {}).label) + '">' +
              day.day + "</th>";
          }).join("") +
          '<th scope="col" title="Present">P</th><th scope="col" title="Absent">A</th><th scope="col" title="Tardy">T</th></tr>';

        if (!sheet.learners.length) {
          body.innerHTML = '<tr><td class="empty-cell">No learners in this section.</td></tr>';
          return;
        }
        body.innerHTML = sheet.learners
          .map(function (learner) {
            return (
              "<tr><td class=\"learner-col\"><strong>" + F.esc(learner.fullName) + "</strong>" +
              '<span class="record-note">' + F.esc(learner.lrn) + "</span></td>" +
              days.map(function (day) {
                var status = learner.cells[day.date];
                var weekend = day.weekday === 0 || day.weekday === 6 || day.dayType !== "school_day";
                return '<td class="' + (weekend ? "is-weekend" : "") + '">' +
                  (status
                    ? '<span class="attendance-mark attendance-mark--' + status + '" title="' + F.esc(F.ATTENDANCE[status] || status) + '">' + (MARK[status] || "?") + "</span>"
                    : '<span class="text-muted">·</span>') +
                  "</td>";
              }).join("") +
              "<td>" + learner.totals.present + "</td><td>" + learner.totals.absent + "</td><td>" + learner.totals.tardy + "</td></tr>"
            );
          })
          .join("");
      })
      .catch(function (error) {
        if (error.status === 401) return;
        body.innerHTML = F.emptyRow(1, L.friendlyError(error));
      });
  }

  function printMonthly() {
    if (!state.monthly) {
      return;
    }
    var sheet = state.monthly;
    var days = sheet.days;
    var head = "<tr><th>Learner</th><th>LRN</th>" +
      days.map(function (day) { return "<th>" + day.day + "</th>"; }).join("") +
      "<th>Present</th><th>Absent</th><th>Tardy</th></tr>";
    var rows =
      "<table><thead>" + head + "</thead><tbody>" +
      sheet.learners.map(function (learner) {
        return "<tr><td>" + F.esc(learner.fullName) + "</td><td>" + F.esc(learner.lrn) + "</td>" +
          days.map(function (day) {
            var status = learner.cells[day.date];
            return "<td>" + (status ? MARK[status] : "") + "</td>";
          }).join("") +
          "<td>" + learner.totals.present + "</td><td>" + learner.totals.absent + "</td><td>" + learner.totals.tardy + "</td></tr>";
      }).join("") +
      "</tbody></table>";
    L.printHtml(
      "Attendance register — " + sheet.section.name,
      "<h1>Monthly Attendance Register</h1>" +
      '<p class="print-meta">' + F.esc(sheet.section.schoolName + " · " + sheet.section.name + " · " + sheet.month) +
      '. This is a working register, not an official SF 2. Generate SF 2 from the School Forms Center for the official submission.</p>' +
      rows +
      '<div class="print-sign"><div>Class Adviser</div><div>School Head</div></div>'
    );
  }

  function loadCalendar() {
    var body = el("calendarBody");
    body.innerHTML = L.skeletonRows(4, 4);
    el("addCalendarButton").classList.toggle("d-none", !canEdit());
    return L.apiGet("/attendance/calendar", {
      schoolId: state.schoolId || L.schoolId() || undefined,
      schoolYearId: state.yearId,
      month: state.month
    })
      .then(function (payload) {
        if (!payload.days.length) {
          body.innerHTML = F.emptyRow(4, "No calendar overrides for this month. Weekends default to no class.");
          return;
        }
        body.innerHTML = payload.days
          .map(function (day) {
            return (
              "<tr><td>" + F.esc(window.UI.phDate(day.date)) + "</td>" +
              "<td>" + F.toneBadge(DAY_TYPE, day.dayType) + "</td>" +
              "<td>" + F.esc(day.label || "—") + "</td>" +
              '<td><div class="row-actions">' +
              (canEdit()
                ? '<button type="button" class="btn btn-light" data-remove-calendar="' + day.id + '" title="Remove calendar override"><i class="bi bi-trash" aria-hidden="true"></i></button>'
                : "") +
              "</div></td></tr>"
            );
          })
          .join("");
      })
      .catch(function (error) {
        if (error.status === 401) return;
        body.innerHTML = F.emptyRow(4, L.friendlyError(error));
      });
  }

  function calendarModal() {
    var dialog = L.modal({
      title: "Add calendar day",
      eyebrow: state.month,
      body:
        '<div id="calendarAlert" class="d-none mb-3" role="alert"></div>' +
        '<form id="calendarForm" novalidate><div class="form-row">' +
        '<div class="col-md-5"><div class="form-group"><label for="calendarDate">Date <span class="required-mark">*</span></label>' +
        '<input type="date" class="form-control" id="calendarDate" name="date" required value="' + state.month + '-01"></div></div>' +
        '<div class="col-md-7"><div class="form-group"><label for="calendarDayType">Day type <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="calendarDayType" name="dayType">' +
        L.options(Object.keys(DAY_TYPE).map(function (key) { return { key: key, label: DAY_TYPE[key].label }; }), "key", "label", "holiday", "Select day type") +
        '</select><span class="field-error"></span></div></div>' +
        '<div class="col-12"><div class="form-group"><label for="calendarLabel">Label</label>' +
        '<input class="form-control" id="calendarLabel" name="label" maxlength="160" placeholder="All Saints\' Day"></div></div>' +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="saveCalendarButton">Save day</button>'
    });
    var form = dialog.element.querySelector("#calendarForm");
    var button = dialog.element.querySelector("#saveCalendarButton");
    var alertBox = dialog.element.querySelector("#calendarAlert");
    button.addEventListener("click", function () {
      var values = L.formValues(form);
      if (!values.date || !values.dayType) {
        window.UI.showAlert(alertBox, "warning", "Choose the date and day type.", "Missing details");
        return;
      }
      window.UI.setButtonLoading(button, true, "Saving…");
      API.post("/attendance/calendar", {
        schoolId: state.schoolId || L.schoolId() || undefined,
        schoolYearId: Number(state.yearId),
        date: values.date,
        dayType: values.dayType,
        label: values.label.trim()
      })
        .then(function () {
          window.UI.setButtonLoading(button, false);
          dialog.close();
          window.UI.toast("Calendar day saved", window.UI.phDate(values.date), "success");
          loadCalendar();
          if (state.tab === "daily") loadSheet();
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not save the calendar day");
        });
    });
  }

  function removeCalendar(id) {
    window.UI.confirm({
      title: "Remove this calendar override?",
      message: "The day will fall back to the default weekday rule.",
      confirmLabel: "Remove",
      tone: "danger"
    }).then(function (confirmed) {
      if (!confirmed) return;
      API.delete("/attendance/calendar/" + id)
        .then(function () {
          window.UI.toast("Calendar day removed", "The default weekday rule applies again.", "success");
          loadCalendar();
          if (state.tab === "daily") loadSheet();
        })
        .catch(function (error) {
          F.pageAlert("attendanceAlert", "danger", L.friendlyError(error), "Could not remove the calendar day");
        });
    });
  }

  function init() {
    window.AppShell.init({
      page: "attendance",
      breadcrumbs: ["Attendance"],
      requiredPermission: "canViewAttendance"
    }).then(function (session) {
      if (!session) return;
      state.session = session;
      var params = new URLSearchParams(window.location.search);
      if (params.get("sectionId")) state.sectionId = params.get("sectionId");
      if (params.get("date")) state.date = params.get("date");
      setupFilters().catch(function (error) {
        if (error.status === 401) return;
        F.pageAlert("attendanceAlert", "danger", L.friendlyError(error), "Attendance could not start");
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
