/* School District Monitoring System — school logo upload dialog */
(function (window, document) {
  "use strict";

  var MAX_BYTES = 2 * 1024 * 1024;
  var MAX_DIMENSION = 2000;
  var ALLOWED_EXTENSION = /\.(png|jpe?g|webp)$/i;
  var ALLOWED_MIME = { "image/png": true, "image/jpeg": true, "image/webp": true };
  var modalCounter = 0;

  function esc(value) {
    return window.UI.escapeHtml(value);
  }

  function formatBytes(bytes) {
    if (bytes >= 1024 * 1024) {
      return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    }
    return Math.max(1, Math.round(bytes / 1024)) + " KB";
  }

  function validateFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) {
        reject("Select an image to upload.");
        return;
      }

      var name = String(file.name || "");
      if (!ALLOWED_EXTENSION.test(name)) {
        reject("Choose a PNG, JPG, JPEG, or WEBP image.");
        return;
      }
      var mime = String(file.type || "").toLowerCase();
      if (mime && !ALLOWED_MIME[mime]) {
        reject("Choose a PNG, JPG, JPEG, or WEBP image.");
        return;
      }
      if (!file.size) {
        reject("The selected file is empty.");
        return;
      }
      if (file.size > MAX_BYTES) {
        reject("The image is " + formatBytes(file.size) + ". The maximum size is 2 MB.");
        return;
      }

      // A data URL keeps the preview inside the page's existing
      // img-src 'self' data: policy without needing a blob: exception.
      var reader = new window.FileReader();
      reader.onerror = function () {
        reject("The selected file could not be read. Try another image.");
      };
      reader.onload = function () {
        var dataUrl = String(reader.result || "");
        var probe = new window.Image();
        probe.onload = function () {
          if (!probe.naturalWidth || !probe.naturalHeight) {
            reject("That file is not a readable image.");
            return;
          }
          if (probe.naturalWidth > MAX_DIMENSION || probe.naturalHeight > MAX_DIMENSION) {
            reject(
              "The image is " + probe.naturalWidth + "×" + probe.naturalHeight +
                " px. Maximum dimensions are 2000×2000 px."
            );
            return;
          }
          resolve({ url: dataUrl, width: probe.naturalWidth, height: probe.naturalHeight });
        };
        probe.onerror = function () {
          reject("That file is not a readable image. It may be corrupted or renamed.");
        };
        probe.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
  }

  function parsePayload(xhr) {
    try {
      return JSON.parse(xhr.responseText || "{}");
    } catch (error) {
      return {};
    }
  }

  function sendLogo(schoolId, file, onProgress) {
    return API.ensureCsrfToken().then(function (token) {
      return new Promise(function (resolve, reject) {
        var retried = false;

        function send(csrfToken) {
          var xhr = new window.XMLHttpRequest();
          xhr.open("POST", "/api/schools/" + encodeURIComponent(schoolId) + "/logo", true);
          xhr.withCredentials = true;
          xhr.timeout = 120000;
          xhr.setRequestHeader("Accept", "application/json");
          xhr.setRequestHeader("X-CSRF-Token", csrfToken);

          xhr.upload.onprogress = function (event) {
            if (event.lengthComputable) {
              onProgress(Math.round((event.loaded / event.total) * 100));
            }
          };
          xhr.upload.onload = function () {
            onProgress(100, "Saving on the server…");
          };
          xhr.onload = function () {
            var payload = parsePayload(xhr);
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve(payload);
              return;
            }
            if (xhr.status === 403 && payload.code === "CSRF_INVALID" && !retried) {
              retried = true;
              API.ensureCsrfToken(true).then(send).catch(reject);
              return;
            }
            if (xhr.status === 401) {
              API.redirectToLogin();
            }
            reject(
              API.ApiError(
                payload.error || "The logo could not be saved.",
                xhr.status,
                payload.code || "LOGO_UPLOAD_FAILED",
                payload.details
              )
            );
          };
          xhr.onerror = function () {
            reject(API.ApiError("The upload could not reach the server.", 0, "NETWORK_ERROR"));
          };
          xhr.ontimeout = function () {
            reject(API.ApiError("The upload timed out. Try a smaller image.", 0, "UPLOAD_TIMEOUT"));
          };

          var formData = new window.FormData();
          formData.append("logo", file, file.name);
          xhr.send(formData);
        }

        send(token);
      });
    });
  }

  function open(options) {
    var settings = Object.assign({ school: null, onDone: null }, options || {});
    var school = settings.school;
    if (!school) {
      return;
    }

    var id = "schoolLogoModal" + (++modalCounter);
    var hasLogo = Boolean(school.logoUrl);
    var element = document.createElement("div");
    element.className = "modal fade";
    element.id = id;
    element.tabIndex = -1;
    element.setAttribute("role", "dialog");
    element.setAttribute("aria-labelledby", id + "Title");
    element.setAttribute("aria-hidden", "true");
    element.innerHTML =
      '<div class="modal-dialog modal-dialog-centered" role="document">' +
      '<div class="modal-content">' +
      '<div class="modal-header">' +
      "<div><p class=\"modal-eyebrow\">School identity</p>" +
      '<h2 class="modal-title" id="' + id + 'Title">' +
      (hasLogo ? "Change school logo" : "Upload school logo") +
      "</h2>" +
      '<p class="modal-subtitle">' + esc(school.name) + " · " + esc(school.code) + "</p></div>" +
      '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
      "</div>" +
      '<div class="modal-body">' +
      '<div id="logoAlert" class="d-none mb-3" role="alert"></div>' +
      '<div class="logo-current">' +
      '<div class="logo-current__frame">' +
      (hasLogo
        ? '<img src="' + esc(school.logoUrl) + '" alt="' + esc(school.name) + ' logo">'
        : '<span class="logo-placeholder"><i class="bi bi-building" aria-hidden="true"></i><span>No logo</span></span>') +
      "</div>" +
      '<div class="logo-current__meta">' +
      "<strong>" + (hasLogo ? "Current logo" : "Default placeholder") + "</strong>" +
      "<p>" +
      (hasLogo
        ? "This logo appears beside the school name in the register and school profile."
        : "A default building icon is shown beside the school name until a logo is uploaded.") +
      "</p>" +
      '<span class="logo-hint"><i class="bi bi-shield-check" aria-hidden="true"></i> PNG, JPG, JPEG, or WEBP · 2 MB max · 2000×2000 px max · saved as WebP</span>' +
      "</div>" +
      "</div>" +
      '<div class="logo-dropzone" id="logoDropzone" role="button" tabindex="0" aria-label="Choose or drop a school logo image">' +
      '<span class="logo-dropzone__icon"><i class="bi bi-cloud-arrow-up" aria-hidden="true"></i></span>' +
      '<p class="logo-dropzone__title">Drag and drop the logo here</p>' +
      '<p class="logo-dropzone__hint">or choose a file from your device</p>' +
      '<span class="btn btn-light btn-sm">Browse files</span>' +
      '<input type="file" id="logoInput" class="sr-only" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp">' +
      "</div>" +
      '<div class="logo-selection d-none" id="logoSelection">' +
      '<div class="logo-selection__preview"><img id="logoPreview" alt="Selected logo preview"></div>' +
      '<div class="logo-selection__meta">' +
      '<strong id="logoFileName"></strong>' +
      '<span id="logoFileMeta"></span>' +
      '<button type="button" class="btn btn-ghost btn-sm" id="logoChangeButton"><i class="bi bi-arrow-repeat" aria-hidden="true"></i> Change logo</button>' +
      "</div>" +
      "</div>" +
      '<div class="logo-progress d-none" id="logoProgress" aria-live="polite">' +
      '<div class="logo-progress__head"><span id="logoProgressLabel">Uploading…</span><span id="logoProgressValue">0%</span></div>' +
      '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="logoProgressBar">' +
      '<div class="progress-bar" id="logoProgressFill" style="width:0%"></div>' +
      "</div></div>" +
      "</div>" +
      '<div class="modal-footer">' +
      '<button type="button" class="btn btn-light" data-dismiss="modal" id="logoCancelButton">Cancel</button>' +
      (hasLogo
        ? '<button type="button" class="btn btn-outline-danger" id="logoRemoveButton"><i class="bi bi-trash3" aria-hidden="true"></i> Remove logo</button>'
        : "") +
      '<button type="button" class="btn btn-primary" id="logoSaveButton" disabled><i class="bi bi-check2" aria-hidden="true"></i> <span>Save logo</span></button>' +
      "</div></div></div>";
    document.body.appendChild(element);

    var instance = new window.bootstrap.Modal(element, { backdrop: "static", keyboard: true });
    var alertBox = element.querySelector("#logoAlert");
    var dropzone = element.querySelector("#logoDropzone");
    var input = element.querySelector("#logoInput");
    var selection = element.querySelector("#logoSelection");
    var preview = element.querySelector("#logoPreview");
    var fileNameNode = element.querySelector("#logoFileName");
    var fileMetaNode = element.querySelector("#logoFileMeta");
    var changeButton = element.querySelector("#logoChangeButton");
    var removeButton = element.querySelector("#logoRemoveButton");
    var saveButton = element.querySelector("#logoSaveButton");
    var cancelButton = element.querySelector("#logoCancelButton");
    var progress = element.querySelector("#logoProgress");
    var progressLabel = element.querySelector("#logoProgressLabel");
    var progressValue = element.querySelector("#logoProgressValue");
    var progressBar = element.querySelector("#logoProgressBar");
    var progressFill = element.querySelector("#logoProgressFill");

    var pendingFile = null;
    var previewUrl = null;
    var busy = false;

    function clearPreview() {
      previewUrl = null;
    }

    function setProgress(value, label) {
      var percent = Math.max(0, Math.min(100, Math.round(value)));
      progress.classList.remove("d-none");
      progressLabel.textContent = label || "Uploading…";
      progressValue.textContent = percent + "%";
      progressBar.setAttribute("aria-valuenow", String(percent));
      progressFill.style.width = percent + "%";
    }

    function setBusy(next) {
      busy = Boolean(next);
      saveButton.disabled = busy || !pendingFile;
      if (removeButton) {
        removeButton.disabled = busy;
      }
      changeButton.disabled = busy;
      cancelButton.disabled = busy;
      dropzone.setAttribute("aria-disabled", busy ? "true" : "false");
      dropzone.classList.toggle("is-disabled", busy);
    }

    function resetSelection() {
      pendingFile = null;
      clearPreview();
      selection.classList.add("d-none");
      saveButton.disabled = true;
      input.value = "";
      progress.classList.add("d-none");
    }

    function showValidationError(message) {
      window.UI.showAlert(alertBox, "danger", message, "Logo not accepted");
    }

    function acceptFile(file) {
      if (busy) {
        return;
      }
      window.UI.hideAlert(alertBox);
      saveButton.disabled = true;
      window.UI.showAlert(alertBox, "info", "Checking the image…", "Validating");
      validateFile(file)
        .then(function (result) {
          window.UI.hideAlert(alertBox);
          clearPreview();
          pendingFile = file;
          previewUrl = result.url;
          preview.src = result.url;
          fileNameNode.textContent = file.name;
          fileMetaNode.textContent =
            formatBytes(file.size) + " · " + result.width + "×" + result.height + " px";
          selection.classList.remove("d-none");
          saveButton.disabled = false;
          dropzone.classList.add("has-file");
        })
        .catch(function (message) {
          resetSelection();
          preview.removeAttribute("src");
          dropzone.classList.remove("has-file");
          showValidationError(message);
        });
    }

    function openPicker() {
      if (!busy) {
        input.click();
      }
    }

    dropzone.addEventListener("click", openPicker);
    dropzone.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPicker();
      }
    });
    input.addEventListener("change", function () {
      if (input.files && input.files[0]) {
        acceptFile(input.files[0]);
      }
    });
    changeButton.addEventListener("click", openPicker);

    ["dragenter", "dragover"].forEach(function (name) {
      dropzone.addEventListener(name, function (event) {
        event.preventDefault();
        if (!busy) {
          dropzone.classList.add("is-dragover");
        }
      });
    });
    ["dragleave", "dragend", "drop"].forEach(function (name) {
      dropzone.addEventListener(name, function (event) {
        event.preventDefault();
        dropzone.classList.remove("is-dragover");
      });
    });
    dropzone.addEventListener("drop", function (event) {
      var file = event.dataTransfer && event.dataTransfer.files ? event.dataTransfer.files[0] : null;
      if (file) {
        acceptFile(file);
      }
    });

    saveButton.addEventListener("click", function () {
      if (!pendingFile || busy) {
        return;
      }
      window.UI.hideAlert(alertBox);
      setBusy(true);
      setProgress(0, "Uploading…");
      sendLogo(school.id, pendingFile, setProgress)
        .then(function (payload) {
          var updated = payload && payload.data ? payload.data : school;
          setBusy(false);
          clearPreview();
          instance.hide();
          window.UI.toast(
            hasLogo ? "Logo updated" : "Logo uploaded",
            updated.name + " now displays its new logo in the school register.",
            "success"
          );
          if (typeof settings.onDone === "function") {
            settings.onDone(updated);
          }
        })
        .catch(function (error) {
          setBusy(false);
          progress.classList.add("d-none");
          window.UI.showAlert(
            alertBox,
            "danger",
            error.status === 403
              ? "You do not have permission to change this school's logo."
              : error.message || "The logo could not be saved.",
            "Could not save logo"
          );
        });
    });

    if (removeButton) {
      removeButton.addEventListener("click", function () {
        if (busy) {
          return;
        }
        window.UI.confirm({
          title: "Remove " + school.name + "'s logo?",
          message: "The default building icon will replace the logo. This does not affect any other school record.",
          confirmLabel: "Remove logo",
          tone: "danger"
        }).then(function (confirmed) {
          if (!confirmed) {
            return;
          }
          setBusy(true);
          progress.classList.add("d-none");
          API.delete("/schools/" + encodeURIComponent(school.id) + "/logo")
            .then(function (payload) {
              var updated = payload && payload.data ? payload.data : school;
              setBusy(false);
              clearPreview();
              instance.hide();
              window.UI.toast("Logo removed", school.name + " now uses the default school icon.", "success");
              if (typeof settings.onDone === "function") {
                settings.onDone(updated);
              }
            })
            .catch(function (error) {
              setBusy(false);
              window.UI.showAlert(
                alertBox,
                "danger",
                error.status === 403
                  ? "You do not have permission to change this school's logo."
                  : error.message || "The logo could not be removed.",
                "Could not remove logo"
              );
            });
        });
      });
    }

    // Bootstrap 4 triggers these events through jQuery, so bind with jQuery
    // when it is present; a native listener alone never fires.
    var hideGuard = function (event) {
      if (busy) {
        event.preventDefault();
      }
    };
    var disposed = false;
    function dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      clearPreview();
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    }

    if (window.jQuery) {
      window.jQuery(element).on("hide.bs.modal", hideGuard);
      window.jQuery(element).on("hidden.bs.modal", dispose);
    } else {
      element.addEventListener("hide.bs.modal", hideGuard);
      element.addEventListener("hidden.bs.modal", dispose);
    }

    // The bundled Bootstrap build does not always emit hidden.bs.modal, so a
    // closed dialog can linger in the DOM. Watch for it becoming hidden and
    // remove it after the fade transition.
    if (typeof window.MutationObserver === "function") {
      var wasVisible = false;
      var observer = new window.MutationObserver(function () {
        var visible =
          element.classList.contains("show") ||
          window.getComputedStyle(element).display !== "none";
        if (visible) {
          wasVisible = true;
          return;
        }
        if (!wasVisible) {
          return;
        }
        observer.disconnect();
        window.setTimeout(dispose, 350);
      });
      observer.observe(element, { attributes: true, attributeFilter: ["class", "style"] });
    }

    instance.show();
  }

  window.SchoolLogo = { open: open, validateFile: validateFile };
})(window, document);
