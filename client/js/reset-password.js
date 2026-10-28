/* School District Monitoring System — password reset page */
(function (window, document) {
  "use strict";

  var token = new URLSearchParams(window.location.search).get("token") || "";
  var form = document.getElementById("resetForm");
  var formView = document.getElementById("resetFormView");
  var invalidView = document.getElementById("resetInvalidView");
  var successView = document.getElementById("resetSuccessView");
  var resetButton = document.getElementById("resetButton");
  var alertBox = document.getElementById("resetAlert");
  var passwordInput = document.getElementById("resetPassword");
  var confirmInput = document.getElementById("resetConfirm");

  function showInvalid(message) {
    formView.classList.add("d-none");
    successView.classList.add("d-none");
    invalidView.classList.remove("d-none");
    if (message) {
      window.UI.showAlert(alertBox, "warning", message, "Reset link unavailable");
    }
    var heading = invalidView.querySelector("h1");
    if (heading) {
      heading.focus();
    }
  }

  function bindToggle(button, input) {
    if (!button || !input) {
      return;
    }
    button.addEventListener("click", function () {
      var showing = input.type === "text";
      input.type = showing ? "password" : "text";
      button.setAttribute("aria-pressed", String(!showing));
      button.setAttribute("aria-label", showing ? "Show password" : "Hide password");
      button.innerHTML = '<i class="bi ' + (showing ? "bi-eye" : "bi-eye-slash") + '" aria-hidden="true"></i>';
      input.focus();
    });
  }

  bindToggle(document.getElementById("passwordToggle"), passwordInput);
  bindToggle(document.getElementById("confirmToggle"), confirmInput);

  if (!/^[a-f0-9]{64}$/.test(token)) {
    showInvalid();
    return;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    window.UI.hideAlert(alertBox);

    var valid = window.UI.validateForm(form, [
      {
        name: "password",
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
        match: "password",
        matchMessage: "The confirmed password does not match."
      }
    ]);
    if (!valid) {
      return;
    }

    window.UI.setButtonLoading(resetButton, true, "Updating…");
    API.post("/auth/reset-password", {
      token: token,
      password: passwordInput.value
    })
      .then(function () {
        window.UI.setButtonLoading(resetButton, false);
        formView.classList.add("d-none");
        invalidView.classList.add("d-none");
        successView.classList.remove("d-none");
        var heading = successView.querySelector("h1");
        if (heading) {
          heading.setAttribute("tabindex", "-1");
          heading.focus();
        }
        window.UI.toast("Password updated", "Sign in with your new password.", "success");
      })
      .catch(function (error) {
        window.UI.setButtonLoading(resetButton, false);
        if (error.code === "RESET_INVALID") {
          showInvalid("This reset link is invalid, already used, or expired. Request a new link from the sign-in page.");
          return;
        }
        if (error.status === 429) {
          window.UI.showAlert(alertBox, "warning", "Too many attempts. Please wait a few minutes before trying again.", "Access temporarily paused");
          return;
        }
        if (!window.UI.showFieldErrors(form, error)) {
          window.UI.showAlert(
            alertBox,
            "danger",
            error.message || "Your password could not be updated. Request a new reset link and try again.",
            "Unable to reset password"
          );
        }
      });
  });

  passwordInput.focus();
})(window, document);
