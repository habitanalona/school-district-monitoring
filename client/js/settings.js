/* School District Monitoring System — account settings page */
(function (window, document) {
  "use strict";

  var state = {
    session: null
  };

  function el(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    var node = el(id);
    if (node) {
      node.textContent = value;
    }
  }

  function fillAccount() {
    var user = state.session.user;
    var roleMeta = window.UI.ROLE[user.role] || { label: window.UI.titleCase(user.role) };
    setText("settingsAvatar", window.UI.initials(user.fullName));
    setText("settingsUserName", user.fullName);
    setText("settingsUserEmail", user.email);
    setText("settingsUserRole", roleMeta.label);
    setText("settingsUsername", "@" + user.username);
    setText("settingsRole", roleMeta.label);
    setText("settingsDistrict", user.districtName || "All districts");
    setText("settingsLastLogin", user.lastLoginAt ? window.UI.dateTime(user.lastLoginAt) : "First session");
    setText("settingsPasswordChanged", user.passwordChangedAt ? window.UI.dateTime(user.passwordChangedAt) : "Not recorded");
  }

  function scorePassword(value) {
    if (!value) {
      return { score: 0, label: "Enter a new password", tone: "" };
    }
    var score = 0;
    if (value.length >= 10) {
      score += 1;
    }
    if (value.length >= 14) {
      score += 1;
    }
    if (/[a-z]/.test(value) && /[A-Z]/.test(value)) {
      score += 1;
    }
    if (/\d/.test(value)) {
      score += 1;
    }
    if (/[^A-Za-z0-9]/.test(value)) {
      score += 1;
    }
    score = Math.min(4, score);
    if (score <= 1) {
      return { score: score, label: "Weak — add length and variety", tone: "weak" };
    }
    if (score === 2) {
      return { score: score, label: "Fair — add more variety", tone: "fair" };
    }
    if (score === 3) {
      return { score: score, label: "Good", tone: "good" };
    }
    return { score: score, label: "Strong", tone: "strong" };
  }

  function renderStrength(value) {
    var wrap = el("passwordStrength");
    if (!wrap) {
      return;
    }
    if (!value) {
      wrap.innerHTML = "";
      wrap.classList.remove("is-visible");
      return;
    }
    var result = scorePassword(value);
    var bars = "";
    for (var index = 1; index <= 4; index += 1) {
      bars += '<span class="password-strength__bar' + (index <= result.score ? " is-on" : "") + '"></span>';
    }
    wrap.classList.add("is-visible");
    wrap.innerHTML =
      '<div class="password-strength__meter password-strength--' + result.tone + '">' + bars + "</div>" +
      '<p class="password-strength__label">' + window.UI.escapeHtml(result.label) + "</p>";
  }

  function bindToggles() {
    document.querySelectorAll("[data-toggle-password]").forEach(function (button) {
      button.addEventListener("click", function () {
        var input = el(button.dataset.togglePassword);
        if (!input) {
          return;
        }
        var showing = input.type === "text";
        input.type = showing ? "password" : "text";
        button.setAttribute("aria-pressed", String(!showing));
        button.setAttribute("aria-label", showing ? "Show password" : "Hide password");
        button.innerHTML = '<i class="bi ' + (showing ? "bi-eye" : "bi-eye-slash") + '" aria-hidden="true"></i>';
        input.focus();
      });
    });
  }

  function submitPassword(event) {
    event.preventDefault();
    var form = el("passwordForm");
    var alertBox = el("passwordAlert");
    var saveButton = el("passwordSaveButton");
    window.UI.hideAlert(alertBox);

    var valid = window.UI.validateForm(form, [
      { name: "currentPassword", label: "Current password", required: true },
      {
        name: "newPassword",
        label: "New password",
        required: true,
        minLength: 10,
        maxLength: 128,
        pattern: /^(?=.*[A-Za-z])(?=.*\d).+$/,
        patternMessage: "Include at least one letter and one number."
      },
      {
        name: "confirmPassword",
        label: "Confirm new password",
        required: true,
        match: "newPassword",
        matchMessage: "The confirmed password does not match."
      }
    ]);
    if (!valid) {
      return;
    }
    if (el("newPassword").value === el("currentPassword").value) {
      window.UI.fieldError(el("newPassword"), "Choose a password different from your current one.");
      return;
    }

    window.UI.setButtonLoading(saveButton, true, "Updating…");
    API.put("/profile/password", {
      currentPassword: el("currentPassword").value,
      newPassword: el("newPassword").value
    })
      .then(function () {
        window.UI.setButtonLoading(saveButton, false);
        form.reset();
        renderStrength("");
        window.UI.showAlert(alertBox, "success", "Your password was updated. Other active sessions have been signed out.", "Password changed");
        setText("settingsPasswordChanged", window.UI.dateTime(new Date().toISOString()));
        if (state.session && state.session.user) {
          state.session.user.passwordChangedAt = new Date().toISOString();
        }
        window.UI.toast("Password updated", "Your new password is active immediately.", "success");
      })
      .catch(function (error) {
        window.UI.setButtonLoading(saveButton, false);
        if (!window.UI.showFieldErrors(form, error)) {
          window.UI.showAlert(
            alertBox,
            "danger",
            error.code === "INVALID_PASSWORD"
              ? "Your current password is incorrect. Try again or sign out if you no longer remember it."
              : error.message || "The password could not be updated.",
            "Unable to change password"
          );
        }
      });
  }

  function init() {
    window.AppShell.init({
      page: "settings",
      breadcrumbs: ["Settings"]
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      fillAccount();
      bindToggles();
      el("passwordForm").addEventListener("submit", submitPassword);
      el("newPassword").addEventListener("input", function (event) {
        renderStrength(event.target.value);
      });
      el("settingsLogout").addEventListener("click", function () {
        window.UI.confirm({
          title: "Sign out of SDMS?",
          message: "You will need to sign in again to access the district dashboard.",
          confirmLabel: "Sign out",
          tone: "danger"
        }).then(function (confirmed) {
          if (!confirmed) {
            return;
          }
          API.post("/auth/logout")
            .catch(function () {
              /* The local session is cleared either way. */
            })
            .then(function () {
              window.location.replace("/index.html");
            });
        });
      });
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
