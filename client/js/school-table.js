/* School District Monitoring System — reusable school monitoring table */
(function (window, document) {
  "use strict";

  function SchoolTable(options) {
    this.options = Object.assign(
      {
        root: document,
        ids: {},
        pageSize: 8,
        defaultSort: "name",
        defaultDirection: "asc",
        defaultStatus: "",
        canManage: false,
        getContext: function () {
          return {};
        },
        onLoaded: null,
        onChanged: null
      },
      options || {}
    );
    this.ids = this.options.ids;
    this.tbody = document.getElementById(this.ids.body);
    this.meta = document.getElementById(this.ids.meta);
    this.paginationMount = document.getElementById(this.ids.pagination);
    this.searchInput = document.getElementById(this.ids.search);
    this.typeSelect = document.getElementById(this.ids.type);
    this.statusSelect = document.getElementById(this.ids.status);
    this.reportSelect = document.getElementById(this.ids.report);
    this.resetButton = document.getElementById(this.ids.reset);
    this.sort = this.options.defaultSort;
    this.direction = this.options.defaultDirection;
    this.page = 1;
    this.period = "";
    this.schools = [];
    this.sequence = 0;
    this.filters = {
      search: "",
      type: "",
      status: this.options.defaultStatus,
      reportStatus: ""
    };
    this.bind();
    this.updateSortHeaders();
  }

  SchoolTable.prototype.bind = function () {
    var self = this;
    if (this.searchInput) {
      this.searchInput.addEventListener(
        "input",
        window.UI.debounce(function () {
          self.filters.search = self.searchInput.value.trim();
          self.page = 1;
          self.load();
        }, 320)
      );
    }
    [
      [this.typeSelect, "type"],
      [this.statusSelect, "status"],
      [this.reportSelect, "reportStatus"]
    ].forEach(function (pair) {
      if (pair[0]) {
        pair[0].addEventListener("change", function () {
          self.filters[pair[1]] = pair[0].value;
          self.page = 1;
          self.load();
        });
      }
    });
    if (this.resetButton) {
      this.resetButton.addEventListener("click", function () {
        self.reset();
      });
    }
    var sortButtons = this.options.root.querySelectorAll("[data-sort]");
    sortButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        var column = button.dataset.sort;
        if (self.sort === column) {
          self.direction = self.direction === "asc" ? "desc" : "asc";
        } else {
          self.sort = column;
          self.direction = ["students", "teachers", "updated", "performance"].indexOf(column) !== -1 ? "desc" : "asc";
        }
        self.page = 1;
        self.load();
      });
    });
    if (this.tbody) {
      this.tbody.addEventListener("click", function (event) {
        var actionButton = event.target.closest("[data-action]");
        if (actionButton) {
          self.handleAction(actionButton.dataset.action, Number(actionButton.dataset.id));
          return;
        }
        var reset = event.target.closest("[data-empty-reset]");
        if (reset) {
          self.reset();
        }
      });
    }
  };

  SchoolTable.prototype.updateSortHeaders = function () {
    var self = this;
    var table = this.tbody ? this.tbody.closest("table") : null;
    if (!table) {
      return;
    }
    table.querySelectorAll("th").forEach(function (header) {
      var button = header.querySelector("[data-sort]");
      if (!button) {
        return;
      }
      var icon = button.querySelector("i");
      var active = button.dataset.sort === self.sort;
      header.setAttribute("aria-sort", active ? (self.direction === "asc" ? "ascending" : "descending") : "none");
      if (icon) {
        icon.className = active
          ? self.direction === "asc"
            ? "bi bi-sort-up"
            : "bi bi-sort-down"
          : "bi bi-arrow-down-up";
      }
      button.classList.toggle("is-sorted", active);
    });
  };

  SchoolTable.prototype.filterParams = function () {
    return {
      search: this.filters.search,
      type: this.filters.type,
      status: this.filters.status,
      reportStatus: this.filters.reportStatus
    };
  };

  SchoolTable.prototype.load = function () {
    var self = this;
    if (!this.tbody) {
      return;
    }
    var sequence = ++this.sequence;
    this.tbody.setAttribute("aria-busy", "true");
    this.tbody.innerHTML = window.UI.tableLoading(10, 6);
    if (this.meta) {
      this.meta.textContent = "Loading schools…";
    }
    if (this.paginationMount) {
      this.paginationMount.innerHTML = "";
    }

    var context = this.options.getContext() || {};
    var params = Object.assign(
      {
        page: this.page,
        pageSize: this.options.pageSize,
        sort: this.sort,
        direction: this.direction
      },
      this.filterParams()
    );
    if (context.districtId) {
      params.districtId = context.districtId;
    }
    if (this.period) {
      params.period = this.period;
    }

    API.get("/schools", params)
      .then(function (payload) {
        if (sequence !== self.sequence) {
          return;
        }
        self.schools = payload.data || [];
        self.render(payload.pagination || {});
      })
      .catch(function (error) {
        if (sequence !== self.sequence || error.status === 401) {
          return;
        }
        self.schools = [];
        self.tbody.removeAttribute("aria-busy");
        self.tbody.innerHTML =
          '<tr class="empty-row"><td colspan="10">' +
          window.UI.emptyState({
            icon: "bi-cloud-slash",
            title: "Schools could not be loaded",
            message: error.message || "The school register is temporarily unavailable.",
            action: '<button type="button" class="btn btn-primary btn-sm" data-empty-reset>Try again</button>'
          }) +
          "</td></tr>";
        if (self.meta) {
          self.meta.textContent = "Unavailable";
        }
      });
  };

  SchoolTable.prototype.render = function (pagination) {
    var self = this;
    this.tbody.removeAttribute("aria-busy");
    this.updateSortHeaders();

    if (!this.schools.length) {
      var filtered = Object.keys(this.filters).some(function (key) {
        return Boolean(self.filters[key]);
      });
      this.tbody.innerHTML =
        '<tr class="empty-row"><td colspan="10">' +
        window.UI.emptyState({
          icon: filtered ? "bi-search" : "bi-buildings",
          title: filtered ? "No matching schools" : "No schools registered yet",
          message: filtered
            ? "Try a different search term or clear the current filters."
            : "Schools added to the district register will appear here.",
          action: '<button type="button" class="btn btn-light btn-sm" data-empty-reset>Clear filters</button>'
        }) +
        "</td></tr>";
    } else {
      this.tbody.innerHTML = this.schools.map(function (school) {
        return self.row(school);
      }).join("");
    }

    if (this.meta) {
      var total = Number(pagination.total || this.schools.length);
      this.meta.textContent = total + (total === 1 ? " school" : " schools") + " in the current scope";
    }
    if (this.paginationMount) {
      window.UI.pagination(this.paginationMount, pagination, function (page) {
        self.page = page;
        self.load();
      });
    }
    if (typeof this.options.onLoaded === "function") {
      this.options.onLoaded({
        schools: this.schools,
        pagination: pagination
      });
    }
  };

  SchoolTable.prototype.row = function (school) {
    var reportStatus = school.reportStatus || "missing";
    var reportMeta = window.UI.REPORT_STATUS[reportStatus] || {
      label: window.UI.titleCase(reportStatus),
      tone: "neutral"
    };
    var actions =
      '<div class="table-actions">' +
      '<button type="button" class="icon-action" data-action="view" data-id="' +
      school.id +
      '" title="View ' +
      window.UI.escapeHtml(school.name) +
      '" aria-label="View ' +
      window.UI.escapeHtml(school.name) +
      '"><i class="bi bi-eye" aria-hidden="true"></i></button>';
    if (this.options.canManage && school.status !== "archived") {
      actions +=
        '<button type="button" class="icon-action" data-action="edit" data-id="' +
        school.id +
        '" title="Edit ' +
        window.UI.escapeHtml(school.name) +
        '" aria-label="Edit ' +
        window.UI.escapeHtml(school.name) +
        '"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>' +
        '<button type="button" class="icon-action icon-action--danger" data-action="archive" data-id="' +
        school.id +
        '" title="Archive ' +
        window.UI.escapeHtml(school.name) +
        '" aria-label="Archive ' +
        window.UI.escapeHtml(school.name) +
        '"><i class="bi bi-archive" aria-hidden="true"></i></button>';
    }
    if (this.options.canManage && school.status === "archived") {
      actions +=
        '<button type="button" class="icon-action" data-action="restore" data-id="' +
        school.id +
        '" title="Restore ' +
        window.UI.escapeHtml(school.name) +
        '" aria-label="Restore ' +
        window.UI.escapeHtml(school.name) +
        '"><i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i></button>';
    }
    actions += "</div>";

    return (
      '<tr data-school-id="' +
      school.id +
      '">' +
      '<td data-label="School ID"><span class="code-chip">' +
      window.UI.escapeHtml(school.code) +
      "</span></td>" +
      '<td data-label="School Name"><div class="school-name-cell"><span class="school-avatar"><i class="bi bi-building" aria-hidden="true"></i></span><div><strong>' +
      window.UI.escapeHtml(school.name) +
      "</strong><small>" +
      window.UI.escapeHtml(school.districtName || "Unassigned district") +
      "</small></div></div></td>" +
      '<td data-label="School Type"><span class="cell-muted">' +
      window.UI.escapeHtml(school.type) +
      "</span></td>" +
      '<td data-label="School Head">' +
      window.UI.escapeHtml(school.head) +
      "</td>" +
      '<td data-label="Total Students" class="text-right"><span class="cell-number">' +
      window.UI.number(school.studentCount) +
      "</span></td>" +
      '<td data-label="Teaching Personnel" class="text-right"><span class="cell-number">' +
      window.UI.number(school.teacherCount) +
      "</span></td>" +
      '<td data-label="Report Submission Status">' +
      window.UI.badge("report", reportStatus) +
      (school.reportPeriod
        ? '<small class="cell-sub">' + window.UI.escapeHtml(window.UI.month(school.reportPeriod)) + "</small>"
        : "") +
      "</td>" +
      '<td data-label="School Status">' +
      window.UI.badge("school", school.status) +
      "</td>" +
      '<td data-label="Last Updated"><span class="cell-time" title="' +
      window.UI.escapeHtml(window.UI.dateTime(school.updatedAt)) +
      '">' +
      window.UI.escapeHtml(window.UI.relativeTime(school.updatedAt)) +
      "</span></td>" +
      '<td data-label="Actions" class="cell-actions">' +
      actions +
      "</td>" +
      "</tr>"
    );
  };

  SchoolTable.prototype.findSchool = function (id) {
    return this.schools.find(function (school) {
      return Number(school.id) === Number(id);
    });
  };

  SchoolTable.prototype.handleAction = function (action, id) {
    var self = this;
    var school = this.findSchool(id);
    if (!school) {
      return;
    }
    var session = window.AppShell.getSession();
    var canManage = Boolean(session && session.permissions.canManageSchools);

    if (action === "view") {
      window.SchoolUI.openView({
        school: school,
        canManage: canManage,
        onEdit: function (record) {
          self.openEdit(record);
        },
        onChanged: function () {
          self.afterChange();
        }
      });
      return;
    }
    if (action === "edit") {
      this.openEdit(school);
      return;
    }
    if (action === "archive") {
      window.SchoolUI.archive({
        school: school,
        onDone: function () {
          self.afterChange();
        }
      });
      return;
    }
    if (action === "restore") {
      window.SchoolUI.restore({
        school: school,
        onDone: function () {
          self.afterChange();
        }
      });
    }
  };

  SchoolTable.prototype.openEdit = function (school) {
    var self = this;
    var session = window.AppShell.getSession();
    window.SchoolUI.openForm({
      school: school,
      districts: session.districts,
      canSelectDistrict: Boolean(session.permissions.canSelectDistrict),
      onSaved: function () {
        self.afterChange();
      }
    });
  };

  SchoolTable.prototype.openCreate = function () {
    var self = this;
    var session = window.AppShell.getSession();
    window.SchoolUI.openForm({
      school: null,
      districts: session.districts,
      canSelectDistrict: Boolean(session.permissions.canSelectDistrict),
      onSaved: function () {
        self.afterChange();
      }
    });
  };

  SchoolTable.prototype.afterChange = function () {
    this.load();
    window.AppShell.refreshSchools();
    if (typeof this.options.onChanged === "function") {
      this.options.onChanged();
    }
  };

  SchoolTable.prototype.reset = function () {
    this.filters = { search: "", type: "", status: this.options.defaultStatus, reportStatus: "" };
    if (this.searchInput) {
      this.searchInput.value = "";
    }
    if (this.typeSelect) {
      this.typeSelect.value = "";
    }
    if (this.statusSelect) {
      this.statusSelect.value = this.options.defaultStatus;
    }
    if (this.reportSelect) {
      this.reportSelect.value = "";
    }
    this.page = 1;
    this.load();
  };

  SchoolTable.prototype.setSearch = function (value) {
    var search = String(value || "");
    this.filters.search = search;
    this.page = 1;
    if (this.searchInput) {
      this.searchInput.value = search;
    }
    this.load();
  };

  SchoolTable.prototype.setFilter = function (name, value) {
    if (!Object.prototype.hasOwnProperty.call(this.filters, name)) {
      return;
    }
    this.filters[name] = value;
    var selectMap = { type: this.typeSelect, status: this.statusSelect, reportStatus: this.reportSelect };
    if (selectMap[name]) {
      selectMap[name].value = value;
    }
    this.page = 1;
    this.load();
  };

  SchoolTable.prototype.setPeriod = function (period) {
    this.period = period || "";
    this.page = 1;
    this.load();
  };

  SchoolTable.prototype.refresh = function () {
    this.load();
  };

  SchoolTable.prototype.getSchools = function () {
    return this.schools;
  };

  window.SchoolTable = SchoolTable;
})(window, document);
