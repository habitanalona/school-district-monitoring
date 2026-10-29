/* School Forms add-on — shared front-end helpers */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;

  var STATUS = {
    draft: { label: "Draft", tone: "neutral" },
    in_progress: { label: "In Progress", tone: "info" },
    ready_for_validation: { label: "Ready for Validation", tone: "primary" },
    validation_failed: { label: "Validation Failed", tone: "danger" },
    submitted: { label: "Submitted", tone: "violet" },
    returned: { label: "Returned for Correction", tone: "warning" },
    approved: { label: "Approved", tone: "success" },
    finalized: { label: "Finalized", tone: "teal" }
  };

  var ISSUANCE_STATUS = {
    issued: { label: "Issued", tone: "info" },
    partially_returned: { label: "Partially returned", tone: "warning" },
    returned: { label: "Returned", tone: "success" },
    damaged: { label: "Damaged", tone: "danger" },
    lost: { label: "Lost", tone: "danger" }
  };

  var NUTRITION = {
    severely_wasted: { label: "Severely wasted", tone: "danger" },
    wasted: { label: "Wasted", tone: "warning" },
    normal: { label: "Normal", tone: "success" },
    overweight: { label: "Overweight", tone: "warning" },
    obese: { label: "Obese", tone: "warning" },
    not_assessed: { label: "Not assessed", tone: "muted" }
  };

  var MOVEMENT = {
    transferred_in: "Transferred in",
    transferred_out: "Transferred out",
    dropped_out: "Dropped out",
    reinstated: "Reinstated",
    completed: "Completed",
    other: "Other"
  };

  var ATTENDANCE = {
    present: "Present",
    absent: "Absent",
    tardy: "Tardy",
    excused: "Excused",
    half_day: "Half day"
  };

  function esc(value) {
    return window.UI.escapeHtml(value);
  }

  function session() {
    return window.AppShell.getSession() || {};
  }

  function permission(name) {
    var current = session();
    return Boolean(current.permissions && current.permissions[name]);
  }

  function role() {
    return (session().user && session().user.role) || "";
  }

  function statusBadge(status) {
    var meta = STATUS[status] || { label: window.UI.titleCase(status || "—"), tone: "neutral" };
    return window.UI.pillarBadge(meta.label, meta.tone);
  }

  function toneBadge(map, key) {
    var meta = map[key] || { label: window.UI.titleCase(key || "—"), tone: "neutral" };
    return window.UI.pillarBadge(meta.label, meta.tone);
  }

  function completion(value, options) {
    var settings = options || {};
    var number = Math.max(0, Math.min(100, Number(value || 0)));
    var tone = number >= 100 ? "success" : number >= 60 ? "" : number > 0 ? "warning" : "danger";
    return (
      '<div class="completion" role="img" aria-label="' +
      esc(number + " percent complete") +
      '">' +
      '<div class="completion__track"><div class="completion__bar' +
      (tone ? " completion__bar--" + tone : "") +
      '" style="width:' +
      number +
      '%"></div></div>' +
      (settings.hideLabel
        ? ""
        : '<span class="completion__label">' + (Math.round(number * 10) / 10) + "%</span>") +
      "</div>"
    );
  }

  function monthNow() {
    return new Date().toISOString().slice(0, 7);
  }

  function todayIso() {
    return L.todayIso();
  }

  function monthOptions(selected) {
    var options = [];
    var now = new Date();
    for (var index = -1; index <= 13; index += 1) {
      var date = new Date(now.getFullYear(), now.getMonth() - index, 1);
      var value = date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
      options.push(
        '<option value="' +
          value +
          '"' +
          (value === selected ? " selected" : "") +
          ">" +
          esc(date.toLocaleString("en-PH", { month: "long", year: "numeric" })) +
          "</option>"
      );
    }
    return options.join("");
  }

  function issueList(errors, warnings, options) {
    var settings = options || {};
    var list = []
      .concat((errors || []).map(function (item) {
        return '<li class="is-error"><span class="issue-tag issue-tag--error">Error</span>' +
          esc(typeof item === "string" ? item : item.message) + "</li>";
      }))
      .concat((warnings || []).map(function (item) {
        return '<li class="is-warning"><span class="issue-tag issue-tag--warning">Warning</span>' +
          esc(typeof item === "string" ? item : item.message) + "</li>";
      }));
    if (!list.length) {
      return settings.empty === false
        ? ""
        : '<p class="field-hint" style="margin:0"><i class="bi bi-check2-circle" aria-hidden="true"></i> No validation issues were found.</p>';
    }
    return '<ul class="issue-list">' + list.join("") + "</ul>";
  }

  function pageAlert(id, tone, message, title) {
    var box = document.getElementById(id);
    if (!box) {
      return;
    }
    window.UI.showAlert(box, tone, message, title);
  }

  function emptyRow(columns, message) {
    return '<tr><td colspan="' + columns + '" class="empty-cell">' + esc(message) + "</td></tr>";
  }

  function fillSelect(select, items, valueKey, labelKey, placeholder, selected) {
    if (!select) {
      return;
    }
    select.innerHTML = L.options(items, valueKey, labelKey, selected, placeholder);
  }

  function schoolFilter(wrapperId, selectId, selected) {
    var wrapper = document.getElementById(wrapperId);
    var select = document.getElementById(selectId);
    var fixed = L.schoolId();
    if (fixed) {
      if (wrapper) {
        wrapper.classList.add("d-none");
      }
      return Promise.resolve(String(fixed));
    }
    if (wrapper) {
      wrapper.classList.remove("d-none");
    }
    return L.schools().then(function (list) {
      fillSelect(select, list, "id", "name", "All schools", selected);
      return "";
    });
  }

  function filteredSections(schoolIdValue, yearId, select, selected) {
    return L.sections({ schoolId: schoolIdValue || undefined, schoolYearId: yearId || undefined })
      .then(function (list) {
        fillSelect(select, list, "id", function (section) {
          return section.name + " · " + section.gradeLevel + (section.schoolYearName ? " (" + section.schoolYearName + ")" : "");
        }, "Select a section", selected);
        return list;
      });
  }

  function filteredGrades(schoolIdValue, select, selected) {
    return L.grades(schoolIdValue || undefined).then(function (list) {
      fillSelect(select, list, "id", "name", "All grade levels", selected);
      return list;
    });
  }

  function templateNote(data) {
    var template = (data && data.template) || null;
    if (!template) {
      return "This is a system-generated layout. Verify it against the current official DepEd form before certification.";
    }
    if (template.isOfficial) {
      return "Layout marked official. Source: " + (template.sourceNote || "not recorded") + ".";
    }
    return "System layout" + (template.name ? " (“" + template.name + "”)" : "") +
      ". This is not an official DepEd template" + (template.sourceNote ? ": " + template.sourceNote : ".") +
      " Verify against the current official form before printing for certification.";
  }

  function previewFrameHtml(title) {
    return (
      '<div class="preview-shell">' +
      '<iframe title="' + esc(title || "Form preview") + '" loading="lazy"></iframe>' +
      '<div class="preview-note"><span class="preview-source">Loading form…</span>' +
      '<span><i class="bi bi-eye" aria-hidden="true"></i> Live preview — not a saved or approved copy.</span></div>' +
      "</div>"
    );
  }

  function loadFrame(frame, html, noteElement) {
    if (!frame) {
      return;
    }
    frame.srcdoc = html;
    if (noteElement) {
      noteElement.textContent = "Generated from current records.";
    }
  }

  function printFrame(frame) {
    if (!frame || !frame.contentWindow) {
      return;
    }
    frame.contentWindow.focus();
    frame.contentWindow.print();
  }

  function downloadPdf(submissionId) {
    var link = document.createElement("a");
    link.href = "/api/school-forms/submissions/" + encodeURIComponent(submissionId) + "/render?format=pdf";
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function previewForm(code, params, options) {
    var settings = options || {};
    var dialog = L.modal({
      title: settings.title || "Form preview",
      eyebrow: settings.eyebrow || code.toUpperCase(),
      size: "modal-xl",
      body:
        '<div id="previewAlert" class="d-none mb-3" role="alert"></div>' +
        previewFrameHtml(settings.title || code.toUpperCase()) +
        '<p class="form-text mt-2 mb-0" id="previewTemplateNote">Checking layout source…</p>',
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Close</button>' +
        (settings.showGenerate === false
          ? ""
          : '<button type="button" class="btn btn-primary" id="previewGenerateButton"><i class="bi bi-arrow-repeat" aria-hidden="true"></i> Generate &amp; save</button>')
    });
    var frame = dialog.element.querySelector("iframe");
    var note = dialog.element.querySelector("#previewTemplateNote");
    var alertBox = dialog.element.querySelector("#previewAlert");
    var generate = dialog.element.querySelector("#previewGenerateButton");

    L.apiGet("/school-forms/preview/" + encodeURIComponent(code), params)
      .then(function (payload) {
        loadFrame(frame, payload.html);
        note.textContent = templateNote(payload.data);
        if (payload.data && payload.data.validation) {
          var errors = payload.data.validation.errors || [];
          var warnings = payload.data.validation.warnings || [];
          if (errors.length) {
            window.UI.showAlert(
              alertBox,
              "warning",
              errors.length + " validation issue" + (errors.length === 1 ? "" : "s") +
                " must be resolved before this form can be submitted. Completeness: " +
                (payload.data.completeness || 0) + "%.",
              "Form needs attention"
            );
          } else if (warnings.length) {
            window.UI.showAlert(
              alertBox,
              "info",
              warnings.length + " warning" + (warnings.length === 1 ? "" : "s") +
                " found. Review the form before submitting.",
              "Warnings found"
            );
          }
        }
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Preview unavailable");
        note.textContent = "The form could not be generated.";
      });

    if (generate) {
      if (!permission("canManageSchoolForms")) {
        generate.classList.add("d-none");
      } else {
        generate.addEventListener("click", function () {
          window.UI.setButtonLoading(generate, true, "Generating…");
          API.post("/school-forms/generate/" + encodeURIComponent(code), params)
            .then(function (payload) {
              window.UI.setButtonLoading(generate, false);
              dialog.close();
              window.UI.toast("Form generated", payload.data.formCode.toUpperCase() + " saved as " + payload.data.statusLabel + ".", "success");
              if (typeof settings.onGenerated === "function") {
                settings.onGenerated(payload.data);
              }
            })
            .catch(function (error) {
              window.UI.setButtonLoading(generate, false);
              window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not generate the form");
            });
        });
      }
    }
    return dialog;
  }

  function openSubmission(submissionId, options) {
    var settings = options || {};
    var dialog = L.modal({
      title: "Form submission",
      eyebrow: "Submission #" + submissionId,
      size: "modal-xl",
      body:
        '<div id="submissionAlert" class="d-none mb-3" role="alert"></div>' +
        '<div id="submissionSummary"><div class="skeleton skeleton-block"></div></div>' +
        '<div id="submissionActions" class="d-flex gap-2 flex-wrap mb-3"></div>' +
        '<div id="submissionIssues" class="mb-3"></div>' +
        previewFrameHtml("Saved form submission") +
        '<p class="form-text mt-2 mb-0" id="submissionTemplateNote"></p>',
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Close</button>' +
        '<button type="button" class="btn btn-outline-primary d-none" id="submissionPdfButton"><i class="bi bi-file-earmark-pdf" aria-hidden="true"></i> Download PDF</button>' +
        '<button type="button" class="btn btn-outline-secondary d-none" id="submissionPrintButton"><i class="bi bi-printer" aria-hidden="true"></i> Print</button>'
    });
    var summary = dialog.element.querySelector("#submissionSummary");
    var actions = dialog.element.querySelector("#submissionActions");
    var issues = dialog.element.querySelector("#submissionIssues");
    var frame = dialog.element.querySelector("iframe");
    var note = dialog.element.querySelector("#submissionTemplateNote");
    var alertBox = dialog.element.querySelector("#submissionAlert");
    var pdfButton = dialog.element.querySelector("#submissionPdfButton");
    var printButton = dialog.element.querySelector("#submissionPrintButton");
    var state = { submission: null };

    function load() {
      return L.apiGet("/school-forms/submissions/" + submissionId)
        .then(function (submission) {
          state.submission = submission;
          var errors = submission.validation.errors || [];
          var warnings = submission.validation.warnings || [];
          summary.innerHTML =
            '<div class="review-summary">' +
            '<div><span>Form</span><strong>' + esc(submission.formCode.toUpperCase() + " — " + submission.formTitle) + "</strong></div>" +
            '<div><span>Status</span><strong>' + statusBadge(submission.status) + "</strong></div>" +
            '<div><span>School</span><strong>' + esc(submission.schoolName || "—") + "</strong></div>" +
            '<div><span>School year</span><strong>' + esc(submission.schoolYearName || "—") + "</strong></div>" +
            '<div><span>Grade / Section</span><strong>' + esc([submission.gradeLevelName, submission.sectionName].filter(Boolean).join(" / ") || "School-wide") + "</strong></div>" +
            '<div><span>Period</span><strong>' + esc(submission.period || "Whole year") + "</strong></div>" +
            '<div><span>Version</span><strong>v' + submission.version + "</strong></div>" +
            '<div><span>Completeness</span><strong>' + completion(submission.completeness) + "</strong></div>" +
            '<div><span>Generated</span><strong>' + esc(window.UI.phDateTime(submission.generatedAt)) + "</strong></div>" +
            '<div><span>Submitted</span><strong>' + esc(submission.submittedAt ? window.UI.phDateTime(submission.submittedAt) : "Not submitted") + "</strong></div>" +
            '<div><span>Reviewed by</span><strong>' + esc(submission.reviewedByName || "Not reviewed") + "</strong></div>" +
            "</div>" +
            (submission.reviewNotes
              ? '<div class="info-banner info-banner--warning"><i class="bi bi-chat-left-text" aria-hidden="true"></i><div><strong>Review notes.</strong> ' + esc(submission.reviewNotes) + "</div></div>"
              : "");
          issues.innerHTML = errors.length || warnings.length ? issueList(errors, warnings) : "";
          renderActions();
          if (errors.length) {
            window.UI.showAlert(alertBox, "warning", errors.length + " validation error" + (errors.length === 1 ? "" : "s") + " remain. Correct the source records and regenerate.", "Validation failed");
          }
          if (submission.hasSnapshot) {
            pdfButton.classList.remove("d-none");
            printButton.classList.remove("d-none");
            return L.apiGet("/school-forms/submissions/" + submissionId + "/render").then(function (payload) {
              loadFrame(frame, payload.html);
              note.textContent =
                "This is the saved version " + submission.version + " snapshot. Confirm the layout source and current DepEd form before certification.";
            });
          }
          frame.srcdoc = '<p style="font-family:Arial;padding:24px;color:#5d7288">This submission has no saved snapshot yet.</p>';
          return null;
        })
        .catch(function (error) {
          if (error.status === 401) {
            return;
          }
          summary.innerHTML = '<p class="empty-cell">' + esc(L.friendlyError(error)) + "</p>";
        });
    }

    function renderActions() {
      var submission = state.submission;
      actions.innerHTML = "";
      if (!submission) {
        return;
      }
      var buttons = [];
      if (permission("canManageSchoolForms") && ["draft", "in_progress", "ready_for_validation", "validation_failed", "returned"].indexOf(submission.status) !== -1) {
        var blocked = submission.validation.errorCount > 0;
        buttons.push(
          '<button type="button" class="btn btn-primary btn-sm" data-review="submit"' + (blocked ? " disabled title=\"Resolve validation errors first\"" : "") + ">" +
            '<i class="bi bi-send" aria-hidden="true"></i> Submit for review</button>'
        );
      }
      if (permission("canReviewSchoolForms") && submission.status === "submitted") {
        buttons.push(
          '<button type="button" class="btn btn-success btn-sm" data-review="approve"><i class="bi bi-check2-circle" aria-hidden="true"></i> Approve</button>' +
            '<button type="button" class="btn btn-warning btn-sm" data-review="return"><i class="bi bi-arrow-return-left" aria-hidden="true"></i> Return for correction</button>' +
            '<button type="button" class="btn btn-outline-danger btn-sm" data-review="reject"><i class="bi bi-x-circle" aria-hidden="true"></i> Reject</button>'
        );
      }
      if (permission("canFinalizeSchoolForms") && submission.status === "approved") {
        buttons.push(
          '<button type="button" class="btn btn-primary btn-sm" data-review="finalize"><i class="bi bi-lock" aria-hidden="true"></i> Finalize</button>'
        );
      }
      if (!buttons.length) {
        buttons.push('<p class="field-hint" style="margin:0">No workflow action is available to you for this status.</p>');
      }
      actions.innerHTML = buttons.join("");
    }

    actions.addEventListener("click", function (event) {
      var button = event.target.closest("[data-review]");
      if (!button || button.disabled) {
        return;
      }
      reviewSubmission(state.submission, button.dataset.review, function () {
        load();
        if (typeof settings.onChanged === "function") {
          settings.onChanged();
        }
      });
    });

    pdfButton.addEventListener("click", function () {
      downloadPdf(submissionId);
    });
    printButton.addEventListener("click", function () {
      printFrame(frame);
    });

    load();
    return dialog;
  }

  function reviewSubmission(submission, action, onDone) {
    var labels = {
      submit: { title: "Submit for review", confirm: "Submit form", tone: "primary", message: "Submit " + submission.formCode.toUpperCase() + " for district validation?" },
      approve: { title: "Approve submission", confirm: "Approve", tone: "success", message: "Approve this " + submission.formCode.toUpperCase() + " submission? The approved version becomes the official record." },
      return: { title: "Return for correction", confirm: "Return to school", tone: "warning", message: "Return this submission with instructions for correction. Comments are required." },
      reject: { title: "Reject submission", confirm: "Reject", tone: "danger", message: "Reject this submission. Comments are required and the rejection is recorded in the audit trail." },
      finalize: { title: "Finalize submission", confirm: "Finalize", tone: "primary", message: "Finalizing locks this form for the school year. Continue?" }
    };
    var meta = labels[action] || labels.submit;
    var needsComment = action === "return" || action === "reject";
    var dialog = L.modal({
      title: meta.title,
      eyebrow: submission.formCode.toUpperCase(),
      size: "",
      body:
        '<p style="font-size:.76rem;color:#334b63">' + esc(meta.message) + "</p>" +
        (needsComment ? '<div class="info-banner info-banner--warning"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i><div>Comments are shown to the school and preserved in the audit trail. Do not include learner health details.</div></div>' : "") +
        '<div id="reviewAlert" class="d-none mb-3" role="alert"></div>' +
        '<div class="form-group mb-0"><label for="reviewComments">' + (needsComment ? "Comments <span class=\"required-mark\">*</span>" : "Comments (optional)") + "</label>" +
        '<textarea class="form-control" id="reviewComments" rows="3" maxlength="2000" placeholder="' + (needsComment ? "Explain exactly what must be corrected…" : "Optional note for the school records…") + '"></textarea>' +
        '<span class="field-error"></span></div>',
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="button" class="btn btn-' + meta.tone + '" id="reviewConfirmButton">' + esc(meta.confirm) + "</button>"
    });
    var button = dialog.element.querySelector("#reviewConfirmButton");
    var alertBox = dialog.element.querySelector("#reviewAlert");
    var textarea = dialog.element.querySelector("#reviewComments");
    button.addEventListener("click", function () {
      var comments = textarea.value.trim();
      if (needsComment && !comments) {
        window.UI.fieldError(textarea, "Provide comments explaining what must be corrected.");
        return;
      }
      window.UI.setButtonLoading(button, true, "Working…");
      API.post("/school-forms/submissions/" + submission.id + "/" + action, { comments: comments })
        .then(function (payload) {
          window.UI.setButtonLoading(button, false);
          dialog.close();
          window.UI.toast("Form updated", payload.data.formCode.toUpperCase() + " is now " + payload.data.statusLabel + ".", "success");
          if (typeof onDone === "function") {
            onDone(payload.data);
          }
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not update the form");
        });
    });
    return dialog;
  }

  function learnerSelect(select, params) {
    var query = Object.assign({ status: "active", pageSize: 100 }, params || {});
    return L.apiGet("/learners", query).then(function (rows) {
      select.innerHTML = (rows || []).length
        ? '<option value="">Select a learner</option>' +
          rows.map(function (learner) {
            var enrollment = learner.currentEnrollment;
            return L.option(
              learner.id,
              learner.lrn + " · " + learner.fullName +
                (enrollment ? " · " + [enrollment.gradeLevel, enrollment.sectionName].filter(Boolean).join(" ") : "")
            );
          }).join("")
        : '<option value="">No learners match this selection</option>';
      return rows;
    });
  }

  window.FormsUI = {
    STATUS: STATUS,
    ISSUANCE_STATUS: ISSUANCE_STATUS,
    NUTRITION: NUTRITION,
    MOVEMENT: MOVEMENT,
    ATTENDANCE: ATTENDANCE,
    esc: esc,
    session: session,
    permission: permission,
    role: role,
    statusBadge: statusBadge,
    toneBadge: toneBadge,
    completion: completion,
    monthNow: monthNow,
    todayIso: todayIso,
    monthOptions: monthOptions,
    issueList: issueList,
    pageAlert: pageAlert,
    emptyRow: emptyRow,
    fillSelect: fillSelect,
    schoolFilter: schoolFilter,
    filteredSections: filteredSections,
    filteredGrades: filteredGrades,
    templateNote: templateNote,
    previewForm: previewForm,
    openSubmission: openSubmission,
    reviewSubmission: reviewSubmission,
    downloadPdf: downloadPdf,
    printFrame: printFrame,
    learnerSelect: learnerSelect
  };
})(window, document);
