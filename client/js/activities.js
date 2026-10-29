/* DepEd Learner Records — activities page */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var state = {
    session: null,
    activities: [],
    years: [],
    schoolId: "",
    yearId: "",
    level: "",
    search: ""
  };

  function el(id) {
    return document.getElementById(id);
  }

  function canManage() {
    return Boolean(state.session && state.session.permissions.canManageActivities);
  }

  function dateRange(activity) {
    if (!activity.startDate && !activity.endDate) {
      return "—";
    }
    if (activity.startDate && activity.endDate && activity.startDate !== activity.endDate) {
      return window.UI.phDate(activity.startDate) + " – " + window.UI.phDate(activity.endDate);
    }
    return window.UI.phDate(activity.startDate || activity.endDate);
  }

  function render() {
    var body = el("activityTableBody");
    var query = state.search.trim().toLowerCase();
    var rows = state.activities.filter(function (activity) {
      return (
        !query ||
        [activity.name, activity.category, activity.organization, activity.adviserName, activity.schoolName]
          .join(" ")
          .toLowerCase()
          .indexOf(query) !== -1
      );
    });
    if (!rows.length) {
      body.innerHTML =
        '<tr><td colspan="8" class="empty-cell">' +
        (state.search ? "No activity matches your search." : "No activities recorded for this filter yet.") +
        "</td></tr>";
    } else {
      body.innerHTML = rows
        .map(function (activity) {
          return (
            '<tr><td><strong>' +
            L.esc(activity.name) +
            "</strong>" +
            (activity.achievement
              ? '<span class="field-hint"><i class="bi bi-award" aria-hidden="true"></i> ' + L.esc(activity.achievement) + "</span>"
              : "") +
            "</td><td>" +
            L.esc(activity.category) +
            "</td><td>" +
            L.esc(activity.schoolYearName || "—") +
            "</td><td>" +
            L.levelBadge(activity.participationLevel) +
            "</td><td>" +
            L.esc(activity.schoolName || "—") +
            "</td><td>" +
            dateRange(activity) +
            '</td><td class="text-right">' +
            window.UI.number(activity.participantCount) +
            '</td><td><div class="row-actions">' +
            '<button type="button" class="btn btn-light" data-participants="' +
            activity.id +
            '" title="Manage participants"><i class="bi bi-people" aria-hidden="true"></i></button>' +
            (canManage()
              ? '<button type="button" class="btn btn-light" data-edit="' +
                activity.id +
                '" title="Edit activity"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>' +
                '<button type="button" class="btn btn-light" data-remove="' +
                activity.id +
                '" title="Remove activity"><i class="bi bi-trash" aria-hidden="true"></i></button>'
              : "") +
            "</div></td></tr>"
          );
        })
        .join("");
    }
    el("activityTableMeta").textContent =
      rows.length +
      (rows.length === 1 ? " activity" : " activities") +
      (state.search ? " matching your search" : "");
  }

  function loadActivities() {
    el("activityTableBody").innerHTML = L.skeletonRows(8, 4);
    L.apiGet("/activities", {
      schoolId: state.schoolId || undefined,
      schoolYearId: state.yearId || undefined,
      level: state.level || undefined,
      search: state.search.trim() || undefined
    })
      .then(function (list) {
        state.activities = list || [];
        render();
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        el("activityTableBody").innerHTML =
          '<tr><td colspan="8" class="empty-cell">' + L.esc(L.friendlyError(error)) + "</td></tr>";
        el("activityTableMeta").textContent = "Activities could not be loaded.";
      });
  }

  function populateYears() {
    return L.years().then(function (years) {
      state.years = years || [];
      el("activityYearFilter").innerHTML = L.yearOptions(state.years, state.yearId, "All school years");
      var current = state.years.find(function (year) {
        return year.isCurrent;
      });
      if (!state.yearId) {
        state.yearId = current ? String(current.id) : "";
        el("activityYearFilter").value = state.yearId;
      }
    });
  }

  function populateSchoolFilter() {
    if (L.schoolId()) {
      state.schoolId = String(L.schoolId());
      return Promise.resolve();
    }
    el("activitySchoolControl").classList.remove("d-none");
    var select = el("activitySchoolFilter");
    return L.schools().then(function (list) {
      var html = ['<option value="">All schools</option>'];
      list.forEach(function (school) {
        html.push('<option value="' + school.id + '">' + L.esc(school.name) + "</option>");
      });
      select.innerHTML = html.join("");
    });
  }

  function activityModal(activity) {
    var editing = Boolean(activity);
    var data = activity || {};
    var dialog = L.modal({
      title: editing ? "Edit activity" : "New activity",
      eyebrow: "Curricular and extracurricular",
      size: "modal-lg",
      body:
        '<form id="activityForm" novalidate>' +
        '<div id="activityFormAlert" class="d-none mb-3" role="alert"></div>' +
        (editing
          ? '<div class="form-group"><label>School</label><input class="form-control" value="' +
            L.esc(data.schoolName || L.schoolName(data.schoolId) || "School") +
            '" readonly></div>'
          : L.schoolFieldHtml(state.schoolId)) +
        '<div class="form-row">' +
        '<div class="col-md-8"><div class="form-group"><label for="activityName">Activity name <span class="required-mark">*</span></label>' +
        '<input class="form-control" id="activityName" name="name" required maxlength="160" placeholder="Mathematics Olympiad" value="' +
        L.esc(data.name || "") +
        '"><span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="activityYear">School year <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="activityYear" name="schoolYearId" required>' +
        L.yearOptions(state.years, data.schoolYearId || state.yearId, "Select school year") +
        '</select><span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="activityCategory">Category <span class="required-mark">*</span></label>' +
        '<input class="form-control" id="activityCategory" name="category" required maxlength="64" list="activityCategoryList" placeholder="Clubs" value="' +
        L.esc(data.category || "") +
        '"><datalist id="activityCategoryList">' +
        ["Academic competition", "Arts and culture", "Clubs", "Community service", "Sports", "Student government"]
          .map(function (item) {
            return "<option value=\"" + L.esc(item) + "\">";
          })
          .join("") +
        '</datalist><span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="activityLevel">Participation level</label>' +
        '<select class="custom-select" id="activityLevel" name="participationLevel">' +
        Object.keys(L.PARTICIPATION_LEVEL)
          .map(function (key) {
            return L.option(key, L.PARTICIPATION_LEVEL[key].label, data.participationLevel || "school");
          })
          .join("") +
        '</select><span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="activityOrganization">Club or organization</label>' +
        '<input class="form-control" id="activityOrganization" name="organization" maxlength="160" placeholder="Science Club" value="' +
        L.esc(data.organization || "") +
        '"><span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="activityAdviser">Adviser or coach</label>' +
        '<select class="custom-select" id="activityAdviser" name="adviserId"><option value="">Not assigned</option></select>' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-3"><div class="form-group"><label for="activityStart">Start date</label>' +
        '<input type="date" class="form-control" id="activityStart" name="startDate" value="' +
        L.esc(data.startDate || "") +
        '"><span class="field-error"></span></div></div>' +
        '<div class="col-md-3"><div class="form-group"><label for="activityEnd">End date</label>' +
        '<input type="date" class="form-control" id="activityEnd" name="endDate" value="' +
        L.esc(data.endDate || "") +
        '"><span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="activityAchievement">Achievement</label>' +
        '<input class="form-control" id="activityAchievement" name="achievement" maxlength="200" placeholder="Division champion" value="' +
        L.esc(data.achievement || "") +
        '"><span class="field-error"></span></div></div>' +
        '<div class="col-12"><div class="form-group"><label for="activityRemarks">Remarks</label>' +
        '<textarea class="form-control" id="activityRemarks" name="remarks" rows="2" maxlength="2000">' +
        L.esc(data.remarks || "") +
        "</textarea></div></div>" +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="submit" form="activityForm" class="btn btn-primary" id="saveActivityButton">' +
        (editing ? "Save activity" : "Create activity") +
        "</button>"
    });
    var form = dialog.element.querySelector("#activityForm");
    var button = dialog.element.querySelector("#saveActivityButton");
    var alertBox = dialog.element.querySelector("#activityFormAlert");
    var schoolSelect = form.querySelector("[data-school-select]");
    var adviserSelect = form.querySelector("#activityAdviser");

    if (schoolSelect) {
      L.fillSchoolSelect(schoolSelect, state.schoolId);
    }

    function loadAdvisers() {
      var school = schoolSelect ? schoolSelect.value : String(data.schoolId || L.schoolId() || "");
      if (!school) {
        adviserSelect.innerHTML = '<option value="">Not assigned</option>';
        return;
      }
      L.teachers(school).then(function (list) {
        if (document.body.contains(adviserSelect)) {
          adviserSelect.innerHTML = L.teacherOptions(list, data.adviserId);
        }
      });
    }
    if (schoolSelect) {
      schoolSelect.addEventListener("change", loadAdvisers);
    }
    loadAdvisers();

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var values = L.formValues(form);
      values.name = values.name.trim();
      values.category = values.category.trim();
      if (!values.name || !values.category || !values.schoolYearId) {
        window.UI.showAlert(alertBox, "warning", "Enter the activity name, category, and school year.", "Missing details");
        return;
      }
      if (!editing && !values.schoolId) {
        window.UI.fieldError(form.querySelector("[name=schoolId]"), "Choose the school for this activity.");
        return;
      }
      if (values.startDate && values.endDate && values.endDate < values.startDate) {
        window.UI.fieldError(form.querySelector("#activityEnd"), "End date cannot be before the start date.");
        return;
      }
      var payload = {
        schoolId: values.schoolId,
        schoolYearId: values.schoolYearId,
        name: values.name,
        category: values.category,
        organization: values.organization.trim(),
        adviserId: values.adviserId || null,
        participationLevel: values.participationLevel,
        startDate: values.startDate || null,
        endDate: values.endDate || null,
        achievement: values.achievement.trim(),
        remarks: values.remarks.trim()
      };
      L.submit(
        form,
        button,
        alertBox,
        function () {
          return editing
            ? API.put("/activities/" + activity.id, payload)
            : API.post("/activities", payload);
        },
        function () {
          dialog.close();
          window.UI.toast(editing ? "Activity updated" : "Activity created", values.name, "success");
          loadActivities();
        }
      );
    });
  }

  function participantsModal(activity) {
    var dialog = L.modal({
      title: "Activity participants",
      eyebrow: activity.name,
      size: "modal-lg",
      body:
        '<div id="participantAlert" class="d-none mb-3" role="alert"></div>' +
        '<div id="participantList" class="mb-3"><div class="skeleton skeleton-block"></div></div>' +
        (canManage()
          ? '<p class="form-section-label">Add learner participation</p>' +
            '<form id="participantForm" novalidate>' +
            '<div class="form-row">' +
            '<div class="col-md-6"><div class="form-group"><label for="participantSearch">Find learner</label>' +
            '<input class="form-control" id="participantSearch" placeholder="Search LRN or name…" autocomplete="off">' +
            '<span class="field-hint">Only active learners from this activity\'s school appear.</span></div></div>' +
            '<div class="col-md-6"><div class="form-group"><label for="participantLearner">Learner <span class="required-mark">*</span></label>' +
            '<select class="custom-select" id="participantLearner" name="learnerId" required><option value="">Loading learners…</option></select>' +
            '<span class="field-error"></span></div></div>' +
            '<div class="col-md-4"><div class="form-group"><label for="participantRole">Role</label>' +
            '<input class="form-control" id="participantRole" name="role" maxlength="80" placeholder="Participant"></div></div>' +
            '<div class="col-md-4"><div class="form-group"><label for="participantAchievement">Achievement</label>' +
            '<input class="form-control" id="participantAchievement" name="achievement" maxlength="200" placeholder="Gold medal"></div></div>' +
            '<div class="col-md-4"><div class="form-group"><label for="participantRemarks">Remarks</label>' +
            '<input class="form-control" id="participantRemarks" name="remarks" maxlength="2000"></div></div>' +
            "</div>" +
            '<button type="submit" class="btn btn-primary btn-sm" id="addParticipantButton"><i class="bi bi-person-plus" aria-hidden="true"></i> Add participant</button>' +
            "</form>"
          : ""),
      footer: '<button type="button" class="btn btn-light" data-dismiss="modal">Close</button>'
    });
    var list = dialog.element.querySelector("#participantList");
    var alertBox = dialog.element.querySelector("#participantAlert");
    var searchInput = dialog.element.querySelector("#participantSearch");
    var learnerSelect = dialog.element.querySelector("#participantLearner");
    var form = dialog.element.querySelector("#participantForm");

    function renderParticipants(participants) {
      if (!participants.length) {
        list.innerHTML = '<p class="text-muted" style="font-size:.82rem">No learner participation recorded yet.</p>';
        return;
      }
      list.innerHTML =
        '<div class="report-preview"><div class="report-preview__scroll"><table><thead><tr><th>LRN</th><th>Learner</th><th>Grade &amp; section</th><th>Role</th><th>Achievement</th><th></th></tr></thead><tbody>' +
        participants
          .map(function (participant) {
            return (
              "<tr><td><code class=\"lrn-code\">" +
              L.esc(participant.lrn) +
              "</code></td><td>" +
              L.esc(participant.fullName) +
              "</td><td>" +
              L.esc((participant.gradeLevel || "—") + " · " + (participant.sectionName || "—")) +
              "</td><td>" +
              L.esc(participant.role || "—") +
              "</td><td>" +
              L.esc(participant.achievement || "—") +
              "</td><td class=\"text-right\">" +
              (canManage()
                ? '<button type="button" class="btn btn-light btn-sm" data-remove-participant="' +
                  participant.id +
                  '" title="Remove participation"><i class="bi bi-x-lg" aria-hidden="true"></i></button>'
                : "") +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table></div></div>";
    }

    function loadDetail() {
      return L.apiGet("/activities/" + activity.id).then(function (detail) {
        renderParticipants(detail.participants || []);
        return detail;
      });
    }

    list.addEventListener("click", function (event) {
      var remove = event.target.closest("[data-remove-participant]");
      if (!remove) {
        return;
      }
      API.delete("/activities/" + activity.id + "/participants/" + remove.dataset.removeParticipant)
        .then(function () {
          window.UI.toast("Participation removed", "The learner was removed from this activity.", "success");
          loadDetail();
          loadActivities();
        })
        .catch(function (error) {
          window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not remove participation");
        });
    });

    if (form) {
      var searchTimer = null;
      function loadLearners(query) {
        clearTimeout(searchTimer);
        searchTimer = window.setTimeout(function () {
          L.apiGet("/learners", {
            schoolId: activity.schoolId,
            schoolYearId: activity.schoolYearId,
            status: "active",
            search: query || undefined,
            pageSize: 30
          })
            .then(function (rows) {
              if (!document.body.contains(learnerSelect)) {
                return;
              }
              learnerSelect.innerHTML = (rows || []).length
                ? '<option value="">Select learner</option>' +
                  rows
                    .map(function (learner) {
                      var enrollment = learner.currentEnrollment;
                      return L.option(
                        learner.id,
                        learner.lrn +
                          " · " +
                          learner.fullName +
                          (enrollment ? " · " + (enrollment.gradeLevel || "") + " " + (enrollment.sectionName || "") : "")
                      );
                    })
                    .join("")
                : '<option value="">No matching learners</option>';
            })
            .catch(function (error) {
              if (error.status === 401) {
                return;
              }
              learnerSelect.innerHTML = '<option value="">Learners unavailable</option>';
            });
        }, 260);
      }
      if (searchInput) {
        searchInput.addEventListener("input", function () {
          loadLearners(searchInput.value.trim());
        });
      }
      loadLearners("");

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var values = L.formValues(form);
        var button = dialog.element.querySelector("#addParticipantButton");
        if (!values.learnerId) {
          window.UI.showAlert(alertBox, "warning", "Choose the learner to add.", "Missing learner");
          return;
        }
        window.UI.hideAlert(alertBox);
        window.UI.setButtonLoading(button, true, "Adding…");
        API.post("/activities/" + activity.id + "/participants", {
          learnerId: values.learnerId,
          role: values.role.trim(),
          achievement: values.achievement.trim(),
          remarks: values.remarks.trim()
        })
          .then(function () {
            window.UI.setButtonLoading(button, false);
            form.reset();
            window.UI.toast("Participant added", "Learner participation recorded.", "success");
            loadDetail();
            loadActivities();
          })
          .catch(function (error) {
            window.UI.setButtonLoading(button, false);
            if (error.status === 401) {
              return;
            }
            window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not add the learner");
          });
      });
    }

    loadDetail().catch(function (error) {
      if (error.status === 401) {
        return;
      }
      list.innerHTML = '<p class="empty-cell">' + L.esc(L.friendlyError(error)) + "</p>";
    });
  }

  function removeActivity(activity) {
    window.UI.confirm({
      title: "Remove " + activity.name + "?",
      message:
        "Participant links and achievements recorded under this activity will be removed from learner profiles. This cannot be undone.",
      confirmLabel: "Remove activity",
      tone: "danger"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      API.delete("/activities/" + activity.id)
        .then(function () {
          window.UI.toast("Activity removed", activity.name, "success");
          loadActivities();
        })
        .catch(function (error) {
          window.UI.showAlert(el("activityPageAlert"), "danger", L.friendlyError(error), "Could not remove the activity");
        });
    });
  }

  function wireFilters() {
    var search = el("activitySearch");
    search.addEventListener(
      "input",
      window.UI.debounce(function () {
        state.search = search.value;
        render();
      }, 180)
    );
    el("activityYearFilter").addEventListener("change", function (event) {
      state.yearId = event.target.value;
      loadActivities();
    });
    el("activityLevelFilter").addEventListener("change", function (event) {
      state.level = event.target.value;
      loadActivities();
    });
    var schoolFilter = el("activitySchoolFilter");
    if (schoolFilter) {
      schoolFilter.addEventListener("change", function () {
        state.schoolId = schoolFilter.value;
        loadActivities();
      });
    }
    el("resetActivityFilters").addEventListener("click", function () {
      state.level = "";
      state.search = "";
      search.value = "";
      el("activityLevelFilter").value = "";
      loadActivities();
    });
  }

  function init() {
    window.AppShell.init({
      page: "activities",
      breadcrumbs: ["Activities"],
      requiredPermission: "canViewLearners"
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      if (canManage()) {
        el("newActivityButton").classList.remove("d-none");
        el("newActivityButton").addEventListener("click", function () {
          activityModal(null);
        });
      }
      el("activityTableBody").addEventListener("click", function (event) {
        var participants = event.target.closest("[data-participants]");
        if (participants) {
          participantsModal(
            state.activities.find(function (item) {
              return String(item.id) === participants.dataset.participants;
            })
          );
          return;
        }
        var edit = event.target.closest("[data-edit]");
        if (edit) {
          activityModal(
            state.activities.find(function (item) {
              return String(item.id) === edit.dataset.edit;
            })
          );
          return;
        }
        var remove = event.target.closest("[data-remove]");
        if (remove) {
          removeActivity(
            state.activities.find(function (item) {
              return String(item.id) === remove.dataset.remove;
            })
          );
        }
      });
      wireFilters();
      populateSchoolFilter()
        .then(populateYears)
        .then(loadActivities);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
