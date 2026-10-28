/* School District Monitoring System — profile page */
(function (window, document) {
  "use strict";

  var state = {
    session: null
  };

  var PERMISSIONS = [
    { key: "canManageSchools", label: "Manage school records", description: "Register, edit, archive, and restore schools." },
    { key: "canManageReports", label: "Record school reports", description: "Create and update reporting submissions." },
    { key: "canManageAnnouncements", label: "Publish announcements", description: "Create and edit district notices." },
    { key: "canManageUsers", label: "Manage user accounts", description: "Provision accounts and control access." },
    { key: "canApproveAccounts", label: "Confirm new accounts", description: "Review and confirm self-registered accounts." },
    { key: "canViewAuditLogs", label: "View audit trail", description: "Review sensitive system activity." },
    { key: "canSelectDistrict", label: "Access all districts", description: "Switch monitoring scope across districts." }
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

  function fillProfile() {
    var session = state.session;
    var user = session.user;
    var roleMeta = window.UI.ROLE[user.role] || { label: window.UI.titleCase(user.role), tone: "neutral" };
    setText("profileAvatar", window.UI.initials(user.fullName));
    setText("profileSummaryName", user.fullName);
    setText("profileSummaryEmail", user.email);
    setText("profileUsername", "@" + user.username);
    setText("profileDistrict", user.districtName || "All districts");
    var schoolRow = el("profileSchoolRow");
    if (schoolRow) {
      schoolRow.classList.toggle("d-none", !user.schoolName);
      setText("profileSchool", user.schoolName || "—");
    }
    setText("profileLastLogin", user.lastLoginAt ? window.UI.dateTime(user.lastLoginAt) : "First session");
    setText("profileCreated", window.UI.date(user.createdAt));
    setText("profilePasswordChanged", user.passwordChangedAt ? window.UI.dateTime(user.passwordChangedAt) : "Not recorded");
    el("profileSummaryBadges").innerHTML =
      window.UI.pillarBadge(roleMeta.label, roleMeta.tone) +
      window.UI.pillarBadge(user.isActive ? "Active account" : "Inactive account", user.isActive ? "success" : "neutral") +
      window.UI.pillarBadge(user.districtName ? "District scoped" : "System-wide", "info");

    el("profileFullName").value = user.fullName;
    el("profileEmail").value = user.email;
    el("profileUsernameField").value = user.username;
    el("profileRoleField").value = roleMeta.label;

    var permissions = session.permissions || {};
    el("permissionGrid").innerHTML = PERMISSIONS.map(function (permission) {
      var allowed = Boolean(permissions[permission.key]);
      return (
        '<li class="permission-item ' + (allowed ? "is-allowed" : "is-denied") + '">' +
        '<span class="permission-item__icon"><i class="bi ' +
        (allowed ? "bi-check2-circle" : "bi-dash-circle") + '" aria-hidden="true"></i></span>' +
        "<div><strong>" + permission.label + "</strong><span>" + permission.description + "</span></div>" +
        '<em>' + (allowed ? "Allowed" : "Not granted") + "</em>" +
        "</li>"
      );
    }).join("");
  }

  function submitProfile(event) {
    event.preventDefault();
    var form = el("profileForm");
    var alertBox = el("profileFormAlert");
    var saveButton = el("profileSaveButton");
    window.UI.hideAlert(alertBox);

    var valid = window.UI.validateForm(form, [
      { name: "fullName", label: "Full name", required: true, minLength: 2, maxLength: 160 },
      {
        name: "email",
        label: "Email address",
        required: true,
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        patternMessage: "Enter a valid email address."
      }
    ]);
    if (!valid) {
      return;
    }

    window.UI.setButtonLoading(saveButton, true, "Saving…");
    API.put("/profile", {
      fullName: el("profileFullName").value.trim(),
      email: el("profileEmail").value.trim()
    })
      .then(function (response) {
        window.UI.setButtonLoading(saveButton, false);
        state.session.user = Object.assign({}, state.session.user, response.data);
        window.AppShell.updateUser(response.data);
        fillProfile();
        window.UI.toast("Profile updated", "Your account details were saved successfully.", "success");
      })
      .catch(function (error) {
        window.UI.setButtonLoading(saveButton, false);
        if (!window.UI.showFieldErrors(form, error)) {
          window.UI.showAlert(
            alertBox,
            "danger",
            error.code === "EMAIL_IN_USE"
              ? "That email address is already linked to another account."
              : error.message || "Your profile could not be saved.",
            "Unable to save profile"
          );
        }
      });
  }

  function init() {
    window.AppShell.init({
      page: "profile",
      breadcrumbs: ["My Profile"]
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      fillProfile();
      el("profileForm").addEventListener("submit", submitProfile);
      var footer = el("footerUpdated");
      if (footer) {
        footer.textContent = "Signed in as " + session.user.fullName;
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
