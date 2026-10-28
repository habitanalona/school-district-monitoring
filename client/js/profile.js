/* School District Monitoring System — profile page */
(function (window, document) {
  "use strict";

  var state = {
    session: null,
    photoFile: null,
    photoPreviewUrl: null
  };

  var PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
  var PHOTO_MAX_BYTES = 2 * 1024 * 1024;

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
    renderPhoto();
  }

  function renderPhoto() {
    var user = state.session.user;
    var url = state.photoPreviewUrl || window.UI.avatarUrl(user);
    ["profileAvatar", "photoPreview"].forEach(function (id) {
      var node = el(id);
      if (!node) {
        return;
      }
      if (url) {
        node.innerHTML =
          '<img src="' +
          window.UI.escapeHtml(url) +
          '" alt="Profile photo of ' +
          window.UI.escapeHtml(user.fullName) +
          '">';
      } else {
        node.textContent = window.UI.initials(user.fullName);
      }
    });
    var removeButton = el("photoRemoveButton");
    if (removeButton) {
      removeButton.classList.toggle("d-none", !window.UI.avatarUrl(user));
    }
  }

  function clearPhotoSelection() {
    if (state.photoPreviewUrl) {
      window.URL.revokeObjectURL(state.photoPreviewUrl);
    }
    state.photoFile = null;
    state.photoPreviewUrl = null;
    var input = el("photoInput");
    if (input) {
      input.value = "";
    }
    var button = el("photoUploadButton");
    if (button) {
      button.disabled = true;
    }
  }

  function showPhotoError(message, title) {
    window.UI.showAlert(el("photoAlert"), "danger", message, title || "Photo not saved");
  }

  function choosePhoto() {
    var input = el("photoInput");
    var file = input.files && input.files[0];
    window.UI.hideAlert(el("photoAlert"));
    clearPhotoSelection();
    if (!file) {
      renderPhoto();
      return;
    }
    if (PHOTO_TYPES.indexOf(file.type) === -1) {
      showPhotoError("Choose a JPEG, PNG, or WebP image.", "Unsupported file type");
      renderPhoto();
      return;
    }
    if (file.size > PHOTO_MAX_BYTES) {
      showPhotoError("That image is larger than 2 MB. Choose a smaller file.", "Image too large");
      renderPhoto();
      return;
    }

    state.photoFile = file;
    state.photoPreviewUrl = window.URL.createObjectURL(file);
    renderPhoto();
    el("photoUploadButton").disabled = false;
  }

  function submitPhoto(event) {
    event.preventDefault();
    if (!state.photoFile) {
      return;
    }

    var button = el("photoUploadButton");
    var formData = new window.FormData();
    formData.append("photo", state.photoFile);

    window.UI.setButtonLoading(button, true, "Uploading…");
    API.upload("/profile/photo", formData)
      .then(function (response) {
        window.UI.setButtonLoading(button, false);
        state.session.user = Object.assign({}, state.session.user, response.data);
        window.AppShell.updateUser(response.data);
        clearPhotoSelection();
        renderPhoto();
        window.UI.toast("Photo updated", "Your profile photo is now visible across the district system.", "success");
      })
      .catch(function (error) {
        window.UI.setButtonLoading(button, false);
        showPhotoError(error.message || "Your photo could not be uploaded. Try again.");
      });
  }

  function removePhoto() {
    window.UI
      .confirm({
        title: "Remove profile photo",
        message: "Your photo will disappear from your profile and from the account menus. You can upload a new one at any time.",
        confirmLabel: "Remove photo",
        tone: "danger"
      })
      .then(function (confirmed) {
        if (!confirmed) {
          return;
        }
        var button = el("photoRemoveButton");
        window.UI.setButtonLoading(button, true, "Removing…");
        return API.delete("/profile/photo")
          .then(function (response) {
            window.UI.setButtonLoading(button, false);
            state.session.user = Object.assign({}, state.session.user, response.data);
            window.AppShell.updateUser(response.data);
            clearPhotoSelection();
            renderPhoto();
            window.UI.toast("Photo removed", "Your profile no longer shows a photo.", "success");
          })
          .catch(function (error) {
            window.UI.setButtonLoading(button, false);
            showPhotoError(error.message || "Your photo could not be removed. Try again.");
          });
      });
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
      el("photoForm").addEventListener("submit", submitPhoto);
      el("photoInput").addEventListener("change", choosePhoto);
      el("photoRemoveButton").addEventListener("click", removePhoto);
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
