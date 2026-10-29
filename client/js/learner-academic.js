/* DepEd Learner Records — connected academic tabs on the learner profile.
 *
 * Attendance, grades, books, health, school forms, and permanent academic
 * records are loaded lazily. Every tab is backed by the same scoped API used
 * by its dedicated workspace, so permissions and privacy rules cannot be
 * bypassed by opening the profile.
 */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var F = window.FormsUI;
  var esc = L.esc;

  var ATTENDANCE = {
    present: { label: "Present", tone: "success" },
    absent: { label: "Absent", tone: "danger" },
    tardy: { label: "Tardy", tone: "warning" },
    excused: { label: "Excused", tone: "info" },
    half_day: { label: "Half day", tone: "neutral" }
  };

  var BOOK_STATUS = {
    issued: { label: "Issued", tone: "info" },
    partially_returned: { label: "Partially returned", tone: "warning" },
    returned: { label: "Returned", tone: "success" },
    damaged: { label: "Damaged", tone: "danger" },
    lost: { label: "Lost", tone: "danger" }
  };

  var DECISION = {
    pending: { label: "Pending decision", tone: "neutral" },
    promoted: { label: "Promoted", tone: "success" },
    retained: { label: "Retained", tone: "danger" },
    conditional: { label: "Conditional", tone: "warning" },
    completed: { label: "Completed", tone: "teal" },
    other: { label: "Other", tone: "neutral" }
  };

  var WORKFLOW = {
    draft: { label: "Draft", tone: "neutral" },
    recommended: { label: "Recommended", tone: "info" },
    approved: { label: "Approved", tone: "success" },
    finalized: { label: "Finalized", tone: "teal" }
  };

  var GRADE_STATUS = {
    finalized: { label: "Finalized", tone: "success" },
    submitted: { label: "Submitted", tone: "info" },
    draft: { label: "Draft", tone: "warning" }
  };

  var REPORT_STATUS = {
    draft: { label: "Draft", tone: "neutral" },
    submitted: { label: "Submitted", tone: "info" },
    approved: { label: "Approved", tone: "success" },
    issued: { label: "Issued", tone: "teal" }
  };

  var NUTRITION = {
    severely_wasted: { label: "Severely wasted", tone: "danger" },
    wasted: { label: "Wasted", tone: "warning" },
    normal: { label: "Normal", tone: "success" },
    overweight: { label: "Overweight", tone: "warning" },
    obese: { label: "Obese", tone: "warning" },
    severely_stunted: { label: "Severely stunted", tone: "danger" },
    stunted: { label: "Stunted", tone: "warning" },
    tall: { label: "Tall", tone: "neutral" },
    not_assessed: { label: "Not assessed", tone: "muted" }
  };

  var state = {
    learnerId: null,
    detail: null,
    session: null,
    years: [],
    attendanceYearId: null,
    attendance: null,
    grades: null,
    books: null,
    health: null,
    forms: null,
    formsCards: null,
    formsSubmissions: null,
    permanent: null,
    loading: {},
    academicTabs: ["attendance", "grades", "books", "health", "forms", "permanent"]
  };

  function el(id) {
    return document.getElementById(id);
  }

  function can(permission) {
    return Boolean(state.session && state.session.permissions && state.session.permissions[permission]);
  }

  function badge(label, tone) {
    return window.UI.pillarBadge(label, tone || "neutral");
  }

  function metaBadge(map, key) {
    var meta = map[key] || { label: window.UI.titleCase(key || "—"), tone: "neutral" };
    return badge(meta.label, meta.tone);
  }

  function emptyRow(columns, message) {
    return '<tr><td colspan="' + columns + '" class="empty-cell">' + esc(message) + "</td></tr>";
  }

  function emptyState(icon, title, message, action) {
    return window.UI.emptyState({
      icon: icon,
      title: title,
      message: message,
      action: action || ""
    });
  }

  function failure(alertId, error, title) {
    if (error && error.status === 401) {
      return;
    }
    var box = el(alertId || "learnerPageAlert");
    if (box) {
      window.UI.showAlert(box, "danger", L.friendlyError(error), title || "Record unavailable");
    }
  }

  function enrollment() {
    if (!state.detail) {
      return null;
    }
    var learner = state.detail.learner;
    return learner.currentEnrollment || (state.detail.enrollments && state.detail.enrollments[0]) || null;
  }

  function yearId() {
    var current = enrollment();
    if (current) {
      return String(current.schoolYearId);
    }
    var active = (state.years || []).find(function (year) {
      return year.isCurrent;
    });
    return active ? String(active.id) : "";
  }

  function schoolId() {
    if (!state.detail) {
      return "";
    }
    return String(state.detail.learner.schoolId || L.schoolId() || "");
  }

  function sectionId() {
    var current = enrollment();
    return current && current.sectionId ? String(current.sectionId) : "";
  }

  function monthLabel(value) {
    var parts = String(value || "").split("-");
    if (parts.length !== 2) {
      return value || "—";
    }
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    return date.toLocaleString("en-PH", { month: "long", year: "numeric" });
  }

  function number(value, digits) {
    if (value === null || value === undefined || value === "") {
      return "—";
    }
    var parsed = Number(value);
    if (!isFinite(parsed)) {
      return "—";
    }
    return digits === undefined ? String(parsed) : parsed.toFixed(digits);
  }

  function latestByForm(rows) {
    var map = {};
    (rows || []).forEach(function (row) {
      if (!map[row.formCode]) {
        map[row.formCode] = row;
      }
    });
    return map;
  }

  /* Mount ------------------------------------------------------------------ */

  function mount(context) {
    state.learnerId = context.learnerId;
    state.detail = context.detail;
    state.session = context.session;
    state.years = context.years || [];

    document.querySelectorAll("#learnerTabs [data-permission]").forEach(function (button) {
      button.classList.toggle("d-none", !can(button.dataset.permission));
    });

    var yearFilter = el("attendanceYearFilter");
    if (yearFilter && !yearFilter.options.length) {
      yearFilter.innerHTML = L.yearOptions(state.years, yearId(), "Select school year");
      yearFilter.addEventListener("change", function () {
        state.attendanceYearId = yearFilter.value;
        state.attendance = null;
        loadAttendance(true);
      });
    }

    var attendanceLink = el("attendanceWorkspaceLink");
    if (attendanceLink) {
      attendanceLink.href = "attendance.html" + (sectionId() ? "?sectionId=" + encodeURIComponent(sectionId()) : "");
    }

    var formsLink = el("formsWorkspaceLink");
    if (formsLink) {
      formsLink.href =
        "school-forms.html?schoolId=" +
        encodeURIComponent(schoolId()) +
        "&schoolYearId=" +
        encodeURIComponent(yearId()) +
        (sectionId() ? "&sectionId=" + encodeURIComponent(sectionId()) : "");
    }

    var sf10 = el("previewSf10Button");
    if (sf10) {
      sf10.classList.toggle("d-none", !can("canViewPermanentRecords"));
      sf10.onclick = function () {
        previewForm("sf10");
      };
    }
  }

  function show(tab, force) {
    if (state.academicTabs.indexOf(tab) === -1 || !state.detail) {
      return false;
    }
    if (tab === "attendance" && can("canViewAttendance")) {
      loadAttendance(Boolean(force));
    } else if (tab === "grades" && can("canViewGrades")) {
      loadGrades(Boolean(force));
    } else if (tab === "books" && can("canViewBooks")) {
      loadBooks(Boolean(force));
    } else if (tab === "health" && can("canViewHealth")) {
      loadHealth(Boolean(force));
    } else if (tab === "forms" && can("canViewSchoolForms")) {
      loadForms(Boolean(force));
    } else if (tab === "permanent" && can("canViewPermanentRecords")) {
      loadPermanent(Boolean(force));
    }
    return true;
  }

  function invalidate() {
    state.attendance = null;
    state.grades = null;
    state.books = null;
    state.health = null;
    state.forms = null;
    state.formsCards = null;
    state.formsSubmissions = null;
  }

  /* Attendance ------------------------------------------------------------- */

  function loadAttendance(force) {
    var targetYear = state.attendanceYearId || yearId();
    if (!targetYear) {
      el("attendanceSummary").innerHTML = '<div class="mini-card"><span>School year</span><strong>No year selected</strong></div>';
      el("attendanceMonthBody").innerHTML = emptyRow(7, "Choose a school year to view attendance.");
      el("attendanceLogBody").innerHTML = emptyRow(3, "No attendance entries to show.");
      return;
    }
    if (!force && state.attendance && String(state.attendance.schoolYear.id) === String(targetYear)) {
      return;
    }
    el("attendanceSummary").innerHTML = '<div class="mini-card"><span>Recorded days</span><strong>—</strong></div>';
    el("attendanceMonthBody").innerHTML =
      '<tr><td colspan="7" class="empty-cell"><span class="skeleton skeleton-block"></span></td></tr>';
    el("attendanceLogBody").innerHTML =
      '<tr><td colspan="3" class="empty-cell"><span class="skeleton skeleton-block"></span></td></tr>';
    L.apiGet("/attendance/learner/" + state.learnerId, { schoolYearId: targetYear })
      .then(function (payload) {
        state.attendance = payload;
        state.attendanceYearId = String(payload.schoolYear.id);
        renderAttendance(payload);
      })
      .catch(function (error) {
        el("attendanceMonthBody").innerHTML = emptyRow(7, L.friendlyError(error));
        el("attendanceLogBody").innerHTML = emptyRow(3, "Attendance could not be loaded.");
        failure("learnerPageAlert", error, "Attendance unavailable");
      });
  }

  function renderAttendance(payload) {
    var records = payload.records || [];
    var monthly = payload.monthly || [];
    var counts = { present: 0, absent: 0, tardy: 0, excused: 0, half_day: 0 };
    records.forEach(function (record) {
      if (counts[record.status] !== undefined) {
        counts[record.status] += 1;
      }
    });
    el("attendanceSummary").innerHTML =
      '<div class="mini-card"><span>Recorded days</span><strong>' + records.length + "</strong><small>" + esc(payload.schoolYear.name) + "</small></div>" +
      '<div class="mini-card"><span>Present</span><strong>' + counts.present + "</strong></div>" +
      '<div class="mini-card"><span>Absent</span><strong>' + counts.absent + "</strong></div>" +
      '<div class="mini-card"><span>Tardy</span><strong>' + counts.tardy + "</strong></div>" +
      '<div class="mini-card"><span>Excused</span><strong>' + counts.excused + "</strong></div>" +
      '<div class="mini-card"><span>Half day</span><strong>' + counts.half_day + "</strong></div>";

    el("attendanceMonthBody").innerHTML = monthly.length
      ? monthly
          .map(function (row) {
            return (
              "<tr><td><strong>" + esc(monthLabel(row.month)) + "</strong></td>" +
              '<td class="text-right">' + row.present + "</td>" +
              '<td class="text-right">' + row.absent + "</td>" +
              '<td class="text-right">' + row.tardy + "</td>" +
              '<td class="text-right">' + row.excused + "</td>" +
              '<td class="text-right">' + row.half_day + "</td>" +
              '<td class="text-right">' + row.recorded + "</td></tr>"
            );
          })
          .join("")
      : emptyRow(7, "No attendance entries were saved for this school year.");

    var sorted = records.slice().sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
    el("attendanceLogBody").innerHTML = sorted.length
      ? sorted
          .map(function (record) {
            return (
              "<tr><td>" + esc(window.UI.phDate(record.date)) + "</td><td>" +
              metaBadge(ATTENDANCE, record.status) +
              "</td><td>" + esc(record.remarks || "—") + "</td></tr>"
            );
          })
          .join("")
      : emptyRow(3, "No daily entries were saved for this school year.");
  }

  /* Grades ----------------------------------------------------------------- */

  function loadGrades(force) {
    if (state.grades && !force) {
      return;
    }
    el("learnerGradeCount").textContent = "…";
    var mount = el("learnerGradesMount");
    mount.innerHTML = '<span class="skeleton skeleton-block" style="height:180px"></span>';
    return L.apiGet("/grades/learners/" + state.learnerId)
      .then(function (payload) {
        state.grades = payload;
        el("learnerGradeCount").textContent = (payload.enrollments || []).length;
        renderGrades(payload);
      })
      .catch(function (error) {
        el("learnerGradeCount").textContent = "—";
        mount.innerHTML = emptyState("bi-journal-x", "Grades unavailable", L.friendlyError(error));
        failure("learnerPageAlert", error, "Grades unavailable");
      });
  }

  function gradeCell(value) {
    return value === null || value === undefined || value === ""
      ? '<span class="grade-missing">—</span>'
      : '<span class="grade-number">' + esc(number(value, 2)) + "</span>";
  }

  function renderGrades(payload) {
    var enrollments = payload.enrollments || [];
    var mount = el("learnerGradesMount");
    if (!enrollments.length) {
      mount.innerHTML = emptyState(
        "bi-journal-check",
        "No grades recorded",
        "Grades appear after a subject teacher encodes quarter grades for a school-year enrollment."
      );
      return;
    }
    mount.innerHTML = enrollments
      .map(function (record) {
        var decision = record.decision ? metaBadge(DECISION, record.decision) : "";
        var workflow = record.workflowStatus ? metaBadge(WORKFLOW, record.workflowStatus) : "";
        var card = record.reportCard
          ? badge(record.reportCard.statusLabel, (REPORT_STATUS[record.reportCard.status] || {}).tone) +
            (record.reportCard.version > 1 ? ' <span class="meta-chip">v' + record.reportCard.version + "</span>" : "")
          : badge("No report card", "muted");
        var rows = record.subjects.length
          ? record.subjects
              .map(function (subject) {
                return (
                  "<tr><td><strong>" + esc(subject.subjectCode || "") + "</strong> " + esc(subject.subjectName) + "</td>" +
                  "<td>" + gradeCell(subject.q1) + "</td>" +
                  "<td>" + gradeCell(subject.q2) + "</td>" +
                  "<td>" + gradeCell(subject.q3) + "</td>" +
                  "<td>" + gradeCell(subject.q4) + "</td>" +
                  "<td>" + gradeCell(subject.final) + "</td>" +
                  "<td>" + (subject.status ? metaBadge(GRADE_STATUS, subject.status) : badge("No final", "muted")) + "</td></tr>"
                );
              })
              .join("")
          : '<tr><td colspan="7" class="empty-cell">No subject grades were encoded for this school year.</td></tr>';
        return (
          '<article class="academic-card">' +
          '<header class="academic-card__head"><div><strong>' +
          esc(record.schoolYearName) +
          "</strong><span>" +
          esc(record.gradeLevelName || "Grade not set") +
          (record.sectionName ? " · " + esc(record.sectionName) : "") +
          "</span></div><div class=\"academic-card__badges\">" +
          decision +
          (workflow ? " " + workflow : "") +
          "<span class=\"academic-average\"><small>General average</small><strong>" +
          (record.generalAverage === null ? "—" : esc(number(record.generalAverage, 2))) +
          "</strong></span>" +
          card +
          "</div></header>" +
          '<div class="table-responsive"><table class="app-table academic-table">' +
          '<caption class="sr-only">Grades for ' + esc(record.schoolYearName) + "</caption>" +
          "<thead><tr><th scope=\"col\">Subject</th><th scope=\"col\">Q1</th><th scope=\"col\">Q2</th>" +
          "<th scope=\"col\">Q3</th><th scope=\"col\">Q4</th><th scope=\"col\">Final</th>" +
          "<th scope=\"col\">Final status</th></tr></thead><tbody>" +
          rows +
          "</tbody></table></div></article>"
        );
      })
      .join("");
  }

  /* Books ------------------------------------------------------------------ */

  function loadBooks(force) {
    if (state.books && !force) {
      return;
    }
    el("learnerBookCount").textContent = "…";
    el("booksLearnerSummary").innerHTML = "";
    el("booksLearnerBody").innerHTML =
      '<tr><td colspan="8" class="empty-cell"><span class="skeleton skeleton-block"></span></td></tr>';
    return L.apiGet("/books/issuances", { learnerId: state.learnerId, pageSize: 100 })
      .then(function (payload) {
        state.books = payload;
        el("learnerBookCount").textContent = (payload.items || []).length;
        renderBooks(payload);
      })
      .catch(function (error) {
        el("learnerBookCount").textContent = "—";
        el("booksLearnerBody").innerHTML = emptyRow(8, L.friendlyError(error));
        failure("learnerPageAlert", error, "Book records unavailable");
      });
  }

  function renderBooks(payload) {
    var items = payload.items || [];
    var issued = 0;
    var returned = 0;
    var outstanding = 0;
    var openIssues = 0;
    items.forEach(function (item) {
      issued += item.quantityIssued;
      returned += item.quantityReturned;
      outstanding += item.outstanding;
      if (item.outstanding > 0) {
        openIssues += 1;
      }
    });
    el("booksLearnerSummary").innerHTML =
      '<div class="mini-card"><span>Issuance records</span><strong>' + items.length + "</strong></div>" +
      '<div class="mini-card"><span>Copies issued</span><strong>' + issued + "</strong></div>" +
      '<div class="mini-card"><span>Copies returned</span><strong>' + returned + "</strong></div>" +
      '<div class="mini-card"><span>Outstanding copies</span><strong>' + outstanding + "</strong><small>" + openIssues + " open record(s)</small></div>";
    el("booksLearnerBody").innerHTML = items.length
      ? items
          .map(function (item) {
            return (
              "<tr><td><strong>" + esc(item.title) + "</strong>" +
              (item.author ? "<br><small>" + esc(item.author) + "</small>" : "") + "</td>" +
              "<td>" + esc(item.schoolYearName || "—") + "</td>" +
              '<td class="text-right">' + item.quantityIssued + "</td>" +
              '<td class="text-right">' + item.quantityReturned + "</td>" +
              '<td class="text-right"><strong>' + item.outstanding + "</strong></td>" +
              "<td>" + esc(window.UI.phDate(item.issuedOn)) + "</td>" +
              "<td>" + esc(item.expectedReturnOn ? window.UI.phDate(item.expectedReturnOn) : "—") + "</td>" +
              "<td>" + metaBadge(BOOK_STATUS, item.status) + "</td></tr>"
            );
          })
          .join("")
      : emptyRow(8, "No books or materials have been issued to this learner.");
  }

  /* Health ----------------------------------------------------------------- */

  function loadHealth(force) {
    if (state.health && !force) {
      return;
    }
    var mount = el("healthLearnerMount");
    mount.innerHTML = '<span class="skeleton skeleton-block" style="height:180px"></span>';
    return L.apiGet("/health/learners/" + state.learnerId)
      .then(function (payload) {
        state.health = payload;
        renderHealth(payload);
      })
      .catch(function (error) {
        mount.innerHTML = emptyState("bi-shield-lock", "Health record unavailable", L.friendlyError(error));
        failure("learnerPageAlert", error, "Health record unavailable");
      });
  }

  function renderHealth(payload) {
    var mount = el("healthLearnerMount");
    var measurements = (payload.measurements || []).slice().reverse();
    if (!measurements.length) {
      mount.innerHTML = emptyState(
        "bi-heart-pulse",
        "No health measurements recorded",
        "Authorized school health personnel can record height, weight, BMI, and nutritional status in the health workspace."
      );
      return;
    }
    var latest = measurements[0];
    mount.innerHTML =
      '<div class="mini-grid mb-3">' +
      '<div class="mini-card"><span>Latest BMI</span><strong>' + esc(number(latest.bmi, 2)) + "</strong><small>" + esc(window.UI.phDate(latest.measuredOn)) + "</small></div>" +
      '<div class="mini-card"><span>Nutritional status</span><strong>' + esc((NUTRITION[latest.nutritionalStatus] || NUTRITION.not_assessed).label) + "</strong></div>" +
      '<div class="mini-card"><span>Weight</span><strong>' + esc(number(latest.weightKg, 1)) + " kg</strong></div>" +
      '<div class="mini-card"><span>Height</span><strong>' + esc(number(latest.heightCm, 1)) + " cm</strong></div>" +
      '<div class="mini-card"><span>Measurements</span><strong>' + measurements.length + "</strong><small>Across recorded school years</small></div>" +
      "</div>" +
      '<div class="measurement-list">' +
      measurements
        .map(function (row) {
          var flags = (row.flags || []).length
            ? '<p class="measurement-flags"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i> ' +
              esc(row.flags.join(" ")) +
              "</p>"
            : "";
          return (
            '<article class="measurement-row">' +
            '<div class="measurement-row__date"><strong>' + esc(window.UI.phDate(row.measuredOn)) + "</strong><span>" + esc(row.schoolYearName || "") + "</span></div>" +
            '<div class="measurement-row__values">' +
            "<span>Weight <strong>" + esc(number(row.weightKg, 1)) + " kg</strong></span>" +
            "<span>Height <strong>" + esc(number(row.heightCm, 1)) + " cm</strong></span>" +
            "<span>BMI <strong>" + esc(number(row.bmi, 2)) + "</strong></span>" +
            metaBadge(NUTRITION, row.nutritionalStatus) +
            "</div>" + flags + "</article>"
          );
        })
        .join("") +
      "</div>";
  }

  /* School Forms ----------------------------------------------------------- */

  function previewForm(code) {
    var current = enrollment();
    var params = {
      schoolId: schoolId() || undefined,
      schoolYearId: yearId() || undefined,
      sectionId: sectionId() || undefined,
      learnerId: state.learnerId
    };
    if (code === "sf10") {
      // SF 10 is cumulative; the section is not part of its scope.
      params.sectionId = undefined;
    }
    if (!current) {
      window.UI.showAlert(
        el("learnerPageAlert"),
        "warning",
        "Add a school-year record for this learner before generating a learner form.",
        "Enrollment required"
      );
      return;
    }
    F.previewForm(code, params, {
      title: code === "sf10" ? "SF 10 · Permanent Academic Record" : "SF 9 · Report Card",
      eyebrow: code.toUpperCase(),
      onGenerated: function () {
        loadForms(true);
        loadPermanent(true);
      }
    });
  }

  function loadForms(force) {
    if (state.forms && !force) {
      return;
    }
    var year = yearId();
    var school = schoolId();
    el("learnerFormsCards").innerHTML = '<div class="skeleton skeleton-block" style="height:150px"></div>';
    el("learnerFormsSubmissions").innerHTML =
      '<tr><td colspan="6" class="empty-cell"><span class="skeleton skeleton-block"></span></td></tr>';
    if (!school || !year) {
      el("learnerFormsCards").innerHTML = emptyState("bi-files", "School forms need a school year", "Add a school-year record before preparing learner forms.");
      el("learnerFormsSubmissions").innerHTML = emptyRow(6, "No school year is available.");
      return;
    }
    state.forms = true;
    Promise.all([
      L.apiGet("/school-forms/cards", { schoolId: school, schoolYearId: year }),
      L.apiGet("/school-forms/submissions", {
        schoolId: school,
        schoolYearId: year,
        learnerId: state.learnerId
      }),
      L.apiGet("/school-forms/submissions", { schoolId: school, schoolYearId: year })
    ])
      .then(function (results) {
        state.formsCards = results[0];
        state.formsSubmissions = results[2] || [];
        renderForms(results[0], results[1] || [], results[2] || []);
      })
      .catch(function (error) {
        state.forms = null;
        el("learnerFormsCards").innerHTML = emptyState("bi-files", "School forms unavailable", L.friendlyError(error));
        el("learnerFormsSubmissions").innerHTML = emptyRow(6, L.friendlyError(error));
        failure("learnerPageAlert", error, "School forms unavailable");
      });
  }

  function formCard(options) {
    return (
      '<article class="form-choice">' +
      '<div class="form-choice__icon"><i class="bi ' + options.icon + '" aria-hidden="true"></i></div>' +
      '<div class="form-choice__body">' +
      '<div class="form-choice__head"><h3>' + esc(options.title) + "</h3>" + options.badge + "</div>" +
      "<p>" + esc(options.description) + "</p>" +
      '<div class="form-choice__meta">' +
      '<span class="meta-chip"><i class="bi bi-hash" aria-hidden="true"></i> ' + esc(options.code.toUpperCase()) + "</span>" +
      (options.period ? '<span class="meta-chip">' + esc(options.period) + "</span>" : "") +
      (options.deadline ? '<span class="meta-chip"><i class="bi bi-calendar-event" aria-hidden="true"></i> Due ' + esc(window.UI.phDate(options.deadline)) + "</span>" : "") +
      "</div>" +
      '<div class="form-choice__actions">' + options.actions + "</div>" +
      "</div></article>"
    );
  }

  function renderForms(cardsPayload, learnerSubmissions, allSubmissions) {
    var cards = (cardsPayload && cardsPayload.cards) || [];
    var byForm = latestByForm(learnerSubmissions);
    var cardMap = {};
    cards.forEach(function (card) {
      cardMap[card.code] = card;
    });

    var sf9 = byForm.sf9;
    var sf10 = byForm.sf10;
    var html = "";

    if (can("canViewGrades")) {
      var sf9Card = cardMap.sf9 || {};
      html += formCard({
        icon: "bi-file-earmark-medical",
        code: "sf9",
        title: sf9Card.title || "Learner Progress Report Card",
        description:
          sf9Card.description ||
          "Quarterly grades, final grades, and promotion status for this learner and school year.",
        badge: sf9 ? F.statusBadge(sf9.status) : badge("Not generated", "muted"),
        period: sf9 && sf9.period ? sf9.period : "",
        deadline: sf9Card.deadline ? sf9Card.deadline.dueDate : "",
        actions:
          '<button type="button" class="btn btn-light btn-sm" data-preview-form="sf9"><i class="bi bi-eye" aria-hidden="true"></i> Preview</button>' +
          '<a class="btn btn-light btn-sm" href="grades.html"><i class="bi bi-journal-check" aria-hidden="true"></i> Report cards</a>'
      });
    }

    if (can("canViewPermanentRecords")) {
      var sf10Card = cardMap.sf10 || {};
      html += formCard({
        icon: "bi-shield-check",
        code: "sf10",
        title: sf10Card.title || "Learner Permanent Academic Record",
        description:
          sf10Card.description ||
          "Cumulative academic history across school years, with verified and proposed entries clearly distinguished.",
        badge: sf10 ? F.statusBadge(sf10.status) : badge("Not generated", "muted"),
        period: "",
        deadline: sf10Card.deadline ? sf10Card.deadline.dueDate : "",
        actions:
          '<button type="button" class="btn btn-light btn-sm" data-preview-form="sf10"><i class="bi bi-eye" aria-hidden="true"></i> Preview</button>'
      });
    }

    el("learnerFormsCards").innerHTML = html || emptyState(
      "bi-files",
      "No learner forms available to you",
      "Learner forms depend on grades and permanent-record access. Ask an administrator if you need access."
    );

    el("learnerFormsCards").onclick = function (event) {
      var button = event.target.closest("[data-preview-form]");
      if (button) {
        previewForm(button.dataset.previewForm);
      }
    };

    var currentSection = sectionId();
    var schoolWide = ["sf1", "sf3", "sf4", "sf6", "sf7", "sf10"];
    var related = (allSubmissions || []).filter(function (row) {
      if (row.learnerId) {
        return String(row.learnerId) === String(state.learnerId);
      }
      if (currentSection && String(row.sectionId || "") === currentSection) {
        return true;
      }
      return !row.sectionId && schoolWide.indexOf(row.formCode) !== -1;
    });

    el("learnerFormsSubmissions").innerHTML = related.length
      ? related
          .map(function (row) {
            var scope = row.learnerId
              ? "Learner"
              : row.sectionName
                ? row.sectionName + (row.gradeLevelName ? " · " + row.gradeLevelName : "")
                : row.gradeLevelName || "School-wide";
            return (
              "<tr><td><strong>" + esc(row.formCode.toUpperCase()) + "</strong> " + esc(row.formTitle) + "</td>" +
              "<td>" + esc(scope) + (row.period ? "<br><small>" + esc(monthLabel(row.period)) + "</small>" : "") + "</td>" +
              "<td>" + F.statusBadge(row.status) + "</td>" +
              "<td>" + F.completion(row.completeness) + "</td>" +
              "<td>" + esc(window.UI.phDateTime(row.updatedAt)) + "</td>" +
              '<td class="text-right"><button type="button" class="btn btn-light btn-sm" data-submission="' +
              row.id + '"><i class="bi bi-box-arrow-in-right" aria-hidden="true"></i> View</button></td></tr>'
            );
          })
          .join("")
      : emptyRow(6, "No school forms have been submitted for this learner's section or school year.");

    el("learnerFormsSubmissions").onclick = function (event) {
      var button = event.target.closest("[data-submission]");
      if (!button) {
        return;
      }
      F.openSubmission(button.dataset.submission, {
        onChanged: function () {
          loadForms(true);
        }
      });
    };
  }

  /* Permanent records ------------------------------------------------------ */

  function loadPermanent(force) {
    if (state.permanent && !force) {
      return;
    }
    var ready = can("canViewGrades") ? loadGrades(force) : Promise.resolve();
    Promise.resolve(ready)
      .then(function () {
        state.permanent = true;
        renderPermanent();
      })
      .catch(function () {
        state.permanent = true;
        renderPermanent();
      });
  }

  function renderPermanent() {
    var enrollments = (state.detail.enrollments || []).slice().sort(function (a, b) {
      return String(b.schoolYearName).localeCompare(String(a.schoolYearName));
    });
    var gradesByEnrollment = {};
    var academic = state.grades;
    if (academic) {
      (academic.enrollments || []).forEach(function (record) {
        gradesByEnrollment[String(record.enrollmentId)] = record;
      });
    }

    var years = enrollments.length;
    var finalized = 0;
    var issued = 0;
    var approved = 0;
    enrollments.forEach(function (entry) {
      var record = gradesByEnrollment[String(entry.id)];
      if (!record) {
        return;
      }
      (record.subjects || []).forEach(function (subject) {
        if (subject.status === "finalized") {
          finalized += 1;
        }
      });
      if (record.reportCard && record.reportCard.status === "issued") {
        issued += 1;
      }
      if (["approved", "finalized"].indexOf(record.workflowStatus) !== -1) {
        approved += 1;
      }
    });

    el("permanentSummary").innerHTML =
      '<div class="mini-card"><span>School years on record</span><strong>' + years + "</strong></div>" +
      '<div class="mini-card"><span>Finalized subject grades</span><strong>' + (academic ? finalized : "—") + "</strong><small>" + (academic ? "Across all school years" : "Grades access required") + "</small></div>" +
      '<div class="mini-card"><span>Report cards issued</span><strong>' + (academic ? issued : "—") + "</strong></div>" +
      '<div class="mini-card"><span>Approved promotion decisions</span><strong>' + (academic ? approved : "—") + "</strong></div>";

    if (!enrollments.length) {
      el("permanentHistory").innerHTML = emptyState(
        "bi-shield-check",
        "No academic history",
        "Add the learner's school-year records to begin the permanent academic history."
      );
      return;
    }

    el("permanentHistory").innerHTML =
      '<div class="table-responsive"><table class="app-table permanent-table">' +
      '<caption class="sr-only">Permanent academic history by school year</caption>' +
      '<thead><tr><th scope="col">School year</th><th scope="col">Grade and section</th>' +
      '<th scope="col" class="text-right">General average</th><th scope="col">Finalized grades</th>' +
      '<th scope="col">Promotion</th><th scope="col">Report card</th></tr></thead><tbody>' +
      enrollments
        .map(function (entry) {
          var record = gradesByEnrollment[String(entry.id)];
          var subjects = record ? record.subjects || [] : [];
          var done = subjects.filter(function (subject) {
            return subject.status === "finalized";
          }).length;
          var pending = subjects.length - done;
          var finalLabel = record
            ? done + " of " + subjects.length + " subject(s)" + (pending ? " · " + pending + " pending" : "")
            : can("canViewGrades")
              ? "No record"
              : "Grades access required";
          return (
            "<tr><td><strong>" + esc(entry.schoolYearName) + "</strong>" +
            (entry.isCurrentYear ? ' <span class="current-year-marker">Current</span>' : "") + "</td>" +
            "<td>" + esc(entry.gradeLevel || "—") + (entry.sectionName ? " · " + esc(entry.sectionName) : "") + "</td>" +
            '<td class="text-right">' + (record && record.generalAverage !== null ? esc(number(record.generalAverage, 2)) : "—") + "</td>" +
            "<td>" + esc(finalLabel) + "</td>" +
            "<td>" + (record && record.decision ? metaBadge(DECISION, record.decision) : badge("No decision", "muted")) + "</td>" +
            "<td>" + (record && record.reportCard ? badge(record.reportCard.statusLabel, (REPORT_STATUS[record.reportCard.status] || {}).tone) : badge("Not prepared", "muted")) + "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>" +
      '<p class="profile-footnote"><i class="bi bi-info-circle" aria-hidden="true"></i> This summary reflects saved system records. The official SF 10 separates verified historical entries from proposals and must be verified before certification.</p>';
  }

  window.LearnerAcademic = {
    mount: mount,
    show: show,
    invalidate: invalidate,
    isAcademic: function (tab) {
      return state.academicTabs.indexOf(tab) !== -1;
    }
  };
})(window, document);
