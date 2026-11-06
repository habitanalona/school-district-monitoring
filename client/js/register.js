/* School District Monitoring System — self-service registration */
(function (window, document) {
  "use strict";

  var state = {
    options: null,
    submitting: false
  };

  function el(id) {
    return document.getElementById(id);
  }

  function setAlert(type, message, title) {
    window.UI.showAlert(el("registerAlert"), type, message, title);
  }

  function clearAlert() {
    window.UI.hideAlert(el("registerAlert"));
  }

  function selectedRoles() {
    if (!state.options) {
      return [];
    }
    return Array.prototype.slice
      .call(document.querySelectorAll('#roleOptions input[type="checkbox"]:checked'))
      .map(function (input) {
        return input.value;
      });
  }

  function selectedRole() {
    var roles = selectedRoles();
    if (!roles.length) {
      return null;
    }
    return roles
      .map(function (value) {
        return state.options.roles.find(function (role) {
          return role.value === value;
        });
      })
      .filter(Boolean)
      .sort(function (a, b) {
        return (b.rank || 0) - (a.rank || 0);
      })[0] || null;
  }

  function selectionNeedsSchool() {
    return selectedRoles().some(function (value) {
      var role = state.options && state.options.roles.find(function (entry) {
        return entry.value === value;
      });
      return Boolean(role && role.needsSchool);
    });
  }

  function selectedDistrict() {
    if (!state.options) {
      return null;
    }
    var value = el("districtId").value;
    return state.options.districts.find(function (district) {
      return String(district.id) === String(value);
    }) || null;
  }

  function selectedSchool() {
    if (!state.options) {
      return null;
    }
    var value = el("schoolId").value;
    return state.options.schools.find(function (school) {
      return String(school.id) === String(value);
    }) || null;
  }

  function fillRoleOptions() {
    el("roleOptions").innerHTML = state.options.roles
      .slice()
      .sort(function (a, b) {
        return (b.rank || 0) - (a.rank || 0);
      })
      .map(function (role) {
        var id = "role-" + role.value;
        return (
          '<div class="custom-control custom-checkbox">' +
          '<input class="custom-control-input" type="checkbox" id="' +
          window.UI.escapeHtml(id) +
          '" value="' +
          window.UI.escapeHtml(role.value) +
          '">' +
          '<label class="custom-control-label" for="' +
          window.UI.escapeHtml(id) +
          '">' +
          window.UI.escapeHtml(role.fullLabel || role.label) +
          "</label>" +
          "</div>"
        );
      })
      .join("");
  }

  function fillDistrictOptions() {
    el("districtId").innerHTML =
      '<option value="">Select your district</option>' +
      state.options.districts
        .map(function (district) {
          return (
            '<option value="' +
            district.id +
            '">' +
            window.UI.escapeHtml(district.name) +
            " (" +
            window.UI.escapeHtml(district.code) +
            ")</option>"
          );
        })
        .join("");
  }

  function fillSchoolOptions() {
    var district = selectedDistrict();
    var previous = el("schoolId").value;
    var schools = state.options.schools.filter(function (school) {
      return district && Number(school.districtId) === Number(district.id);
    });
    el("schoolId").innerHTML =
      '<option value="">Select your school</option>' +
      schools
        .map(function (school) {
          return (
            '<option value="' +
            school.id +
            '">' +
            window.UI.escapeHtml(school.name) +
            " (" +
            window.UI.escapeHtml(school.code) +
            ")</option>"
          );
        })
        .join("");
    if (previous && schools.some(function (school) { return String(school.id) === String(previous); })) {
      el("schoolId").value = previous;
    }
  }

  function updateRoleUi() {
    var values = selectedRoles();
    var roles = values
      .map(function (value) {
        return state.options.roles.find(function (role) {
          return role.value === value;
        });
      })
      .filter(Boolean);
    var needsSchool = roles.some(function (role) {
      return role.needsSchool;
    });
    var schoolGroup = el("schoolGroup");
    var school = el("schoolId");
    var help = el("roleHelp");
    var primary = selectedRole();

    el("rolesValue").value = values.join(",");
    schoolGroup.classList.toggle("d-none", !needsSchool);
    school.required = needsSchool;
    if (!needsSchool) {
      school.value = "";
    }

    if (!primary) {
      help.textContent =
        "Select every role you hold. Your account receives the combined access of all selected roles.";
      return;
    }
    var roleCount = values.length > 1 ? " (" + values.length + " roles combined)" : "";
    if (primary.value === "psds") {
      help.textContent =
        "PSDS registrations are confirmed by the District Administrator" + roleCount + ".";
      return;
    }
    if (primary.value === "school_head") {
      help.textContent =
        "School head registrations are confirmed by the PSDS in your district" + roleCount + ".";
      return;
    }
    if (primary.value === "learner") {
      help.textContent =
        "Learner registrations are confirmed by your Class Adviser" + roleCount + ".";
      return;
    }
    help.textContent =
      "This registration is confirmed by the School Head at your selected school" + roleCount + ".";
  }

  function showSuccess(result) {
    var user = result.user || {};
    var approval = result.approval || {};
    var district = selectedDistrict();
    var school = selectedSchool();
    el("registerForm").classList.add("d-none");
    var panel = el("registerSuccess");
    panel.classList.remove("d-none");
    el("registerSuccessMessage").textContent =
      approval.message ||
      "Your account was created and is waiting for confirmation.";
    var meta = [];
    var roleValues = user.roles && user.roles.length ? user.roles : user.role ? [user.role] : [];
    var roleNames = roleValues.map(function (value) {
      return window.UI.ROLE[value] ? window.UI.ROLE[value].label : window.UI.titleCase(value);
    });
    meta.push("Roles: " + (roleNames.length ? roleNames.join(", ") : "Registered"));
    if (district) {
      meta.push("District: " + district.name);
    }
    if (school) {
      meta.push("School: " + school.name);
    }
    meta.push("Confirming officer: " + (approval.approverLabel || "your superior"));
    el("registerSuccessMeta").innerHTML = meta
      .map(function (line) {
        return "<span>" + window.UI.escapeHtml(line) + "</span>";
      })
      .join("");
    window.UI.scrollToTop();
    var heading = el("registerSuccess").querySelector("h3");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus();
    }
  }

  function submit(event) {
    event.preventDefault();
    if (state.submitting) {
      return;
    }
    clearAlert();
    var form = el("registerForm");
    var role = selectedRole();
    var rules = [
      { name: "firstName", label: "First name", required: true, maxLength: 80 },
      { name: "middleName", label: "Middle name", maxLength: 80 },
      { name: "lastName", label: "Last name", required: true, maxLength: 80 },
      {
        name: "username",
        label: "Username",
        required: true,
        minLength: 3,
        maxLength: 64,
        pattern: /^[a-zA-Z0-9._-]+$/,
        patternMessage: "Use letters, numbers, dots, underscores, and hyphens only."
      },
      {
        name: "email",
        label: "Email address",
        required: true,
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        patternMessage: "Enter a valid email address."
      },
      {
        name: "roles",
        label: "Role",
        required: true,
        requiredMessage: "Select at least one role."
      },
      { name: "districtId", label: "District", required: true, requiredMessage: "Select your district." },
      {
        name: "password",
        label: "Password",
        required: true,
        minLength: 10,
        maxLength: 128,
        pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/,
        patternMessage: "Include at least one letter and one number."
      },
      {
        name: "confirmPassword",
        label: "Confirm password",
        required: true,
        requiredMessage: "Confirm your password.",
        match: "password",
        matchMessage: "Passwords do not match."
      }
    ];
    if (selectionNeedsSchool()) {
      rules.push({
        name: "schoolId",
        label: "School",
        required: true,
        requiredMessage: "Select your school."
      });
    }
    if (!window.UI.validateForm(form, rules)) {
      return;
    }

    state.submitting = true;
    window.UI.setButtonLoading(el("registerButton"), true, "Submitting…");

    API.post("/auth/register", {
      firstName: el("firstName").value.trim(),
      middleName: el("middleName").value.trim(),
      lastName: el("lastName").value.trim(),
      username: el("username").value.trim(),
      email: el("email").value.trim(),
      password: el("registerPassword").value,
      roles: selectedRoles(),
      role: role ? role.value : "",
      districtId: Number(el("districtId").value),
      schoolId: selectionNeedsSchool() ? Number(el("schoolId").value) : null
    })
      .then(function (payload) {
        state.submitting = false;
        window.UI.setButtonLoading(el("registerButton"), false);
        showSuccess(payload.data || {});
      })
      .catch(function (error) {
        state.submitting = false;
        window.UI.setButtonLoading(el("registerButton"), false);
        if (!window.UI.showFieldErrors(form, error)) {
          setAlert(
            "danger",
            error.status === 429
              ? "Too many account requests. Please wait before trying again."
              : error.message || "Your registration could not be submitted.",
            "Unable to create account"
          );
        }
      });
  }

  function bind() {
    el("roleOptions").addEventListener("change", function () {
      updateRoleUi();
      fillSchoolOptions();
    });
    el("districtId").addEventListener("change", function () {
      fillSchoolOptions();
    });
    el("registerPasswordToggle").addEventListener("click", function () {
      var input = el("registerPassword");
      var showing = input.type === "text";
      input.type = showing ? "password" : "text";
      el("registerPasswordToggle").setAttribute("aria-pressed", String(!showing));
      el("registerPasswordToggle").setAttribute("aria-label", showing ? "Show password" : "Hide password");
      el("registerPasswordToggle").innerHTML =
        '<i class="bi ' + (showing ? "bi-eye" : "bi-eye-slash") + '" aria-hidden="true"></i>';
      input.focus();
    });
    el("registerForm").addEventListener("submit", submit);
  }

  function loadOptions() {
    API.get("/auth/registration-options")
      .then(function (payload) {
        state.options = payload.data || {};
        fillRoleOptions();
        fillDistrictOptions();
        fillSchoolOptions();
        updateRoleUi();
        el("registerLoading").classList.add("d-none");
        el("registerForm").classList.remove("d-none");
        API.ensureCsrfToken().catch(function () {
          /* Submission requests a token again if this fails. */
        });
      })
      .catch(function (error) {
        el("registerLoading").classList.add("d-none");
        el("registerForm").classList.add("d-none");
        setAlert(
          "danger",
          error.message || "The registration form could not be loaded. Refresh the page to try again.",
          "Registration unavailable"
        );
      });
  }

  function init() {
    bind();
    loadOptions();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
