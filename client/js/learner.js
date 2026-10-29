/* DepEd Learner Records — learner profile page */
(function (window, document) {
  "use strict";

  var state = {
    session: null,
    learnerId: null,
    detail: null,
    years: [],
    gradeLevels: [],
    sections: [],
    teachers: [],
    activityList: [],
    activeTab: "overview"
  };

  var L = window.LearnerUI;
  var esc = L.esc;

  function el(id) {
    return document.getElementById(id);
  }

  function detailItem(label, value, wide) {
    return (
      '<div class="detail-item' +
      (wide ? " detail-item--wide" : "") +
      '"><span class="detail-label">' +
      esc(label) +
      '</span><span class="detail-value">' +
      (value === null || value === undefined || value === "" ? "—" : value) +
      "</span></div>"
    );
  }

  function phoneLink(value) {
    return value
      ? '<a href="tel:' + esc(value) + '">' + esc(value) + "</a>"
      : "—";
  }

  function mailLink(value) {
    return value
      ? '<a href="mailto:' + esc(value) + '">' + esc(value) + "</a>"
      : "—";
  }

  function setTab(tab, updateUrl) {
    var target = document.querySelector('#learnerTabs [data-tab="' + tab + '"]');
    if (!target || target.classList.contains("d-none")) {
      tab = "overview";
    }
    state.activeTab = tab;
    document.querySelectorAll("#learnerTabs [data-tab]").forEach(function (button) {
      var active = button.dataset.tab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    });
    document.querySelectorAll("[data-panel]").forEach(function (panel) {
      panel.hidden = panel.dataset.panel !== tab;
    });
    if (updateUrl !== false) {
      var url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      window.history.replaceState({}, "", url.pathname + url.search);
    }
    if (tab === "subjects") {
      loadSubjects();
    }
    if (window.LearnerAcademic) {
      window.LearnerAcademic.show(tab);
    }
    if (window.innerWidth < 768) {
      var tabs = el("learnerTabs");
      if (tabs) {
        tabs.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }

  function isManage() {
    return Boolean(state.session && state.session.permissions.canManageLearners);
  }

  function isActivityManager() {
    return Boolean(state.session && state.session.permissions.canManageActivities);
  }

  /* Hero ------------------------------------------------------------------ */

  function renderHero() {
    var learner = state.detail.learner;
    var enrollment = learner.currentEnrollment;
    var mount = el("learnerHero");
    var archived = learner.isArchived;
    mount.innerHTML =
      '<div class="learner-hero">' +
      '<div class="learner-hero__identity">' +
      '<span class="avatar">' +
      esc(window.UI.initials(learner.fullName)) +
      "</span><div>" +
      '<p class="page-eyebrow" style="color:rgba(236,245,255,.7);margin-bottom:.2rem">Learner profile · LRN ' +
      esc(learner.lrn) +
      "</p>" +
      '<h1 class="learner-hero__name">' +
      esc(learner.formalName) +
      "</h1>" +
      '<p class="learner-hero__meta">' +
      esc(learner.fullName) +
      " · " +
      esc(window.UI.titleCase(learner.sex)) +
      ", " +
      (learner.age === null ? "age not available" : learner.age + " years old") +
      " · " +
      esc(learner.schoolName || "No school") +
      "</p>" +
      '<div class="learner-hero__badges">' +
      L.profileBadge(learner.profileComplete) +
      (archived
        ? '<span class="status-badge status-badge--muted"><span class="status-dot"></span>Archived</span>'
        : "") +
      (enrollment
        ? L.badge(enrollment.status) +
          '<span class="status-badge status-badge--neutral"><span class="status-dot"></span>' +
          esc(enrollment.schoolYearName || "") +
          "</span>"
        : '<span class="status-badge status-badge--warning"><span class="status-dot"></span>Not enrolled</span>') +
      "</div></div></div>" +
      '<div class="learner-hero__actions">' +
      '<button type="button" class="btn btn-light" id="printProfileButton"><i class="bi bi-printer" aria-hidden="true"></i> Print profile</button>' +
      (isManage()
        ? '<button type="button" class="btn btn-light" id="heroEditButton"><i class="bi bi-pencil-square" aria-hidden="true"></i> Edit</button>' +
          (archived
            ? '<button type="button" class="btn btn-light" id="heroArchiveButton" data-restore><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i> Restore</button>'
            : '<button type="button" class="btn btn-light" id="heroArchiveButton" data-archive><i class="bi bi-archive" aria-hidden="true"></i> Archive</button>')
        : "") +
      "</div>" +
      '<div class="learner-hero__stats">' +
      '<div class="learner-hero__stat"><span>Grade and section</span><strong>' +
      esc(enrollment ? (enrollment.gradeLevel || "—") + (enrollment.sectionName ? " · " + enrollment.sectionName : "") : "Not enrolled") +
      "</strong></div>" +
      '<div class="learner-hero__stat"><span>Adviser</span><strong>' +
      esc((enrollment && enrollment.adviserName) || "Not assigned") +
      "</strong></div>" +
      '<div class="learner-hero__stat"><span>Guardians</span><strong>' +
      state.detail.guardians.length +
      "</strong></div>" +
      '<div class="learner-hero__stat"><span>School year</span><strong>' +
      esc(enrollment ? enrollment.schoolYearName : "—") +
      "</strong></div>" +
      "</div></div>";

    el("printProfileButton").addEventListener("click", printProfile);
    var edit = el("heroEditButton");
    if (edit) {
      edit.addEventListener("click", function () {
        window.LearnerForm.open({
          learner: learner,
          onSaved: function () {
            loadDetail();
          }
        });
      });
    }
    var archive = el("heroArchiveButton");
    if (archive) {
      archive.addEventListener("click", function () {
        toggleArchive(!archived);
      });
    }
    document.title = learner.formalName + " · Learner Profile";
  }

  function toggleArchive(archive) {
    var learner = state.detail.learner;
    window.UI.confirm({
      title: archive ? "Archive this learner?" : "Restore this learner?",
      message: archive
        ? learner.fullName +
          " will leave the active register. All profiles, school-year folders, activities, documents, and audit history are preserved."
        : learner.fullName + " will return to the active learner register.",
      confirmLabel: archive ? "Archive learner" : "Restore learner",
      tone: archive ? "danger" : "primary"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      API.patch("/learners/" + learner.id + (archive ? "/archive" : "/restore"))
        .then(function () {
          window.UI.toast(
            archive ? "Learner archived" : "Learner restored",
            learner.fullName + (archive ? " was archived." : " is active again."),
            "success"
          );
          loadDetail();
        })
        .catch(function (error) {
          window.UI.showAlert(el("learnerPageAlert"), "danger", L.friendlyError(error), "Could not update record");
        });
    });
  }

  /* Personal -------------------------------------------------------------- */

  function renderPersonal() {
    var learner = state.detail.learner;
    var grid = el("personalDetails");
    grid.innerHTML =
      detailItem("Learner Reference Number", "<code>" + esc(learner.lrn) + "</code>") +
      detailItem("Full name", esc(learner.formalName)) +
      detailItem("First name", esc(learner.firstName)) +
      detailItem("Middle name", esc(learner.middleName)) +
      detailItem("Last name", esc(learner.lastName)) +
      detailItem("Name extension", esc(learner.extensionName)) +
      detailItem("Birth date", window.UI.phDate(learner.birthDate)) +
      detailItem("Age (derived)", learner.age === null ? "—" : learner.age + " years old") +
      detailItem("Sex", window.UI.titleCase(learner.sex)) +
      detailItem("Weight", learner.weightKg === null ? "—" : learner.weightKg + " kg") +
      detailItem("Height", learner.heightCm === null ? "—" : learner.heightCm + " cm") +
      detailItem("School", esc(learner.schoolName || "—")) +
      detailItem("District", esc(learner.districtName || "—")) +
      detailItem("House number / street", esc(learner.houseNumber)) +
      detailItem("Barangay", esc(learner.barangay)) +
      detailItem("Municipality / city", esc(learner.municipality)) +
      detailItem("Province", esc(learner.province)) +
      detailItem("Region", esc(learner.region)) +
      detailItem("ZIP code", esc(learner.zipCode)) +
      detailItem("Complete address", esc(learner.addressLine), true) +
      detailItem("Contact number", phoneLink(learner.contactNumber)) +
      detailItem("Email address", mailLink(learner.email)) +
      detailItem("Record created", window.UI.phDateTime(learner.createdAt) + (learner.createdByName ? " by " + esc(learner.createdByName) : "")) +
      detailItem("Last updated", window.UI.phDateTime(learner.updatedAt));

    var editButton = el("editPersonalButton");
    editButton.classList.toggle("d-none", !isManage() || learner.isArchived);
    if (isManage() && !learner.isArchived) {
      editButton.onclick = function () {
        window.LearnerForm.open({
          learner: learner,
          onSaved: function () {
            loadDetail();
          }
        });
      };
    }
  }

  /* Guardians ------------------------------------------------------------- */

  function guardianCard(guardian) {
    var badges =
      (guardian.isPrimary
        ? '<span class="status-badge status-badge--success"><span class="status-dot"></span>Primary guardian</span>'
        : "") +
      (guardian.isEmergency
        ? '<span class="status-badge status-badge--danger"><span class="status-dot"></span>Emergency contact</span>'
        : "");
    return (
      '<article class="guardian-card">' +
      '<div class="guardian-card__head"><div><h3>' +
      esc(guardian.fullName) +
      "</h3><p>" +
      esc(guardian.relationship) +
      (guardian.occupation ? " · " + esc(guardian.occupation) : "") +
      "</p></div>" +
      (isManage()
        ? '<div class="row-actions"><button type="button" class="btn btn-light" data-guardian-edit="' +
          guardian.id +
          '" title="Edit guardian"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>' +
          '<button type="button" class="btn btn-light" data-guardian-delete="' +
          guardian.id +
          '" title="Remove guardian"><i class="bi bi-trash3" aria-hidden="true"></i></button></div>'
        : "") +
      "</div>" +
      (badges ? '<div class="guardian-card__badges">' + badges + "</div>" : "") +
      '<div class="guardian-card__rows">' +
      '<span><i class="bi bi-telephone" aria-hidden="true"></i> ' +
      phoneLink(guardian.contactNumber) +
      "</span>" +
      '<span><i class="bi bi-envelope" aria-hidden="true"></i> ' +
      mailLink(guardian.email) +
      "</span>" +
      '<span><i class="bi bi-geo-alt" aria-hidden="true"></i> ' +
      esc(guardian.address || "No address recorded") +
      "</span>" +
      "</div></article>"
    );
  }

  function renderGuardians() {
    var guardians = state.detail.guardians;
    var mount = el("guardianList");
    el("guardianCount").textContent = guardians.length;
    if (!guardians.length) {
      mount.innerHTML = window.UI.emptyState({
        icon: "bi-people",
        title: "No parent or guardian recorded",
        message:
          "Add at least one parent or guardian to complete the learner's profile. A primary and an emergency contact can be flagged.",
        action: isManage()
          ? '<button type="button" class="btn btn-primary btn-sm" data-add-guardian><i class="bi bi-person-plus" aria-hidden="true"></i> Add guardian</button>'
          : ""
      });
    } else {
      mount.innerHTML = guardians.map(guardianCard).join("");
    }
    var addButton = el("addGuardianButton");
    addButton.classList.toggle("d-none", !isManage());
    addButton.onclick = function () {
      guardianModal(null);
    };
    mount.querySelectorAll("[data-add-guardian]").forEach(function (button) {
      button.addEventListener("click", function () {
        guardianModal(null);
      });
    });
    mount.querySelectorAll("[data-guardian-edit]").forEach(function (button) {
      button.addEventListener("click", function () {
        var guardian = guardians.find(function (item) {
          return String(item.id) === button.dataset.guardianEdit;
        });
        guardianModal(guardian);
      });
    });
    mount.querySelectorAll("[data-guardian-delete]").forEach(function (button) {
      button.addEventListener("click", function () {
        var guardian = guardians.find(function (item) {
          return String(item.id) === button.dataset.guardianDelete;
        });
        window.UI.confirm({
          title: "Remove guardian?",
          message:
            (guardian ? guardian.fullName : "This guardian") +
            " will be removed from the learner profile. The action is recorded in the audit trail.",
          confirmLabel: "Remove",
          tone: "danger"
        }).then(function (confirmed) {
          if (!confirmed) {
            return;
          }
          API.delete("/learners/" + state.learnerId + "/guardians/" + guardian.id)
            .then(function () {
              window.UI.toast("Guardian removed", guardian.fullName + " was removed.", "success");
              loadDetail();
            })
            .catch(function (error) {
              window.UI.showAlert(el("learnerPageAlert"), "danger", L.friendlyError(error), "Could not remove guardian");
            });
        });
      });
    });
  }

  function guardianModal(guardian) {
    var editing = Boolean(guardian);
    var data = guardian || {};
    var relationships = ["Mother", "Father", "Guardian", "Grandparent", "Sibling", "Relative", "Other"];
    var dialog = L.modal({
      title: editing ? "Edit parent or guardian" : "Add parent or guardian",
      eyebrow: editing ? "Update contact" : "Family details",
      size: "modal-lg",
      body:
        '<form id="guardianForm" novalidate>' +
        '<div id="guardianFormAlert" class="d-none mb-3" role="alert"></div>' +
        '<div class="row">' +
        '<div class="col-md-6"><div class="form-group"><label for="guardianFullName">Full name <span class="required-mark">*</span></label>' +
        '<input class="form-control" id="guardianFullName" name="fullName" required maxlength="160" value="' +
        esc(data.fullName) +
        '"><span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="guardianRelationship">Relationship <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="guardianRelationship" name="relationship" required>' +
        '<option value="">Select relationship</option>' +
        relationships
          .map(function (relationship) {
            return L.option(relationship, relationship, data.relationship);
          })
          .join("") +
        "</select><span class=\"field-error\"></span></div></div>" +
        '<div class="col-md-6"><div class="form-group"><label for="guardianContact">Contact number</label>' +
        '<input type="tel" class="form-control" id="guardianContact" name="contactNumber" maxlength="32" value="' +
        esc(data.contactNumber) +
        '"><span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="guardianEmail">Email address</label>' +
        '<input type="email" class="form-control" id="guardianEmail" name="email" maxlength="160" value="' +
        esc(data.email) +
        '"><span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="guardianOccupation">Occupation</label>' +
        '<input class="form-control" id="guardianOccupation" name="occupation" maxlength="120" value="' +
        esc(data.occupation) +
        '"><span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="guardianAddress">Address</label>' +
        '<input class="form-control" id="guardianAddress" name="address" maxlength="500" value="' +
        esc(data.address) +
        '"><span class="field-error"></span></div></div>' +
        '<div class="col-12"><div class="custom-control custom-checkbox custom-control-inline">' +
        '<input type="checkbox" class="custom-control-input" id="guardianPrimary" name="isPrimary"' +
        (data.isPrimary ? " checked" : "") +
        '><label class="custom-control-label" for="guardianPrimary">Primary guardian</label></div>' +
        '<div class="custom-control custom-checkbox custom-control-inline">' +
        '<input type="checkbox" class="custom-control-input" id="guardianEmergency" name="isEmergency"' +
        (data.isEmergency ? " checked" : "") +
        '><label class="custom-control-label" for="guardianEmergency">Emergency contact</label></div></div>' +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="submit" form="guardianForm" class="btn btn-primary" id="saveGuardianButton">' +
        (editing ? "Save guardian" : "Add guardian") +
        "</button>"
    });
    var form = dialog.element.querySelector("#guardianForm");
    var button = dialog.element.querySelector("#saveGuardianButton");
    var alertBox = dialog.element.querySelector("#guardianFormAlert");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var values = L.formValues(form);
      if (!values.fullName || !values.relationship) {
        if (!values.fullName) {
          window.UI.fieldError(form.querySelector("#guardianFullName"), "Guardian name is required.");
        }
        if (!values.relationship) {
          window.UI.fieldError(form.querySelector("#guardianRelationship"), "Choose the relationship.");
        }
        return;
      }
      L.submit(
        form,
        button,
        alertBox,
        function () {
          return editing
            ? API.put("/learners/" + state.learnerId + "/guardians/" + guardian.id, values)
            : API.post("/learners/" + state.learnerId + "/guardians", values);
        },
        function () {
          dialog.close();
          window.UI.toast(editing ? "Guardian updated" : "Guardian added", data.fullName || values.fullName, "success");
          loadDetail();
        }
      );
    });
  }

  /* School-year folders --------------------------------------------------- */

  function renderEnrollments() {
    var learner = state.detail.learner;
    var enrollments = state.detail.enrollments;
    el("enrollmentCount").textContent = enrollments.length;
    var mount = el("enrollmentFolders");
    if (!enrollments.length) {
      mount.innerHTML = window.UI.emptyState({
        icon: "bi-journal-bookmark",
        title: "No school-year records",
        message: "Add the learner's grade level and section for a school year to start the enrollment history."
      });
    } else {
      mount.innerHTML = enrollments
        .map(function (enrollment) {
          return (
            '<article class="year-folder">' +
            '<header class="year-folder__head"><div><strong>' +
            esc(enrollment.schoolYearName) +
            "</strong>" +
            (enrollment.isCurrentYear ? '<span class="current-year-marker">Current SY</span>' : "") +
            "<span> · " +
            esc(enrollment.gradeLevel || "Grade not set") +
            (enrollment.sectionName ? " · " + esc(enrollment.sectionName) : "") +
            "</span></div><div>" +
            L.badge(enrollment.status) +
            (isManage() && !learner.isArchived
              ? ' <button type="button" class="btn btn-light btn-sm" data-enrollment-edit="' +
                enrollment.id +
                '"><i class="bi bi-pencil-square" aria-hidden="true"></i> Edit</button>'
              : "") +
            "</div></header>" +
            '<div class="year-folder__body"><div class="detail-grid">' +
            detailItem("Grade level", esc(enrollment.gradeLevel || "—")) +
            detailItem("Section", esc(enrollment.sectionName || "Not assigned")) +
            detailItem("Adviser", esc(enrollment.adviserName || "Not assigned")) +
            detailItem("Enrollment date", window.UI.phDate(enrollment.enrollmentDate)) +
            detailItem("Status", esc((L.ENROLLMENT_STATUS[enrollment.status] || {}).label || enrollment.status)) +
            detailItem("Remarks", esc(enrollment.remarks || "—"), true) +
            "</div></div></article>"
          );
        })
        .join("");
    }

    mount.querySelectorAll("[data-enrollment-edit]").forEach(function (button) {
      button.addEventListener("click", function () {
        var enrollment = enrollments.find(function (item) {
          return String(item.id) === button.dataset.enrollmentEdit;
        });
        enrollmentModal(enrollment);
      });
    });

    var addButton = el("addEnrollmentButton");
    addButton.classList.toggle("d-none", !isManage() || learner.isArchived);
    addButton.onclick = function () {
      enrollmentModal(null);
    };
    var promoteButton = el("promoteButton");
    promoteButton.classList.toggle("d-none", !isManage() || learner.isArchived || !enrollments.length);
    promoteButton.onclick = promoteModal;
  }

  function sectionOptionsFor(yearId, gradeId, selected) {
    var list = state.sections.filter(function (section) {
      return (
        String(section.schoolYearId) === String(yearId) &&
        String(section.gradeLevelId) === String(gradeId)
      );
    });
    return L.options(
      list,
      "id",
      function (section) {
        return section.name + (section.room ? " · " + section.room : "");
      },
      selected,
      list.length ? "No section / unassigned" : "No sections for this grade and year"
    );
  }

  function yearSelectOptions(usedYears, selected) {
    var list = state.years.filter(function (year) {
      return !usedYears.some(function (used) {
        return String(used) === String(year.id);
      });
    });
    return L.yearOptions(list, selected, list.length ? "Select school year" : "No school years available");
  }

  function enrollmentModal(enrollment) {
    var editing = Boolean(enrollment);
    var learner = state.detail.learner;
    var usedYears = state.detail.enrollments
      .filter(function (entry) {
        return !editing || String(entry.id) !== String(enrollment.id);
      })
      .map(function (entry) {
        return entry.schoolYearId;
      });
    var defaultYear = editing
      ? enrollment.schoolYearId
      : (state.years.find(function (year) {
          return year.isCurrent;
        }) || {}).id || "";
    var defaultGrade = editing ? enrollment.gradeLevelId : "";
    var dialog = L.modal({
      title: editing ? "Edit school-year record" : "Add school-year record",
      eyebrow: editing ? enrollment.schoolYearName : "Enrollment folder",
      size: "modal-lg",
      body:
        '<form id="enrollmentForm" novalidate>' +
        '<div id="enrollmentFormAlert" class="d-none mb-3" role="alert"></div>' +
        '<div class="row">' +
        '<div class="col-md-6"><div class="form-group"><label for="enrollmentYear">School year <span class="required-mark">*</span></label>' +
        (editing
          ? '<input class="form-control" value="' + esc(enrollment.schoolYearName) + '" readonly><input type="hidden" name="schoolYearId" value="' + enrollment.schoolYearId + '">'
          : '<select class="custom-select" id="enrollmentYear" name="schoolYearId" required>' +
            yearSelectOptions(usedYears, defaultYear) +
            "</select>") +
        '<span class="field-hint">A learner can have only one record per school year.</span><span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="enrollmentGrade">Grade level <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="enrollmentGrade" name="gradeLevelId" required>' +
        L.gradeOptions(state.gradeLevels, defaultGrade, "Select grade level") +
        "</select><span class=\"field-error\"></span></div></div>" +
        '<div class="col-md-6"><div class="form-group"><label for="enrollmentSection">Section</label>' +
        '<select class="custom-select" id="enrollmentSection" name="sectionId">' +
        sectionOptionsFor(defaultYear, defaultGrade, editing ? enrollment.sectionId : "") +
        "</select><span class=\"field-error\"></span></div></div>" +
        '<div class="col-md-6"><div class="form-group"><label for="enrollmentAdviser">Adviser</label>' +
        '<select class="custom-select" id="enrollmentAdviser" name="adviserId">' +
        L.teacherOptions(state.teachers, editing ? enrollment.adviserId : "", "Use section adviser") +
        "</select><span class=\"field-error\"></span></div></div>" +
        '<div class="col-md-6"><div class="form-group"><label for="enrollmentDate">Enrollment date</label>' +
        '<input type="date" class="form-control" id="enrollmentDate" name="enrollmentDate" value="' +
        esc(editing ? enrollment.enrollmentDate : L.todayIso()) +
        '"><span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="enrollmentStatus">Status <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="enrollmentStatus" name="status" required>' +
        L.options(
          Object.keys(L.ENROLLMENT_STATUS).map(function (key) {
            return { value: key, label: L.ENROLLMENT_STATUS[key].label };
          }),
          "value",
          "label",
          editing ? enrollment.status : "enrolled"
        ) +
        "</select><span class=\"field-error\"></span></div></div>" +
        '<div class="col-12"><div class="form-group"><label for="enrollmentRemarks">Remarks</label>' +
        '<textarea class="form-control" id="enrollmentRemarks" name="remarks" rows="2" maxlength="2000">' +
        esc(editing ? enrollment.remarks : "") +
        "</textarea><span class=\"field-error\"></span></div></div>" +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="submit" form="enrollmentForm" class="btn btn-primary" id="saveEnrollmentButton">' +
        (editing ? "Save record" : "Add record") +
        "</button>"
    });

    var form = dialog.element.querySelector("#enrollmentForm");
    var button = dialog.element.querySelector("#saveEnrollmentButton");
    var alertBox = dialog.element.querySelector("#enrollmentFormAlert");
    var yearField = form.querySelector("#enrollmentYear");
    var gradeField = form.querySelector("#enrollmentGrade");
    var sectionField = form.querySelector("#enrollmentSection");

    function refreshSections() {
      var yearId = yearField ? yearField.value : enrollment.schoolYearId;
      sectionField.innerHTML = sectionOptionsFor(yearId, gradeField.value, sectionField.value);
    }

    if (yearField) {
      yearField.addEventListener("change", refreshSections);
    }
    gradeField.addEventListener("change", refreshSections);

    var learnerSchoolLabel = learner.schoolName;
    if (learnerSchoolLabel && !form.querySelector(".school-context")) {
      var note = document.createElement("p");
      note.className = "field-hint school-context";
      note.textContent = "Enrollment will be recorded under " + learnerSchoolLabel + ".";
      form.insertBefore(note, form.firstChild.nextSibling);
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var values = L.formValues(form);
      if (!values.schoolYearId || !values.gradeLevelId) {
        window.UI.showAlert(alertBox, "warning", "Choose both a school year and a grade level.", "Missing details");
        return;
      }
      L.submit(
        form,
        button,
        alertBox,
        function () {
          return editing
            ? API.put("/learners/" + state.learnerId + "/enrollments/" + enrollment.id, values)
            : API.post("/learners/" + state.learnerId + "/enrollments", values);
        },
        function () {
          dialog.close();
          window.UI.toast(editing ? "School-year record updated" : "School-year record added", "The learner's enrollment history was updated.", "success");
          loadDetail();
        }
      );
    });
  }

  function promoteModal() {
    var learner = state.detail.learner;
    var enrollments = state.detail.enrollments;
    var usedYears = enrollments.map(function (entry) {
      return entry.schoolYearId;
    });
    var source = learner.currentEnrollment || enrollments[0];
    var dialog = L.modal({
      title: "Promote or roll over learner",
      eyebrow: "New school-year folder",
      size: "modal-lg",
      body:
        '<form id="promoteForm" novalidate>' +
        '<div id="promoteFormAlert" class="d-none mb-3" role="alert"></div>' +
        '<p class="field-hint">The source record is marked <strong>Promoted</strong> (when currently enrolled or retained) and a new folder is created for the target school year.</p>' +
        '<div class="row">' +
        '<div class="col-md-6"><div class="form-group"><label for="promoteSource">Source record</label>' +
        '<select class="custom-select" id="promoteSource" name="sourceEnrollmentId">' +
        L.options(
          enrollments,
          "id",
          function (entry) {
            return entry.schoolYearName + " · " + (entry.gradeLevel || "Grade") + (entry.sectionName ? " · " + entry.sectionName : "");
          },
          source ? source.id : ""
        ) +
        "</select></div></div>" +
        '<div class="col-md-6"><div class="form-group"><label for="promoteYear">Target school year <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="promoteYear" name="schoolYearId" required>' +
        yearSelectOptions(usedYears, "") +
        "</select><span class=\"field-error\"></span></div></div>" +
        '<div class="col-md-6"><div class="form-group"><label for="promoteGrade">Target grade level <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="promoteGrade" name="gradeLevelId" required>' +
        L.gradeOptions(state.gradeLevels, "", "Select grade level") +
        "</select><span class=\"field-error\"></span></div></div>" +
        '<div class="col-md-6"><div class="form-group"><label for="promoteSection">Target section</label>' +
        '<select class="custom-select" id="promoteSection" name="sectionId"><option value="">Select grade first</option></select></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="promoteAdviser">Adviser</label>' +
        '<select class="custom-select" id="promoteAdviser" name="adviserId">' +
        L.teacherOptions(state.teachers, "", "Use section adviser") +
        "</select></div></div>" +
        '<div class="col-md-6"><div class="form-group"><label for="promoteDate">Enrollment date</label>' +
        '<input type="date" class="form-control" id="promoteDate" name="enrollmentDate" value="' +
        L.todayIso() +
        '"></div></div>' +
        '<div class="col-12"><div class="form-group"><label for="promoteRemarks">Remarks</label>' +
        '<textarea class="form-control" id="promoteRemarks" name="remarks" rows="2" maxlength="2000" placeholder="e.g. Promoted to Grade 7 after completing Grade 6"></textarea></div></div>' +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="submit" form="promoteForm" class="btn btn-primary" id="savePromoteButton"><i class="bi bi-arrow-up-circle" aria-hidden="true"></i> Promote learner</button>'
    });
    var form = dialog.element.querySelector("#promoteForm");
    var button = dialog.element.querySelector("#savePromoteButton");
    var alertBox = dialog.element.querySelector("#promoteFormAlert");
    var yearField = form.querySelector("#promoteYear");
    var gradeField = form.querySelector("#promoteGrade");
    var sectionField = form.querySelector("#promoteSection");
    gradeField.addEventListener("change", function () {
      sectionField.innerHTML = sectionOptionsFor(yearField.value, gradeField.value, "");
    });
    yearField.addEventListener("change", function () {
      sectionField.innerHTML = sectionOptionsFor(yearField.value, gradeField.value, "");
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var values = L.formValues(form);
      if (!values.schoolYearId || !values.gradeLevelId) {
        window.UI.showAlert(alertBox, "warning", "Choose a target school year and grade level.", "Missing details");
        return;
      }
      L.submit(
        form,
        button,
        alertBox,
        function () {
          return API.post("/learners/" + state.learnerId + "/promote", values);
        },
        function () {
          dialog.close();
          window.UI.toast("Learner promoted", "A new school-year folder was created and the source record was updated.", "success");
          loadDetail();
        }
      );
    });
  }

  /* Documents ------------------------------------------------------------- */

  function renderDocuments() {
    var documents = state.detail.documents;
    var mount = el("documentList");
    if (!documents.length) {
      mount.innerHTML =
        '<p class="text-muted mb-0" style="font-size:.82rem"><i class="bi bi-paperclip" aria-hidden="true"></i> No documents uploaded yet.</p>';
    } else {
      mount.innerHTML = documents
        .map(function (document) {
          return (
            '<div class="doc-item"><div class="doc-item__copy"><strong>' +
            esc(document.title) +
            "</strong><small>" +
            esc(document.documentType) +
            (document.schoolYearName ? " · " + esc(document.schoolYearName) : "") +
            " · " +
            Math.max(1, Math.round(Number(document.byteSize) / 1024)) +
            " KB · uploaded " +
            window.UI.phDate(document.createdAt) +
            (document.uploadedByName ? " by " + esc(document.uploadedByName) : "") +
            "</small></div>" +
            '<div class="row-actions">' +
            '<a class="btn btn-light" href="/api/learners/' +
            state.learnerId +
            "/documents/" +
            document.id +
            '/download" title="Download document"><i class="bi bi-download" aria-hidden="true"></i></a>' +
            (isManage() && !state.detail.learner.isArchived
              ? '<button type="button" class="btn btn-light" data-document-delete="' +
                document.id +
                '" title="Delete document"><i class="bi bi-trash3" aria-hidden="true"></i></button>'
              : "") +
            "</div></div>"
          );
        })
        .join("");
    }
    mount.querySelectorAll("[data-document-delete]").forEach(function (button) {
      button.addEventListener("click", function () {
        var document = documents.find(function (item) {
          return String(item.id) === button.dataset.documentDelete;
        });
        window.UI.confirm({
          title: "Delete document?",
          message: (document ? document.title : "This document") + " will be permanently removed from the learner record.",
          confirmLabel: "Delete",
          tone: "danger"
        }).then(function (confirmed) {
          if (!confirmed) {
            return;
          }
          API.delete("/learners/" + state.learnerId + "/documents/" + document.id)
            .then(function () {
              window.UI.toast("Document deleted", document.title + " was removed.", "success");
              loadDetail();
            })
            .catch(function (error) {
              window.UI.showAlert(el("learnerPageAlert"), "danger", L.friendlyError(error), "Could not delete document");
            });
        });
      });
    });
    var upload = el("uploadDocumentButton");
    upload.classList.toggle("d-none", !isManage() || state.detail.learner.isArchived);
    upload.onclick = uploadDocumentModal;
  }

  function uploadDocumentModal() {
    var dialog = L.modal({
      title: "Upload learner document",
      eyebrow: "Secure attachment",
      size: "modal-lg",
      body:
        '<form id="documentForm" novalidate>' +
        '<div id="documentFormAlert" class="d-none mb-3" role="alert"></div>' +
        '<div class="row">' +
        '<div class="col-md-7"><div class="form-group"><label for="documentTitle">Document title <span class="required-mark">*</span></label>' +
        '<input class="form-control" id="documentTitle" name="title" required maxlength="160" placeholder="e.g. Report Card SY 2025-2026">' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-5"><div class="form-group"><label for="documentType">Document type <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="documentType" name="documentType" required>' +
        '<option>Report Card</option><option>Birth Certificate</option><option>Certificate of Enrollment</option><option>Good Moral Certificate</option><option>Award or Certificate</option><option>Other</option>' +
        "</select><span class=\"field-error\"></span></div></div>" +
        '<div class="col-md-6"><div class="form-group"><label for="documentYear">School year (optional)</label>' +
        '<select class="custom-select" id="documentYear" name="schoolYearId">' +
        L.yearOptions(state.years, "", "Not year-specific") +
        "</select></div></div>" +
        '<div class="col-md-6"><div class="form-group"><label for="documentFile">File <span class="required-mark">*</span></label>' +
        '<input type="file" class="form-control-file" id="documentFile" name="file" accept="application/pdf,image/jpeg,image/png" required>' +
        '<span class="field-hint">PDF, JPEG, or PNG up to 5 MB. Files are validated by content, not just extension.</span><span class="field-error"></span></div></div>' +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="submit" form="documentForm" class="btn btn-primary" id="saveDocumentButton"><i class="bi bi-upload" aria-hidden="true"></i> Upload document</button>'
    });
    var form = dialog.element.querySelector("#documentForm");
    var button = dialog.element.querySelector("#saveDocumentButton");
    var alertBox = dialog.element.querySelector("#documentFormAlert");
    var fileInput = form.querySelector("#documentFile");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var file = fileInput.files && fileInput.files[0];
      var title = form.querySelector("#documentTitle").value.trim();
      if (!title) {
        window.UI.fieldError(form.querySelector("#documentTitle"), "Document title is required.");
        return;
      }
      if (!file) {
        window.UI.fieldError(fileInput, "Choose a file to upload.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        window.UI.fieldError(fileInput, "The file must be 5 MB or smaller.");
        return;
      }
      var data = new FormData();
      data.append("title", title);
      data.append("documentType", form.querySelector("#documentType").value);
      var yearId = form.querySelector("#documentYear").value;
      if (yearId) {
        data.append("schoolYearId", yearId);
      }
      data.append("file", file);
      window.UI.clearFieldErrors(form);
      window.UI.setButtonLoading(button, true, "Uploading…");
      API.upload("/learners/" + state.learnerId + "/documents", data)
        .then(function () {
          window.UI.setButtonLoading(button, false);
          dialog.close();
          window.UI.toast("Document uploaded", title + " was attached to the learner record.", "success");
          loadDetail();
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (error.status === 413) {
            window.UI.fieldError(fileInput, "The file must be 5 MB or smaller.");
            return;
          }
          window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not upload document");
        });
    });
  }

  /* Activities ------------------------------------------------------------ */

  function activityCard(record) {
    return (
      '<article class="guardian-card" style="margin-bottom:.8rem">' +
      '<div class="guardian-card__head"><div><h3>' +
      esc(record.name) +
      "</h3><p>" +
      esc(record.category) +
      (record.organization ? " · " + esc(record.organization) : "") +
      "</p></div>" +
      (isActivityManager() && !state.detail.learner.isArchived
        ? '<div class="row-actions"><button type="button" class="btn btn-light" data-activity-remove="' +
          record.id +
          '" title="Remove participation"><i class="bi bi-x-circle" aria-hidden="true"></i></button></div>'
        : "") +
      "</div>" +
      '<div class="guardian-card__badges">' +
      L.levelBadge(record.participationLevel) +
      '<span class="year-chip"><i class="bi bi-calendar3" aria-hidden="true"></i> ' +
      esc(record.schoolYearName || "") +
      "</span>" +
      (record.role
        ? '<span class="status-badge status-badge--neutral"><span class="status-dot"></span>' + esc(record.role) + "</span>"
        : "") +
      "</div>" +
      '<div class="guardian-card__rows">' +
      '<span><i class="bi bi-calendar-range" aria-hidden="true"></i> ' +
      window.UI.phDate(record.startDate) +
      (record.endDate ? " – " + window.UI.phDate(record.endDate) : "") +
      "</span>" +
      (record.adviserName
        ? '<span><i class="bi bi-person-badge" aria-hidden="true"></i> ' + esc(record.adviserName) + "</span>"
        : "") +
      (record.achievement
        ? '<span><i class="bi bi-award" aria-hidden="true"></i> ' + esc(record.achievement) + "</span>"
        : "") +
      (record.remarks
        ? '<span><i class="bi bi-chat-left-text" aria-hidden="true"></i> ' + esc(record.remarks) + "</span>"
        : "") +
      "</div></article>"
    );
  }

  function renderActivities() {
    var activities = state.detail.activities;
    var mount = el("activityList");
    el("activityCount").textContent = activities.length;
    if (!activities.length) {
      mount.innerHTML = window.UI.emptyState({
        icon: "bi-trophy",
        title: "No activities recorded",
        message: "Record curricular or extracurricular participation such as clubs, competitions, and school programs."
      });
    } else {
      mount.innerHTML = activities.map(activityCard).join("");
    }
    mount.querySelectorAll("[data-activity-remove]").forEach(function (button) {
      button.addEventListener("click", function () {
        var record = activities.find(function (item) {
          return String(item.id) === button.dataset.activityRemove;
        });
        window.UI.confirm({
          title: "Remove participation?",
          message: (record ? record.name : "This activity") + " will be removed from this learner's record.",
          confirmLabel: "Remove",
          tone: "danger"
        }).then(function (confirmed) {
          if (!confirmed) {
            return;
          }
          API.delete("/learners/" + state.learnerId + "/activities/" + record.id)
            .then(function () {
              window.UI.toast("Participation removed", record.name + " was removed.", "success");
              loadDetail();
            })
            .catch(function (error) {
              window.UI.showAlert(el("learnerPageAlert"), "danger", L.friendlyError(error), "Could not remove activity");
            });
        });
      });
    });
    var addButton = el("addActivityButton");
    addButton.classList.toggle("d-none", !isActivityManager() || state.detail.learner.isArchived);
    addButton.onclick = addActivityModal;
  }

  function addActivityModal() {
    if (!state.activityList.length) {
      window.UI.showAlert(
        el("learnerPageAlert"),
        "info",
        'No activities exist for this school yet. Create one from the Activities page, then add this learner as a participant.',
        "No activities available"
      );
      return;
    }
    var existing = state.detail.activities.map(function (record) {
      return record.activityId;
    });
    var candidates = state.activityList.filter(function (activity) {
      return existing.indexOf(activity.id) === -1;
    });
    var dialog = L.modal({
      title: "Add activity participation",
      eyebrow: "Curricular and extracurricular",
      size: "modal-lg",
      body:
        '<form id="participationForm" novalidate>' +
        '<div id="participationFormAlert" class="d-none mb-3" role="alert"></div>' +
        '<div class="row">' +
        '<div class="col-12"><div class="form-group"><label for="participationActivity">Activity <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="participationActivity" name="activityId" required>' +
        L.options(
          candidates,
          "id",
          function (activity) {
            return activity.name + " · " + (activity.schoolYearName || "") + " · " + window.UI.titleCase(activity.participationLevel);
          },
          "",
          candidates.length ? "Select an activity" : "All activities are already recorded"
        ) +
        "</select><span class=\"field-error\"></span></div></div>" +
        '<div class="col-md-6"><div class="form-group"><label for="participationRole">Role in the activity</label>' +
        '<input class="form-control" id="participationRole" name="role" maxlength="80" placeholder="e.g. President, Member, Soloist">' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="participationAchievement">Achievement</label>' +
        '<input class="form-control" id="participationAchievement" name="achievement" maxlength="200" placeholder="e.g. First place, division level">' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-12"><div class="form-group"><label for="participationRemarks">Remarks</label>' +
        '<textarea class="form-control" id="participationRemarks" name="remarks" rows="2" maxlength="2000"></textarea>' +
        '<span class="field-error"></span></div></div>' +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="submit" form="participationForm" class="btn btn-primary" id="saveParticipationButton">Add participation</button>'
    });
    var form = dialog.element.querySelector("#participationForm");
    var button = dialog.element.querySelector("#saveParticipationButton");
    var alertBox = dialog.element.querySelector("#participationFormAlert");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var values = L.formValues(form);
      if (!values.activityId) {
        window.UI.fieldError(form.querySelector("#participationActivity"), "Choose an activity.");
        return;
      }
      L.submit(
        form,
        button,
        alertBox,
        function () {
          return API.post("/learners/" + state.learnerId + "/activities", values);
        },
        function () {
          dialog.close();
          window.UI.toast("Participation added", "The activity was added to the learner's record.", "success");
          loadDetail();
        }
      );
    });
  }

  /* Subjects, teachers, and timetable ------------------------------------ */

  function loadSubjects() {
    if (!state.detail) {
      return;
    }
    var learner = state.detail.learner;
    var enrollment = learner.currentEnrollment;
    var subtitle = el("subjectsSubtitle");
    var body = el("subjectTableBody");
    var timetable = el("learnerTimetable");
    if (!enrollment || !enrollment.sectionId) {
      subtitle.textContent = "The learner has no section assignment for the current school year.";
      body.innerHTML = '<tr><td colspan="6" class="empty-cell">Assign a section in the school-year record to see subjects and teachers.</td></tr>';
      timetable.innerHTML = '<p class="text-muted mb-0" style="font-size:.82rem">No section timetable is available.</p>';
      return;
    }
    subtitle.textContent =
      "Subject assignments and schedule for " +
      (enrollment.gradeLevel || "the section") +
      " · " +
      enrollment.sectionName +
      " (" +
      enrollment.schoolYearName +
      ").";
    body.innerHTML = window.LearnerUI.skeletonRows(6, 4);
    timetable.innerHTML = '<span class="skeleton skeleton-block" style="height:180px"></span>';
    document.getElementById("timetableLink").href =
      "subjects.html?tab=timetable&sectionId=" + enrollment.sectionId;

    Promise.all([
      L.apiGet("/academic/assignments", {
        sectionId: enrollment.sectionId,
        schoolYearId: enrollment.schoolYearId
      }),
      L.apiGet("/academic/schedules", {
        sectionId: enrollment.sectionId
      }),
      L.apiGet("/academic/timetable", { sectionId: enrollment.sectionId })
    ])
      .then(function (results) {
        var assignments = results[0] || [];
        var schedules = results[1] || [];
        var timetableData = results[2] || { days: [] };
        el("subjectCount").textContent = assignments.length;
        if (!assignments.length) {
          body.innerHTML = '<tr><td colspan="6" class="empty-cell">No subjects have been assigned to this section yet.</td></tr>';
        } else {
          body.innerHTML = assignments
            .map(function (assignment) {
              var entries = schedules
                .filter(function (entry) {
                  return entry.assignmentId === assignment.id;
                })
                .map(function (entry) {
                  return (
                    '<span><strong>' +
                    esc(L.DAY_NAMES[entry.dayOfWeek]) +
                    "</strong> " +
                    window.UI.time(entry.startTime) +
                    "–" +
                    window.UI.time(entry.endTime) +
                    "</span>"
                  );
                })
                .join("<br>");
              return (
                "<tr><td><strong>" +
                esc(assignment.subjectCode || "") +
                "</strong> " +
                esc(assignment.subjectName || "") +
                "</td><td>" +
                esc(assignment.teacherName || "Unassigned") +
                "</td><td>" +
                esc(assignment.employeeNumber || "—") +
                "</td><td>" +
                (entries || "—") +
                "</td><td>" +
                esc(assignment.remarks || "—") +
                "</td><td>" +
                (assignment.scheduleCount ? assignment.scheduleCount + " session(s)" : "No schedule") +
                "</td></tr>"
              );
            })
            .join("");
        }

        var days = timetableData.days || [];
        if (!days.length) {
          timetable.innerHTML = '<p class="text-muted mb-0" style="font-size:.82rem">No timetable entries yet.</p>';
          return;
        }
        timetable.innerHTML =
          '<div class="table-responsive"><table class="timetable"><thead><tr><th>Time</th>' +
          days
            .map(function (day) {
              return "<th>" + esc(day.dayName) + "</th>";
            })
            .join("") +
          "</tr></thead><tbody><tr><td><strong>Class schedule</strong></td>" +
          days
            .map(function (day) {
              if (!day.entries.length) {
                return '<td><span class="timetable-empty">No classes</span></td>';
              }
              return (
                "<td>" +
                day.entries
                  .map(function (entry) {
                    return (
                      '<span class="timetable-entry">' +
                      esc(entry.subjectCode || entry.subjectName || "Class") +
                      "<small>" +
                      window.UI.time(entry.startTime) +
                      "–" +
                      window.UI.time(entry.endTime) +
                      (entry.room ? " · " + esc(entry.room) : "") +
                      "</small></span>"
                    );
                  })
                  .join("") +
                "</td>"
              );
            })
            .join("") +
          "</tr></tbody></table></div>";
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        body.innerHTML =
          '<tr><td colspan="6" class="empty-cell">' + esc(L.friendlyError(error)) + "</td></tr>";
        timetable.innerHTML = "";
      });
  }

  /* History and overview -------------------------------------------------- */

  function historyItem(entry) {
    var summary = "";
    if (entry.details && entry.details.name) {
      summary = entry.details.name;
    } else if (entry.details && entry.details.lrn) {
      summary = entry.details.lrn;
    } else if (entry.details && entry.details.school_year) {
      summary = entry.details.school_year;
    }
    return (
      "<li><strong>" +
      esc(window.UI.actionLabel(entry.action)) +
      "</strong><span>" +
      esc(entry.userName || "System") +
      " · " +
      window.UI.phDateTime(entry.createdAt) +
      (summary ? " · " + esc(summary) : "") +
      "</span></li>"
    );
  }

  function renderHistory() {
    var history = state.detail.history;
    var mount = el("historyList");
    var overview = el("overviewHistory");
    if (!history.length) {
      mount.innerHTML = "<li><strong>No changes recorded</strong><span>The audit trail will appear as the record is updated.</span></li>";
      overview.innerHTML = mount.innerHTML;
      return;
    }
    mount.innerHTML = history.map(historyItem).join("");
    overview.innerHTML = history.slice(0, 5).map(historyItem).join("");
  }

  function renderOverview() {
    var learner = state.detail.learner;
    var enrollment = learner.currentEnrollment;
    el("overviewYear").innerHTML =
      '<i class="bi bi-calendar3" aria-hidden="true"></i> ' +
      esc(enrollment ? enrollment.schoolYearName : "No current school year");
    el("overviewEnrollment").innerHTML =
      '<div class="mini-card"><span>Grade level</span><strong>' +
      esc(enrollment ? enrollment.gradeLevel || "—" : "Not enrolled") +
      "</strong><small>" +
      esc(learner.schoolName || "") +
      "</small></div>" +
      '<div class="mini-card"><span>Section</span><strong>' +
      esc((enrollment && enrollment.sectionName) || "Not assigned") +
      "</strong><small>" +
      esc((enrollment && enrollment.adviserName) || "No adviser") +
      "</small></div>" +
      '<div class="mini-card"><span>Enrollment status</span><strong>' +
      esc(enrollment ? (L.ENROLLMENT_STATUS[enrollment.status] || {}).label || enrollment.status : "Not enrolled") +
      "</strong><small>" +
      esc(enrollment ? "Recorded " + window.UI.phDate(enrollment.enrollmentDate || learner.updatedAt) : "Add a school-year record") +
      "</small></div>" +
      '<div class="mini-card"><span>Learning profile</span><strong>' +
      esc(learner.profileComplete ? "Complete" : "Needs details") +
      "</strong><small>" +
      (learner.profileComplete ? "All required fields are present" : learner.missingFields.length + " field(s) missing") +
      "</small></div>";

    var missingCard = el("overviewMissingCard");
    if (learner.profileComplete) {
      missingCard.hidden = true;
    } else {
      missingCard.hidden = false;
      el("overviewMissing").innerHTML = learner.missingFields
        .map(function (field) {
          return "<li>" + esc(field) + "</li>";
        })
        .join("");
    }

    var guardians = state.detail.guardians;
    el("overviewGuardians").innerHTML = guardians.length
      ? guardians
          .slice(0, 3)
          .map(function (guardian) {
            return (
              '<div class="detail-item" style="padding:.5rem 0"><span class="detail-label">' +
              esc(guardian.relationship) +
              (guardian.isPrimary ? " · primary" : "") +
              '</span><span class="detail-value">' +
              esc(guardian.fullName) +
              "<br><small>" +
              esc(guardian.contactNumber || guardian.email || "No contact") +
              "</small></span></div>"
            );
          })
          .join("")
      : '<p class="text-muted mb-0" style="font-size:.82rem">No guardian recorded yet.</p>';

    var documents = state.detail.documents;
    el("overviewDocuments").innerHTML = documents.length
      ? documents
          .slice(0, 3)
          .map(function (document) {
            return (
              '<div class="doc-item" style="margin-bottom:.4rem"><div class="doc-item__copy"><strong>' +
              esc(document.title) +
              "</strong><small>" +
              esc(document.documentType) +
              "</small></div>" +
              '<a class="btn btn-light" href="/api/learners/' +
              state.learnerId +
              "/documents/" +
              document.id +
              '/download" title="Download"><i class="bi bi-download" aria-hidden="true"></i></a></div>'
            );
          })
          .join("")
      : '<p class="text-muted mb-0" style="font-size:.82rem">No documents uploaded.</p>';
  }

  /* Print ----------------------------------------------------------------- */

  function printProfile() {
    var learner = state.detail.learner;
    var guardians = state.detail.guardians;
    var enrollments = state.detail.enrollments;
    var activities = state.detail.activities;
    var rows =
      '<div class="print-grid">' +
      '<div><span>Learner Reference Number</span>' + esc(learner.lrn) + "</div>" +
      '<div><span>Full name</span>' + esc(learner.formalName) + "</div>" +
      '<div><span>Birth date</span>' + esc(window.UI.phDate(learner.birthDate)) + "</div>" +
      '<div><span>Age</span>' + (learner.age === null ? "—" : learner.age + " years old") + "</div>" +
      '<div><span>Sex</span>' + esc(window.UI.titleCase(learner.sex)) + "</div>" +
      '<div><span>School</span>' + esc(learner.schoolName || "—") + "</div>" +
      '<div><span>Address</span>' + esc(learner.addressLine || "—") + "</div>" +
      '<div><span>Contact</span>' + esc(learner.contactNumber || learner.email || "—") + "</div>" +
      "</div>";
    var guardianTable = L.tableHtml(
      ["Guardian", "Relationship", "Contact", "Email", "Address", "Flags"],
      guardians.map(function (guardian) {
        return [
          guardian.fullName,
          guardian.relationship,
          guardian.contactNumber || "",
          guardian.email || "",
          guardian.address || "",
          (guardian.isPrimary ? "Primary" : "") + (guardian.isEmergency ? " Emergency" : "")
        ];
      })
    );
    var enrollmentTable = L.tableHtml(
      ["School year", "Grade level", "Section", "Adviser", "Enrollment date", "Status", "Remarks"],
      enrollments.map(function (entry) {
        return [
          entry.schoolYearName,
          entry.gradeLevel || "",
          entry.sectionName || "",
          entry.adviserName || "",
          window.UI.phDate(entry.enrollmentDate),
          (L.ENROLLMENT_STATUS[entry.status] || {}).label || entry.status,
          entry.remarks || ""
        ];
      })
    );
    var activityTable = L.tableHtml(
      ["Activity", "Category", "School year", "Level", "Role", "Achievement"],
      activities.map(function (activity) {
        return [
          activity.name,
          activity.category,
          activity.schoolYearName || "",
          (L.PARTICIPATION_LEVEL[activity.participationLevel] || {}).label || activity.participationLevel,
          activity.role || "",
          activity.achievement || ""
        ];
      })
    );
    L.printHtml(
      "Learner Profile Sheet — " + learner.formalName,
      "<h1>Republic of the Philippines · Department of Education</h1>" +
        '<p class="print-meta">Learner Profile Sheet · ' +
        esc(learner.schoolName || "") +
        " · Generated " +
        esc(window.UI.phDateTime(new Date())) +
        "</p>" +
        rows +
        "<h2>Parents and guardians</h2>" +
        guardianTable +
        "<h2>School-year records</h2>" +
        enrollmentTable +
        "<h2>Curricular and extracurricular activities</h2>" +
        activityTable +
        '<div class="print-sign"><div>Class Adviser</div><div>School Head / Registrar</div><div>Parent / Guardian</div></div>'
    );
  }

  /* Data ------------------------------------------------------------------ */

  function mountAcademic(refresh) {
    if (!window.LearnerAcademic) {
      return;
    }
    window.LearnerAcademic.mount({
      learnerId: state.learnerId,
      detail: state.detail,
      session: state.session,
      years: state.years
    });
    if (refresh && window.LearnerAcademic.isAcademic(state.activeTab)) {
      window.LearnerAcademic.invalidate();
      window.LearnerAcademic.show(state.activeTab, true);
    }
  }

  function loadDetail() {
    L.apiGet("/learners/" + state.learnerId)
      .then(function (detail) {
        state.detail = detail;
        renderHero();
        renderPersonal();
        renderGuardians();
        renderEnrollments();
        renderDocuments();
        renderActivities();
        renderHistory();
        renderOverview();
        mountAcademic(true);
        if (state.activeTab === "subjects") {
          loadSubjects();
        }
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        window.UI.showAlert(
          el("learnerPageAlert"),
          "danger",
          error.status === 404
            ? "This learner does not exist or is outside your authorized scope."
            : L.friendlyError(error),
          "Learner profile unavailable"
        );
        el("learnerHero").innerHTML = "";
      });
  }

  function loadReferenceData() {
    var learner = state.detail ? state.detail.learner : null;
    var learnerSchoolId = learner ? learner.schoolId : L.schoolId();
    return Promise.all([
      L.years(),
      L.grades(learnerSchoolId),
      L.sections({ schoolId: learnerSchoolId || undefined }),
      L.teachers(learnerSchoolId || undefined),
      L.activities({ schoolId: learnerSchoolId || undefined })
    ]).then(function (results) {
      state.years = results[0];
      state.gradeLevels = results[1];
      state.sections = results[2];
      state.teachers = results[3];
      state.activityList = results[4];
    });
  }

  function init() {
    var query = new URLSearchParams(window.location.search);
    var id = query.get("id");
    if (!id || !/^\d+$/.test(id)) {
      document.getElementById("appLoading").innerHTML =
        '<div class="shell-error"><h1>Learner not specified</h1><p>Open a learner from the learner register.</p><a class="btn btn-primary" href="learners.html">Back to learners</a></div>';
      return;
    }
    state.learnerId = id;
    state.activeTab = query.get("tab") || "overview";

    window.AppShell.init({
      page: "learners",
      breadcrumbs: ["Learners", "Profile"]
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      document.querySelectorAll("#learnerTabs [data-tab]").forEach(function (button) {
        button.addEventListener("click", function () {
          setTab(button.dataset.tab);
        });
      });
      document.querySelectorAll("[data-open-tab]").forEach(function (button) {
        button.addEventListener("click", function () {
          setTab(button.dataset.openTab);
        });
      });
      L.apiGet("/learners/" + state.learnerId).then(function (detail) {
        state.detail = detail;
        return loadReferenceData().then(function () {
          renderHero();
          renderPersonal();
          renderGuardians();
          renderEnrollments();
          renderDocuments();
          renderActivities();
          renderHistory();
          renderOverview();
          mountAcademic(false);
          setTab(state.activeTab, false);
        });
      }).catch(function (error) {
        if (error.status === 401) {
          return;
        }
        window.UI.showAlert(
          el("learnerPageAlert"),
          "danger",
          error.status === 404
            ? "This learner does not exist or is outside your authorized scope."
            : L.friendlyError(error),
          "Learner profile unavailable"
        );
        el("learnerHero").innerHTML = "";
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
