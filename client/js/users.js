/* School District Monitoring System — user management page */
(function (window, document) {
  "use strict";

  var state = {
    session: null,
    page: 1,
    pageSize: 10,
    search: "",
    role: "",
    status: "",
    sort: "name",
    direction: "asc",
    users: [],
    schools: [],
    sequence: 0,
    countSequence: 0,
    editingUser: null,
    formModal: null
  };

  var SCHOOL_ROLES = ["school_head", "teacher", "nt", "adviser", "learner"];
  var DISTRICT_MANAGED_ROLES = ["staff", "psds", "school_head", "teacher", "nt", "adviser", "learner"];
  var ROLE_OPTIONS = [
    { value: "district_admin", label: "District Administrator" },
    { value: "psds", label: "PSDS" },
    { value: "school_head", label: "School Head" },
    { value: "teacher", label: "Teacher" },
    { value: "nt", label: "NT (Non-Teaching)" },
    { value: "adviser", label: "Class Adviser" },
    { value: "learner", label: "Learner" },
    { value: "staff", label: "Authorized Staff" },
    { value: "system_admin", label: "System Administrator" }
  ];

  function el(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    var node = el(id);
    if (node) {
      node.textContent = value;
    }
  }

  function isSystemAdmin() {
    return Boolean(state.session && state.session.user.role === "system_admin");
  }

  function isSelf(user) {
    return Boolean(state.session && user && Number(user.id) === Number(state.session.user.id));
  }

  function canManageTarget(user) {
    if (!state.session || !user) {
      return false;
    }
    if (isSystemAdmin()) {
      return true;
    }
    return (
      DISTRICT_MANAGED_ROLES.indexOf(user.role) !== -1 &&
      Number(user.districtId) === Number(state.session.user.districtId)
    );
  }

  function listParams() {
    return {
      page: state.page,
      pageSize: state.pageSize,
      search: state.search,
      role: state.role,
      status: state.status,
      sort: state.sort,
      direction: state.direction
    };
  }

  function updateSortHeaders() {
    document.querySelectorAll("#userTable [data-sort]").forEach(function (button) {
      var column = button.dataset.sort;
      var active = column === state.sort;
      var icon = button.querySelector("i");
      var header = button.closest("th");
      if (header) {
        header.setAttribute("aria-sort", active ? (state.direction === "asc" ? "ascending" : "descending") : "none");
      }
      if (icon) {
        icon.className = active
          ? state.direction === "asc" ? "bi bi-sort-up" : "bi bi-sort-down"
          : "bi bi-arrow-down-up";
      }
      button.classList.toggle("is-sorted", active);
    });
  }

  function userRow(user) {
    var manageable = canManageTarget(user);
    var actions = '<div class="table-actions">';
    if (manageable) {
      actions +=
        '<button type="button" class="icon-action" data-action="edit" data-id="' + user.id +
        '" title="Edit account" aria-label="Edit account for ' + window.UI.escapeHtml(user.fullName) +
        '"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>';
      if (!isSelf(user) && (user.approvalStatus || "active") === "active") {
        actions +=
          '<button type="button" class="icon-action ' +
          (user.isActive ? "icon-action--danger" : "") +
          '" data-action="toggle" data-id="' + user.id +
          '" title="' + (user.isActive ? "Deactivate account" : "Activate account") +
          '" aria-label="' + (user.isActive ? "Deactivate account for " : "Activate account for ") +
          window.UI.escapeHtml(user.fullName) + '"><i class="bi ' +
          (user.isActive ? "bi-person-dash" : "bi-person-check") +
          '" aria-hidden="true"></i></button>';
      }
    } else {
      actions +=
        '<span class="cell-locked" title="Your role cannot manage this account"><i class="bi bi-lock" aria-hidden="true"></i> Protected</span>';
    }
    actions += "</div>";

    var roleMeta = window.UI.ROLE[user.role] || { label: window.UI.titleCase(user.role), tone: "neutral" };
    var lastLogin = user.lastLoginAt
      ? '<span class="cell-time" title="' + window.UI.escapeHtml(window.UI.dateTime(user.lastLoginAt)) + '">' +
        window.UI.escapeHtml(window.UI.relativeTime(user.lastLoginAt)) + "</span>"
      : '<span class="cell-muted">Never</span>';
    var approvalStatus = user.approvalStatus || "active";
    var statusBadge =
      approvalStatus === "pending"
        ? window.UI.pillarBadge("Pending confirmation", "warning")
        : approvalStatus === "rejected"
          ? window.UI.pillarBadge("Returned", "danger")
          : window.UI.pillarBadge(user.isActive ? "Active" : "Inactive", user.isActive ? "success" : "neutral");
    var districtCell =
      window.UI.escapeHtml(user.districtName || "All districts") +
      (user.schoolName
        ? '<small class="cell-subtext">' + window.UI.escapeHtml(user.schoolName) + "</small>"
        : "");

    return (
      '<tr data-user-id="' + user.id + '">' +
        '<td data-label="User"><div class="user-cell">' +
        '<span class="avatar avatar--sm avatar--' + window.UI.escapeHtml(user.role) + '">' +
        window.UI.escapeHtml(window.UI.initials(user.fullName)) + "</span>" +
        "<div><strong>" + window.UI.escapeHtml(user.fullName) +
        (isSelf(user) ? '<span class="self-chip">You</span>' : "") +
        "</strong><small>@" + window.UI.escapeHtml(user.username) + " · " + window.UI.escapeHtml(user.email) + "</small></div></div></td>" +
        '<td data-label="Role">' + window.UI.pillarBadge(roleMeta.label, roleMeta.tone) + "</td>" +
        '<td data-label="District"><span class="cell-muted">' + districtCell + "</span></td>" +
        '<td data-label="Status">' + statusBadge + "</td>" +
        '<td data-label="Last Sign-in">' + lastLogin + "</td>" +
        '<td data-label="Created"><span class="cell-time">' + window.UI.escapeHtml(window.UI.date(user.createdAt)) + "</span></td>" +
        '<td data-label="Actions" class="cell-actions">' + actions + "</td>" +
      "</tr>"
    );
  }

  function renderUsers(pagination) {
    var body = el("userTableBody");
    var meta = el("userTableMeta");
    if (!body) {
      return;
    }
    body.removeAttribute("aria-busy");
    updateSortHeaders();
    if (!state.users.length) {
      var filtered = Boolean(state.search || state.role || state.status);
      body.innerHTML =
        '<tr class="empty-row"><td colspan="7">' +
        window.UI.emptyState({
          icon: filtered ? "bi-search" : "bi-people",
          title: filtered ? "No matching accounts" : "No accounts found",
          message: filtered
            ? "Try a different search term or clear the current filters."
            : "Create an account to begin provisioning district access.",
          action: '<button type="button" class="btn btn-light btn-sm" data-empty-reset>Clear filters</button>'
        }) + "</td></tr>";
      if (meta) {
        meta.textContent = "No accounts found";
      }
      window.UI.pagination(el("userPagination"), pagination || {}, function () {});
      return;
    }
    body.innerHTML = state.users.map(userRow).join("");
    if (meta) {
      meta.textContent =
        window.UI.number(pagination.total) + (Number(pagination.total) === 1 ? " account" : " accounts") +
        " in your management scope";
    }
    window.UI.pagination(el("userPagination"), pagination, function (page) {
      state.page = page;
      loadUsers();
    });
  }

  function loadUsers() {
    var body = el("userTableBody");
    if (!body) {
      return;
    }
    var sequence = ++state.sequence;
    body.setAttribute("aria-busy", "true");
    body.innerHTML = window.UI.tableLoading(7, 6);
    setText("userTableMeta", "Loading accounts…");
    return API.get("/users", listParams())
      .then(function (payload) {
        if (sequence !== state.sequence) {
          return;
        }
        state.users = payload.data || [];
        renderUsers(payload.pagination || { total: state.users.length, page: state.page, pageSize: state.pageSize, totalPages: 1 });
      })
      .catch(function (error) {
        if (sequence !== state.sequence || error.status === 401) {
          return;
        }
        body.removeAttribute("aria-busy");
        body.innerHTML =
          '<tr class="empty-row"><td colspan="7">' +
          window.UI.emptyState({
            icon: "bi-cloud-slash",
            title: "Accounts could not be loaded",
            message: error.status === 403
              ? "You do not have permission to manage user accounts."
              : error.message || "The user directory is temporarily unavailable.",
            action: '<button type="button" class="btn btn-primary btn-sm" id="retryUsers">Try again</button>'
          }) + "</td></tr>";
        setText("userTableMeta", "Unavailable");
        var retry = el("retryUsers");
        if (retry) {
          retry.addEventListener("click", loadUsers);
        }
      });
  }

  function loadCounts() {
    var sequence = ++state.countSequence;
    return Promise.all([
      API.get("/users", { page: 1, pageSize: 1, status: "active" }),
      API.get("/users", { page: 1, pageSize: 1, status: "inactive" })
    ])
      .then(function (results) {
        if (sequence !== state.countSequence) {
          return;
        }
        var active = Number((results[0].pagination && results[0].pagination.total) || 0);
        var inactive = Number((results[1].pagination && results[1].pagination.total) || 0);
        setText("userKpiTotal", window.UI.number(active + inactive));
        setText("userKpiActive", window.UI.number(active));
        setText("userKpiInactive", window.UI.number(inactive));
      })
      .catch(function (error) {
        if (sequence !== state.countSequence || error.status === 401) {
          return;
        }
        ["userKpiTotal", "userKpiActive", "userKpiInactive"].forEach(function (id) {
          setText(id, "—");
        });
      });
  }

  function loadSchools() {
    return API.get("/schools", { page: 1, pageSize: 100, sort: "name", direction: "asc" })
      .then(function (payload) {
        state.schools = payload.data || [];
        refreshSchoolOptions();
        return state.schools;
      })
      .catch(function (error) {
        if (error.status === 401) {
          return [];
        }
        state.schools = [];
        return [];
      });
  }

  function districtOptions(selectedId) {
    return (state.session.districts || []).map(function (district) {
      return (
        '<option value="' + district.id + '"' +
        (String(district.id) === String(selectedId) ? " selected" : "") +
        ">" + window.UI.escapeHtml(district.name) + " (" + window.UI.escapeHtml(district.code) + ")</option>"
      );
    }).join("");
  }

  function roleOptions(selectedRole) {
    var roles = isSystemAdmin()
      ? ROLE_OPTIONS
      : ROLE_OPTIONS.filter(function (role) {
          return DISTRICT_MANAGED_ROLES.indexOf(role.value) !== -1;
        });
    return roles.map(function (role) {
      return (
        '<option value="' + role.value + '"' +
        (role.value === selectedRole ? " selected" : "") +
        ">" + role.label + "</option>"
      );
    }).join("");
  }

  function schoolOptions(selectedId, districtId) {
    return state.schools
      .filter(function (school) {
        return districtId && Number(school.districtId) === Number(districtId);
      })
      .map(function (school) {
        return (
          '<option value="' + school.id + '"' +
          (String(school.id) === String(selectedId) ? " selected" : "") +
          ">" + window.UI.escapeHtml(school.name) + " (" + window.UI.escapeHtml(school.code) + ")</option>"
        );
      })
      .join("");
  }

  function refreshSchoolOptions(selectedId) {
    var school = el("userSchool");
    if (!school) {
      return;
    }
    var current = selectedId === undefined ? school.value : selectedId;
    school.innerHTML =
      '<option value="">Select a school</option>' +
      schoolOptions(current, el("userDistrict").value);
  }

  function toggleDistrictField(selectedSchoolId) {
    var role = el("userRole").value;
    var group = el("userDistrictGroup");
    var district = el("userDistrict");
    var schoolGroup = el("userSchoolGroup");
    var school = el("userSchool");
    if (!group) {
      return;
    }
    var needsDistrict = role !== "system_admin";
    var needsSchool = SCHOOL_ROLES.indexOf(role) !== -1;
    group.classList.toggle("d-none", !needsDistrict);
    if (district) {
      district.disabled = !needsDistrict || !isSystemAdmin();
      district.required = needsDistrict;
      if (!needsDistrict) {
        district.value = "";
      }
    }
    if (schoolGroup) {
      schoolGroup.classList.toggle("d-none", !needsSchool);
    }
    if (school) {
      school.disabled = !needsSchool;
      school.required = needsSchool;
      refreshSchoolOptions(selectedSchoolId);
      if (!needsSchool) {
        school.value = "";
      }
    }
  }

  function openForm(user) {
    var form = el("userForm");
    var modal = state.formModal;
    if (!form || !modal) {
      return;
    }
    state.editingUser = user || null;
    var editing = Boolean(user);
    form.reset();
    window.UI.clearFieldErrors(form);
    window.UI.hideAlert(el("userFormAlert"));

    setText("userFormTitle", editing ? "Edit user account" : "Add a user account");
    setText("userFormSubtitle", editing
      ? "Update account details, role assignment, or sign-in access."
      : "Provision access for a district team member.");

    el("userRole").innerHTML = roleOptions(user ? user.role : isSystemAdmin() ? "district_admin" : "staff");
    el("userRole").disabled = Boolean(user && isSelf(user));
    el("userDistrict").innerHTML = '<option value="">Select a district</option>' + districtOptions(user ? user.districtId : "");

    el("userFullName").value = user ? user.fullName : "";
    el("userUsername").value = user ? user.username : "";
    el("userUsername").disabled = editing;
    el("userEmail").value = user ? user.email : "";
    el("userRole").value = user ? user.role : isSystemAdmin() ? "district_admin" : "staff";
    if (!isSystemAdmin() && state.session.user.districtId) {
      el("userDistrict").value = String(state.session.user.districtId);
      el("userDistrict").disabled = true;
    }
    el("userSchool").innerHTML = '<option value="">Select a school</option>';
    el("userActive").checked = user ? Boolean(user.isActive) : true;
    el("userActive").disabled = Boolean(user && (isSelf(user) || (user.approvalStatus || "active") !== "active"));
    el("userPassword").value = "";
    el("userPassword").type = "password";
    el("userPasswordToggle").innerHTML = '<i class="bi bi-eye" aria-hidden="true"></i>';
    el("userPasswordToggle").setAttribute("aria-pressed", "false");
    el("userPasswordToggle").setAttribute("aria-label", "Show password");

    setText("userPasswordLabel", editing ? "Reset password" : "Temporary password");
    setText("passwordHelp", editing
      ? "Leave blank to keep the current password. New passwords need 10+ characters with a letter and number."
      : "At least 10 characters, including a letter and a number.");
    setText("usernameHelp", editing
      ? "Usernames are permanent and cannot be changed."
      : "Letters, numbers, dots, underscores, and hyphens only.");
    el("userSelfNote").classList.toggle("d-none", !(editing && isSelf(user)));

    var saveLabel = el("userSaveButton").querySelector("span");
    if (saveLabel) {
      saveLabel.textContent = editing ? "Save changes" : "Create account";
    }

    toggleDistrictField(user ? user.schoolId : "");
    if (!editing && !isSystemAdmin() && state.session.user.districtId) {
      el("userDistrictGroup").classList.remove("d-none");
    }
    modal.show();
    window.setTimeout(function () {
      el(editing ? "userFullName" : "userFullName").focus();
    }, 180);
  }

  function submitForm(event) {
    event.preventDefault();
    var form = el("userForm");
    var alertBox = el("userFormAlert");
    var saveButton = el("userSaveButton");
    window.UI.hideAlert(alertBox);

    var editing = state.editingUser;
    var password = el("userPassword").value;
    var rules = [
      { name: "fullName", label: "Full name", required: true, minLength: 2, maxLength: 160 },
      { name: "email", label: "Email address", required: true, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, patternMessage: "Enter a valid email address." },
      { name: "role", label: "Role", required: true }
    ];
    if (!editing) {
      rules.splice(1, 0, {
        name: "username",
        label: "Username",
        required: true,
        minLength: 3,
        maxLength: 64,
        pattern: /^[a-zA-Z0-9._-]+$/,
        patternMessage: "Use letters, numbers, dots, underscores, and hyphens only."
      });
    }
    if (!editing || password) {
      rules.push({
        name: "password",
        label: editing ? "Reset password" : "Temporary password",
        required: !editing,
        minLength: 10,
        maxLength: 128,
        pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/,
        patternMessage: "Include at least one letter and one number."
      });
    }
    var role = el("userRole").value;
    var needsSchool = SCHOOL_ROLES.indexOf(role) !== -1;
    if (isSystemAdmin() && role !== "system_admin") {
      rules.push({ name: "districtId", label: "District", required: true, requiredMessage: "Select a district." });
    }
    if (needsSchool) {
      rules.push({ name: "schoolId", label: "School", required: true, requiredMessage: "Select a school." });
    }
    if (!window.UI.validateForm(form, rules)) {
      return;
    }

    var payload = {
      fullName: el("userFullName").value.trim(),
      email: el("userEmail").value.trim(),
      role: role,
      schoolId: needsSchool ? Number(el("userSchool").value) : null,
      isActive: el("userActive").checked
    };
    if (isSystemAdmin()) {
      payload.districtId = role === "system_admin" ? null : Number(el("userDistrict").value);
    } else {
      payload.districtId = Number(state.session.user.districtId);
    }
    if (!editing) {
      payload.username = el("userUsername").value.trim();
      payload.password = password;
    } else if (password) {
      payload.password = password;
    }

    window.UI.setButtonLoading(saveButton, true, editing ? "Saving…" : "Creating…");
    var request = editing
      ? API.put("/users/" + editing.id, payload)
      : API.post("/users", payload);

    request
      .then(function (response) {
        window.UI.setButtonLoading(saveButton, false);
        state.formModal.hide();
        window.UI.toast(
          editing ? "Account updated" : "Account created",
          response.data.fullName + (editing ? " was updated successfully." : " can now sign in with the assigned role."),
          "success"
        );
        if (editing && isSelf(response.data)) {
          window.AppShell.updateUser(response.data);
        }
        loadUsers();
        loadCounts();
      })
      .catch(function (error) {
        window.UI.setButtonLoading(saveButton, false);
        if (!window.UI.showFieldErrors(form, error)) {
          window.UI.showAlert(
            alertBox,
            "danger",
            error.message || "The account could not be saved.",
            "Unable to save account"
          );
        }
      });
  }

  function toggleStatus(user) {
    var activate = !user.isActive;
    return window.UI.confirm({
      title: (activate ? "Activate " : "Deactivate ") + user.fullName + "?",
      message: activate
        ? "The account will be able to sign in again with its existing role and district access."
        : "The account will be signed out immediately and blocked from signing in until it is reactivated.",
      confirmLabel: activate ? "Activate account" : "Deactivate account",
      tone: activate ? "primary" : "danger"
    }).then(function (confirmed) {
      if (!confirmed) {
        return false;
      }
      return API.patch("/users/" + user.id + "/status", { isActive: activate })
        .then(function (response) {
          window.UI.toast(
            activate ? "Account activated" : "Account deactivated",
            response.data.fullName + (activate ? " can sign in again." : " has been blocked from signing in."),
            "success"
          );
          loadUsers();
          loadCounts();
          return true;
        })
        .catch(function (error) {
          window.UI.toast(
            "Could not update account",
            error.status === 403 ? "You do not have permission to change this account." : error.message,
            "danger"
          );
          return false;
        });
    });
  }

  function findUser(id) {
    return state.users.find(function (user) {
      return Number(user.id) === Number(id);
    });
  }

  function resetFilters() {
    state.search = "";
    state.role = "";
    state.status = "";
    state.page = 1;
    el("userSearch").value = "";
    el("userRoleFilter").value = "";
    el("userStatusFilter").value = "";
    loadUsers();
  }

  function bind() {
    document.querySelectorAll("#userTable [data-sort]").forEach(function (button) {
      button.addEventListener("click", function () {
        var column = button.dataset.sort;
        if (state.sort === column) {
          state.direction = state.direction === "asc" ? "desc" : "asc";
        } else {
          state.sort = column;
          state.direction = ["created", "lastLogin", "status"].indexOf(column) !== -1 ? "desc" : "asc";
        }
        state.page = 1;
        loadUsers();
      });
    });

    el("userSearch").addEventListener(
      "input",
      window.UI.debounce(function (event) {
        state.search = event.target.value.trim();
        state.page = 1;
        loadUsers();
      }, 320)
    );
    el("userRoleFilter").addEventListener("change", function (event) {
      state.role = event.target.value;
      state.page = 1;
      loadUsers();
    });
    el("userStatusFilter").addEventListener("change", function (event) {
      state.status = event.target.value;
      state.page = 1;
      loadUsers();
    });
    el("resetUserFilters").addEventListener("click", resetFilters);

    el("userTableBody").addEventListener("click", function (event) {
      var actionButton = event.target.closest("[data-action]");
      if (actionButton) {
        var user = findUser(actionButton.dataset.id);
        if (!user) {
          return;
        }
        if (actionButton.dataset.action === "edit") {
          openForm(user);
        } else if (actionButton.dataset.action === "toggle") {
          toggleStatus(user);
        }
        return;
      }
      if (event.target.closest("[data-empty-reset]")) {
        resetFilters();
      }
    });

    el("addUserButton").addEventListener("click", function () {
      openForm(null);
    });
    var refresh = el("refreshUsers");
    refresh.addEventListener("click", function () {
      window.UI.setButtonLoading(refresh, true, "Refreshing…");
      Promise.all([loadUsers(), loadCounts()])
        .catch(function () {
          /* Errors are surfaced inside the table and counters. */
        })
        .then(function () {
          window.UI.setButtonLoading(refresh, false);
        });
    });

    el("userRole").addEventListener("change", function () {
      toggleDistrictField("");
    });
    el("userDistrict").addEventListener("change", function () {
      toggleDistrictField("");
    });
    el("userPasswordToggle").addEventListener("click", function () {
      var input = el("userPassword");
      var showing = input.type === "text";
      input.type = showing ? "password" : "text";
      el("userPasswordToggle").setAttribute("aria-pressed", String(!showing));
      el("userPasswordToggle").setAttribute("aria-label", showing ? "Show password" : "Hide password");
      el("userPasswordToggle").innerHTML =
        '<i class="bi ' + (showing ? "bi-eye" : "bi-eye-slash") + '" aria-hidden="true"></i>';
      input.focus();
    });
    el("userForm").addEventListener("submit", submitForm);
    el("userFormModal").addEventListener("hidden.bs.modal", function () {
      window.UI.setButtonLoading(el("userSaveButton"), false);
    });
  }

  function init() {
    state.formModal = new window.bootstrap.Modal(el("userFormModal"));
    window.AppShell.init({
      page: "users",
      breadcrumbs: ["User Management"],
      requiredPermission: "canManageUsers"
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      if (!isSystemAdmin()) {
        ["system_admin", "district_admin"].forEach(function (role) {
          var option = el("userRoleFilter").querySelector('[value="' + role + '"]');
          if (option) {
            option.remove();
          }
        });
      }
      bind();
      loadSchools();
      loadUsers();
      loadCounts();
      var footer = el("footerUpdated");
      if (footer) {
        footer.textContent = "Data refreshed " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
