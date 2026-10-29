/* School District Monitoring System — shared UI helpers */
(function (window, document) {
  "use strict";

  var numberFormatter = new Intl.NumberFormat("en-US");
  var dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  var dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  var phDateFormatter = new Intl.DateTimeFormat("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  var phDateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  var monthFormatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
  var relativeFormatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  var CHART_COLORS = {
    navy: "#12355b",
    royal: "#1d5fbf",
    blue: "#3d8fd1",
    sky: "#7cc2e8",
    teal: "#17a09a",
    amber: "#e29a2d",
    red: "#c8474f",
    violet: "#7a6ad8",
    slate: "#8a9bb0"
  };
  var CHART_PALETTE = [
    CHART_COLORS.royal,
    CHART_COLORS.teal,
    CHART_COLORS.amber,
    CHART_COLORS.violet,
    CHART_COLORS.blue,
    CHART_COLORS.red,
    CHART_COLORS.sky,
    CHART_COLORS.navy
  ];

  var REPORT_STATUS = {
    pending: { label: "Pending", tone: "warning" },
    submitted: { label: "Submitted", tone: "info" },
    late: { label: "Late", tone: "danger" },
    reviewed: { label: "Reviewed", tone: "success" },
    missing: { label: "Not submitted", tone: "neutral" }
  };
  var SCHOOL_STATUS = {
    active: { label: "Active", tone: "success" },
    inactive: { label: "Inactive", tone: "neutral" },
    archived: { label: "Archived", tone: "muted" }
  };
  var ROLE = {
    system_admin: { label: "System Administrator", short: "System Admin", tone: "violet" },
    district_admin: { label: "District Administrator", short: "District Admin", tone: "info" },
    psds: { label: "PSDS", short: "PSDS", tone: "primary" },
    school_head: { label: "School Head", short: "School Head", tone: "success" },
    teacher: { label: "Teacher", short: "Teacher", tone: "teal" },
    nt: { label: "NT", short: "NT", tone: "warning" },
    adviser: { label: "Class Adviser", short: "Adviser", tone: "violet" },
    learner: { label: "Learner", short: "Learner", tone: "info" },
    staff: { label: "Authorized Staff", short: "Staff", tone: "neutral" }
  };
  var ANNOUNCEMENT_STATUS = {
    draft: { label: "Draft", tone: "neutral" },
    published: { label: "Published", tone: "success" },
    archived: { label: "Archived", tone: "muted" }
  };

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function titleCase(value) {
    if (!value) {
      return "";
    }
    return String(value)
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, function (letter) {
        return letter.toUpperCase();
      });
  }

  function number(value) {
    if (value === null || value === undefined || value === "" || Number.isNaN(Number(value))) {
      return "0";
    }
    return numberFormatter.format(Number(value));
  }

  function compactNumber(value) {
    var numeric = Number(value || 0);
    if (Math.abs(numeric) >= 1000000) {
      return (numeric / 1000000).toFixed(numeric % 1000000 === 0 ? 0 : 1) + "M";
    }
    if (Math.abs(numeric) >= 1000) {
      return (numeric / 1000).toFixed(numeric % 1000 === 0 ? 0 : 1) + "K";
    }
    return String(numeric);
  }

  function date(value, fallback) {
    if (!value) {
      return fallback || "—";
    }
    var parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback || "—" : dateFormatter.format(parsed);
  }

  function dateTime(value, fallback) {
    if (!value) {
      return fallback || "—";
    }
    var parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback || "—" : dateTimeFormatter.format(parsed);
  }

  function phDate(value, fallback) {
    if (!value) {
      return fallback || "—";
    }
    var parsed = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? value + "T00:00:00" : value);
    return Number.isNaN(parsed.getTime()) ? fallback || "—" : phDateFormatter.format(parsed);
  }

  function phDateTime(value, fallback) {
    if (!value) {
      return fallback || "—";
    }
    var parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback || "—" : phDateTimeFormatter.format(parsed);
  }

  function time(value, fallback) {
    if (!value) {
      return fallback || "—";
    }
    var parts = String(value).slice(0, 5).split(":");
    var hours = Number(parts[0]);
    var minutes = parts[1];
    if (Number.isNaN(hours) || !minutes) {
      return String(value);
    }
    var suffix = hours >= 12 ? "PM" : "AM";
    var display = hours % 12 === 0 ? 12 : hours % 12;
    return display + ":" + minutes + " " + suffix;
  }

  function month(value) {
    if (!value || !/^\d{4}-\d{2}$/.test(String(value))) {
      return value || "—";
    }
    var parts = String(value).split("-");
    var parsed = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, 1));
    return monthFormatter.format(parsed);
  }

  function relativeTime(value) {
    if (!value) {
      return "—";
    }
    var parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "—";
    }
    var seconds = (parsed.getTime() - Date.now()) / 1000;
    var divisions = [
      { amount: 60, unit: "second" },
      { amount: 60, unit: "minute" },
      { amount: 24, unit: "hour" },
      { amount: 7, unit: "day" },
      { amount: 4.34524, unit: "week" },
      { amount: 12, unit: "month" },
      { amount: Number.POSITIVE_INFINITY, unit: "year" }
    ];
    for (var index = 0; index < divisions.length; index += 1) {
      var division = divisions[index];
      if (Math.abs(seconds) < division.amount) {
        return relativeFormatter.format(Math.round(seconds), division.unit);
      }
      seconds /= division.amount;
    }
    return "—";
  }

  function initials(name) {
    var parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) {
      return "?";
    }
    var first = parts[0].charAt(0);
    var last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
    return (first + last).toUpperCase();
  }

  function avatarUrl(user) {
    if (!user || !user.id || !user.photoUpdatedAt) {
      return "";
    }
    var stamp = new Date(user.photoUpdatedAt).getTime();
    var version = isNaN(stamp) ? encodeURIComponent(String(user.photoUpdatedAt)) : String(stamp);
    return "/api/users/" + encodeURIComponent(String(user.id)) + "/photo?v=" + version;
  }

  function avatarMarkup(user, extraClass, alt) {
    var classes = "avatar" + (extraClass ? " " + extraClass : "");
    var url = avatarUrl(user);
    if (url) {
      return (
        '<span class="' + classes + '">' +
        '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(alt || "Profile photo") + '" loading="lazy" decoding="async">' +
        "</span>"
      );
    }
    return '<span class="' + classes + '">' + escapeHtml(initials(user && user.fullName)) + "</span>";
  }

  function firstName(name) {
    var parts = String(name || "").trim().split(/\s+/);
    return parts[0] || "there";
  }

  function toneFor(kind, value) {
    var maps = {
      report: REPORT_STATUS,
      school: SCHOOL_STATUS,
      role: ROLE,
      announcement: ANNOUNCEMENT_STATUS
    };
    var map = maps[kind] || {};
    return map[value] || { label: titleCase(value) || "Unknown", tone: "neutral" };
  }

  function badge(kind, value, extraClass) {
    var meta = toneFor(kind, value);
    return (
      '<span class="status-badge status-badge--' +
      escapeHtml(meta.tone) +
      (extraClass ? " " + extraClass : "") +
      '"><span class="status-dot"></span>' +
      escapeHtml(meta.label) +
      "</span>"
    );
  }

  function pillarBadge(label, tone) {
    return (
      '<span class="status-badge status-badge--' +
      escapeHtml(tone || "neutral") +
      '"><span class="status-dot"></span>' +
      escapeHtml(label) +
      "</span>"
    );
  }

  function toast(title, message, type) {
    var stack = document.getElementById("toastStack");
    if (!stack) {
      return;
    }
    var tone = type || "info";
    var iconMap = {
      success: "bi-check-circle-fill",
      danger: "bi-exclamation-octagon-fill",
      warning: "bi-exclamation-triangle-fill",
      info: "bi-info-circle-fill"
    };
    var wrapper = document.createElement("div");
    wrapper.className = "app-toast app-toast--" + tone;
    wrapper.setAttribute("role", tone === "danger" || tone === "warning" ? "alert" : "status");
    wrapper.innerHTML =
      '<div class="app-toast__icon"><i class="bi ' +
      (iconMap[tone] || iconMap.info) +
      '" aria-hidden="true"></i></div>' +
      '<div class="app-toast__body">' +
      (title ? '<p class="app-toast__title">' + escapeHtml(title) + "</p>" : "") +
      (message ? '<p class="app-toast__message">' + escapeHtml(message) + "</p>" : "") +
      "</div>" +
      '<button type="button" class="app-toast__close" aria-label="Dismiss notification"><i class="bi bi-x-lg" aria-hidden="true"></i></button>';
    var close = function () {
      wrapper.classList.add("is-leaving");
      window.setTimeout(function () {
        wrapper.remove();
      }, 220);
    };
    wrapper.querySelector(".app-toast__close").addEventListener("click", close);
    stack.appendChild(wrapper);
    window.setTimeout(close, 5200);
  }

  function flash(message, type) {
    try {
      window.sessionStorage.setItem(
        "sdms.flash",
        JSON.stringify({ message: message, type: type || "info" })
      );
    } catch (error) {
      /* Storage may be unavailable in private mode. */
    }
  }

  function consumeFlash() {
    try {
      var raw = window.sessionStorage.getItem("sdms.flash");
      if (!raw) {
        return;
      }
      window.sessionStorage.removeItem("sdms.flash");
      var payload = JSON.parse(raw);
      window.setTimeout(function () {
        toast("", payload.message, payload.type || "info");
      }, 280);
    } catch (error) {
      /* Ignore malformed flash payloads. */
    }
  }

  function setButtonLoading(button, loading, label) {
    if (!button) {
      return;
    }
    if (loading) {
      button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.innerHTML =
        '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span><span>' +
        escapeHtml(label || "Working…") +
        "</span>";
    } else {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (button.dataset.originalHtml) {
        button.innerHTML = button.dataset.originalHtml;
        delete button.dataset.originalHtml;
      }
    }
  }

  function confirmDialog(options) {
    var settings = Object.assign(
      {
        title: "Confirm action",
        message: "Are you sure you want to continue?",
        confirmLabel: "Confirm",
        cancelLabel: "Cancel",
        tone: "primary"
      },
      options || {}
    );

    return new Promise(function (resolve) {
      var existing = document.getElementById("uiConfirmModal");
      if (existing) {
        existing.remove();
      }
      var element = document.createElement("div");
      element.className = "modal fade";
      element.id = "uiConfirmModal";
      element.tabIndex = -1;
      element.setAttribute("role", "dialog");
      element.setAttribute("aria-labelledby", "uiConfirmTitle");
      element.setAttribute("aria-hidden", "true");
      element.innerHTML =
        '<div class="modal-dialog modal-dialog-centered modal-sm-ui" role="document">' +
        '<div class="modal-content">' +
        '<div class="modal-body">' +
        '<div class="confirm-icon confirm-icon--' +
        escapeHtml(settings.tone) +
        '"><i class="bi ' +
        (settings.tone === "danger" ? "bi-exclamation-triangle" : "bi-question-lg") +
        '" aria-hidden="true"></i></div>' +
        '<h2 class="confirm-title" id="uiConfirmTitle">' +
        escapeHtml(settings.title) +
        "</h2>" +
        '<p class="confirm-message">' +
        escapeHtml(settings.message) +
        "</p>" +
        "</div>" +
        '<div class="modal-footer">' +
        '<button type="button" class="btn btn-light" data-dismiss="modal">' +
        escapeHtml(settings.cancelLabel) +
        "</button>" +
        '<button type="button" class="btn ' +
        (settings.tone === "danger" ? "btn-danger-soft" : "btn-primary") +
        '" data-confirm>' +
        escapeHtml(settings.confirmLabel) +
        "</button>" +
        "</div></div></div>";
      document.body.appendChild(element);

      var settled = false;
      var instance = new window.bootstrap.Modal(element, { backdrop: "static", keyboard: true });
      var finish = function (value) {
        if (settled) {
          return;
        }
        settled = true;
        resolve(value);
      };
      element.querySelector("[data-confirm]").addEventListener("click", function () {
        finish(true);
        instance.hide();
      });
      element.addEventListener("hidden.bs.modal", function () {
        finish(false);
        element.remove();
      });
      instance.show();
    });
  }

  function showAlert(container, type, message, title) {
    if (!container) {
      return;
    }
    container.innerHTML =
      '<div class="alert app-alert app-alert--' +
      escapeHtml(type || "danger") +
      '" role="alert">' +
      '<i class="bi ' +
      (type === "success" ? "bi-check-circle" : type === "warning" ? "bi-exclamation-triangle" : "bi-exclamation-circle") +
      '" aria-hidden="true"></i>' +
      "<div>" +
      (title ? '<strong class="d-block">' + escapeHtml(title) + "</strong>" : "") +
      "<span>" +
      escapeHtml(message || "") +
      "</span></div></div>";
    container.classList.remove("d-none");
  }

  function hideAlert(container) {
    if (!container) {
      return;
    }
    container.innerHTML = "";
    container.classList.add("d-none");
  }

  function clearFieldErrors(form) {
    if (!form) {
      return;
    }
    form.querySelectorAll(".is-invalid").forEach(function (field) {
      field.classList.remove("is-invalid");
    });
    form.querySelectorAll(".field-error").forEach(function (node) {
      node.textContent = "";
    });
  }

  function fieldError(field, message) {
    if (!field) {
      return;
    }
    field.classList.add("is-invalid");
    var container = field.closest(".form-group, .form-field, .custom-control");
    var target = container ? container.querySelector(".field-error") : null;
    if (!target) {
      target = field.parentElement.querySelector(".field-error");
    }
    if (target) {
      target.textContent = message;
    }
    field.setAttribute("aria-invalid", "true");
  }

  function showFieldErrors(form, error) {
    clearFieldErrors(form);
    if (!error) {
      return false;
    }
    var details = error.details || {};
    if (details.field) {
      var field = form.querySelector('[name="' + details.field + '"]');
      fieldError(field, error.message);
      if (field) {
        field.focus();
        field.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return true;
    }
    return false;
  }

  function validateForm(form, rules) {
    clearFieldErrors(form);
    var firstInvalid = null;
    var messages = rules || [];
    messages.some(function (rule) {
      var field = form.querySelector('[name="' + rule.name + '"]');
      if (!field) {
        return false;
      }
      var value = typeof field.value === "string" ? field.value.trim() : field.value;
      var error = null;
      if (rule.required && !value) {
        error = rule.requiredMessage || rule.label + " is required.";
      } else if (value && rule.minLength && value.length < rule.minLength) {
        error = rule.label + " must be at least " + rule.minLength + " characters.";
      } else if (value && rule.maxLength && value.length > rule.maxLength) {
        error = rule.label + " must be " + rule.maxLength + " characters or fewer.";
      } else if (value && rule.pattern && !rule.pattern.test(value)) {
        error = rule.patternMessage || rule.label + " is not in a valid format.";
      } else if (value && rule.match) {
        var other = form.querySelector('[name="' + rule.match + '"]');
        if (!other || other.value !== value) {
          error = rule.matchMessage || rule.label + " does not match.";
        }
      }
      if (error) {
        fieldError(field, error);
        if (!firstInvalid) {
          firstInvalid = field;
        }
      }
      return false;
    });
    if (firstInvalid) {
      firstInvalid.focus();
      firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" });
      return false;
    }
    return true;
  }

  function emptyState(options) {
    var settings = Object.assign(
      {
        icon: "bi-inbox",
        title: "Nothing here yet",
        message: "There is no data to display right now.",
        action: ""
      },
      options || {}
    );
    return (
      '<div class="empty-state">' +
      '<div class="empty-state__icon"><i class="bi ' +
      escapeHtml(settings.icon) +
      '" aria-hidden="true"></i></div>' +
      "<h3>" +
      escapeHtml(settings.title) +
      "</h3>" +
      "<p>" +
      escapeHtml(settings.message) +
      "</p>" +
      (settings.action || "") +
      "</div>"
    );
  }

  function pagination(container, data, onPage) {
    if (!container) {
      return;
    }
    var page = Number(data.page || 1);
    var pageSize = Number(data.pageSize || 10);
    var total = Number(data.total || 0);
    var totalPages = Math.max(1, Number(data.totalPages || 1));
    if (!total) {
      container.innerHTML = "";
      return;
    }
    var from = (page - 1) * pageSize + 1;
    var to = Math.min(total, page * pageSize);
    var pages = [];
    var start = Math.max(1, page - 2);
    var end = Math.min(totalPages, page + 2);
    if (end - start < 4) {
      start = Math.max(1, end - 4);
    }
    if (end - start < 4) {
      end = Math.min(totalPages, start + 4);
    }
    for (var index = start; index <= end; index += 1) {
      pages.push(index);
    }

    container.innerHTML =
      '<div class="pagination-meta">Showing <strong>' +
      from +
      "–" +
      to +
      "</strong> of <strong>" +
      number(total) +
      "</strong></div>" +
      '<nav aria-label="Pagination"><ul class="pagination app-pagination mb-0">' +
      '<li class="page-item ' +
      (page <= 1 ? "disabled" : "") +
      '"><button type="button" class="page-link" data-page="' +
      (page - 1) +
      '" aria-label="Previous page"><i class="bi bi-chevron-left" aria-hidden="true"></i></button></li>' +
      (start > 1
        ? '<li class="page-item"><button type="button" class="page-link" data-page="1">1</button></li>' +
          (start > 2 ? '<li class="page-item disabled"><span class="page-link">…</span></li>' : "")
        : "") +
      pages
        .map(function (numberPage) {
          return (
            '<li class="page-item ' +
            (numberPage === page ? "active" : "") +
            '"><button type="button" class="page-link" data-page="' +
            numberPage +
            '"' +
            (numberPage === page ? ' aria-current="page"' : "") +
            ">" +
            numberPage +
            "</button></li>"
          );
        })
        .join("") +
      (end < totalPages
        ? (end < totalPages - 1
            ? '<li class="page-item disabled"><span class="page-link">…</span></li>'
            : "") +
          '<li class="page-item"><button type="button" class="page-link" data-page="' +
          totalPages +
          '">' +
          totalPages +
          "</button></li>"
        : "") +
      '<li class="page-item ' +
      (page >= totalPages ? "disabled" : "") +
      '"><button type="button" class="page-link" data-page="' +
      (page + 1) +
      '" aria-label="Next page"><i class="bi bi-chevron-right" aria-hidden="true"></i></button></li>' +
      "</ul></nav>";

    container.querySelectorAll("[data-page]").forEach(function (button) {
      button.addEventListener("click", function () {
        var target = Number(button.dataset.page);
        if (target >= 1 && target <= totalPages && target !== page) {
          onPage(target);
        }
      });
    });
  }

  function tableLoading(columnCount, rows) {
    var count = rows || 6;
    var html = "";
    for (var index = 0; index < count; index += 1) {
      html += "<tr class=\"skeleton-row\">";
      for (var column = 0; column < columnCount; column += 1) {
        html += '<td><span class="skeleton skeleton-text" style="width:' + (45 + ((index + column) % 4) * 12) + '%"></span></td>';
      }
      html += "</tr>";
    }
    return html;
  }

  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments;
      var context = this;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        fn.apply(context, args);
      }, wait || 300);
    };
  }

  function actionLabel(action) {
    var labels = {
      "user.login": "signed in to the system",
      "user.logout": "signed out",
      "user.login_failed": "failed a sign-in attempt",
      "user.created": "created a user account",
      "user.updated": "updated a user account",
      "user.password_reset": "reset a password",
      "user.password_reset_requested": "requested a password reset",
      "school.created": "registered a new school",
      "school.updated": "updated a school record",
      "school.archived": "archived a school",
      "school.restored": "restored a school",
      "report.created": "submitted a school report",
      "report.submitted": "submitted a school report",
      "report.updated": "updated a school report",
      "announcement.created": "created an announcement",
      "announcement.updated": "updated an announcement",
      "announcement.published": "published an announcement",
      "profile.updated": "updated their profile",
      "profile.password_changed": "changed their password",
      "learner.created": "registered a learner",
      "learner.updated": "updated a learner profile",
      "learner.archived": "archived a learner record",
      "learner.restored": "restored a learner record",
      "learner.promoted": "promoted a learner to a new school year",
      "learner.document_uploaded": "uploaded a learner document",
      "learner.document_removed": "removed a learner document",
      "guardian.created": "added a parent or guardian",
      "guardian.updated": "updated a parent or guardian",
      "guardian.removed": "removed a parent or guardian",
      "enrollment.created": "added a school-year record",
      "enrollment.updated": "updated a school-year record",
      "activity.created": "created a learner activity",
      "activity.updated": "updated a learner activity",
      "activity.removed": "removed a learner activity",
      "activity.participant_added": "added an activity participant",
      "activity.participant_removed": "removed an activity participant",
      "school_year.created": "created a school year",
      "school_year.updated": "updated a school year",
      "school_year.structure_copied": "copied a school-year structure",
      "grade_level.created": "added a grade level",
      "grade_level.updated": "updated a grade level",
      "grade_level.removed": "removed a grade level",
      "section.created": "created a section",
      "section.updated": "updated a section",
      "section.removed": "removed a section",
      "subject.created": "created a subject",
      "subject.updated": "updated a subject",
      "subject.removed": "removed a subject",
      "assignment.created": "created a teaching assignment",
      "assignment.updated": "updated a teaching assignment",
      "assignment.removed": "removed a teaching assignment",
      "schedule.created": "added a class schedule",
      "schedule.updated": "updated a class schedule",
      "schedule.removed": "removed a class schedule"
    };
    return labels[action] || titleCase(String(action || "").replace(/\./g, " "));
  }

  function actionIcon(action) {
    var prefix = String(action || "").split(".")[0];
    var suffix = String(action || "").split(".")[1];
    if (suffix === "archived") {
      return "bi-archive";
    }
    if (prefix === "school") {
      return "bi-building";
    }
    if (prefix === "report") {
      return "bi-clipboard-check";
    }
    if (prefix === "user" || prefix === "profile") {
      return "bi-person";
    }
    if (prefix === "announcement") {
      return "bi-megaphone";
    }
    if (prefix === "learner") {
      return "bi-person-vcard";
    }
    if (prefix === "guardian") {
      return "bi-people";
    }
    if (prefix === "enrollment") {
      return "bi-journal-bookmark";
    }
    if (prefix === "activity") {
      return "bi-trophy";
    }
    if (prefix === "schedule") {
      return "bi-calendar-week";
    }
    if (prefix === "assignment" || prefix === "subject") {
      return "bi-easel2";
    }
    if (prefix === "section" || prefix === "grade_level" || prefix === "school_year") {
      return "bi-diagram-3";
    }
    return "bi-activity";
  }

  function actionTone(action) {
    if (/failed/.test(action)) {
      return "danger";
    }
    if (/created|submitted|published/.test(action)) {
      return "success";
    }
    if (/archived/.test(action)) {
      return "warning";
    }
    return "info";
  }

  function detailSummary(details) {
    if (!details || typeof details !== "object") {
      return "";
    }
    if (details.school_code) {
      return String(details.school_code);
    }
    if (details.title) {
      return String(details.title);
    }
    if (details.username) {
      return "@" + String(details.username);
    }
    if (details.period) {
      return month(details.period);
    }
    var keys = Object.keys(details);
    return keys.length ? titleCase(keys[0]) : "";
  }

  function setBusy(element, busy) {
    if (!element) {
      return;
    }
    element.classList.toggle("is-busy", Boolean(busy));
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  window.UI = {
    CHART_COLORS: CHART_COLORS,
    CHART_PALETTE: CHART_PALETTE,
    REPORT_STATUS: REPORT_STATUS,
    SCHOOL_STATUS: SCHOOL_STATUS,
    ROLE: ROLE,
    ANNOUNCEMENT_STATUS: ANNOUNCEMENT_STATUS,
    escapeHtml: escapeHtml,
    titleCase: titleCase,
    number: number,
    compactNumber: compactNumber,
    date: date,
    dateTime: dateTime,
    phDate: phDate,
    phDateTime: phDateTime,
    time: time,
    month: month,
    relativeTime: relativeTime,
    initials: initials,
    avatarUrl: avatarUrl,
    avatarMarkup: avatarMarkup,
    firstName: firstName,
    badge: badge,
    pillarBadge: pillarBadge,
    toast: toast,
    flash: flash,
    consumeFlash: consumeFlash,
    setButtonLoading: setButtonLoading,
    confirm: confirmDialog,
    showAlert: showAlert,
    hideAlert: hideAlert,
    clearFieldErrors: clearFieldErrors,
    fieldError: fieldError,
    showFieldErrors: showFieldErrors,
    validateForm: validateForm,
    emptyState: emptyState,
    pagination: pagination,
    tableLoading: tableLoading,
    debounce: debounce,
    actionLabel: actionLabel,
    actionIcon: actionIcon,
    actionTone: actionTone,
    detailSummary: detailSummary,
    setBusy: setBusy,
    scrollToTop: scrollToTop
  };
})(window, document);
