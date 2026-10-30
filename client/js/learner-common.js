/* DepEd Learner Records — shared helpers for learner module pages */
(function (window, document) {
  "use strict";

  var cache = {
    hierarchy: null,
    years: null,
    grades: {},
    sections: {},
    teachers: {},
    subjects: {},
    activities: {}
  };
  var modalCounter = 0;

  var ENROLLMENT_STATUS = {
    enrolled: { label: "Enrolled", tone: "success" },
    transferred_in: { label: "Transferred in", tone: "info" },
    transferred_out: { label: "Transferred out", tone: "warning" },
    promoted: { label: "Promoted", tone: "violet" },
    retained: { label: "Retained", tone: "danger" },
    completed: { label: "Completed", tone: "teal" },
    archived: { label: "Archived", tone: "muted" }
  };

  var PARTICIPATION_LEVEL = {
    classroom: { label: "Classroom", tone: "neutral" },
    school: { label: "School", tone: "info" },
    district: { label: "District", tone: "primary" },
    division: { label: "Division", tone: "violet" },
    regional: { label: "Regional", tone: "teal" },
    national: { label: "National", tone: "warning" },
    international: { label: "International", tone: "success" }
  };

  var DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  function esc(value) {
    return window.UI.escapeHtml(value);
  }

  function session() {
    return window.AppShell.getSession();
  }

  function permission(name) {
    var current = session();
    return Boolean(current && current.permissions && current.permissions[name]);
  }

  function todayIso() {
    var now = new Date();
    var local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 10);
  }

  function apiGet(path, params) {
    return API.get(path, params).then(function (payload) {
      return payload ? payload.data : null;
    });
  }

  function hierarchy() {
    if (cache.hierarchy) {
      return Promise.resolve(cache.hierarchy);
    }
    return API.get("/districts/hierarchy").then(function (payload) {
      cache.hierarchy = (payload.data && payload.data.districts) || [];
      return cache.hierarchy;
    });
  }

  function schools() {
    return hierarchy().then(function (districts) {
      var out = [];
      districts.forEach(function (district) {
        (district.schools || []).forEach(function (school) {
          out.push({
            id: Number(school.id),
            name: school.name,
            code: school.code,
            districtId: Number(district.id),
            districtName: district.name
          });
        });
      });
      return out;
    });
  }

  function schoolId() {
    var current = session();
    return current && current.user.schoolId ? Number(current.user.schoolId) : null;
  }

  function schoolName(schoolIdValue) {
    var current = session();
    if (!current) {
      return "";
    }
    if (current.user.schoolName && String(current.user.schoolId) === String(schoolIdValue)) {
      return current.user.schoolName;
    }
    var found = "";
    (current.districts || []).forEach(function (district) {
      (district.schools || []).forEach(function (school) {
        if (String(school.id) === String(schoolIdValue)) {
          found = school.name;
        }
      });
    });
    return found;
  }

  function schoolFieldHtml(selectedId) {
    var current = session();
    var fixed = schoolId();
    if (fixed) {
      return (
        '<input type="hidden" name="schoolId" value="' + fixed + '">' +
        '<div class="form-group"><label>School</label><input type="text" class="form-control" value="' +
        esc(current.user.schoolName || "Your school") +
        '" readonly></div>'
      );
    }
    return (
      '<div class="form-group"><label for="recordSchool">School <span class="required-mark">*</span></label>' +
      '<select class="custom-select" id="recordSchool" name="schoolId" data-school-select required>' +
      '<option value="">Loading schools…</option></select>' +
      '<span class="field-error"></span></div>'
    );
  }

  function fillSchoolSelect(select, selectedId) {
    if (!select) {
      return Promise.resolve();
    }
    return schools()
      .then(function (list) {
        var options = ['<option value="">Select a school</option>'];
        var lastDistrict = null;
        list.forEach(function (school) {
          if (school.districtName !== lastDistrict) {
            if (lastDistrict !== null) {
              options.push("</optgroup>");
            }
            options.push('<optgroup label="' + esc(school.districtName) + '">');
            lastDistrict = school.districtName;
          }
          options.push(
            '<option value="' +
              school.id +
              '"' +
              (String(school.id) === String(selectedId) ? " selected" : "") +
              ">" +
              esc(school.name) +
              " (" +
              esc(school.code) +
              ")</option>"
          );
        });
        if (lastDistrict !== null) {
          options.push("</optgroup>");
        }
        select.innerHTML = options.join("");
      })
      .catch(function () {
        select.innerHTML = '<option value="">Schools unavailable</option>';
      });
  }

  function years() {
    if (cache.years) {
      return Promise.resolve(cache.years);
    }
    return apiGet("/academic/school-years").then(function (list) {
      cache.years = list || [];
      return cache.years;
    });
  }

  function currentYearId() {
    return years().then(function (list) {
      var current = list.find(function (year) {
        return year.isCurrent;
      });
      return current ? current.id : list[0] ? list[0].id : "";
    });
  }

  function grades(schoolIdValue) {
    var key = String(schoolIdValue || schoolId() || "all");
    if (cache.grades[key]) {
      return Promise.resolve(cache.grades[key]);
    }
    return apiGet("/academic/grade-levels", {
      schoolId: schoolIdValue || undefined
    }).then(function (list) {
      cache.grades[key] = list || [];
      return cache.grades[key];
    });
  }

  function sections(params) {
    var query = params || {};
    var key = JSON.stringify(query);
    if (cache.sections[key]) {
      return Promise.resolve(cache.sections[key]);
    }
    return apiGet("/academic/sections", query).then(function (list) {
      cache.sections[key] = list || [];
      return cache.sections[key];
    });
  }

  function teachers(schoolIdValue) {
    var key = String(schoolIdValue || schoolId() || "all");
    if (cache.teachers[key]) {
      return Promise.resolve(cache.teachers[key]);
    }
    return apiGet("/academic/teachers", {
      schoolId: schoolIdValue || undefined
    }).then(function (list) {
      cache.teachers[key] = list || [];
      return cache.teachers[key];
    });
  }

  function subjects(schoolIdValue) {
    var key = String(schoolIdValue || schoolId() || "all");
    if (cache.subjects[key]) {
      return Promise.resolve(cache.subjects[key]);
    }
    return apiGet("/academic/subjects", {
      schoolId: schoolIdValue || undefined
    }).then(function (list) {
      cache.subjects[key] = list || [];
      return cache.subjects[key];
    });
  }

  function activities(params) {
    var query = params || {};
    var key = JSON.stringify(query);
    if (cache.activities[key]) {
      return Promise.resolve(cache.activities[key]);
    }
    return apiGet("/activities", query).then(function (list) {
      cache.activities[key] = list || [];
      return cache.activities[key];
    });
  }

  function clearCache() {
    cache.years = null;
    cache.grades = {};
    cache.sections = {};
    cache.teachers = {};
    cache.subjects = {};
    cache.activities = {};
  }

  function option(value, label, selected) {
    return (
      '<option value="' +
      esc(value) +
      '"' +
      (String(value) === String(selected) ? " selected" : "") +
      ">" +
      esc(label) +
      "</option>"
    );
  }

  function options(list, valueKey, labelKey, selected, placeholder) {
    var html = placeholder ? '<option value="">' + esc(placeholder) + "</option>" : "";
    (list || []).forEach(function (item) {
      var value = typeof valueKey === "function" ? valueKey(item) : item[valueKey];
      var label = typeof labelKey === "function" ? labelKey(item) : item[labelKey];
      html += option(value, label, selected);
    });
    return html;
  }

  function yearOptions(list, selected, placeholder) {
    return options(
      list,
      "id",
      function (year) {
        return year.name + (year.isCurrent ? " · current" : "");
      },
      selected,
      placeholder || "All school years"
    );
  }

  function gradeOptions(list, selected, placeholder) {
    return options(
      list,
      "id",
      function (grade) {
        return grade.name + (grade.schoolName ? " · " + grade.schoolName : "");
      },
      selected,
      placeholder || "All grade levels"
    );
  }

  function sectionOptions(list, selected, placeholder) {
    return options(
      list,
      "id",
      function (section) {
        return (
          section.name +
          " · " +
          section.gradeLevel +
          (section.schoolYearName ? " (" + section.schoolYearName + ")" : "")
        );
      },
      selected,
      placeholder || "Select a section"
    );
  }

  function teacherOptions(list, selected, placeholder) {
    return options(
      list,
      "id",
      function (teacher) {
        return teacher.fullName + (teacher.employeeNumber ? " · " + teacher.employeeNumber : "");
      },
      selected,
      placeholder || "Not assigned"
    );
  }

  function badge(status) {
    var meta = ENROLLMENT_STATUS[status] || {
      label: window.UI.titleCase(status || "—"),
      tone: "neutral"
    };
    return window.UI.pillarBadge(meta.label, meta.tone);
  }

  function levelBadge(level) {
    var meta = PARTICIPATION_LEVEL[level] || {
      label: window.UI.titleCase(level || "—"),
      tone: "neutral"
    };
    return window.UI.pillarBadge(meta.label, meta.tone);
  }

  function profileBadge(complete) {
    return complete
      ? '<span class="status-badge status-badge--success"><span class="status-dot"></span>Complete</span>'
      : '<span class="status-badge status-badge--warning"><span class="status-dot"></span>Incomplete</span>';
  }

  function modal(options) {
    var settings = Object.assign(
      {
        title: "Dialog",
        eyebrow: "",
        body: "",
        footer: "",
        size: "",
        headerClass: ""
      },
      options || {}
    );
    var id = "learnerModal" + ++modalCounter;
    var element = document.createElement("div");
    element.className = "modal fade";
    element.id = id;
    element.tabIndex = -1;
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-labelledby", id + "Title");
    element.setAttribute("aria-hidden", "true");
    element.innerHTML =
      '<div class="modal-dialog modal-dialog-centered modal-dialog-scrollable ' +
      settings.size +
      '" role="document">' +
      '<div class="modal-content">' +
      '<div class="modal-header' +
      (settings.headerClass ? " " + settings.headerClass : "") +
      '">' +
      "<div>" +
      (settings.eyebrow ? '<p class="modal-eyebrow">' + esc(settings.eyebrow) + "</p>" : "") +
      '<h2 class="modal-title" id="' +
      id +
      'Title">' +
      esc(settings.title) +
      "</h2>" +
      (settings.subtitle ? '<p class="modal-subtitle">' + esc(settings.subtitle) + "</p>" : "") +
      "</div>" +
      '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
      "</div>" +
      '<div class="modal-body-learner">' +
      settings.body +
      "</div>" +
      '<div class="modal-footer">' +
      settings.footer +
      "</div>" +
      "</div></div>";
    document.body.appendChild(element);
    var instance = new window.bootstrap.Modal(element, { backdrop: true, keyboard: true });
    var discard = function () {
      element.remove();
    };
    if (window.jQuery) {
      /* Bootstrap 4 triggers hidden.bs.modal through jQuery, so a native
         addEventListener never fires and the dialog would linger in the DOM. */
      window.jQuery(element).on("hidden.bs.modal", discard);
    } else {
      element.addEventListener("hidden.bs.modal", discard);
    }
    instance.show();
    return {
      element: element,
      instance: instance,
      body: element.querySelector(".modal-body-learner"),
      footer: element.querySelector(".modal-footer"),
      close: function () {
        instance.hide();
      }
    };
  }

  function submit(form, button, alertBox, requestFactory, onSuccess) {
    window.UI.clearFieldErrors(form);
    window.UI.hideAlert(alertBox);
    window.UI.setButtonLoading(button, true, "Saving…");
    requestFactory()
      .then(function (payload) {
        window.UI.setButtonLoading(button, false);
        return onSuccess(payload);
      })
      .catch(function (error) {
        window.UI.setButtonLoading(button, false);
        if (error.status === 401) {
          return;
        }
        if (!window.UI.showFieldErrors(form, error)) {
          window.UI.showAlert(
            alertBox,
            "danger",
            friendlyError(error),
            "Could not save changes"
          );
        }
      });
  }

  function friendlyError(error) {
    if (!error) {
      return "The request could not be completed.";
    }
    if (error.status === 403) {
      return error.message || "You do not have permission to perform that action.";
    }
    if (error.status === 409) {
      return error.message || "That record conflicts with an existing record.";
    }
    return error.message || "The request could not be completed.";
  }

  function formValues(form) {
    var values = {};
    Array.prototype.forEach.call(form.elements, function (field) {
      if (!field.name) {
        return;
      }
      if (field.type === "checkbox") {
        values[field.name] = field.checked;
      } else if (field.type === "radio") {
        if (field.checked) {
          values[field.name] = field.value;
        }
      } else {
        values[field.name] = field.value;
      }
    });
    return values;
  }

  function setLoading(container, html) {
    if (container) {
      container.innerHTML = html;
    }
  }

  function skeletonRows(columns, rows) {
    return window.UI.tableLoading(columns, rows || 5);
  }

  function initials(name) {
    return window.UI.initials(name);
  }

  function printHtml(title, innerHtml) {
    var frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.right = "0";
    frame.style.bottom = "0";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    document.body.appendChild(frame);
    var doc = frame.contentWindow.document;
    var styles =
      "body{font-family:Inter,Arial,sans-serif;color:#13263b;margin:28px;font-size:11px}" +
      "h1{font-size:19px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 8px}" +
      ".print-meta{color:#5d7288;font-size:11px;margin-bottom:16px}" +
      "table{width:100%;border-collapse:collapse;margin:10px 0 18px}" +
      "th,td{border:1px solid #cbd8e8;padding:5px 7px;text-align:left;vertical-align:top}" +
      "th{background:#eef4fb;font-size:10px;text-transform:uppercase;letter-spacing:.04em}" +
      ".print-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px}" +
      ".print-grid div{border-bottom:1px solid #e1e8f2;padding:4px 0}" +
      ".print-grid span{color:#5d7288;display:block;font-size:9px;text-transform:uppercase;letter-spacing:.05em}" +
      ".print-sign{margin-top:38px;display:flex;justify-content:space-between;gap:40px}" +
      ".print-sign div{flex:1;border-top:1px solid #13263b;padding-top:5px;text-align:center;font-size:10px}" +
      "@page{size:landscape;margin:12mm}" +
      "@media print{body{margin:0}}";
    doc.open();
    doc.write(
      "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>" +
        esc(title) +
        "</title><style>" +
        styles +
        "</style></head><body>" +
        innerHtml +
        "</body></html>"
    );
    doc.close();
    frame.contentWindow.focus();
    window.setTimeout(function () {
      frame.contentWindow.print();
      window.setTimeout(function () {
        frame.remove();
      }, 60000);
    }, 250);
  }

  function tableHtml(headers, rows) {
    return (
      "<table><thead><tr>" +
      headers
        .map(function (header) {
          return "<th>" + esc(header) + "</th>";
        })
        .join("") +
      "</tr></thead><tbody>" +
      (rows.length
        ? rows
            .map(function (row) {
              return (
                "<tr>" +
                row
                  .map(function (cell) {
                    return "<td>" + esc(cell === null || cell === undefined ? "" : cell) + "</td>";
                  })
                  .join("") +
                "</tr>"
              );
            })
            .join("")
        : '<tr><td colspan="' + headers.length + '">No records.</td></tr>') +
      "</tbody></table>"
    );
  }

  window.LearnerUI = {
    ENROLLMENT_STATUS: ENROLLMENT_STATUS,
    PARTICIPATION_LEVEL: PARTICIPATION_LEVEL,
    DAY_NAMES: DAY_NAMES,
    esc: esc,
    session: session,
    permission: permission,
    todayIso: todayIso,
    apiGet: apiGet,
    hierarchy: hierarchy,
    schools: schools,
    schoolId: schoolId,
    schoolName: schoolName,
    schoolName: schoolName,
    schoolFieldHtml: schoolFieldHtml,
    fillSchoolSelect: fillSchoolSelect,
    years: years,
    currentYearId: currentYearId,
    grades: grades,
    sections: sections,
    teachers: teachers,
    subjects: subjects,
    activities: activities,
    clearCache: clearCache,
    option: option,
    options: options,
    yearOptions: yearOptions,
    gradeOptions: gradeOptions,
    sectionOptions: sectionOptions,
    teacherOptions: teacherOptions,
    badge: badge,
    levelBadge: levelBadge,
    profileBadge: profileBadge,
    modal: modal,
    submit: submit,
    friendlyError: friendlyError,
    formValues: formValues,
    setLoading: setLoading,
    skeletonRows: skeletonRows,
    initials: initials,
    printHtml: printHtml,
    tableHtml: tableHtml
  };
})(window, document);
