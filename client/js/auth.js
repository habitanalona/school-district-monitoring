/* School District Monitoring System — landing page authentication */
(function (window, document) {
  "use strict";

  var loginForm = document.getElementById("loginForm");
  var loginAlert = document.getElementById("loginAlert");
  var loginButton = document.getElementById("loginButton");
  var passwordToggle = document.getElementById("passwordToggle");
  var passwordInput = document.getElementById("password");
  var forgotLink = document.getElementById("forgotLink");
  var forgotForm = document.getElementById("forgotForm");
  var forgotButton = document.getElementById("forgotButton");
  var forgotAlert = document.getElementById("forgotAlert");
  var forgotModalElement = document.getElementById("forgotModal");
  var forgotModal = forgotModalElement && window.bootstrap ? new window.bootstrap.Modal(forgotModalElement) : null;

  function safeNextPath() {
    var next = new URLSearchParams(window.location.search).get("next") || "";
    if (!next || next.charAt(0) !== "/" || next.charAt(1) === "/" || next.indexOf("\\") !== -1) {
      return "/dashboard.html";
    }
    return next;
  }

  function setAlert(type, message, title) {
    window.UI.showAlert(loginAlert, type, message, title);
  }

  function clearAlert() {
    window.UI.hideAlert(loginAlert);
  }

  if (passwordToggle) {
    passwordToggle.addEventListener("click", function () {
      var showing = passwordInput.type === "text";
      passwordInput.type = showing ? "password" : "text";
      passwordToggle.setAttribute("aria-pressed", String(!showing));
      passwordToggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
      passwordToggle.innerHTML =
        '<i class="bi ' + (showing ? "bi-eye" : "bi-eye-slash") + '" aria-hidden="true"></i>';
      passwordInput.focus();
    });
  }

  if (loginForm) {
    loginForm.addEventListener("submit", function (event) {
      event.preventDefault();
      clearAlert();

      var valid = window.UI.validateForm(loginForm, [
        {
          name: "identifier",
          label: "Email or username",
          required: true,
          requiredMessage: "Enter your email address or username."
        },
        {
          name: "password",
          label: "Password",
          required: true,
          requiredMessage: "Enter your password."
        }
      ]);
      if (!valid) {
        return;
      }

      var identifier = document.getElementById("identifier").value.trim();
      var password = passwordInput.value;
      var remember = document.getElementById("remember").checked;

      window.UI.setButtonLoading(loginButton, true, "Signing in…");

      API.post("/auth/login", {
        identifier: identifier,
        password: password,
        remember: remember
      })
        .then(function (payload) {
          API.setCsrfToken(payload.data.csrfToken);
          window.location.href = safeNextPath();
        })
        .catch(function (error) {
          window.UI.setButtonLoading(loginButton, false);
          passwordInput.value = "";
          passwordInput.focus();

          if (error.status === 429) {
            setAlert("warning", "Too many sign-in attempts. Please wait a few minutes before trying again.", "Access temporarily paused");
            return;
          }
          if (error.status === 401) {
            setAlert("danger", "The email/username or password you entered is incorrect. Please try again.", "Sign-in failed");
            return;
          }
          if (error.status === 0) {
            setAlert("danger", error.message, "Connection problem");
            return;
          }
          setAlert("danger", error.message || "Sign-in could not be completed. Please try again.", "Unable to sign in");
        });
    });
  }

  if (forgotLink && forgotModal) {
    forgotLink.addEventListener("click", function () {
      var identifier = document.getElementById("identifier");
      var forgotIdentifier = document.getElementById("forgotIdentifier");
      if (identifier && identifier.value.trim() && forgotIdentifier) {
        forgotIdentifier.value = identifier.value.trim();
      }
      window.UI.hideAlert(forgotAlert);
      window.UI.clearFieldErrors(forgotForm);
      forgotModal.show();
    });
  }

  if (forgotModalElement) {
    forgotModalElement.addEventListener("shown.bs.modal", function () {
      var field = document.getElementById("forgotIdentifier");
      if (field) {
        field.focus();
      }
    });
  }

  if (forgotForm) {
    forgotForm.addEventListener("submit", function (event) {
      event.preventDefault();
      window.UI.hideAlert(forgotAlert);

      var valid = window.UI.validateForm(forgotForm, [
        {
          name: "identifier",
          label: "Email or username",
          required: true,
          requiredMessage: "Enter your email address or username."
        }
      ]);
      if (!valid) {
        return;
      }

      var identifier = document.getElementById("forgotIdentifier").value.trim();
      window.UI.setButtonLoading(forgotButton, true, "Creating…");

      API.post("/auth/forgot-password", { identifier: identifier })
        .then(function (payload) {
          window.UI.setButtonLoading(forgotButton, false);
          window.UI.showAlert(
            forgotAlert,
            "success",
            payload.data.message,
            "Request received"
          );
          if (payload.data.devResetUrl) {
            try {
              var resetUrl = new URL(payload.data.devResetUrl, window.location.origin);
              if (resetUrl.origin === window.location.origin) {
                var note = document.createElement("div");
                note.className = "reset-link-note";
                note.innerHTML =
                  '<span class="reset-link-note__label">Development build · secure reset link</span>';
                var link = document.createElement("a");
                link.href = resetUrl.pathname + resetUrl.search;
                link.textContent = "Open password reset page";
                note.appendChild(link);
                forgotAlert.querySelector(".app-alert")?.appendChild(note);
              }
            } catch (error) {
              /* The reset link is a development convenience only. */
            }
          }
        })
        .catch(function (error) {
          window.UI.setButtonLoading(forgotButton, false);
          window.UI.showAlert(
            forgotAlert,
            "danger",
            error.status === 429
              ? "Too many reset requests. Please wait before trying again."
              : error.message,
            "Unable to create a reset link"
          );
        });
    });
  }

  if (forgotModalElement) {
    forgotModalElement.addEventListener("hidden.bs.modal", function () {
      window.UI.hideAlert(forgotAlert);
      var field = document.getElementById("forgotIdentifierError");
      if (field) {
        field.textContent = "";
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var identifier = document.getElementById("identifier");
    if (identifier && window.innerWidth > 900) {
      identifier.focus();
    }
    var params = new URLSearchParams(window.location.search);
    if (params.get("reset") === "success") {
      window.UI.toast("Password updated", "Sign in with your new password to continue.", "success");
    }
    if (params.get("reason") === "expired") {
      window.UI.toast("Session ended", "Your session expired. Please sign in again.", "info");
    }
    window.UI.consumeFlash();
  });
})(window, document);
