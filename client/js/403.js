/* School District Monitoring System — access restricted page */
(function (window, document) {
  "use strict";

  var backButton = document.getElementById("accessBackButton");
  var signOut = document.getElementById("accessSignOut");
  var status = document.getElementById("accessStatus");

  if (backButton) {
    backButton.addEventListener("click", function () {
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.replace("/index.html");
      }
    });
  }

  if (!signOut) {
    return;
  }

  signOut.addEventListener("click", function () {
    signOut.disabled = true;
    signOut.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Signing out…';
    window.API.post("/auth/logout", {})
      .then(function () {
        window.location.replace("/index.html");
      })
      .catch(function (error) {
        signOut.disabled = false;
        signOut.innerHTML = '<i class="bi bi-box-arrow-right" aria-hidden="true"></i> Sign out';
        if (status) {
          status.textContent = error && error.message
            ? error.message
            : "Sign-out could not be completed. Refresh the page and try again.";
          status.classList.add("text-danger");
        }
      });
  });
})(window, document);
