/* School District Monitoring System — school dialogs and CRUD helpers */
(function (window, document) {
  "use strict";

  var SCHOOL_TYPES = ["Elementary School", "High School", "Integrated School", "Senior High School"];
  var modalCounter = 0;

  function esc(value) {
    return window.UI.escapeHtml(value);
  }

  function optionList(values, selected) {
    return values
      .map(function (value) {
        return (
          '<option value="' +
          esc(value) +
          '"' +
          (value === selected ? " selected" : "") +
          ">" +
          esc(value) +
          "</option>"
        );
      })
      .join("");
  }

  function districtOptions(districts, selectedId) {
    return (districts || [])
      .map(function (district) {
        return (
          '<option value="' +
          district.id +
          '"' +
          (String(district.id) === String(selectedId) ? " selected" : "") +
          ">" +
          esc(district.name) +
          " (" +
          esc(district.code) +
          ")</option>"
        );
      })
      .join("");
  }

  function schoolFormMarkup(school, districts, canSelectDistrict) {
    var editing = Boolean(school);
    var districtField = canSelectDistrict
      ? '<div class="col-md-6"><div class="form-group">' +
        '<label for="schoolDistrict">District <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="schoolDistrict" name="districtId" required>' +
        '<option value="">Select a district</option>' +
        districtOptions(districts, school ? school.districtId : "") +
        "</select>" +
        '<span class="field-error"></span>' +
        "</div></div>"
      : "";

    return (
      '<form id="schoolForm" novalidate>' +
      '<div class="modal-body">' +
      '<div id="schoolFormAlert" class="d-none mb-3" role="alert"></div>' +
      '<p class="form-section-label">School identity</p>' +
      '<div class="row">' +
      '<div class="col-md-5"><div class="form-group">' +
      '<label for="schoolCode">School code <span class="required-mark">*</span></label>' +
      '<input class="form-control" id="schoolCode" name="schoolCode" required maxlength="32" placeholder="e.g. NVD-001" value="' +
      esc(school ? school.code : "") +
      '" autocapitalize="characters" spellcheck="false">' +
      '<span class="form-text">Letters, numbers, and hyphens only.</span>' +
      '<span class="field-error"></span>' +
      "</div></div>" +
      '<div class="col-md-7"><div class="form-group">' +
      '<label for="schoolName">Official school name <span class="required-mark">*</span></label>' +
      '<input class="form-control" id="schoolName" name="schoolName" required maxlength="200" placeholder="e.g. Central Elementary School" value="' +
      esc(school ? school.name : "") +
      '">' +
      '<span class="field-error"></span>' +
      "</div></div>" +
      '<div class="col-md-6"><div class="form-group">' +
      '<label for="schoolType">School type <span class="required-mark">*</span></label>' +
      '<select class="custom-select" id="schoolType" name="schoolType" required>' +
      optionList(SCHOOL_TYPES, school ? school.type : "Elementary School") +
      "</select>" +
      '<span class="field-error"></span>' +
      "</div></div>" +
      '<div class="col-md-6"><div class="form-group">' +
      '<label for="schoolStatus">School status <span class="required-mark">*</span></label>' +
      '<select class="custom-select" id="schoolStatus" name="status" required>' +
      '<option value="active"' +
      (!school || school.status === "active" ? " selected" : "") +
      ">Active</option>" +
      '<option value="inactive"' +
      (school && school.status === "inactive" ? " selected" : "") +
      ">Inactive</option>" +
      "</select>" +
      '<span class="field-error"></span>' +
      "</div></div>" +
      districtField +
      '<div class="col-md-6"><div class="form-group">' +
      '<label for="schoolHead">School head <span class="required-mark">*</span></label>' +
      '<input class="form-control" id="schoolHead" name="schoolHead" required maxlength="160" placeholder="Full name of the school head" value="' +
      esc(school ? school.head : "") +
      '">' +
      '<span class="field-error"></span>' +
      "</div></div>" +
      '<div class="col-12"><div class="form-group">' +
      '<label for="schoolAddress">Complete address <span class="required-mark">*</span></label>' +
      '<textarea class="form-control" id="schoolAddress" name="address" rows="2" required maxlength="500" placeholder="Street, barangay / city, province">' +
      esc(school ? school.address : "") +
      "</textarea>" +
      '<span class="field-error"></span>' +
      "</div></div>" +
      "</div>" +
      '<p class="form-section-label">Contact and monitoring</p>' +
      '<div class="row">' +
      '<div class="col-md-6"><div class="form-group">' +
      '<label for="schoolEmail">Contact email</label>' +
      '<input type="email" class="form-control" id="schoolEmail" name="contactEmail" maxlength="160" placeholder="school@district.edu" value="' +
      esc(school ? school.contactEmail || "" : "") +
      '">' +
      '<span class="field-error"></span>' +
      "</div></div>" +
      '<div class="col-md-6"><div class="form-group">' +
      '<label for="schoolPhone">Contact phone</label>' +
      '<input type="tel" class="form-control" id="schoolPhone" name="contactPhone" maxlength="32" placeholder="(555) 010-2000" value="' +
      esc(school ? school.contactPhone || "" : "") +
      '">' +
      '<span class="field-error"></span>' +
      "</div></div>" +
      '<div class="col-md-4"><div class="form-group">' +
      '<label for="studentCount">Student count <span class="required-mark">*</span></label>' +
      '<input type="number" class="form-control" id="studentCount" name="studentCount" min="0" max="1000000" step="1" required value="' +
      (school ? school.studentCount : 0) +
      '">' +
      '<span class="field-error"></span>' +
      "</div></div>" +
      '<div class="col-md-4"><div class="form-group">' +
      '<label for="teacherCount">Teaching personnel <span class="required-mark">*</span></label>' +
      '<input type="number" class="form-control" id="teacherCount" name="teacherCount" min="0" max="100000" step="1" required value="' +
      (school ? school.teacherCount : 0) +
      '">' +
      '<span class="field-error"></span>' +
      "</div></div>" +
      '<div class="col-md-4"><div class="form-group">' +
      '<label for="performanceScore">Performance score</label>' +
      '<input type="number" class="form-control" id="performanceScore" name="performanceScore" min="0" max="100" step="0.1" placeholder="0–100" value="' +
      (school && school.performanceScore !== null ? school.performanceScore : "") +
      '">' +
      '<span class="form-text">Optional. Used in district performance comparisons.</span>' +
      '<span class="field-error"></span>' +
      "</div></div>" +
      "</div>" +
      "</div>" +
      '<div class="modal-footer">' +
      '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
      '<button type="submit" class="btn btn-primary" id="schoolSaveButton">' +
      '<i class="bi bi-check2" aria-hidden="true"></i> ' +
      (editing ? "Save changes" : "Register school") +
      "</button>" +
      "</div></form>"
    );
  }

  function openForm(options) {
    var settings = Object.assign({ school: null, districts: [], canSelectDistrict: false, onSaved: null }, options || {});
    var editing = Boolean(settings.school);
    var id = "schoolFormModal" + (++modalCounter);
    var element = document.createElement("div");
    element.className = "modal fade";
    element.id = id;
    element.tabIndex = -1;
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-labelledby", id + "Title");
    element.setAttribute("aria-hidden", "true");
    element.innerHTML =
      '<div class="modal-dialog modal-dialog-centered modal-lg" role="document">' +
      '<div class="modal-content">' +
      '<div class="modal-header">' +
      "<div><h2 class=\"modal-title\" id=\"" +
      id +
      "Title\">" +
      (editing ? "Edit school record" : "Register a new school") +
      "</h2><p class=\"modal-subtitle\">" +
      (editing
        ? "Update enrollment, personnel, and monitoring details."
        : "Add an official school to the district register.") +
      "</p></div>" +
      '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
      "</div>" +
      schoolFormMarkup(settings.school, settings.districts, settings.canSelectDistrict) +
      "</div></div>";
    document.body.appendChild(element);

    var instance = new window.bootstrap.Modal(element, { backdrop: "static", keyboard: true });
    var form = element.querySelector("#schoolForm");
    var alertBox = element.querySelector("#schoolFormAlert");
    var saveButton = element.querySelector("#schoolSaveButton");

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      window.UI.hideAlert(alertBox);

      var codeField = form.querySelector("#schoolCode");
      if (codeField) {
        codeField.value = codeField.value.trim().toUpperCase();
      }

      var rules = [
        { name: "schoolCode", label: "School code", required: true, minLength: 3, maxLength: 32, pattern: /^[A-Z0-9-]+$/, patternMessage: "Use letters, numbers, and hyphens only." },
        { name: "schoolName", label: "School name", required: true, minLength: 2, maxLength: 200 },
        { name: "schoolType", label: "School type", required: true },
        { name: "schoolHead", label: "School head", required: true, minLength: 2, maxLength: 160 },
        { name: "address", label: "Address", required: true, minLength: 5, maxLength: 500 },
        { name: "studentCount", label: "Student count", required: true },
        { name: "teacherCount", label: "Teaching personnel", required: true }
      ];
      if (settings.canSelectDistrict) {
        rules.push({ name: "districtId", label: "District", required: true, requiredMessage: "Select a district." });
      }
      if (!window.UI.validateForm(form, rules)) {
        return;
      }

      var numericFields = ["studentCount", "teacherCount"];
      var invalidNumber = false;
      numericFields.forEach(function (name) {
        var field = form.querySelector('[name="' + name + '"]');
        var value = Number(field.value);
        if (!Number.isInteger(value) || value < 0) {
          window.UI.fieldError(field, "Enter a whole number of zero or greater.");
          invalidNumber = true;
        }
      });
      var scoreField = form.querySelector("#performanceScore");
      var scoreValue = scoreField.value.trim();
      if (scoreValue && (Number(scoreValue) < 0 || Number(scoreValue) > 100 || Number.isNaN(Number(scoreValue)))) {
        window.UI.fieldError(scoreField, "Enter a score between 0 and 100.");
        invalidNumber = true;
      }
      var emailField = form.querySelector("#schoolEmail");
      if (emailField.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.value.trim())) {
        window.UI.fieldError(emailField, "Enter a valid contact email.");
        invalidNumber = true;
      }
      var phoneField = form.querySelector("#schoolPhone");
      if (phoneField.value.trim() && !/^[0-9+()\-\s.]+$/.test(phoneField.value.trim())) {
        window.UI.fieldError(phoneField, "Use numbers, spaces, and + ( ) - . only.");
        invalidNumber = true;
      }
      if (invalidNumber) {
        return;
      }

      var payload = {
        schoolCode: codeField.value.trim().toUpperCase(),
        schoolName: form.querySelector("#schoolName").value.trim(),
        schoolType: form.querySelector("#schoolType").value,
        address: form.querySelector("#schoolAddress").value.trim(),
        schoolHead: form.querySelector("#schoolHead").value.trim(),
        contactEmail: emailField.value.trim(),
        contactPhone: phoneField.value.trim(),
        studentCount: Number(form.querySelector("#studentCount").value),
        teacherCount: Number(form.querySelector("#teacherCount").value),
        performanceScore: scoreValue === "" ? null : Number(scoreValue),
        status: form.querySelector("#schoolStatus").value
      };
      if (settings.canSelectDistrict) {
        payload.districtId = Number(form.querySelector("#schoolDistrict").value);
      }

      window.UI.setButtonLoading(saveButton, true, editing ? "Saving…" : "Registering…");
      var request = editing
        ? API.put("/schools/" + settings.school.id, payload)
        : API.post("/schools", payload);

      request
        .then(function (response) {
          window.UI.setButtonLoading(saveButton, false);
          instance.hide();
          window.UI.toast(
            editing ? "School updated" : "School registered",
            response.data.name + (editing ? " was updated successfully." : " was added to the district register."),
            "success"
          );
          if (typeof settings.onSaved === "function") {
            settings.onSaved(response.data, editing);
          }
        })
        .catch(function (error) {
          window.UI.setButtonLoading(saveButton, false);
          if (!window.UI.showFieldErrors(form, error)) {
            window.UI.showAlert(
              alertBox,
              "danger",
              error.status === 403
                ? "You do not have permission to manage this school."
                : error.message,
              "Could not save school"
            );
          }
        });
    });

    element.addEventListener("show.bs.modal", function () {
      window.setTimeout(function () {
        var first = form.querySelector("#schoolCode");
        if (first) {
          first.focus();
          first.select();
        }
      }, 180);
    });
    element.addEventListener("hidden.bs.modal", function () {
      element.remove();
    });
    instance.show();
  }

  function detailItem(label, value, extraClass) {
    return (
      '<div class="detail-item' +
      (extraClass ? " " + extraClass : "") +
      '"><span class="detail-label">' +
      esc(label) +
      '</span><span class="detail-value">' +
      (value === null || value === undefined || value === "" ? "—" : value) +
      "</span></div>"
    );
  }

  function openView(options) {
    var settings = Object.assign({ school: null, canManage: false, onEdit: null, onChanged: null }, options || {});
    var school = settings.school;
    if (!school) {
      return;
    }
    var id = "schoolViewModal" + (++modalCounter);
    var reportStatus = school.reportStatus || "missing";
    var reportMeta = window.UI.REPORT_STATUS[reportStatus] || { label: "Not submitted", tone: "neutral" };
    var schoolMeta = window.UI.SCHOOL_STATUS[school.status] || { label: window.UI.titleCase(school.status), tone: "neutral" };
    var ratio =
      school.teacherCount > 0
        ? Math.round((school.studentCount / school.teacherCount) * 10) / 10 + " : 1"
        : "—";
    var archived = school.status === "archived";
    var element = document.createElement("div");
    element.className = "modal fade";
    element.id = id;
    element.tabIndex = -1;
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-labelledby", id + "Title");
    element.setAttribute("aria-hidden", "true");
    element.innerHTML =
      '<div class="modal-dialog modal-dialog-centered modal-lg" role="document">' +
      '<div class="modal-content">' +
      '<div class="modal-header school-view-header">' +
      '<div class="school-view-identity">' +
      '<span class="school-view-icon"><i class="bi bi-building" aria-hidden="true"></i></span>' +
      "<div><p class=\"modal-eyebrow\">School record · " +
      esc(school.code) +
      "</p><h2 class=\"modal-title\" id=\"" +
      id +
      "Title\">" +
      esc(school.name) +
      "</h2><div class=\"school-view-badges\">" +
      window.UI.pillarBadge(schoolMeta.label, schoolMeta.tone) +
      window.UI.pillarBadge(reportMeta.label + " report", reportMeta.tone) +
      "</div></div>" +
      "</div>" +
      '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
      "</div>" +
      '<div class="modal-body">' +
      '<div class="school-stat-strip">' +
      '<div class="school-stat"><i class="bi bi-people" aria-hidden="true"></i><div><strong>' +
      esc(window.UI.number(school.studentCount)) +
      "</strong><span>Students</span></div></div>" +
      '<div class="school-stat"><i class="bi bi-person-video3" aria-hidden="true"></i><div><strong>' +
      esc(window.UI.number(school.teacherCount)) +
      "</strong><span>Teaching personnel</span></div></div>" +
      '<div class="school-stat"><i class="bi bi-diagram-3" aria-hidden="true"></i><div><strong>' +
      esc(ratio) +
      "</strong><span>Student–teacher ratio</span></div></div>" +
      '<div class="school-stat"><i class="bi bi-graph-up-arrow" aria-hidden="true"></i><div><strong>' +
      (school.performanceScore === null || school.performanceScore === undefined
        ? "—"
        : esc(school.performanceScore) + "<small>/100</small>") +
      "</strong><span>Performance score</span></div></div>" +
      "</div>" +
      '<div class="detail-grid">' +
      detailItem("School ID", esc(school.code)) +
      detailItem("School type", esc(school.type)) +
      detailItem("District", esc(school.districtName || "—")) +
      detailItem("School head", esc(school.head)) +
      detailItem("Contact email", school.contactEmail ? '<a href="mailto:' + esc(school.contactEmail) + '">' + esc(school.contactEmail) + "</a>" : "—") +
      detailItem("Contact phone", school.contactPhone ? '<a href="tel:' + esc(school.contactPhone) + '">' + esc(school.contactPhone) + "</a>" : "—") +
      detailItem("Complete address", esc(school.address), "detail-item--wide") +
      "</div>" +
      '<div class="report-callout report-callout--' +
      esc(reportMeta.tone) +
      '"><i class="bi bi-clipboard-check" aria-hidden="true"></i><div><strong>Latest monthly enrollment report</strong><span>' +
      esc(reportMeta.label) +
      (school.reportPeriod ? " for " + esc(window.UI.month(school.reportPeriod)) : "") +
      (school.submittedAt ? " · submitted " + esc(window.UI.dateTime(school.submittedAt)) : "") +
      "</span></div></div>" +
      '<div class="detail-timeline">' +
      '<span><i class="bi bi-calendar-plus" aria-hidden="true"></i> Added ' + esc(window.UI.date(school.createdAt)) + "</span>" +
      '<span><i class="bi bi-clock-history" aria-hidden="true"></i> Updated ' + esc(window.UI.dateTime(school.updatedAt)) + "</span>" +
      (school.archivedAt
        ? '<span><i class="bi bi-archive" aria-hidden="true"></i> Archived ' + esc(window.UI.dateTime(school.archivedAt)) + "</span>"
        : "") +
      "</div>" +
      "</div>" +
      '<div class="modal-footer">' +
      '<button type="button" class="btn btn-light" data-dismiss="modal">Close</button>' +
      (settings.canManage && archived
        ? '<button type="button" class="btn btn-primary" data-restore><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i> Restore school</button>'
        : "") +
      (settings.canManage && !archived
        ? '<button type="button" class="btn btn-primary" data-edit><i class="bi bi-pencil-square" aria-hidden="true"></i> Edit school</button>'
        : "") +
      "</div></div></div>";
    document.body.appendChild(element);
    var instance = new window.bootstrap.Modal(element);

    var editButton = element.querySelector("[data-edit]");
    if (editButton) {
      editButton.addEventListener("click", function () {
        instance.hide();
        if (typeof settings.onEdit === "function") {
          window.setTimeout(function () {
            settings.onEdit(school);
          }, 180);
        }
      });
    }
    var restoreButton = element.querySelector("[data-restore]");
    if (restoreButton) {
      restoreButton.addEventListener("click", function () {
        instance.hide();
        window.setTimeout(function () {
          restore({ school: school, onDone: settings.onChanged });
        }, 180);
      });
    }
    element.addEventListener("hidden.bs.modal", function () {
      element.remove();
    });
    instance.show();
  }

  function archive(options) {
    var settings = Object.assign({ school: null, onDone: null }, options || {});
    var school = settings.school;
    if (!school) {
      return Promise.resolve(false);
    }
    return window.UI.confirm({
      title: "Archive " + school.name + "?",
      message:
        "The school will be removed from active monitoring and default reports, but all of its records are retained. You can restore it at any time.",
      confirmLabel: "Archive school",
      tone: "danger"
    }).then(function (confirmed) {
      if (!confirmed) {
        return false;
      }
      return API.patch("/schools/" + school.id + "/archive")
        .then(function (response) {
          window.UI.toast("School archived", response.data.name + " is now archived. Records remain available.", "success");
          if (typeof settings.onDone === "function") {
            settings.onDone(response.data);
          }
          return true;
        })
        .catch(function (error) {
          window.UI.toast(
            "Could not archive school",
            error.status === 403 ? "You do not have permission to archive this school." : error.message,
            "danger"
          );
          return false;
        });
    });
  }

  function restore(options) {
    var settings = Object.assign({ school: null, onDone: null }, options || {});
    var school = settings.school;
    if (!school) {
      return Promise.resolve(false);
    }
    return window.UI.confirm({
      title: "Restore " + school.name + "?",
      message: "The school will return to the active district register with its previous record details and reporting history.",
      confirmLabel: "Restore school"
    }).then(function (confirmed) {
      if (!confirmed) {
        return false;
      }
      return API.patch("/schools/" + school.id + "/restore")
        .then(function (response) {
          window.UI.toast("School restored", response.data.name + " has been restored to the district register.", "success");
          if (typeof settings.onDone === "function") {
            settings.onDone(response.data);
          }
          return true;
        })
        .catch(function (error) {
          window.UI.toast(
            "Could not restore school",
            error.status === 403 ? "You do not have permission to restore this school." : error.message,
            "danger"
          );
          return false;
        });
    });
  }

  window.SchoolUI = {
    openForm: openForm,
    openView: openView,
    archive: archive,
    restore: restore,
    SCHOOL_TYPES: SCHOOL_TYPES
  };
})(window, document);
