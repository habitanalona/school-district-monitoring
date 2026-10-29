/* DepEd Learner Records — create and edit learner profile dialog */
(function (window) {
  "use strict";

  var ESC = window.LearnerUI.esc;

  function ageFromDate(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return null;
    }
    var parts = value.split("-").map(Number);
    var birth = new Date(parts[0], parts[1] - 1, parts[2]);
    var today = new Date();
    var age = today.getFullYear() - birth.getFullYear();
    var month = today.getMonth() - birth.getMonth();
    if (month < 0 || (month === 0 && today.getDate() < birth.getDate())) {
      age -= 1;
    }
    return age >= 0 && age <= 130 ? age : null;
  }

  function field(name, label, options) {
    var settings = options || {};
    var required = settings.required
      ? ' <span class="required-mark">*</span>'
      : "";
    var attrs =
      'class="form-control' +
      (settings.className ? " " + settings.className : "") +
      '" id="learner-' +
      name +
      '" name="' +
      name +
      '"' +
      (settings.type ? ' type="' + settings.type + '"' : "") +
      (settings.required ? " required" : "") +
      (settings.maxlength ? ' maxlength="' + settings.maxlength + '"' : "") +
      (settings.min !== undefined ? ' min="' + settings.min + '"' : "") +
      (settings.max !== undefined ? ' max="' + settings.max + '"' : "") +
      (settings.step ? ' step="' + settings.step + '"' : "") +
      (settings.placeholder ? ' placeholder="' + ESC(settings.placeholder) + '"' : "") +
      (settings.inputmode ? ' inputmode="' + settings.inputmode + '"' : "") +
      (settings.autocomplete ? ' autocomplete="' + settings.autocomplete + '"' : "") +
      ' value="' +
      ESC(settings.value === null || settings.value === undefined ? "" : settings.value) +
      '">';
    return (
      '<div class="form-group">' +
      "<label for=\"learner-" +
      name +
      '">' +
      ESC(label) +
      required +
      "</label>" +
      attrs +
      (settings.hint ? '<span class="field-hint">' + ESC(settings.hint) + "</span>" : "") +
      '<span class="field-error"></span>' +
      "</div>"
    );
  }

  function readAge() {
    var input = document.getElementById("learner-birthDate");
    var output = document.getElementById("learnerAgeReadout");
    if (!input || !output) {
      return;
    }
    var age = ageFromDate(input.value);
    output.innerHTML =
      age === null
        ? '<i class="bi bi-calculator" aria-hidden="true"></i> Age is calculated from the birth date.'
        : '<i class="bi bi-calculator" aria-hidden="true"></i> Age today: <strong>' +
          age +
          "</strong> years old";
  }

  function bodyMarkup(learner) {
    var data = learner || {};
    var fixedSchool = window.LearnerUI.schoolId();
    return (
      '<form id="learnerForm" novalidate>' +
      '<div id="learnerFormAlert" class="d-none mb-3" role="alert"></div>' +
      '<div class="row">' +
      '<div class="col-md-6">' +
      field("lrn", "Learner Reference Number (LRN)", {
        required: true,
        maxlength: 12,
        inputmode: "numeric",
        placeholder: "12-digit LRN",
        value: data.lrn,
        hint: "Exactly 12 digits. Must be unique across all learner records."
      }) +
      "</div>" +
      '<div class="col-md-6">' +
      field("birthDate", "Birth date", {
        required: true,
        type: "date",
        value: data.birthDate,
        max: window.LearnerUI.todayIso()
      }) +
      '<div class="form-group"><label>Age</label><div class="age-readout" id="learnerAgeReadout" aria-live="polite">' +
      '<i class="bi bi-calculator" aria-hidden="true"></i> Age is calculated from the birth date.</div>' +
      '<span class="field-hint">Derived automatically in Asia/Manila time; it cannot be edited.</span></div>' +
      "</div>" +
      '<div class="col-md-4">' +
      field("lastName", "Last name", { required: true, maxlength: 80, value: data.lastName }) +
      "</div>" +
      '<div class="col-md-4">' +
      field("firstName", "First name", { required: true, maxlength: 80, value: data.firstName }) +
      "</div>" +
      '<div class="col-md-3">' +
      field("middleName", "Middle name", { maxlength: 80, value: data.middleName }) +
      "</div>" +
      '<div class="col-md-1">' +
      field("extensionName", "Ext.", {
        maxlength: 16,
        value: data.extensionName,
        placeholder: "Jr."
      }) +
      "</div>" +
      '<div class="col-md-3">' +
      '<div class="form-group"><label for="learner-sex">Sex <span class="required-mark">*</span></label>' +
      '<select class="custom-select" id="learner-sex" name="sex" required>' +
      '<option value="">Select sex</option>' +
      '<option value="male"' +
      (data.sex === "male" ? " selected" : "") +
      ">Male</option>" +
      '<option value="female"' +
      (data.sex === "female" ? " selected" : "") +
      ">Female</option></select>" +
      '<span class="field-error"></span></div></div>' +
      '<div class="col-md-3">' +
      field("weightKg", "Weight (kg)", {
        type: "number",
        min: 1,
        max: 500,
        step: "0.1",
        value: data.weightKg
      }) +
      "</div>" +
      '<div class="col-md-3">' +
      field("heightCm", "Height (cm)", {
        type: "number",
        min: 1,
        max: 300,
        step: "0.1",
        value: data.heightCm
      }) +
      "</div>" +
      '<div class="col-md-3">' +
      (fixedSchool
        ? window.LearnerUI.schoolFieldHtml(fixedSchool)
        : '<div class="form-group"><label for="recordSchool">School <span class="required-mark">*</span></label>' +
          '<select class="custom-select" id="recordSchool" name="schoolId" data-school-select required>' +
          '<option value="">Loading schools…</option></select><span class="field-error"></span></div>') +
      "</div>" +
      "</div>" +
      '<p class="form-section-label">Address</p>' +
      '<div class="row">' +
      '<div class="col-md-4">' +
      field("houseNumber", "House number / street", { maxlength: 120, value: data.houseNumber }) +
      "</div>" +
      '<div class="col-md-4">' +
      field("barangay", "Barangay", { maxlength: 120, value: data.barangay }) +
      "</div>" +
      '<div class="col-md-4">' +
      field("municipality", "Municipality / city", { maxlength: 120, value: data.municipality }) +
      "</div>" +
      '<div class="col-md-4">' +
      field("province", "Province", { maxlength: 120, value: data.province }) +
      "</div>" +
      '<div class="col-md-4">' +
      field("region", "Region", { maxlength: 120, value: data.region }) +
      "</div>" +
      '<div class="col-md-4">' +
      field("zipCode", "ZIP code", {
        maxlength: 10,
        inputmode: "numeric",
        value: data.zipCode
      }) +
      "</div>" +
      "</div>" +
      '<p class="form-section-label">Contact details</p>' +
      '<div class="row">' +
      '<div class="col-md-6">' +
      field("contactNumber", "Contact number", {
        type: "tel",
        maxlength: 32,
        value: data.contactNumber,
        placeholder: "09XX XXX XXXX"
      }) +
      "</div>" +
      '<div class="col-md-6">' +
      field("email", "Email address", {
        type: "email",
        maxlength: 160,
        value: data.email
      }) +
      "</div>" +
      "</div>" +
      "</form>"
    );
  }

  function open(options) {
    var settings = Object.assign({ learner: null, onSaved: null }, options || {});
    var learner = settings.learner;
    var editing = Boolean(learner);
    var dialog = window.LearnerUI.modal({
      eyebrow: editing ? "Update profile" : "New record",
      title: editing ? "Edit learner profile" : "Register a learner",
      subtitle:
        "Permanent learner details. School-year enrollment, guardians, and activities are managed from the learner profile.",
      size: "modal-lg",
      body: bodyMarkup(learner),
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="submit" form="learnerForm" class="btn btn-primary" id="saveLearnerButton">' +
        '<i class="bi bi-check2" aria-hidden="true"></i> ' +
        (editing ? "Save changes" : "Create learner") +
        "</button>"
    });

    var form = dialog.element.querySelector("#learnerForm");
    var alertBox = dialog.element.querySelector("#learnerFormAlert");
    var saveButton = dialog.element.querySelector("#saveLearnerButton");
    var schoolSelect = form.querySelector("[data-school-select]");

    if (schoolSelect) {
      window.LearnerUI.fillSchoolSelect(schoolSelect, learner ? learner.schoolId : window.LearnerUI.schoolId());
    }
    var birthDate = form.querySelector("#learner-birthDate");
    if (birthDate) {
      birthDate.addEventListener("change", readAge);
      birthDate.addEventListener("input", readAge);
      readAge();
    }
    var lrnInput = form.querySelector("#learner-lrn");
    if (lrnInput) {
      lrnInput.addEventListener("input", function () {
        lrnInput.value = lrnInput.value.replace(/\D+/g, "").slice(0, 12);
      });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var values = window.LearnerUI.formValues(form);
      if (!values.lrn || !/^\d{12}$/.test(values.lrn)) {
        window.UI.fieldError(form.querySelector("#learner-lrn"), "The LRN must be exactly 12 digits.");
        return;
      }
      if (!values.birthDate) {
        window.UI.fieldError(form.querySelector("#learner-birthDate"), "Birth date is required.");
        return;
      }
      if (values.schoolId === "" && !window.LearnerUI.schoolId()) {
        window.UI.fieldError(form.querySelector("#recordSchool"), "Choose the learner's school.");
        return;
      }
      window.LearnerUI.submit(
        form,
        saveButton,
        alertBox,
        function () {
          return editing
            ? API.put("/learners/" + learner.id, values)
            : API.post("/learners", values);
        },
        function (payload) {
          dialog.close();
          window.UI.toast(
            editing ? "Learner updated" : "Learner registered",
            (payload.data.learner.fullName || "The learner") +
              (editing ? " was updated." : " was added to the learner register."),
            "success"
          );
          if (typeof settings.onSaved === "function") {
            settings.onSaved(payload.data.learner, editing);
          }
        }
      );
    });

    window.setTimeout(function () {
      var first = form.querySelector("#learner-lrn");
      if (first) {
        first.focus();
      }
    }, 220);

    return dialog;
  }

  window.LearnerForm = { open: open, ageFromDate: ageFromDate };
})(window);
