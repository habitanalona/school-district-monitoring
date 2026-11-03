"use strict";

(function (window, document) {
  var stamp = document.getElementById("maintenanceStamp");
  var reload = document.getElementById("maintenanceReload");

  function setMessage(text) {
    if (stamp) {
      stamp.innerHTML = '<i class="bi bi-info-circle" aria-hidden="true"></i> ' + text;
    }
  }

  function check() {
    if (reload) {
      reload.disabled = true;
    }
    window
      .fetch("/api/security/session", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (payload) {
        var maintenance = payload && payload.data ? payload.data.maintenanceMode : payload ? payload.maintenanceMode : false;
        if (maintenance === false) {
          window.location.replace("/");
          return;
        }
        setMessage("Maintenance is still in progress as of " + new Date().toLocaleTimeString() + ". This page checks again automatically.");
        if (reload) {
          reload.disabled = false;
        }
      })
      .catch(function () {
        window.location.reload();
      });
  }

  if (reload) {
    reload.addEventListener("click", check);
  }
})(window, document);
