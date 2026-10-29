/* School District Monitoring System — user rights and permissions page */
(function (window, document) {
  "use strict";

  var ACTIONS = ["access", "add", "edit", "delete"];
  var ACTION_LABELS = { access: "Access", add: "Add", edit: "Edit", delete: "Delete" };

  var state = {
    session: null,
    catalog: null,
    page: 1,
    pageSize: 12,
    filters: { search: "", role: "", schoolId: "", status: "" },
    users: [],
    pagination: null,
    listSequence: 0,
    detailSequence: 0,
    selectedId: null,
    detail: null,
    baseline: null,
    draft: null,
    loadingDetail: false,
    saving: false
  };

  function el(id) {
    return document.getElementById(id);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function escape(value) {
    return window.UI.escapeHtml(value);
  }

  function findModule(key) {
    return (state.catalog && state.catalog.modules || []).filter(function (module) {
      return module.key === key;
    })[0];
  }

  function roleLabel(role) {
    var roles = (state.catalog && state.catalog.roles) || [];
    var match = roles.filter(function (entry) {
      return entry.value === role;
    })[0];
    if (match) {
      return match.fullLabel || match.label;
    }
    var meta = window.UI.ROLE[role];
    return meta ? meta.label : window.UI.titleCase(role || "");
  }

  function roleTone(role) {
    var meta = window.UI.ROLE[role];
    return meta ? meta.tone : "neutral";
  }

  function canEditTarget() {
    return Boolean(
      state.detail &&
        state.session &&
        state.session.user.role === "system_admin" &&
        state.detail.user.role !== "system_admin" &&
        Number(state.detail.user.id) !== Number(state.session.user.id)
    );
  }

  function isGrantable(module, action) {
    if (!module || module.actions.indexOf(action) === -1 || !state.detail) {
      return false;
    }
    var roles = module.grantRoles[action] || [];
    return roles.indexOf(state.detail.user.role) !== -1;
  }

  function normalizeDraft() {
    (state.catalog.modules || []).forEach(function (module) {
      var entry = state.draft[module.key] || {};
      var normalized = { access: false, add: false, edit: false, delete: false };
      ACTIONS.forEach(function (action) {
        var supported = module.actions.indexOf(action) !== -1;
        var grantable = supported && (module.grantRoles[action] || []).indexOf(state.detail.user.role) !== -1;
        normalized[action] = Boolean(entry[action]) && grantable;
      });
      if (!normalized.access) {
        normalized.add = false;
        normalized.edit = false;
        normalized.delete = false;
      }
      state.draft[module.key] = normalized;
    });
  }

  function isDirty() {
    if (!state.draft || !state.baseline) {
      return false;
    }
    return JSON.stringify(state.draft) !== JSON.stringify(state.baseline);
  }

  function changeStats() {
    var changeCount = 0;
    var moduleCount = 0;
    if (!state.draft || !state.baseline) {
      return { changes: 0, modules: 0 };
    }
    (state.catalog.modules || []).forEach(function (module) {
      var before = state.baseline[module.key] || {};
      var after = state.draft[module.key] || {};
      var changed = false;
      ACTIONS.forEach(function (action) {
        if (Boolean(before[action]) !== Boolean(after[action])) {
          changeCount += 1;
          changed = true;
        }
      });
      if (changed) {
        moduleCount += 1;
      }
    });
    return { changes: changeCount, modules: moduleCount };
  }

  function showPageAlert(type, message, title) {
    window.UI.showAlert(el("rightsPageAlert"), type, message, title);
  }

  function hidePageAlert() {
    window.UI.hideAlert(el("rightsPageAlert"));
  }

  function showEditorAlert(type, message, title) {
    window.UI.showAlert(el("rightsEditorAlert"), type, message, title);
  }

  function hideEditorAlert() {
    window.UI.hideAlert(el("rightsEditorAlert"));
  }

  function selectedUser() {
    return state.detail ? state.detail.user : null;
  }

  /* ---------------------------------------------------------------- catalog */

  function loadCatalog() {
    return API.get("/user-rights/catalog")
      .then(function (payload) {
        state.catalog = payload.data;
        populateFilters();
        return loadUsers(true);
      })
      .catch(function (error) {
        showPageAlert("danger", error.message || "The permission catalog could not be loaded.", "Unable to start");
        var list = el("rightsUserList");
        if (list) {
          list.innerHTML = window.UI.emptyState({
            icon: "bi-shield-exclamation",
            title: "Permission controls unavailable",
            message: "Refresh the page or contact another system administrator."
          });
        }
      });
  }

  function populateFilters() {
    var roleSelect = el("rightsRoleFilter");
    var schoolSelect = el("rightsSchoolFilter");
    if (roleSelect) {
      roleSelect.innerHTML =
        '<option value="">All roles</option>' +
        (state.catalog.roles || [])
          .map(function (role) {
            return '<option value="' + escape(role.value) + '">' + escape(role.fullLabel || role.label) + "</option>";
          })
          .join("");
    }
    if (schoolSelect) {
      var groups = {};
      (state.catalog.schools || []).forEach(function (school) {
        if (!groups[school.districtName]) {
          groups[school.districtName] = [];
        }
        groups[school.districtName].push(school);
      });
      var markup = '<option value="">All schools</option>';
      Object.keys(groups).sort().forEach(function (districtName) {
        markup += '<optgroup label="' + escape(districtName) + '">';
        groups[districtName].forEach(function (school) {
          markup += '<option value="' + school.id + '">' + escape(school.name) + "</option>";
        });
        markup += "</optgroup>";
      });
      schoolSelect.innerHTML = markup;
    }
  }

  /* ------------------------------------------------------------------ users */

  function listParams() {
    return {
      page: state.page,
      pageSize: state.pageSize,
      search: state.filters.search,
      role: state.filters.role,
      schoolId: state.filters.schoolId,
      status: state.filters.status
    };
  }

  function loadUsers(resetPage) {
    if (resetPage) {
      state.page = 1;
    }
    var sequence = ++state.listSequence;
    API.get("/user-rights/users", listParams())
      .then(function (payload) {
        if (sequence !== state.listSequence) {
          return;
        }
        state.users = payload.data || [];
        state.pagination = payload.pagination || null;
        renderSummary(payload.summary);
        renderUserList();
        renderPagination();
      })
      .catch(function (error) {
        if (sequence !== state.listSequence) {
          return;
        }
        showPageAlert("danger", error.message || "Accounts could not be loaded.", "Directory unavailable");
        var list = el("rightsUserList");
        if (list) {
          list.innerHTML = window.UI.emptyState({
            icon: "bi-cloud-slash",
            title: "Accounts could not be loaded",
            message: "Check your connection and try again."
          });
        }
        setText("rightsListMeta", "Unable to load accounts");
      });
  }

  function renderSummary(summary) {
    if (!summary) {
      return;
    }
    setText("rightsKpiTotal", window.UI.number(summary.total));
    setText("rightsKpiActive", window.UI.number(summary.active));
    setText("rightsKpiCustom", window.UI.number(summary.custom));
  }

  function setText(id, value) {
    var node = el(id);
    if (node) {
      node.textContent = value;
    }
  }

  function renderUserList() {
    var list = el("rightsUserList");
    if (!list) {
      return;
    }
    if (!state.users.length) {
      list.innerHTML = window.UI.emptyState({
        icon: "bi-person-x",
        title: "No matching accounts",
        message: "Try a different search term or clear the filters."
      });
    } else {
      list.innerHTML = state.users
        .map(function (user) {
          var selected = Number(user.id) === Number(state.selectedId);
          var custom = Number(user.overrideCount) > 0;
          return (
            '<div class="rights-user-item" role="listitem">' +
            '<button type="button" class="rights-user' +
            (selected ? " is-selected" : "") +
            '" data-user-id="' + user.id + '"' +
            (selected ? ' aria-current="true"' : "") +
            ">" +
            window.UI.avatarMarkup(user, "avatar--sm", "Profile photo for " + user.fullName) +
            '<span class="rights-user__copy">' +
            "<strong>" + escape(user.fullName) + "</strong>" +
            '<small>@' + escape(user.username) + "</small>" +
            '<small class="rights-user__place">' +
            escape(user.schoolName || user.districtName || "No school assigned") +
            "</small>" +
            "</span>" +
            '<span class="rights-user__side">' +
            window.UI.pillarBadge(roleLabel(user.role), roleTone(user.role)) +
            (custom
              ? '<span class="rights-user__flag"><i class="bi bi-sliders2" aria-hidden="true"></i> Custom</span>'
              : '<span class="rights-user__flag rights-user__flag--muted"><i class="bi bi-diagram-3" aria-hidden="true"></i> Role defaults</span>') +
            "</span>" +
            "</button></div>"
          );
        })
        .join("");
    }

    var pagination = state.pagination || {};
    setText(
      "rightsListMeta",
      window.UI.number(pagination.total || 0) +
        " account" +
        (Number(pagination.total) === 1 ? "" : "s") +
        (state.filters.search || state.filters.role || state.filters.schoolId || state.filters.status
          ? " matching filters"
          : "")
    );
  }

  function renderPagination() {
    var container = el("rightsPagination");
    if (!container || !state.pagination) {
      return;
    }
    window.UI.pagination(container, state.pagination, function (page) {
      state.page = page;
      loadUsers();
    });
  }

  /* ------------------------------------------------------------------ detail */

  function selectUser(userId) {
    if (Number(userId) === Number(state.selectedId)) {
      return;
    }
    var proceed = function () {
      state.selectedId = Number(userId);
      renderUserList();
      loadDetail(state.selectedId);
    };
    if (isDirty()) {
      window.UI
        .confirm({
          title: "Discard unsaved changes?",
          message: "Switching accounts will discard the permission changes you have not saved yet.",
          confirmLabel: "Discard and switch",
          tone: "danger"
        })
        .then(function (confirmed) {
          if (confirmed) {
            proceed();
          }
        });
      return;
    }
    proceed();
  }

  function loadDetail(userId) {
    var sequence = ++state.detailSequence;
    state.loadingDetail = true;
    state.detail = null;
    state.baseline = null;
    state.draft = null;
    renderEditorLoading();
    API.get("/user-rights/users/" + userId)
      .then(function (payload) {
        if (sequence !== state.detailSequence) {
          return;
        }
        state.loadingDetail = false;
        state.detail = payload.data;
        state.baseline = clone(payload.data.permissions);
        state.draft = clone(payload.data.permissions);
        normalizeDraft();
        renderEditor();
        loadHistory(userId);
      })
      .catch(function (error) {
        if (sequence !== state.detailSequence) {
          return;
        }
        state.loadingDetail = false;
        var editor = el("rightsEditor");
        if (editor) {
          editor.innerHTML =
            '<div class="rights-editor__empty">' +
            '<span class="rights-editor__empty-icon"><i class="bi bi-shield-exclamation" aria-hidden="true"></i></span>' +
            "<h2>This account could not be opened</h2>" +
            "<p>" + escape(error.message || "The permission detail could not be loaded.") + "</p>" +
            '<button type="button" class="btn btn-light" data-retry-detail="' + userId + '">' +
            '<i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Try again</button>' +
            "</div>";
        }
      });
  }

  function renderEditorLoading() {
    var editor = el("rightsEditor");
    if (!editor) {
      return;
    }
    editor.innerHTML =
      '<div class="rights-editor__loading">' +
      '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span>' +
      "<p>Loading effective permissions…</p>" +
      "</div>";
  }

  function renderEditor() {
    var editor = el("rightsEditor");
    if (!editor || !state.detail) {
      return;
    }
    var user = state.detail.user;
    var editable = canEditTarget();
    var overrides = Object.keys(state.detail.overrides || {}).length;
    var lastChange = state.detail.lastChange;

    var notice = "";
    if (user.role === "system_admin") {
      notice =
        '<div class="rights-notice rights-notice--info"><i class="bi bi-shield-check" aria-hidden="true"></i>' +
        "<div><strong>Fixed full access</strong><span>System administrator rights are permanent and cannot be reduced here. This protects the last line of administration for the district.</span></div></div>";
    } else if (!editable) {
      notice =
        '<div class="rights-notice rights-notice--warning"><i class="bi bi-lock" aria-hidden="true"></i>' +
        "<div><strong>Read-only view</strong><span>You cannot change your own account's permissions. Ask another system administrator to review them.</span></div></div>";
    } else if (lastChange) {
      notice =
        '<div class="rights-notice rights-notice--muted"><i class="bi bi-clock-history" aria-hidden="true"></i>' +
        "<div><strong>Last change</strong><span>" +
        escape(lastChange.actorName || "A system administrator") +
        " updated these rights on " +
        escape(window.UI.dateTime(lastChange.at)) +
        ".</span></div></div>";
    } else {
      notice =
        '<div class="rights-notice rights-notice--muted"><i class="bi bi-diagram-3" aria-hidden="true"></i>' +
        "<div><strong>Following role defaults</strong><span>No individual exceptions have been recorded. The role policy applies until you save a change.</span></div></div>";
    }

    editor.innerHTML =
      '<div class="rights-editor__head">' +
      '<div class="rights-person">' +
      window.UI.avatarMarkup(user, "avatar--lg", "Profile photo for " + user.fullName) +
      "<div>" +
      "<h2>" + escape(user.fullName) + "</h2>" +
      '<p class="rights-person__meta">@' + escape(user.username) + " · " + escape(user.email) + "</p>" +
      '<div class="rights-person__badges">' +
      window.UI.pillarBadge(roleLabel(user.role), roleTone(user.role)) +
      window.UI.pillarBadge(user.isActive ? "Active" : "Inactive", user.isActive ? "success" : "neutral") +
      '<span class="rights-person__place"><i class="bi bi-geo-alt" aria-hidden="true"></i> ' +
      escape(user.schoolName || user.districtName || "No school assigned") +
      "</span>" +
      (overrides
        ? '<span class="rights-person__place"><i class="bi bi-sliders2" aria-hidden="true"></i> ' +
          overrides + " individual exception" + (overrides === 1 ? "" : "s") + "</span>"
        : "") +
      "</div></div></div>" +
      '<span class="rights-dirty" id="rightsDirtyChip" aria-live="polite"></span>' +
      "</div>" +
      '<div id="rightsEditorAlert" class="d-none mb-3" role="alert"></div>' +
      notice +
      '<div class="rights-toolbar">' +
      '<p><i class="bi bi-info-circle" aria-hidden="true"></i> Access must be enabled before Add, Edit, or Delete can be granted. Unchecked operations are cleared automatically.</p>' +
      (editable
        ? '<div class="rights-toolbar__actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" data-scope="all" data-mode="grant" data-action="grant-all">' +
          '<i class="bi bi-check2-square" aria-hidden="true"></i> Grant all available</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-scope="all" data-mode="clear" data-action="clear-all">' +
          '<i class="bi bi-x-square" aria-hidden="true"></i> Clear all</button>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-use-defaults="true">' +
          '<i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i> Role defaults</button>' +
          "</div>"
        : "") +
      "</div>" +
      '<div class="rights-groups" id="rightsGroups">' +
      renderGroups(editable) +
      "</div>" +
      '<div class="rights-savebar">' +
      '<p id="rightsChangeSummary">No unsaved changes</p>' +
      '<div class="rights-savebar__actions">' +
      '<button type="button" class="btn btn-light" id="rightsReset" disabled>Cancel</button>' +
      '<button type="button" class="btn btn-primary" id="rightsSave" disabled>' +
      '<i class="bi bi-check2" aria-hidden="true"></i> <span>Save changes</span></button>' +
      "</div></div>" +
      '<section class="rights-history" aria-labelledby="rightsHistoryHeading">' +
      '<header><div><h3 id="rightsHistoryHeading">Permission change history</h3>' +
      "<p>Newest first. Only system administrators can see this audit trail.</p></div>" +
      '<span class="rights-history__count" id="rightsHistoryCount"></span></header>' +
      '<div id="rightsHistoryList"><p class="rights-history__loading"><span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Loading history…</p></div>' +
      "</section>";

    updateDirtyState();
  }

  function renderGroups(editable) {
    var groups = [];
    var index = {};
    (state.catalog.modules || []).forEach(function (module) {
      if (!index[module.group]) {
        index[module.group] = groups.length;
        groups.push({ name: module.group, modules: [] });
      }
      groups[index[module.group]].modules.push(module);
    });

    return groups
      .map(function (group) {
        var rows = group.modules.map(function (module) {
          return renderModuleRow(module, editable);
        }).join("");
        return (
          '<section class="rights-group" data-group="' + escape(group.name) + '">' +
          '<header class="rights-group__head">' +
          '<div><h3>' + escape(group.name) + "</h3><p>" +
          group.modules.length + " module" + (group.modules.length === 1 ? "" : "s") +
          "</p></div>" +
          (editable
            ? '<div class="rights-group__actions">' +
              '<button type="button" class="btn btn-ghost btn-xs" data-scope="' + escape(group.name) + '" data-mode="grant">Grant all</button>' +
              '<button type="button" class="btn btn-ghost btn-xs" data-scope="' + escape(group.name) + '" data-mode="clear">Clear</button>' +
              "</div>"
            : "") +
          "</header>" +
          '<div class="rights-matrix-wrap"><table class="rights-matrix">' +
          '<caption class="sr-only">' + escape(group.name) + " permissions</caption>" +
          "<thead><tr><th scope=\"col\">Module</th>" +
          '<th scope="col">Access</th><th scope="col">Add</th><th scope="col">Edit</th><th scope="col">Delete</th>' +
          "</tr></thead><tbody>" + rows + "</tbody></table></div>" +
          "</section>"
        );
      })
      .join("");
  }

  function renderModuleRow(module, editable) {
    var entry = state.draft[module.key] || {};
    var cells = ACTIONS.map(function (action) {
      if (module.actions.indexOf(action) === -1) {
        return '<td><span class="perm-na" title="This module does not support ' + ACTION_LABELS[action].toLowerCase() + '">—</span></td>';
      }
      var grantable = isGrantable(module, action);
      var disabled = !editable || !grantable || (action !== "access" && !entry.access);
      var id = "perm-" + module.key + "-" + action;
      var title = !grantable
        ? ACTION_LABELS[action] + " is not available for the " + roleLabel(state.detail.user.role) + " role"
        : ACTION_LABELS[action] + " permission for " + module.label;
      return (
        '<td><div class="perm-check">' +
        '<input type="checkbox" id="' + id + '" data-module="' + escape(module.key) + '" data-action="' + action + '"' +
        (entry[action] ? " checked" : "") +
        (disabled ? " disabled" : "") +
        ' aria-label="' + escape(module.label + " – " + ACTION_LABELS[action]) + '" title="' + escape(title) + '">' +
        "</div></td>"
      );
    }).join("");

    return (
      '<tr data-module="' + escape(module.key) + '">' +
      '<th scope="row"><strong>' + escape(module.label) + "</strong>" +
      (module.description ? "<small>" + escape(module.description) + "</small>" : "") +
      "</th>" + cells + "</tr>"
    );
  }

  function refreshModuleRow(moduleKey) {
    var row = document.querySelector('#rightsGroups tr[data-module="' + moduleKey + '"]');
    if (!row) {
      return;
    }
    var module = findModule(moduleKey);
    var entry = state.draft[moduleKey];
    row.querySelectorAll("input[data-action]").forEach(function (input) {
      var action = input.dataset.action;
      input.checked = Boolean(entry[action]);
      input.disabled =
        !canEditTarget() ||
        !isGrantable(module, action) ||
        (action !== "access" && !entry.access);
    });
  }

  function updateDirtyState() {
    var stats = changeStats();
    var dirty = isDirty();
    var chip = el("rightsDirtyChip");
    var summary = el("rightsChangeSummary");
    var save = el("rightsSave");
    var reset = el("rightsReset");

    if (chip) {
      chip.className = "rights-dirty" + (dirty ? " is-dirty" : "");
      chip.innerHTML = dirty
        ? '<i class="bi bi-exclamation-circle" aria-hidden="true"></i> Unsaved changes'
        : '<i class="bi bi-check2-circle" aria-hidden="true"></i> All changes saved';
    }
    if (summary) {
      summary.textContent = dirty
        ? stats.changes + " change" + (stats.changes === 1 ? "" : "s") + " across " + stats.modules + " module" + (stats.modules === 1 ? "" : "s")
        : "No unsaved changes";
    }
    if (save) {
      save.disabled = !dirty || !canEditTarget() || state.saving;
    }
    if (reset) {
      reset.disabled = !dirty || state.saving;
    }
  }

  /* ---------------------------------------------------------------- history */

  function loadHistory(userId) {
    var list = el("rightsHistoryList");
    if (list) {
      list.innerHTML =
        '<p class="rights-history__loading"><span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Loading history…</p>';
    }
    API.get("/user-rights/users/" + userId + "/history")
      .then(function (payload) {
        if (Number(state.selectedId) !== Number(userId)) {
          return;
        }
        renderHistory(payload.data || []);
      })
      .catch(function () {
        if (Number(state.selectedId) !== Number(userId)) {
          return;
        }
        renderHistory(null);
      });
  }

  function renderHistory(rows) {
    var list = el("rightsHistoryList");
    var count = el("rightsHistoryCount");
    if (!list) {
      return;
    }
    if (!rows) {
      if (count) {
        count.textContent = "";
      }
      list.innerHTML = '<p class="rights-history__empty">The history could not be loaded. Refresh the page to try again.</p>';
      return;
    }
    if (count) {
      count.textContent = rows.length + " record" + (rows.length === 1 ? "" : "s");
    }
    if (!rows.length) {
      list.innerHTML =
        '<p class="rights-history__empty"><i class="bi bi-journal-text" aria-hidden="true"></i> No permission changes have been recorded for this account yet.</p>';
      return;
    }
    list.innerHTML = rows
      .map(function (entry) {
        var changes = entry.changes || [];
        var lines = changes
          .map(function (change) {
            return (
              '<li><span class="rights-history__verb rights-history__verb--' +
              (change.to ? "grant" : "revoke") +
              '">' + (change.to ? "Granted" : "Revoked") + "</span>" +
              "<span>" + escape(change.label || findModule(change.module) && findModule(change.module).label || change.module) + "</span>" +
              '<span class="rights-history__action">' + escape(ACTION_LABELS[change.action] || change.action) + "</span></li>"
            );
          })
          .join("");
        return (
          '<details class="rights-history__item">' +
          "<summary>" +
          '<span class="rights-history__dot" aria-hidden="true"></span>' +
          "<span class=\"rights-history__who\"><strong>" + escape(entry.actorName || entry.actorUsername || "System administrator") + "</strong>" +
          "<small>" + escape(window.UI.dateTime(entry.createdAt)) + "</small></span>" +
          '<span class="rights-history__badge">' + changes.length + " change" + (changes.length === 1 ? "" : "s") + "</span>" +
          '<i class="bi bi-chevron-down rights-history__chevron" aria-hidden="true"></i>' +
          "</summary>" +
          '<ul class="rights-history__changes">' + lines + "</ul>" +
          "</details>"
        );
      })
      .join("");
  }

  /* ----------------------------------------------------------------- actions */

  function grantScope(scope, mode) {
    if (!canEditTarget()) {
      return;
    }
    (state.catalog.modules || []).forEach(function (module) {
      if (scope !== "all" && module.group !== scope) {
        return;
      }
      if (mode === "clear") {
        state.draft[module.key] = { access: false, add: false, edit: false, delete: false };
        return;
      }
      var entry = { access: false, add: false, edit: false, delete: false };
      ACTIONS.forEach(function (action) {
        entry[action] = isGrantable(module, action);
      });
      if (!entry.access) {
        entry.add = false;
        entry.edit = false;
        entry.delete = false;
      }
      state.draft[module.key] = entry;
    });
    var groups = el("rightsGroups");
    if (groups) {
      groups.innerHTML = renderGroups(canEditTarget());
    }
    updateDirtyState();
  }

  function useRoleDefaults() {
    if (!canEditTarget() || !state.detail || !state.detail.roleDefaults) {
      return;
    }
    state.draft = clone(state.detail.roleDefaults);
    normalizeDraft();
    var groups = el("rightsGroups");
    if (groups) {
      groups.innerHTML = renderGroups(canEditTarget());
    }
    updateDirtyState();
  }

  function resetDraft() {
    if (!isDirty() || state.saving) {
      return;
    }
    state.draft = clone(state.baseline);
    renderEditor();
    window.UI.toast("Changes discarded", "The saved permissions are shown again.", "info");
  }

  function savePermissions() {
    if (!canEditTarget() || state.saving || !isDirty()) {
      return;
    }
    var stats = changeStats();
    if (!stats.changes) {
      updateDirtyState();
      return;
    }
    var user = selectedUser();
    window.UI
      .confirm({
        title: "Save permission changes?",
        message:
          "This will update " + stats.changes + " right" + (stats.changes === 1 ? "" : "s") +
          " across " + stats.modules + " module" + (stats.modules === 1 ? "" : "s") +
          " for " + user.fullName + ". The change takes effect on their next request.",
        confirmLabel: "Save changes",
        tone: "primary"
      })
      .then(function (confirmed) {
        if (!confirmed) {
          return;
        }
        state.saving = true;
        var button = el("rightsSave");
        window.UI.setButtonLoading(button, true, "Saving…");
        updateDirtyState();
        API.put("/user-rights/users/" + user.id, { permissions: state.draft })
          .then(function (payload) {
            state.detail = payload.data;
            state.baseline = clone(payload.data.permissions);
            state.draft = clone(payload.data.permissions);
            normalizeDraft();
            state.saving = false;
            window.UI.setButtonLoading(button, false);
            renderEditor();
            loadHistory(user.id);
            loadUsers();
            hidePageAlert();
            window.UI.toast(
              "Permissions saved",
              "Updated rights for " + user.fullName + ". They apply on the next request.",
              "success"
            );
          })
          .catch(function (error) {
            state.saving = false;
            window.UI.setButtonLoading(button, false);
            updateDirtyState();
            var message = error && error.message ? error.message : "The permission changes could not be saved.";
            showEditorAlert("danger", message, "Save failed");
            window.UI.toast("Save failed", message, "danger");
          });
      });
  }

  /* ------------------------------------------------------------------ events */

  function bind() {
    var search = el("rightsSearch");
    if (search) {
      search.addEventListener(
        "input",
        window.UI.debounce(function () {
          state.filters.search = search.value.trim();
          loadUsers(true);
        }, 260)
      );
    }

    var role = el("rightsRoleFilter");
    if (role) {
      role.addEventListener("change", function () {
        state.filters.role = role.value;
        loadUsers(true);
      });
    }
    var school = el("rightsSchoolFilter");
    if (school) {
      school.addEventListener("change", function () {
        state.filters.schoolId = school.value;
        loadUsers(true);
      });
    }
    var status = el("rightsStatusFilter");
    if (status) {
      status.addEventListener("change", function () {
        state.filters.status = status.value;
        loadUsers(true);
      });
    }

    var resetFilters = el("rightsResetFilters");
    if (resetFilters) {
      resetFilters.addEventListener("click", function () {
        state.filters = { search: "", role: "", schoolId: "", status: "" };
        if (search) {
          search.value = "";
        }
        if (role) {
          role.value = "";
        }
        if (school) {
          school.value = "";
        }
        if (status) {
          status.value = "";
        }
        loadUsers(true);
      });
    }

    var refresh = el("rightsRefresh");
    if (refresh) {
      refresh.addEventListener("click", function () {
        hidePageAlert();
        loadUsers();
        if (state.selectedId) {
          loadDetail(state.selectedId);
        }
      });
    }

    var userList = el("rightsUserList");
    if (userList) {
      userList.addEventListener("click", function (event) {
        var trigger = event.target.closest("[data-user-id]");
        if (!trigger) {
          return;
        }
        selectUser(Number(trigger.dataset.userId));
      });
    }

    var editor = el("rightsEditor");
    if (editor) {
      editor.addEventListener("change", function (event) {
        var input = event.target.closest("input[data-module][data-action]");
        if (!input || !state.draft) {
          return;
        }
        var moduleKey = input.dataset.module;
        var action = input.dataset.action;
        if (!state.draft[moduleKey]) {
          return;
        }
        if (!canEditTarget()) {
          input.checked = !input.checked;
          return;
        }
        state.draft[moduleKey][action] = input.checked;
        if (action === "access" && !input.checked) {
          state.draft[moduleKey].add = false;
          state.draft[moduleKey].edit = false;
          state.draft[moduleKey].delete = false;
        }
        refreshModuleRow(moduleKey);
        updateDirtyState();
      });

      editor.addEventListener("click", function (event) {
        var scopeButton = event.target.closest("[data-scope]");
        if (scopeButton) {
          grantScope(scopeButton.dataset.scope, scopeButton.dataset.mode);
          return;
        }
        if (event.target.closest("[data-use-defaults]")) {
          useRoleDefaults();
          return;
        }
        if (event.target.closest("#rightsSave")) {
          savePermissions();
          return;
        }
        if (event.target.closest("#rightsReset")) {
          resetDraft();
          return;
        }
        var retry = event.target.closest("[data-retry-detail]");
        if (retry) {
          loadDetail(Number(retry.dataset.retryDetail));
        }
      });
    }

    window.addEventListener("beforeunload", function (event) {
      if (!isDirty()) {
        return undefined;
      }
      event.preventDefault();
      event.returnValue = "";
      return "";
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var shell = window.AppShell.init({
      page: "user-rights",
      breadcrumbs: ["Access control", "User rights"],
      requiredPermission: "canManageUserRights"
    });
    if (!shell || typeof shell.then !== "function") {
      return;
    }
    shell.then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      if (!session.permissions || !session.permissions.canManageUserRights) {
        return;
      }
      bind();
      loadCatalog().then(function () {
        var footer = el("footerUpdated");
        if (footer) {
          footer.textContent = "Permissions reloaded " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        }
      });
    });
  });
})(window, document);
