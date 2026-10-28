/* School District Monitoring System — account registration approvals */
(function (window, document) {
  "use strict";

  var state = {
    session: null,
    approvals: [],
    sequence: 0,
    rejectTarget: null,
    rejectModal: null
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

  function roleLabel(role) {
    var meta = window.UI.ROLE[role];
    return meta ? meta.label : window.UI.titleCase(role);
  }

  function setAlert(type, message, title) {
    window.UI.showAlert(el("approvalPageAlert"), type, message, title);
  }

  function approvalRow(approval) {
    var roleMeta = window.UI.ROLE[approval.role] || { label: window.UI.titleCase(approval.role), tone: "neutral" };
    var school = approval.schoolName
      ? window.UI.escapeHtml(approval.schoolName) +
        (approval.schoolCode ? '<small class="cell-subtext">' + window.UI.escapeHtml(approval.schoolCode) + "</small>" : "")
      : '<span class="cell-muted">District level</span>';
    return (
      '<tr data-approval-id="' + approval.id + '">' +
        '<td data-label="Applicant"><div class="user-cell">' +
        '<span class="avatar avatar--sm avatar--' + window.UI.escapeHtml(approval.role) + '">' +
        window.UI.escapeHtml(window.UI.initials(approval.fullName)) + "</span>" +
        "<div><strong>" + window.UI.escapeHtml(approval.fullName) +
        "</strong><small>@" + window.UI.escapeHtml(approval.username) + " · " + window.UI.escapeHtml(approval.email) + "</small></div></div></td>" +
        '<td data-label="Requested role">' + window.UI.pillarBadge(roleMeta.label, roleMeta.tone) + "</td>" +
        '<td data-label="District"><span class="cell-muted">' + window.UI.escapeHtml(approval.districtName || "—") + "</span></td>" +
        '<td data-label="School">' + school + "</td>" +
        '<td data-label="Registered"><span class="cell-time" title="' +
        window.UI.escapeHtml(window.UI.dateTime(approval.createdAt)) + '">' +
        window.UI.escapeHtml(window.UI.relativeTime(approval.createdAt)) + "</span></td>" +
        '<td data-label="Decision" class="cell-actions"><div class="table-actions">' +
        '<button type="button" class="btn btn-primary btn-sm" data-action="approve" data-id="' + approval.id + '">' +
        '<i class="bi bi-check2" aria-hidden="true"></i> Confirm</button>' +
        '<button type="button" class="btn btn-light btn-sm" data-action="reject" data-id="' + approval.id + '">' +
        '<i class="bi bi-x-lg" aria-hidden="true"></i> Return</button>' +
        "</div></td>" +
      "</tr>"
    );
  }

  function render() {
    var body = el("approvalTableBody");
    var meta = el("approvalTableMeta");
    if (!body) {
      return;
    }
    body.removeAttribute("aria-busy");
    if (!state.approvals.length) {
      body.innerHTML =
        '<tr class="empty-row"><td colspan="6">' +
        window.UI.emptyState({
          icon: "bi-patch-check",
          title: "No registrations waiting",
          message: "New accounts assigned to your level of the hierarchy will appear here.",
          action: '<button type="button" class="btn btn-light btn-sm" id="reloadApprovals">Check again</button>'
        }) + "</td></tr>";
      setText("approvalTableMeta", "No pending registrations");
      var reload = el("reloadApprovals");
      if (reload) {
        reload.addEventListener("click", loadApprovals);
      }
      return;
    }
    body.innerHTML = state.approvals.map(approvalRow).join("");
    setText(
      "approvalTableMeta",
      state.approvals.length +
        (state.approvals.length === 1 ? " registration awaiting confirmation" : " registrations awaiting confirmation")
    );
  }

  function loadApprovals() {
    var body = el("approvalTableBody");
    if (!body) {
      return;
    }
    var sequence = ++state.sequence;
    body.setAttribute("aria-busy", "true");
    body.innerHTML = window.UI.tableLoading(6, 5);
    setText("approvalTableMeta", "Loading registrations…");
    API.get("/approvals")
      .then(function (payload) {
        if (sequence !== state.sequence) {
          return;
        }
        state.approvals = payload.data || [];
        var meta = payload.meta || {};
        setText("approvalKpiPending", window.UI.number(state.approvals.length));
        setText("approvalKpiRole", meta.approverLabel || roleLabel(state.session.user.role));
        render();
        var footer = el("footerUpdated");
        if (footer) {
          footer.textContent = "Data refreshed " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        }
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
            title: "Registrations could not be loaded",
            message: error.status === 403
              ? "You do not have permission to review account registrations."
              : error.message || "The approval queue is temporarily unavailable.",
            action: '<button type="button" class="btn btn-primary btn-sm" id="retryApprovals">Try again</button>'
          }) + "</td></tr>";
        setText("approvalTableMeta", "Unavailable");
        setText("approvalKpiPending", "—");
        var retry = el("retryApprovals");
        if (retry) {
          retry.addEventListener("click", loadApprovals);
        }
      });
  }

  function findApproval(id) {
    return state.approvals.find(function (approval) {
      return Number(approval.id) === Number(id);
    });
  }

  function confirmApproval(approval) {
    window.UI.confirm({
      title: "Confirm " + approval.fullName + "?",
      message:
        "The account will be activated as " +
        roleLabel(approval.role) +
        " and the applicant can sign in to update their own records.",
      confirmLabel: "Confirm account",
      tone: "primary"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      API.post("/approvals/" + approval.id + "/approve", {})
        .then(function (response) {
          window.UI.toast(
            "Account confirmed",
            (response.data && response.data.fullName ? response.data.fullName : approval.fullName) +
              " can now sign in.",
            "success"
          );
          loadApprovals();
        })
        .catch(function (error) {
          setAlert(
            "danger",
            error.status === 409
              ? "This registration was already reviewed by another officer."
              : error.message || "The account could not be confirmed.",
            "Unable to confirm account"
          );
          loadApprovals();
        });
    });
  }

  function openReject(approval) {
    state.rejectTarget = approval;
    var modalEl = el("rejectModal");
    if (!modalEl || !state.rejectModal) {
      return;
    }
    el("rejectForm").reset();
    window.UI.hideAlert(el("rejectAlert"));
    window.UI.clearFieldErrors(el("rejectForm"));
    setText(
      "rejectSubtitle",
      "Return " + approval.fullName + "'s " + roleLabel(approval.role) + " registration with an optional reason."
    );
    state.rejectModal.show();
  }

  function submitReject(event) {
    event.preventDefault();
    var approval = state.rejectTarget;
    if (!approval) {
      return;
    }
    var button = el("rejectSubmit");
    window.UI.hideAlert(el("rejectAlert"));
    window.UI.setButtonLoading(button, true, "Returning…");
    API.post("/approvals/" + approval.id + "/reject", {
      note: el("rejectNote").value.trim()
    })
      .then(function () {
        window.UI.setButtonLoading(button, false);
        state.rejectModal.hide();
        window.UI.toast(
          "Registration returned",
          approval.fullName + " was notified that the account was not confirmed.",
          "success"
        );
        loadApprovals();
      })
      .catch(function (error) {
        window.UI.setButtonLoading(button, false);
        window.UI.showAlert(
          el("rejectAlert"),
          "danger",
          error.status === 409
            ? "This registration was already reviewed by another officer."
            : error.message || "The registration could not be returned.",
          "Unable to return registration"
        );
      });
  }

  function bind() {
    el("approvalTableBody").addEventListener("click", function (event) {
      var button = event.target.closest("[data-action]");
      if (!button) {
        return;
      }
      var approval = findApproval(button.dataset.id);
      if (!approval) {
        return;
      }
      if (button.dataset.action === "approve") {
        confirmApproval(approval);
      } else if (button.dataset.action === "reject") {
        openReject(approval);
      }
    });

    el("refreshApprovals").addEventListener("click", function () {
      var refresh = el("refreshApprovals");
      window.UI.setButtonLoading(refresh, true, "Refreshing…");
      loadApprovals();
      window.setTimeout(function () {
        window.UI.setButtonLoading(refresh, false);
      }, 400);
    });

    el("rejectForm").addEventListener("submit", submitReject);
    el("rejectModal").addEventListener("hidden.bs.modal", function () {
      window.UI.setButtonLoading(el("rejectSubmit"), false);
      state.rejectTarget = null;
    });
  }

  function init() {
    state.rejectModal = new window.bootstrap.Modal(el("rejectModal"));
    window.AppShell.init({
      page: "approvals",
      breadcrumbs: ["Account Approvals"],
      requiredPermission: "canApproveAccounts"
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      setText("approvalKpiRole", roleLabel(session.user.role));
      bind();
      loadApprovals();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
