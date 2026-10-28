/* School District Monitoring System — district announcements page */
(function (window, document) {
  "use strict";

  var state = {
    session: null,
    districtId: "",
    status: "",
    search: "",
    announcements: [],
    filtered: [],
    sequence: 0,
    editing: null,
    viewing: null,
    canManage: false,
    formModal: null,
    viewModal: null
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

  function districtParams() {
    return state.districtId ? { districtId: state.districtId } : {};
  }

  function audienceLabel(announcement) {
    return announcement.districtName || "All districts";
  }

  function excerpt(content) {
    var text = String(content || "").replace(/\s+/g, " ").trim();
    return text.length > 180 ? text.slice(0, 177).trimEnd() + "…" : text;
  }

  function updateKpis() {
    var all = state.announcements;
    setText("announcementKpiTotal", window.UI.number(all.length));
    setText("announcementKpiPublished", window.UI.number(all.filter(function (item) { return item.status === "published"; }).length));
    setText("announcementKpiDrafts", window.UI.number(all.filter(function (item) { return item.status === "draft"; }).length));
    setText("announcementKpiDistrict", window.UI.number(all.filter(function (item) { return item.districtId; }).length));
  }

  function applyFilters() {
    var search = state.search.toLowerCase();
    state.filtered = state.announcements.filter(function (announcement) {
      if (state.status && announcement.status !== state.status) {
        return false;
      }
      if (!search) {
        return true;
      }
      return (
        String(announcement.title || "").toLowerCase().indexOf(search) !== -1 ||
        String(announcement.content || "").toLowerCase().indexOf(search) !== -1 ||
        String(announcement.createdByName || "").toLowerCase().indexOf(search) !== -1
      );
    });
    render();
  }

  function card(announcement) {
    var date = announcement.publishedAt || announcement.createdAt;
    return (
      '<article class="announcement-card announcement-card--' + window.UI.escapeHtml(announcement.status) + '" data-id="' + announcement.id + '">' +
        '<div class="announcement-card__top">' +
          window.UI.badge("announcement", announcement.status) +
          '<span class="announcement-date"><i class="bi bi-calendar3" aria-hidden="true"></i> ' +
          window.UI.escapeHtml(window.UI.date(date)) + "</span>" +
        "</div>" +
        '<h2 class="announcement-card__title">' + window.UI.escapeHtml(announcement.title) + "</h2>" +
        '<p class="announcement-card__excerpt">' + window.UI.escapeHtml(excerpt(announcement.content)) + "</p>" +
        '<div class="announcement-card__meta">' +
          '<span><i class="bi bi-person" aria-hidden="true"></i> ' + window.UI.escapeHtml(announcement.createdByName || "District office") + "</span>" +
          '<span><i class="bi bi-geo-alt" aria-hidden="true"></i> ' + window.UI.escapeHtml(audienceLabel(announcement)) + "</span>" +
        "</div>" +
        '<div class="announcement-card__actions">' +
          '<button type="button" class="btn btn-light btn-sm" data-action="view" data-id="' + announcement.id + '">Read notice</button>' +
          (state.canManage
            ? '<button type="button" class="icon-action" data-action="edit" data-id="' + announcement.id +
              '" title="Edit announcement" aria-label="Edit ' + window.UI.escapeHtml(announcement.title) +
              '"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>'
            : "") +
        "</div>" +
      "</article>"
    );
  }

  function render() {
    var grid = el("announcementGrid");
    if (!grid) {
      return;
    }
    if (!state.filtered.length) {
      var filtered = Boolean(state.search || state.status);
      grid.innerHTML = window.UI.emptyState({
        icon: filtered ? "bi-search" : "bi-megaphone",
        title: filtered ? "No matching announcements" : "No announcements yet",
        message: filtered
          ? "Try a different search term or clear the current filters."
          : state.canManage
            ? "Publish a notice to keep district schools informed."
            : "There are no published notices in your district right now.",
        action: filtered
          ? '<button type="button" class="btn btn-light btn-sm" id="clearAnnouncementFilters">Clear filters</button>'
          : state.canManage
            ? '<button type="button" class="btn btn-primary btn-sm" id="emptyNewAnnouncement">Create an announcement</button>'
            : ""
      });
      var clear = el("clearAnnouncementFilters");
      if (clear) {
        clear.addEventListener("click", resetFilters);
      }
      var create = el("emptyNewAnnouncement");
      if (create) {
        create.addEventListener("click", function () {
          openForm(null);
        });
      }
      return;
    }
    grid.innerHTML = state.filtered.map(card).join("");
  }

  function loadAnnouncements() {
    var grid = el("announcementGrid");
    if (!grid) {
      return;
    }
    var sequence = ++state.sequence;
    grid.innerHTML =
      '<article class="announcement-card announcement-skeleton" aria-hidden="true">' +
      '<span class="skeleton skeleton-text" style="width:28%"></span>' +
      '<span class="skeleton skeleton-text" style="width:76%;height:18px"></span>' +
      '<span class="skeleton skeleton-text" style="width:100%"></span>' +
      '<span class="skeleton skeleton-text" style="width:88%"></span></article>' +
      '<article class="announcement-card announcement-skeleton" aria-hidden="true">' +
      '<span class="skeleton skeleton-text" style="width:32%"></span>' +
      '<span class="skeleton skeleton-text" style="width:64%;height:18px"></span>' +
      '<span class="skeleton skeleton-text" style="width:96%"></span>' +
      '<span class="skeleton skeleton-text" style="width:72%"></span></article>';
    API.get("/announcements", districtParams())
      .then(function (payload) {
        if (sequence !== state.sequence) {
          return;
        }
        state.announcements = payload.data || [];
        updateKpis();
        applyFilters();
      })
      .catch(function (error) {
        if (sequence !== state.sequence || error.status === 401) {
          return;
        }
        grid.innerHTML = window.UI.emptyState({
          icon: "bi-cloud-slash",
          title: "Announcements could not be loaded",
          message: error.message || "The announcement feed is temporarily unavailable.",
          action: '<button type="button" class="btn btn-primary btn-sm" id="retryAnnouncements">Try again</button>'
        });
        var retry = el("retryAnnouncements");
        if (retry) {
          retry.addEventListener("click", loadAnnouncements);
        }
      });
  }

  function openView(announcement) {
    state.viewing = announcement;
    setText("announcementViewEyebrow", audienceLabel(announcement) + " · " +
      (announcement.publishedAt ? "Published " + window.UI.date(announcement.publishedAt) : "Created " + window.UI.date(announcement.createdAt)));
    setText("announcementViewTitle", announcement.title);
    el("announcementViewMeta").innerHTML =
      window.UI.badge("announcement", announcement.status) +
      '<span><i class="bi bi-person" aria-hidden="true"></i> ' + window.UI.escapeHtml(announcement.createdByName || "District office") + "</span>" +
      '<span><i class="bi bi-geo-alt" aria-hidden="true"></i> ' + window.UI.escapeHtml(audienceLabel(announcement)) + "</span>" +
      '<span><i class="bi bi-clock-history" aria-hidden="true"></i> Updated ' + window.UI.escapeHtml(window.UI.dateTime(announcement.updatedAt)) + "</span>";
    el("announcementViewBody").textContent = announcement.content;
    el("announcementViewEdit").classList.toggle("d-none", !state.canManage);
    state.viewModal.show();
  }

  function districtOptions(selectedId) {
    return '<option value="">All districts (system-wide)</option>' +
      (state.session.districts || []).map(function (district) {
        return '<option value="' + district.id + '"' +
          (String(district.id) === String(selectedId) ? " selected" : "") +
          ">" + window.UI.escapeHtml(district.name) + " (" + window.UI.escapeHtml(district.code) + ")</option>";
      }).join("");
  }

  function openForm(announcement) {
    var form = el("announcementForm");
    if (!form) {
      return;
    }
    state.editing = announcement || null;
    var editing = Boolean(announcement);
    form.reset();
    window.UI.clearFieldErrors(form);
    window.UI.hideAlert(el("announcementFormAlert"));
    setText("announcementFormTitle", editing ? "Edit announcement" : "New announcement");
    setText("announcementFormSubtitle", editing
      ? "Update the notice content, audience, or publication status."
      : "Share a notice with district schools and staff.");

    el("announcementTitle").value = editing ? announcement.title : "";
    el("announcementContent").value = editing ? announcement.content : "";
    el("announcementStatus").value = editing ? announcement.status : "draft";
    setText("announcementCount", String(el("announcementContent").value.length));

    var group = el("announcementDistrictGroup");
    var select = el("announcementDistrict");
    if (state.session.permissions.canSelectDistrict) {
      group.classList.remove("d-none");
      select.innerHTML = districtOptions(editing ? announcement.districtId : "");
    } else {
      group.classList.add("d-none");
      select.innerHTML = "";
    }

    var saveLabel = el("announcementSaveButton").querySelector("span");
    if (saveLabel) {
      saveLabel.textContent = editing ? "Save changes" : "Save announcement";
    }
    state.formModal.show();
    window.setTimeout(function () {
      el("announcementTitle").focus();
    }, 180);
  }

  function submitForm(event) {
    event.preventDefault();
    var form = el("announcementForm");
    var alertBox = el("announcementFormAlert");
    var saveButton = el("announcementSaveButton");
    window.UI.hideAlert(alertBox);

    var valid = window.UI.validateForm(form, [
      { name: "title", label: "Title", required: true, minLength: 3, maxLength: 200 },
      { name: "content", label: "Content", required: true, minLength: 10, maxLength: 5000 },
      { name: "status", label: "Status", required: true }
    ]);
    if (!valid) {
      return;
    }

    var payload = {
      title: el("announcementTitle").value.trim(),
      content: el("announcementContent").value.trim(),
      status: el("announcementStatus").value
    };
    if (state.session.permissions.canSelectDistrict) {
      var districtValue = el("announcementDistrict").value;
      payload.districtId = districtValue ? Number(districtValue) : null;
    }

    var editing = state.editing;
    window.UI.setButtonLoading(saveButton, true, editing ? "Saving…" : "Publishing…");
    var request = editing
      ? API.put("/announcements/" + editing.id, payload)
      : API.post("/announcements", payload);

    request
      .then(function (response) {
        window.UI.setButtonLoading(saveButton, false);
        state.formModal.hide();
        window.UI.toast(
          editing ? "Announcement updated" : "Announcement saved",
          response.data.title + " · " + window.UI.ANNOUNCEMENT_STATUS[response.data.status].label + ".",
          "success"
        );
        loadAnnouncements();
      })
      .catch(function (error) {
        window.UI.setButtonLoading(saveButton, false);
        if (!window.UI.showFieldErrors(form, error)) {
          window.UI.showAlert(alertBox, "danger", error.message || "The announcement could not be saved.", "Unable to save announcement");
        }
      });
  }

  function findAnnouncement(id) {
    return state.announcements.find(function (announcement) {
      return Number(announcement.id) === Number(id);
    });
  }

  function resetFilters() {
    state.search = "";
    state.status = "";
    el("announcementSearch").value = "";
    el("announcementStatusFilter").value = "";
    applyFilters();
  }

  function bind() {
    el("announcementGrid").addEventListener("click", function (event) {
      var button = event.target.closest("[data-action]");
      if (!button) {
        return;
      }
      var announcement = findAnnouncement(button.dataset.id);
      if (!announcement) {
        return;
      }
      if (button.dataset.action === "view") {
        openView(announcement);
      } else if (button.dataset.action === "edit" && state.canManage) {
        openForm(announcement);
      }
    });
    el("announcementSearch").addEventListener(
      "input",
      window.UI.debounce(function (event) {
        state.search = event.target.value.trim();
        applyFilters();
      }, 200)
    );
    el("announcementStatusFilter").addEventListener("change", function (event) {
      state.status = event.target.value;
      applyFilters();
    });
    el("resetAnnouncementFilters").addEventListener("click", resetFilters);
    el("newAnnouncementButton").addEventListener("click", function () {
      openForm(null);
    });
    el("announcementContent").addEventListener("input", function (event) {
      setText("announcementCount", String(event.target.value.length));
    });
    el("announcementForm").addEventListener("submit", submitForm);
    el("announcementViewEdit").addEventListener("click", function () {
      var announcement = state.viewing;
      if (!announcement) {
        return;
      }
      state.viewModal.hide();
      window.setTimeout(function () {
        openForm(announcement);
      }, 180);
    });
    el("announcementFormModal").addEventListener("hidden.bs.modal", function () {
      window.UI.setButtonLoading(el("announcementSaveButton"), false);
    });
  }

  function populateDistrictFilter() {
    var control = el("announcementDistrictControl");
    var select = el("announcementDistrictFilter");
    if (!state.session.permissions.canSelectDistrict || !control || !select) {
      return;
    }
    select.innerHTML = '<option value="">All districts</option>' +
      (state.session.districts || []).map(function (district) {
        return '<option value="' + district.id + '">' +
          window.UI.escapeHtml(district.name) + " (" + window.UI.escapeHtml(district.code) + ")</option>";
      }).join("");
    control.classList.remove("d-none");
    select.addEventListener("change", function () {
      state.districtId = select.value;
      loadAnnouncements();
    });
  }

  function init() {
    state.formModal = new window.bootstrap.Modal(el("announcementFormModal"));
    state.viewModal = new window.bootstrap.Modal(el("announcementViewModal"));
    window.AppShell.init({
      page: "announcements",
      breadcrumbs: ["Announcements"]
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      state.canManage = Boolean(session.permissions.canManageAnnouncements);
      if (state.canManage) {
        el("newAnnouncementButton").classList.remove("d-none");
      } else {
        el("announcementStatusFilter").closest(".custom-select").classList.add("d-none");
        el("announcementDraftCard").classList.add("d-none");
        el("announcementKpis").classList.add("kpi-grid--three");
      }
      populateDistrictFilter();
      bind();
      loadAnnouncements();
      var footer = el("footerUpdated");
      if (footer) {
        footer.textContent = "Data refreshed " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
