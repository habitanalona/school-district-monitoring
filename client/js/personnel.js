/* DepEd Learner Records — personnel profiles, loads, and schedules */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var F = window.FormsUI;

  var EMPLOYMENT_TYPES = {
    plantilla: "Plantilla",
    provisional: "Provisional",
    contractual: "Contractual",
    substitute: "Substitute",
    volunteer: "Volunteer",
    other: "Other"
  };

  var state = {
    schoolId: "",
    yearId: "",
    years: [],
    personnel: [],
    loads: [],
    loadSchoolId: "",
    search: "",
    teaching: "",
    employmentStatus: "",
    tab: "register"
  };

  function el(id) {
    return document.getElementById(id);
  }

  function canManage() {
    return F.permission("canManagePersonnel");
  }

  function failed(error) {
    return error && error.status === 401;
  }

  function alertPage(tone, message, title) {
    F.pageAlert("personnelAlert", tone, message, title);
  }

  function currentSchoolId() {
    if (L.schoolId()) {
      return String(L.schoolId());
    }
    var select = el("personnelSchoolFilter");
    return select && select.value ? String(select.value) : "";
  }

  function scopeLabel() {
    var label = el("personnelScopeLabel");
    var schoolName = currentSchoolId()
      ? L.schoolName(currentSchoolId()) || "Selected school"
      : "All accessible schools";
    var year = state.years.find(function (item) {
      return String(item.id) === String(state.yearId);
    });
    label.textContent = schoolName + (year ? " · " + year.name : "") + " · " + state.personnel.length + " personnel record(s)";
  }

  function summary() {
    return L.apiGet("/personnel/summary", { schoolId: currentSchoolId() || undefined })
      .then(function (data) {
        el("summaryTotal").textContent = window.UI.number(data.total || 0);
        el("summaryTeaching").textContent = window.UI.number(data.teaching || 0);
        el("summaryNonTeaching").textContent = window.UI.number(data.nonTeaching || 0);
        el("summaryProfiled").textContent = window.UI.number(data.profiled || 0);
        el("summaryUnprofiled").textContent = window.UI.number(data.unprofiled || 0);
      })
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        alertPage("danger", L.friendlyError(error), "Could not load the personnel summary");
      });
  }

  function completenessBadge(item) {
    if (!item.completeness || item.completeness.complete) {
      return '<span class="status-badge status-badge--success"><span class="status-dot"></span>Complete</span>';
    }
    var missing = item.completeness.missing || [];
    return (
      '<span class="status-badge status-badge--warning" title="' +
      F.esc(missing.join(", ")) +
      '"><span class="status-dot"></span>Missing ' +
      missing.length +
      "</span>"
    );
  }

  function renderPersonnel() {
    var body = el("personnelBody");
    if (!state.personnel.length) {
      body.innerHTML = F.emptyRow(8, "No personnel match this filter.");
      el("personnelMeta").textContent = "No personnel records.";
      return;
    }
    body.innerHTML = state.personnel
      .map(function (item) {
        var hasProfile = Boolean(item.id);
        var actions = [];
        actions.push('<button type="button" class="btn btn-light btn-sm" data-loads="' + (item.userId || "") + '" title="View teaching load"><i class="bi bi-calendar3" aria-hidden="true"></i></button>');
        if (canManage()) {
          if (hasProfile) {
            actions.push('<button type="button" class="btn btn-light btn-sm" data-edit-personnel="' + item.id + '" title="Edit personnel profile"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>');
            actions.push('<button type="button" class="btn btn-light btn-sm" data-archive-personnel="' + item.id + '" title="Archive personnel profile"><i class="bi bi-archive" aria-hidden="true"></i></button>');
          } else {
            actions.push('<button type="button" class="btn btn-light btn-sm" data-create-profile="' + item.userId + '" title="Create personnel profile">Profile</button>');
          }
        }
        return (
          "<tr>" +
          "<td><strong>" + F.esc(item.fullName) + "</strong>" +
          '<span class="field-hint">' +
          F.esc([item.accountRole ? window.UI.titleCase(item.accountRole) : "No account", item.username || ""].filter(Boolean).join(" · ")) +
          "</span></td>" +
          "<td>" + F.esc(item.employeeNo || "—") + "</td>" +
          "<td>" + F.esc(item.position || "—") +
          (item.designation ? '<span class="field-hint">' + F.esc(item.designation) + "</span>" : "") +
          "</td>" +
          "<td>" + (item.isTeaching ? window.UI.pillarBadge("Teaching", "teal") : window.UI.pillarBadge("Non-teaching", "warning")) + "</td>" +
          "<td>" + F.esc(EMPLOYMENT_TYPES[item.employmentType] || window.UI.titleCase(item.employmentType || "—")) +
          (item.employmentStatus === "inactive" ? '<span class="field-hint">Inactive</span>' : "") +
          "</td>" +
          "<td>" + F.esc(item.specialization || "—") + "</td>" +
          "<td>" + completenessBadge(item) + "</td>" +
          '<td class="text-right"><div class="row-actions">' + actions.join("") + "</div></td>" +
          "</tr>"
        );
      })
      .join("");
    el("personnelMeta").textContent =
      state.personnel.length +
      (state.personnel.length === 1 ? " personnel record" : " personnel records") +
      " · " +
      state.personnel.filter(function (item) {
        return !item.id;
      }).length +
      " without a personnel profile.";
  }

  function loadPersonnel() {
    el("personnelBody").innerHTML = L.skeletonRows(8, 5);
    return L.apiGet("/personnel", {
      schoolId: currentSchoolId() || undefined,
      search: state.search.trim() || undefined,
      teaching: state.teaching || undefined,
      employmentStatus: state.employmentStatus || undefined
    })
      .then(function (payload) {
        state.personnel = (payload && payload.items) || [];
        renderPersonnel();
        scopeLabel();
      })
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        el("personnelBody").innerHTML = F.emptyRow(8, L.friendlyError(error));
        el("personnelMeta").textContent = "Personnel could not be loaded.";
      });
  }

  function personnelModal(item) {
    var editing = Boolean(item && item.id);
    var data = item || {};
    var schoolId = currentSchoolId() || String(data.schoolId || "");
    if (!schoolId) {
      alertPage("warning", "Choose a specific school before adding personnel.", "School required");
      return;
    }
    var dialog = L.modal({
      title: editing ? "Edit personnel profile" : "Add personnel profile",
      eyebrow: "SF7 personnel record",
      size: "modal-lg",
      body:
        '<div id="personnelFormAlert" class="d-none mb-3" role="alert"></div>' +
        '<form id="personnelForm" novalidate>' +
        '<div class="form-row">' +
        '<div class="col-md-4"><div class="form-group"><label for="personnelEmployeeNo">Employee number <span class="required-mark">*</span></label>' +
        '<input class="form-control" id="personnelEmployeeNo" name="employeeNo" maxlength="32" required value="' + F.esc(data.employeeNo || "") + '">' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-8"><div class="form-group"><label>School</label><input class="form-control" readonly value="' +
        F.esc(L.schoolName(schoolId) || "Selected school") + '"></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="personnelLast">Last name <span class="required-mark">*</span></label>' +
        '<input class="form-control" id="personnelLast" name="lastName" maxlength="80" required value="' + F.esc(data.lastName || "") + '">' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="personnelFirst">First name <span class="required-mark">*</span></label>' +
        '<input class="form-control" id="personnelFirst" name="firstName" maxlength="80" required value="' + F.esc(data.firstName || "") + '">' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-2"><div class="form-group"><label for="personnelMiddle">Middle name</label>' +
        '<input class="form-control" id="personnelMiddle" name="middleName" maxlength="80" value="' + F.esc(data.middleName || "") + '"></div></div>' +
        '<div class="col-md-2"><div class="form-group"><label for="personnelSuffix">Suffix</label>' +
        '<input class="form-control" id="personnelSuffix" name="suffix" maxlength="16" value="' + F.esc(data.suffix || "") + '"></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="personnelPosition">Position <span class="required-mark">*</span></label>' +
        '<input class="form-control" id="personnelPosition" name="position" maxlength="120" required value="' + F.esc(data.position || "") + '">' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-3"><div class="form-group"><label for="personnelType">Employment type</label>' +
        '<select class="custom-select" id="personnelType" name="employmentType">' +
        Object.keys(EMPLOYMENT_TYPES)
          .map(function (key) {
            return L.option(key, EMPLOYMENT_TYPES[key], data.employmentType || "plantilla");
          })
          .join("") +
        "</select></div></div>" +
        '<div class="col-md-3"><div class="form-group"><label for="personnelStatus">Employment status</label>' +
        '<select class="custom-select" id="personnelStatus" name="employmentStatus">' +
        L.option("active", "Active", data.employmentStatus || "active") +
        L.option("inactive", "Inactive", data.employmentStatus) +
        "</select></div></div>" +
        '<div class="col-md-4"><div class="form-group"><label for="personnelTeaching">Teaching role</label>' +
        '<select class="custom-select" id="personnelTeaching" name="isTeaching">' +
        L.option("true", "Teaching personnel", data.isTeaching === false ? "false" : "true") +
        L.option("false", "Non-teaching personnel", data.isTeaching === false ? "false" : "true") +
        "</select></div></div>" +
        '<div class="col-md-4"><div class="form-group"><label for="personnelSpecialization">Specialization</label>' +
        '<input class="form-control" id="personnelSpecialization" name="specialization" maxlength="160" value="' + F.esc(data.specialization || "") + '"></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="personnelDesignation">Designation</label>' +
        '<input class="form-control" id="personnelDesignation" name="designation" maxlength="160" placeholder="e.g. School ICT Coordinator" value="' + F.esc(data.designation || "") + '"></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="personnelHired">Date hired</label>' +
        '<input type="date" class="form-control" id="personnelHired" name="dateHired" value="' + F.esc(data.dateHired || "") + '"></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="personnelContact">Contact number</label>' +
        '<input class="form-control" id="personnelContact" name="contactNumber" maxlength="24" value="' + F.esc(data.contactNumber || "") + '"></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="personnelEmail">Email</label>' +
        '<input type="email" class="form-control" id="personnelEmail" name="email" maxlength="160" value="' + F.esc(data.email || "") + '"></div></div>' +
        '<div class="col-12"><div class="form-group mb-0"><label for="personnelQualifications">Qualifications</label>' +
        '<textarea class="form-control" id="personnelQualifications" name="qualifications" rows="2" maxlength="4000">' + F.esc(data.qualifications || "") + "</textarea>" +
        '<span class="field-hint">Contact details and qualifications are confidential fields shown only to authorized personnel roles.</span></div></div>' +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="personnelSaveButton">' + (editing ? "Save profile" : "Create profile") + "</button>"
    });
    var form = dialog.element.querySelector("#personnelForm");
    var button = dialog.element.querySelector("#personnelSaveButton");
    var alertBox = dialog.element.querySelector("#personnelFormAlert");
    button.addEventListener("click", function () {
      window.UI.clearFieldErrors(form);
      window.UI.hideAlert(alertBox);
      var values = L.formValues(form);
      if (!values.employeeNo.trim() || !values.lastName.trim() || !values.firstName.trim() || !values.position.trim()) {
        alertPage("warning", "Employee number, name, and position are required.", "Missing details");
        return;
      }
      var payload = {
        schoolId: Number(schoolId),
        userId: data.userId || null,
        employeeNo: values.employeeNo.trim(),
        lastName: values.lastName.trim(),
        firstName: values.firstName.trim(),
        middleName: values.middleName.trim(),
        suffix: values.suffix.trim(),
        position: values.position.trim(),
        employmentType: values.employmentType,
        employmentStatus: values.employmentStatus,
        isTeaching: values.isTeaching === "true",
        specialization: values.specialization.trim(),
        qualifications: values.qualifications.trim(),
        designation: values.designation.trim(),
        contactNumber: values.contactNumber.trim(),
        email: values.email.trim(),
        dateHired: values.dateHired || null
      };
      window.UI.setButtonLoading(button, true, "Saving…");
      var request = editing ? API.put("/personnel/" + item.id, payload) : API.post("/personnel", payload);
      request
        .then(function () {
          window.UI.setButtonLoading(button, false);
          dialog.close();
          window.UI.toast(editing ? "Profile saved" : "Profile created", payload.firstName + " " + payload.lastName, "success");
          summary();
          loadPersonnel();
          if (state.tab === "loads") {
            loadLoads();
          }
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (failed(error)) {
            return;
          }
          if (!window.UI.showFieldErrors(form, error)) {
            window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not save the profile");
          }
        });
    });
  }

  function archivePersonnel(item) {
    window.UI.confirm({
      title: "Archive personnel profile",
      message: "Archive the personnel profile of " + item.fullName + "? The account and its history stay intact, but the profile is removed from the active register.",
      confirmLabel: "Archive",
      tone: "danger"
    }).then(function (ok) {
      if (!ok) {
        return;
      }
      API.delete("/personnel/" + item.id)
        .then(function () {
          window.UI.toast("Profile archived", item.fullName + " was archived.", "success");
          summary();
          loadPersonnel();
          if (state.tab === "loads") {
            loadLoads();
          }
        })
        .catch(function (error) {
          if (failed(error)) {
            return;
          }
          alertPage("danger", L.friendlyError(error), "Could not archive the profile");
        });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Teaching loads                                                         */
  /* ---------------------------------------------------------------------- */

  function assignmentText(item) {
    if (!item.assignments || !item.assignments.length) {
      return '<span class="field-hint">No assignment recorded</span>';
    }
    return (
      '<div class="assignment-list">' +
      item.assignments
        .map(function (assignment) {
          return (
            "<span>" +
            F.esc(assignment.subjectName) +
            " · " +
            F.esc(assignment.gradeLevelName) +
            " " +
            F.esc(assignment.sectionName) +
            "</span>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function renderLoads() {
    var body = el("loadsBody");
    if (!state.loads.length) {
      body.innerHTML = F.emptyRow(7, "No active school personnel for the selected school.");
      el("loadsMeta").textContent = "No personnel assignments.";
      return;
    }
    body.innerHTML = state.loads
      .map(function (item) {
        var missing = item.missing || [];
        var conflicts = item.conflicts || [];
        return (
          "<tr>" +
          "<td><strong>" + F.esc(item.fullName) + "</strong>" +
          '<span class="field-hint">' + F.esc(item.position || window.UI.titleCase(item.role)) + "</span></td>" +
          "<td>" + assignmentText(item) + "</td>" +
          '<td class="text-right">' + window.UI.number((item.schedules || []).length) + "</td>" +
          '<td class="text-right">' + F.esc(item.loadHours || 0) + "</td>" +
          "<td>" +
          (item.complete
            ? '<span class="status-badge status-badge--success"><span class="status-dot"></span>Complete</span>'
            : '<span class="status-badge status-badge--warning" title="' + F.esc(missing.join(", ")) + '"><span class="status-dot"></span>' + missing.length + " missing</span>") +
          "</td>" +
          "<td>" +
          (conflicts.length
            ? '<span class="status-badge status-badge--danger"><span class="status-dot"></span>' + conflicts.length + " conflict" + (conflicts.length === 1 ? "" : "s") + "</span>"
            : '<span class="field-hint">None</span>') +
          "</td>" +
          '<td class="text-right"><div class="row-actions">' +
          '<button type="button" class="btn btn-light btn-sm" data-load-detail="' + item.userId + '" title="View assignments and schedule"><i class="bi bi-eye" aria-hidden="true"></i></button>' +
          (canManage() && !item.profileId
            ? '<button type="button" class="btn btn-light btn-sm" data-create-profile="' + item.userId + '">Profile</button>'
            : "") +
          "</div></td>" +
          "</tr>"
        );
      })
      .join("");
    el("loadsMeta").textContent =
      state.loads.length +
      " personnel · " +
      state.loads.filter(function (item) {
        return !item.complete;
      }).length +
      " with incomplete records · " +
      state.loads.reduce(function (sum, item) {
        return sum + (item.conflicts || []).length;
      }, 0) +
      " schedule conflicts.";
  }

  function loadLoads() {
    var schoolId = state.loadSchoolId || currentSchoolId();
    if (!schoolId) {
      el("loadsBody").innerHTML = F.emptyRow(7, "Choose a specific school to load assignments.");
      el("loadsMeta").textContent = "A specific school is required for teaching loads.";
      return Promise.resolve();
    }
    el("loadsBody").innerHTML = L.skeletonRows(7, 5);
    return L.apiGet("/personnel/assignments", {
      schoolId: schoolId,
      schoolYearId: state.yearId || undefined
    })
      .then(function (payload) {
        state.loads = (payload && payload.items) || [];
        renderLoads();
        el("loadsNote").textContent =
          "Assignments and schedules for " +
          ((payload.school && payload.school.name) || "the selected school") +
          " · " +
          ((payload.schoolYear && payload.schoolYear.name) || "school year") +
          ". Conflicting schedules are flagged; the system never resolves them automatically.";
      })
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        el("loadsBody").innerHTML = F.emptyRow(7, L.friendlyError(error));
        el("loadsMeta").textContent = "Assignments could not be loaded.";
      });
  }

  function loadDetail(userId) {
    var item = state.loads.find(function (row) {
      return String(row.userId) === String(userId);
    });
    if (!item) {
      loadLoads().then(function () {
        var found = state.loads.find(function (row) {
          return String(row.userId) === String(userId);
        });
        if (found) {
          openLoadDetail(found);
        }
      });
      return;
    }
    openLoadDetail(item);
  }

  function openLoadDetail(item) {
    var byDay = {};
    (item.schedules || []).forEach(function (schedule) {
      if (!byDay[schedule.dayOfWeek]) {
        byDay[schedule.dayOfWeek] = [];
      }
      byDay[schedule.dayOfWeek].push(schedule);
    });
    var scheduleHtml = Object.keys(byDay)
      .sort(function (a, b) {
        return Number(a) - Number(b);
      })
      .map(function (day) {
        return (
          '<p class="form-section-label">' + F.esc(L.DAY_NAMES[Number(day)] || "Day " + day) + "</p>" +
          '<div class="report-preview"><div class="report-preview__scroll"><table><thead><tr><th>Time</th><th>Subject</th><th>Section</th><th>Room</th></tr></thead><tbody>' +
          byDay[day]
            .map(function (schedule) {
              return (
                "<tr><td>" + F.esc(schedule.startTime + "–" + schedule.endTime) + "</td>" +
                "<td>" + F.esc(schedule.subjectName) + "</td>" +
                "<td>" + F.esc(schedule.sectionName) + "</td>" +
                "<td>" + F.esc(schedule.room || "—") + "</td></tr>"
              );
            })
            .join("") +
          "</tbody></table></div></div>"
        );
      })
      .join("");
    var dialog = L.modal({
      title: item.fullName,
      eyebrow: "Teaching load and schedule",
      size: "modal-lg",
      body:
        '<div class="review-summary mb-3">' +
        "<div><span>Position</span><strong>" + F.esc(item.position || "—") + "</strong></div>" +
        "<div><span>Employee number</span><strong>" + F.esc(item.employeeNo || "—") + "</strong></div>" +
        "<div><span>Schedules</span><strong>" + window.UI.number((item.schedules || []).length) + "</strong></div>" +
        "<div><span>Load</span><strong>" + F.esc(item.loadHours || 0) + " hours / week</strong></div>" +
        "</div>" +
        (item.missing && item.missing.length
          ? '<div class="info-banner info-banner--warning"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><div><strong>Incomplete record.</strong> Missing: ' + F.esc(item.missing.join(", ")) + ".</div></div>"
          : "") +
        (item.conflicts && item.conflicts.length
          ? '<div class="info-banner info-banner--private"><i class="bi bi-calendar-x" aria-hidden="true"></i><div><strong>Schedule conflicts.</strong> ' +
            F.esc(item.conflicts.map(function (conflict) {
              return conflict.message;
            }).join(" ")) +
            "</div></div>"
          : "") +
        '<p class="form-section-label">Assignments</p>' +
        (item.assignments && item.assignments.length
          ? '<div class="report-preview"><div class="report-preview__scroll"><table><thead><tr><th>Subject</th><th>Grade / Section</th></tr></thead><tbody>' +
            item.assignments
              .map(function (assignment) {
                return (
                  "<tr><td>" + F.esc(assignment.subjectName) + "</td>" +
                  "<td>" + F.esc(assignment.gradeLevelName + " · " + assignment.sectionName) + "</td></tr>"
                );
              })
              .join("") +
            "</tbody></table></div></div>"
          : '<p class="empty-cell">No teaching assignment recorded.</p>') +
        (scheduleHtml || '<p class="empty-cell">No class schedule recorded.</p>'),
      footer: '<button type="button" class="btn btn-light" data-dismiss="modal">Close</button>'
    });
    return dialog;
  }

  /* ---------------------------------------------------------------------- */
  /* Filters and tabs                                                       */
  /* ---------------------------------------------------------------------- */

  function switchTab(tab) {
    state.tab = tab;
    ["register", "loads"].forEach(function (key) {
      var button = el("tab" + window.UI.titleCase(key));
      var panel = el("panel" + window.UI.titleCase(key));
      if (button) {
        button.setAttribute("aria-selected", key === tab ? "true" : "false");
        button.classList.toggle("is-active", key === tab);
      }
      if (panel) {
        panel.classList.toggle("d-none", key !== tab);
      }
    });
    if (tab === "loads") {
      loadLoads();
    } else {
      loadPersonnel();
    }
  }

  function loadYears() {
    return L.years().then(function (years) {
      state.years = years || [];
      var current = state.years.find(function (year) {
        return year.isCurrent;
      });
      if (!state.yearId) {
        state.yearId = current ? String(current.id) : "";
      }
      el("personnelYearFilter").innerHTML = L.yearOptions(state.years, state.yearId, "All school years");
    });
  }

  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll(".module-tabs [data-tab]"), function (button) {
      button.addEventListener("click", function () {
        switchTab(button.dataset.tab);
      });
    });

    el("personnelSchoolFilter").addEventListener("change", function () {
      state.loadSchoolId = el("personnelSchoolFilter").value;
      loadPersonnel();
      summary();
      if (state.tab === "loads") {
        loadLoads();
      }
    });
    el("personnelYearFilter").addEventListener("change", function () {
      state.yearId = el("personnelYearFilter").value;
      if (state.tab === "loads") {
        loadLoads();
      }
    });
    el("personnelTeachingFilter").addEventListener("change", function () {
      state.teaching = el("personnelTeachingFilter").value;
      loadPersonnel();
    });
    el("personnelStatusFilter").addEventListener("change", function () {
      state.employmentStatus = el("personnelStatusFilter").value;
      loadPersonnel();
    });
    el("personnelSearch").addEventListener("input", window.UI.debounce(function () {
      state.search = el("personnelSearch").value;
      loadPersonnel();
    }, 300));

    el("newPersonnelButton").addEventListener("click", function () {
      personnelModal(null);
    });

    el("personnelBody").addEventListener("click", function (event) {
      var edit = event.target.closest("[data-edit-personnel]");
      if (edit) {
        var item = state.personnel.find(function (row) {
          return String(row.id) === String(edit.dataset.editPersonnel);
        });
        personnelModal(item);
        return;
      }
      var archive = event.target.closest("[data-archive-personnel]");
      if (archive) {
        var target = state.personnel.find(function (row) {
          return String(row.id) === String(archive.dataset.archivePersonnel);
        });
        if (target) {
          archivePersonnel(target);
        }
        return;
      }
      var create = event.target.closest("[data-create-profile]");
      if (create) {
        var account = state.personnel.find(function (row) {
          return row.source === "account" && String(row.userId) === String(create.dataset.createProfile);
        });
        personnelModal(account || null);
        return;
      }
      var loads = event.target.closest("[data-loads]");
      if (loads && loads.dataset.loads) {
        if (!state.loads.length) {
          loadLoads().then(function () {
            loadDetail(loads.dataset.loads);
          });
        } else {
          loadDetail(loads.dataset.loads);
        }
      }
    });

    el("loadsBody").addEventListener("click", function (event) {
      var detail = event.target.closest("[data-load-detail]");
      if (detail) {
        loadDetail(detail.dataset.loadDetail);
        return;
      }
      var create = event.target.closest("[data-create-profile]");
      if (create) {
        var item = state.loads.find(function (row) {
          return String(row.userId) === String(create.dataset.createProfile);
        });
        personnelModal(item ? {
          userId: item.userId,
          fullName: item.fullName,
          position: item.position,
          employeeNo: item.employeeNo,
          isTeaching: item.isTeaching,
          schoolId: state.loadSchoolId || currentSchoolId()
        } : null);
      }
    });
  }

  function init() {
    AppShell.init({
      page: "personnel",
      breadcrumbs: ["Personnel"],
      requiredPermission: "canViewPersonnel"
    }).then(function (session) {
      if (!session) {
        return;
      }
      wire();
      el("newPersonnelButton").classList.toggle("d-none", !canManage());
      F.schoolFilter("personnelSchoolControl", "personnelSchoolFilter", L.schoolId() || "");
      return loadYears()
        .then(function () {
          state.loadSchoolId = currentSchoolId();
          return Promise.all([summary(), loadPersonnel()]);
        })
        .then(function () {
          if (state.loadSchoolId) {
            return null;
          }
          return L.schools().then(function (list) {
            if (list.length) {
              state.loadSchoolId = String(list[0].id);
            }
          });
        });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})(window, document);
