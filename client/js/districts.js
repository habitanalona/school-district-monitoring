/* School District Monitoring System — district management page */
(function (window, document) {
  "use strict";

  var SERVER_FIELDS = {
    "District name": "districtName",
    "District code": "districtCode",
    "Address": "districtAddress",
    "Contact email": "districtContactEmail",
    "PSDS 1 name": "psdsOneName",
    "PSDS 1 email": "psdsOneEmail",
    "PSDS 1 phone": "psdsOnePhone",
    "PSDS 2 name": "psdsTwoName",
    "PSDS 2 email": "psdsTwoEmail",
    "PSDS 2 phone": "psdsTwoPhone"
  };

  var state = {
    session: null,
    districts: [],
    search: "",
    sequence: 0,
    editing: null,
    formModal: null
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

  function optionalValue(id) {
    var node = el(id);
    var value = node ? node.value.trim() : "";
    return value || null;
  }

  function psdsCell(district) {
    if (!district.psds || !district.psds.length) {
      return '<span class="cell-locked"><i class="bi bi-exclamation-triangle" aria-hidden="true"></i> Not assigned</span>';
    }
    return (
      '<div class="psds-cell">' +
      district.psds
        .map(function (supervisor, index) {
          var detail = [supervisor.email, supervisor.phone].filter(Boolean).join(" · ");
          return (
            '<div class="psds-person">' +
            '<span class="psds-index">' + (index + 1) + "</span>" +
            '<div class="psds-person__copy"><strong>' +
            window.UI.escapeHtml(supervisor.name) +
            "</strong><small>" +
            window.UI.escapeHtml(detail || "No contact details") +
            "</small></div></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function districtRow(district) {
    var contact = [
      district.contactEmail
        ? '<span class="cell-time">' + window.UI.escapeHtml(district.contactEmail) + "</span>"
        : '<span class="cell-muted">No email</span>',
      district.address
        ? '<span class="cell-muted">' + window.UI.escapeHtml(district.address) + "</span>"
        : '<span class="cell-muted">No address</span>'
    ].join("");
    return (
      '<tr data-district-id="' + district.id + '">' +
        '<td data-label="District"><div class="district-cell">' +
        '<span class="district-mark"><i class="bi bi-diagram-3" aria-hidden="true"></i></span>' +
        "<div><strong>" + window.UI.escapeHtml(district.name) + "</strong><small>" +
        window.UI.escapeHtml(district.code) + "</small></div></div></td>" +
        '<td data-label="PSDS assignments">' + psdsCell(district) + "</td>" +
        '<td data-label="Schools"><div class="count-cell"><strong>' +
        window.UI.number(district.schoolCount || 0) + "</strong><small>" +
        (Number(district.schoolCount) === 1 ? "school" : "schools") + "</small></div></td>" +
        '<td data-label="Accounts"><div class="count-cell"><strong>' +
        window.UI.number(district.userCount || 0) + "</strong><small>" +
        (Number(district.userCount) === 1 ? "account" : "accounts") + "</small></div></td>" +
        '<td data-label="Office contact"><div class="contact-cell">' + contact + "</div></td>" +
        '<td data-label="Actions" class="cell-actions"><div class="table-actions">' +
        '<button type="button" class="icon-action" data-action="edit" data-id="' + district.id +
        '" title="Edit district" aria-label="Edit ' + window.UI.escapeHtml(district.name) +
        '"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>' +
        '<button type="button" class="icon-action icon-action--danger" data-action="delete" data-id="' + district.id +
        '" title="Delete district" aria-label="Delete ' + window.UI.escapeHtml(district.name) +
        '"><i class="bi bi-trash3" aria-hidden="true"></i></button>' +
        "</div></td>" +
      "</tr>"
    );
  }

  function filteredDistricts() {
    var search = state.search.trim().toLowerCase();
    if (!search) {
      return state.districts;
    }
    return state.districts.filter(function (district) {
      var psds = (district.psds || []).map(function (supervisor) {
        return [supervisor.name, supervisor.email, supervisor.phone].join(" ");
      }).join(" ");
      var haystack = [
        district.name,
        district.code,
        district.address,
        district.contactEmail,
        psds
      ].join(" ").toLowerCase();
      return haystack.indexOf(search) !== -1;
    });
  }

  function renderKpis() {
    var psds = state.districts.reduce(function (total, district) {
      return total + (district.psds ? district.psds.length : 0);
    }, 0);
    var schools = state.districts.reduce(function (total, district) {
      return total + Number(district.schoolCount || 0);
    }, 0);
    setText("districtKpiTotal", window.UI.number(state.districts.length));
    setText("districtKpiPsds", window.UI.number(psds));
    setText("districtKpiSchools", window.UI.number(schools));
  }

  function renderDistricts() {
    var body = el("districtTableBody");
    var meta = el("districtTableMeta");
    if (!body) {
      return;
    }
    body.removeAttribute("aria-busy");
    renderKpis();
    var districts = filteredDistricts();
    if (!districts.length) {
      var filtered = Boolean(state.search);
      body.innerHTML =
        '<tr class="empty-row"><td colspan="6">' +
        window.UI.emptyState({
          icon: filtered ? "bi-search" : "bi-diagram-3",
          title: filtered ? "No matching districts" : "No districts yet",
          message: filtered
            ? "Try a different search term or clear the current filter."
            : "Add the first district under the School Division Office.",
          action: filtered
            ? '<button type="button" class="btn btn-light btn-sm" data-empty-reset>Clear search</button>'
            : '<button type="button" class="btn btn-primary btn-sm" data-empty-add>Add district</button>'
        }) + "</td></tr>";
      if (meta) {
        meta.textContent = filtered
          ? "No districts match “" + state.search + "”"
          : "No districts in the division";
      }
      return;
    }
    body.innerHTML = districts.map(districtRow).join("");
    if (meta) {
      meta.textContent = state.search
        ? districts.length + " of " + state.districts.length +
          (state.districts.length === 1 ? " district" : " districts") + " shown"
        : state.districts.length + (state.districts.length === 1 ? " district" : " districts") +
          " under the School Division Office";
    }
  }

  function loadDistricts() {
    var body = el("districtTableBody");
    if (!body) {
      return;
    }
    var sequence = ++state.sequence;
    body.setAttribute("aria-busy", "true");
    body.innerHTML = window.UI.tableLoading(6, 5);
    setText("districtTableMeta", "Loading districts…");
    return API.get("/districts")
      .then(function (payload) {
        if (sequence !== state.sequence) {
          return;
        }
        state.districts = payload.data || [];
        renderDistricts();
      })
      .catch(function (error) {
        if (sequence !== state.sequence || error.status === 401) {
          return;
        }
        body.removeAttribute("aria-busy");
        body.innerHTML =
          '<tr class="empty-row"><td colspan="6">' +
          window.UI.emptyState({
            icon: "bi-cloud-slash",
            title: "Districts could not be loaded",
            message: error.status === 403
              ? "You do not have permission to manage districts."
              : error.message || "The district directory is temporarily unavailable.",
            action: '<button type="button" class="btn btn-primary btn-sm" id="retryDistricts">Try again</button>'
          }) + "</td></tr>";
        setText("districtTableMeta", "Unavailable");
        var retry = el("retryDistricts");
        if (retry) {
          retry.addEventListener("click", loadDistricts);
        }
      });
  }

  function openForm(district) {
    var form = el("districtForm");
    var modal = state.formModal;
    if (!form || !modal) {
      return;
    }
    state.editing = district || null;
    var editing = Boolean(district);
    var psds = district && district.psds ? district.psds : [];
    form.reset();
    window.UI.clearFieldErrors(form);
    window.UI.hideAlert(el("districtFormAlert"));

    setText("districtFormTitle", editing ? "Edit district" : "Add a district");
    setText("districtFormSubtitle", editing
      ? "Update the district office details and its two PSDS assignments."
      : "Create a district under the School Division Office.");
    var saveLabel = el("districtSaveButton").querySelector("span");
    if (saveLabel) {
      saveLabel.textContent = editing ? "Save changes" : "Create district";
    }

    el("districtName").value = district ? district.name : "";
    el("districtCode").value = district ? district.code : "";
    el("districtAddress").value = district && district.address ? district.address : "";
    el("districtContactEmail").value = district && district.contactEmail ? district.contactEmail : "";
    el("psdsOneName").value = psds[0] ? psds[0].name : "";
    el("psdsOneEmail").value = psds[0] && psds[0].email ? psds[0].email : "";
    el("psdsOnePhone").value = psds[0] && psds[0].phone ? psds[0].phone : "";
    el("psdsTwoName").value = psds[1] ? psds[1].name : "";
    el("psdsTwoEmail").value = psds[1] && psds[1].email ? psds[1].email : "";
    el("psdsTwoPhone").value = psds[1] && psds[1].phone ? psds[1].phone : "";

    modal.show();
    window.setTimeout(function () {
      el("districtName").focus();
    }, 180);
  }

  function showServerError(error) {
    var form = el("districtForm");
    var alertBox = el("districtFormAlert");
    var fieldName = error.details && error.details.field
      ? SERVER_FIELDS[error.details.field] || ""
      : "";
    if (fieldName) {
      var field = form.querySelector('[name="' + fieldName + '"]');
      if (field) {
        field.classList.add("is-invalid");
        var group = field.closest(".form-group");
        var errorNode = group ? group.querySelector(".field-error") : null;
        if (errorNode) {
          errorNode.textContent = error.message;
        }
        field.focus();
        return;
      }
    }
    window.UI.showAlert(
      alertBox,
      "danger",
      error.message || "The district could not be saved.",
      "Unable to save district"
    );
  }

  function submitForm(event) {
    event.preventDefault();
    var form = el("districtForm");
    var alertBox = el("districtFormAlert");
    var saveButton = el("districtSaveButton");
    window.UI.hideAlert(alertBox);

    var rules = [
      { name: "districtName", label: "District name", required: true, minLength: 2, maxLength: 160 },
      {
        name: "districtCode",
        label: "District code",
        required: true,
        minLength: 2,
        maxLength: 24,
        pattern: /^[A-Za-z0-9-]+$/,
        patternMessage: "Use letters, numbers, and hyphens only."
      },
      {
        name: "districtContactEmail",
        label: "Office email",
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        patternMessage: "Enter a valid email address."
      },
      { name: "psdsOneName", label: "PSDS one name", required: true, maxLength: 160 },
      {
        name: "psdsOneEmail",
        label: "PSDS one email",
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        patternMessage: "Enter a valid email address."
      },
      {
        name: "psdsOnePhone",
        label: "PSDS one phone",
        maxLength: 32,
        pattern: /^[0-9+()\-\s.]+$/,
        patternMessage: "Use numbers, spaces, and + ( ) - . only."
      },
      { name: "psdsTwoName", label: "PSDS two name", required: true, maxLength: 160 },
      {
        name: "psdsTwoEmail",
        label: "PSDS two email",
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        patternMessage: "Enter a valid email address."
      },
      {
        name: "psdsTwoPhone",
        label: "PSDS two phone",
        maxLength: 32,
        pattern: /^[0-9+()\-\s.]+$/,
        patternMessage: "Use numbers, spaces, and + ( ) - . only."
      }
    ];
    if (!window.UI.validateForm(form, rules)) {
      return;
    }

    var psdsOneName = el("psdsOneName").value.trim();
    var psdsTwoName = el("psdsTwoName").value.trim();
    if (psdsOneName.toLowerCase() === psdsTwoName.toLowerCase()) {
      window.UI.showAlert(
        alertBox,
        "warning",
        "The two PSDS assignments must be different people.",
        "Check PSDS assignments"
      );
      el("psdsTwoName").focus();
      return;
    }

    var payload = {
      name: el("districtName").value.trim(),
      code: el("districtCode").value.trim().toUpperCase(),
      address: optionalValue("districtAddress"),
      contactEmail: optionalValue("districtContactEmail"),
      psds: [
        {
          name: psdsOneName,
          email: optionalValue("psdsOneEmail"),
          phone: optionalValue("psdsOnePhone")
        },
        {
          name: psdsTwoName,
          email: optionalValue("psdsTwoEmail"),
          phone: optionalValue("psdsTwoPhone")
        }
      ]
    };

    window.UI.setButtonLoading(saveButton, true, state.editing ? "Saving…" : "Creating…");
    var request = state.editing
      ? API.put("/districts/" + state.editing.id, payload)
      : API.post("/districts", payload);

    request
      .then(function (response) {
        window.UI.setButtonLoading(saveButton, false);
        state.formModal.hide();
        window.UI.toast(
          state.editing ? "District updated" : "District created",
          response.data.name + (state.editing
            ? " was updated successfully."
            : " is now part of the School Division Office."),
          "success"
        );
        loadDistricts();
        window.AppShell.refreshSchools();
      })
      .catch(function (error) {
        window.UI.setButtonLoading(saveButton, false);
        showServerError(error);
      });
  }

  function findDistrict(id) {
    return state.districts.find(function (district) {
      return Number(district.id) === Number(id);
    });
  }

  function deleteDistrict(district) {
    window.UI.confirm({
      title: "Delete " + district.name + "?",
      message: "This permanently removes the district from the School Division Office. Districts with schools, accounts, or announcements cannot be deleted.",
      confirmLabel: "Delete district",
      tone: "danger"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      API.delete("/districts/" + district.id)
        .then(function () {
          window.UI.toast("District deleted", district.name + " was removed from the division.", "success");
          loadDistricts();
          window.AppShell.refreshSchools();
        })
        .catch(function (error) {
          window.UI.toast(
            "District could not be deleted",
            error.status === 409
              ? error.message
              : error.message || "The district could not be deleted.",
            "danger"
          );
        });
    });
  }

  function resetFilters() {
    state.search = "";
    el("districtSearch").value = "";
    renderDistricts();
  }

  function bind() {
    el("districtSearch").addEventListener(
      "input",
      window.UI.debounce(function (event) {
        state.search = event.target.value.trim();
        renderDistricts();
      }, 220)
    );
    el("resetDistrictFilters").addEventListener("click", resetFilters);

    el("districtTableBody").addEventListener("click", function (event) {
      var actionButton = event.target.closest("[data-action]");
      if (actionButton) {
        var district = findDistrict(actionButton.dataset.id);
        if (!district) {
          return;
        }
        if (actionButton.dataset.action === "edit") {
          openForm(district);
        } else if (actionButton.dataset.action === "delete") {
          deleteDistrict(district);
        }
        return;
      }
      if (event.target.closest("[data-empty-reset]")) {
        resetFilters();
      }
      if (event.target.closest("[data-empty-add]")) {
        openForm(null);
      }
    });

    el("addDistrictButton").addEventListener("click", function () {
      openForm(null);
    });

    var refresh = el("refreshDistricts");
    refresh.addEventListener("click", function () {
      window.UI.setButtonLoading(refresh, true, "Refreshing…");
      loadDistricts()
        .catch(function () {
          /* Errors are surfaced inside the table. */
        })
        .then(function () {
          window.UI.setButtonLoading(refresh, false);
        });
    });

    el("districtForm").addEventListener("submit", submitForm);
    el("districtFormModal").addEventListener("hidden.bs.modal", function () {
      window.UI.setButtonLoading(el("districtSaveButton"), false);
    });
  }

  function init() {
    state.formModal = new window.bootstrap.Modal(el("districtFormModal"));
    window.AppShell.init({
      page: "districts",
      breadcrumbs: ["Districts"],
      requiredPermission: "canManageDistricts"
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      bind();
      loadDistricts();
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
