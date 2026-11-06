/* School District Monitoring System — authenticated application shell */
(function (window, document) {
  "use strict";

  var SVG_MARK =
    '<img src="assets/images/division-seal.png" alt="" aria-hidden="true">';

  var state = {
    session: null,
    page: "dashboard",
    sidebarOpen: false,
    hierarchy: { districts: [], totals: {} },
    hierarchyLoaded: false,
    expanded: {},
    divisionSearch: "",
    searchTimer: null
  };

  function queryParam(name) {
    return new URLSearchParams(window.location.search).get(name) || "";
  }

  function currentView() {
    return queryParam("view");
  }

  function isActiveNav(page) {
    return state.page === page;
  }

  function navItem(page, href, icon, label) {
    var active = isActiveNav(page);
    var view = currentView();
    if (page === "schools" && view) {
      active = false;
    }
    if (page === "schools" && !view && isActiveNav(page)) {
      active = true;
    }
    return (
      '<a class="sidebar-link' +
      (active ? " is-active" : "") +
      '" href="' +
      href +
      '"' +
      (active ? ' aria-current="page"' : "") +
      ">" +
      '<i class="bi ' +
      icon +
      '" aria-hidden="true"></i><span>' +
      label +
      "</span></a>"
    );
  }

  function navItemView(page, view, href, icon, label) {
    var active = state.page === page && currentView() === view;
    return (
      '<a class="sidebar-link' +
      (active ? " is-active" : "") +
      '" href="' +
      href +
      '"' +
      (active ? ' aria-current="page"' : "") +
      ">" +
      '<i class="bi ' +
      icon +
      '" aria-hidden="true"></i><span>' +
      label +
      "</span></a>"
    );
  }

  function roleShort(role) {
    var meta = window.UI.ROLE[role];
    return meta ? meta.short : window.UI.titleCase(role);
  }

  function workspaceOf(session) {
    return (session && session.permissions && session.permissions.workspace) || "district";
  }

  function isDistrictWorkspace(session) {
    var workspace = workspaceOf(session);
    return workspace === "all" || workspace === "district";
  }

  function isSchoolWorkspace(session) {
    return workspaceOf(session) === "school";
  }

  function isClassWorkspace(session) {
    var workspace = workspaceOf(session);
    return workspace === "class" || workspace === "learner";
  }

  function rolesOfSession(session) {
    if (!session || !session.user) {
      return [];
    }
    return session.user.roles && session.user.roles.length
      ? session.user.roles
      : [session.user.role];
  }

  // A program coordinator without a teaching or school-wide role is limited to
  // personnel, learner, and coordination records inside the school.
  function isCoordinatorOnly(session) {
    var roles = rolesOfSession(session);
    return (
      roles.indexOf("coordinator") !== -1 &&
      roles.every(function (role) {
        return role === "coordinator" || role === "nt" || role === "learner";
      })
    );
  }

  var WORKSPACE_RANK = { all: 5, district: 4, school: 3, class: 2, learner: 1 };

  // Pages that must never render for a narrower workspace, even from a direct link.
  var PAGE_MIN_WORKSPACE = {
    districts: "district",
    schools: "school",
    reports: "school",
    monitoring: "school",
    personnel: "school",
    books: "school",
    movements: "school",
    health: "school",
    "school-forms": "school",
    activities: "school",
    "school-years": "school",
    "grade-levels": "school",
    sections: "school",
    teachers: "school",
    subjects: "school"
  };

  function workspaceAllowed(session, minimum) {
    var actual = WORKSPACE_RANK[workspaceOf(session)] || 0;
    return actual >= WORKSPACE_RANK[minimum];
  }

  var COORDINATOR_PAGES = {
    dashboard: 1,
    learners: 1,
    learner: 1,
    "learner-reports": 1,
    activities: 1,
    personnel: 1,
    announcements: 1,
    profile: 1,
    settings: 1
  };

  function districtLabel(session) {
    if (!isDistrictWorkspace(session) && session.user.schoolName) {
      return session.user.schoolName;
    }
    if (session.user.districtName) {
      return session.user.districtName;
    }
    return session.districts && session.districts.length > 1 ? "All districts" : "District workspace";
  }

  function renderSidebar() {
    var session = state.session;
    var permissions = session.permissions;
    var modules = permissions.modules || {};
    var mount = document.getElementById("appSidebar");
    if (!mount) {
      return;
    }
    function allows(key) {
      return Boolean(modules[key] && modules[key].access);
    }

    var districtScope = isDistrictWorkspace(session);
    var schoolScope = isSchoolWorkspace(session);
    var classScope = isClassWorkspace(session);

    var roleList = rolesOfSession(session);
    function hasRole(name) {
      return roleList.indexOf(name) !== -1;
    }
    var isSystemAdmin = session.user.role === "system_admin";
    var coordinatorOnly = isCoordinatorOnly(session);
    var isAdviser = hasRole("adviser") || hasRole("school_head") || isSystemAdmin;

    var adminLinks = "";
    var showDistricts = permissions.canManageDistricts;
    if (
      allows("approvals") ||
      showDistricts ||
      allows("users") ||
      permissions.canViewAuditLogs ||
      permissions.canManageUserRights ||
      allows("helpdesk") ||
      isSystemAdmin
    ) {
      adminLinks = '<p class="sidebar-heading">Administration</p>';
      if (allows("approvals")) {
        adminLinks += navItem("approvals", "approvals.html", "bi-person-check", "Account Approvals");
      }
      if (showDistricts) {
        adminLinks += navItem("districts", "districts.html", "bi-diagram-3", "Districts");
      }
      if (allows("users")) {
        adminLinks += navItem("users", "users.html", "bi-people", "User Management");
      }
      if (permissions.canManageUserRights) {
        adminLinks += navItem("user-rights", "user-rights.html", "bi-shield-lock", "User Rights");
      }
      if (permissions.canViewAuditLogs) {
        adminLinks += navItem("audit", "audit-logs.html", "bi-shield-check", "Audit Logs");
      }
      if (isSystemAdmin) {
        adminLinks += navItem(
          "database-backup",
          "database-backup.html",
          "bi-database-down",
          "Database Backup"
        );
      }
      if (allows("helpdesk")) {
        adminLinks += navItem("helpdesk-admin", "helpdesk-admin.html", "bi-life-preserver", "Helpdesk Content");
      }
    }

    var learnerLinks = "";
    var learnerItems =
      (allows("learners") ? navItem("learners", "learners.html", "bi-person-vcard", "Learners") : "") +
      (!classScope && !coordinatorOnly && allows("school_years") ? navItem("school-years", "school-years.html", "bi-calendar3", "School Years") : "") +
      (!classScope && !coordinatorOnly && allows("grade_levels") ? navItem("grade-levels", "grade-levels.html", "bi-layers", "Grade Levels") : "") +
      (!classScope && !coordinatorOnly && allows("sections") ? navItem("sections", "sections.html", "bi-diagram-3", "Sections") : "") +
      (!classScope && !coordinatorOnly && allows("teachers") ? navItem("teachers", "teachers.html", "bi-person-video3", "Teachers") : "") +
      (!classScope && !coordinatorOnly && allows("subjects") ? navItem("subjects", "subjects.html", "bi-easel2", "Subjects") : "") +
      (!classScope && allows("activities") ? navItem("activities", "activities.html", "bi-trophy", "Activities") : "") +
      (allows("learner_reports")
        ? navItem("learner-reports", "learner-reports.html", "bi-clipboard-data", "Learner Reports")
        : "");
    if (learnerItems) {
      learnerLinks = '<p class="sidebar-heading">Learner records</p>' + learnerItems;
    }

    var operationsItems = coordinatorOnly
      ? (allows("personnel") ? navItem("personnel", "personnel.html", "bi-person-badge", "Personnel") : "")
      : (allows("attendance") ? navItem("attendance", "attendance.html", "bi-calendar2-check", "Attendance") : "") +
        (allows("attendance") && permissions.canValidateAttendance
          ? navItem("adviser-attendance", "adviser-attendance.html", "bi-clipboard2-check", "Adviser Attendance")
          : "") +
        (allows("grades") ? navItem("grades", "grades.html", "bi-journal-check", "Grades & Promotion") : "") +
        (!classScope && allows("books") ? navItem("books", "books.html", "bi-book", "Books & Materials") : "") +
        (!classScope && allows("movements") ? navItem("movements", "movements.html", "bi-arrow-left-right", "Learner Movements") : "") +
        (!classScope && allows("health") ? navItem("health", "health.html", "bi-heart-pulse", "Health & Nutrition") : "") +
        (!classScope && allows("personnel") ? navItem("personnel", "personnel.html", "bi-person-badge", "Personnel") : "");
    var operationsLinks = operationsItems
      ? '<p class="sidebar-heading">School operations</p>' + operationsItems
      : "";

    var formsItems = coordinatorOnly
      ? ""
      : (allows("class_records")
        ? navItem("class-records", "class-records.html", "bi-journal-text", "Class Records")
        : "") +
      (allows("grade_submissions") && (!classScope || isAdviser)
        ? navItem(
            "adviser-consolidation",
            "adviser-consolidation.html",
            "bi-inboxes",
            "Adviser Consolidation"
          )
        : "") +
      (allows("report_cards")
        ? navItem("report-cards", "report-cards.html", "bi-file-earmark-person", "Report Cards (SF 9)")
        : "") +
      (!classScope && allows("school_forms")
        ? navItem("school-forms", "school-forms.html", "bi-file-earmark-text", "School Forms Center")
        : "") +
      (!classScope && allows("monitoring")
        ? navItem(
            "monitoring",
            "monitoring.html",
            "bi-clipboard2-data",
            districtScope ? "District Monitoring" : "School Monitoring"
          )
        : "");
    var formsLinks = formsItems
      ? '<p class="sidebar-heading">Grading & school forms</p>' + formsItems
      : "";

    var dashboardLink = allows("dashboard")
      ? navItem("dashboard", "dashboard.html", "bi-grid-1x2", "Dashboard")
      : "";
    var divisionSection =
      districtScope && allows("schools") && allows("districts")
        ? '<section class="sidebar-division" aria-labelledby="sidebarDivisionHeading">' +
          '<div class="sidebar-division__head">' +
          '<p class="sidebar-heading" id="sidebarDivisionHeading"><i class="bi bi-diagram-3" aria-hidden="true"></i> School Division Office</p>' +
          '<span class="sidebar-count" id="sidebarSchoolCount">Loading…</span>' +
          "</div>" +
          '<label class="sidebar-search">' +
          '<i class="bi bi-search" aria-hidden="true"></i>' +
          '<input type="search" id="sidebarSchoolSearch" placeholder="Find district or school" aria-label="Search districts and schools" autocomplete="off" value="' +
          window.UI.escapeHtml(state.divisionSearch) +
          '">' +
          "</label>" +
          '<div class="division-tree" id="sidebarDivisionTree" role="list"></div>' +
          "</section>"
        : "";
    var schoolLinks =
      !classScope && !coordinatorOnly && allows("schools")
        ? navItem("schools", "schools.html", "bi-buildings", "Schools") +
          (districtScope
            ? navItemView("schools", "enrollment", "schools.html?view=enrollment", "bi-people", "School Enrollment") +
              navItemView("schools", "performance", "schools.html?view=performance", "bi-graph-up-arrow", "School Performance")
            : "")
        : "";
    var reportLink =
      !classScope && !coordinatorOnly && allows("district_reports")
        ? navItem(
            "reports",
            "reports.html",
            "bi-graph-up",
            districtScope ? "District Reports" : "School Reports"
          )
        : "";
    var announcementLink = allows("announcements")
      ? navItem("announcements", "announcements.html", "bi-megaphone", "Announcements")
      : "";
    var settingsLink = allows("settings")
      ? navItem("settings", "settings.html", "bi-sliders", "Settings")
      : "";
    var securityLink = session.superadmin
      ? '<p class="sidebar-heading">Security</p>' +
        navItem("security-firewall", "security-firewall.html", "bi-shield-lock-fill", "Security Firewall")
      : "";

    mount.innerHTML =
      '<div class="sidebar-brand">' +
      '<a class="brand brand--sidebar" href="dashboard.html">' +
      '<span class="brand-mark">' +
      SVG_MARK +
      "</span>" +
      '<span class="brand-copy"><strong>SDMS</strong><small>District Monitoring</small></span>' +
      "</a>" +
      '<button type="button" class="sidebar-close" id="sidebarClose" aria-label="Close navigation"><i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
      "</div>" +
      '<div class="sidebar-district">' +
      '<span class="sidebar-district__label">' +
      (districtScope ? "District workspace" : schoolScope ? "School workspace" : "Class workspace") +
      "</span>" +
      '<span class="sidebar-district__name">' +
      window.UI.escapeHtml(districtLabel(session)) +
      "</span>" +
      '<span class="role-pill">' +
      window.UI.escapeHtml(roleShort(session.user.role)) +
      (permissions.readOnly ? " · View only" : "") +
      "</span>" +
      "</div>" +
      '<div class="sidebar-scroll" id="sidebarScroll">' +
      '<nav class="sidebar-nav" aria-label="Main navigation">' +
      (dashboardLink || learnerLinks ? '<p class="sidebar-heading">Overview</p>' : "") +
      dashboardLink +
      learnerLinks +
      operationsLinks +
      formsLinks +
      divisionSection +
      schoolLinks +
      (reportLink || announcementLink
        ? '<p class="sidebar-heading">' + (districtScope ? "District" : "School") + "</p>"
        : "") +
      reportLink +
      announcementLink +
      adminLinks +
      (settingsLink ? '<p class="sidebar-heading">System</p>' + settingsLink : "") +
      securityLink +
      "</nav>" +
      "</div>" +
      '<div class="sidebar-footer">' +
      '<button type="button" class="sidebar-user" id="sidebarProfile">' +
      window.UI.avatarMarkup(session.user, "avatar--sm", "Your profile photo") +
      '<span class="sidebar-user__copy"><strong>' +
      window.UI.escapeHtml(session.user.fullName) +
      "</strong><small>" +
      window.UI.escapeHtml(roleShort(session.user.role)) +
      "</small></span>" +
      '<i class="bi bi-gear" aria-hidden="true"></i>' +
      "</button>" +
      '<button type="button" class="sidebar-logout" id="sidebarLogout">' +
      '<i class="bi bi-box-arrow-right" aria-hidden="true"></i><span>Logout</span></button>' +
      "</div>";

    renderDivisionTree();
  }

  function divisionSkeleton() {
    var html = "";
    for (var index = 0; index < 3; index += 1) {
      html +=
        '<div class="school-nav-skeleton" aria-hidden="true">' +
        '<span class="skeleton skeleton-avatar"></span>' +
        '<span class="school-nav-skeleton__lines"><span class="skeleton skeleton-text" style="width:78%"></span><span class="skeleton skeleton-text" style="width:52%"></span></span>' +
        "</div>";
    }
    return html;
  }

  function defaultExpand() {
    var districts = state.hierarchy.districts || [];
    if (!districts.length) {
      return;
    }
    var target = queryParam("districtId");
    var schoolId = queryParam("schoolId");
    if (!target && schoolId) {
      var active = districts.find(function (district) {
        return district.schools.some(function (school) {
          return String(school.id) === String(schoolId);
        });
      });
      if (active) {
        target = String(active.id);
      }
    }
    if (!target && state.session.user.districtId) {
      target = String(state.session.user.districtId);
    }
    if (!target) {
      target = String(districts[0].id);
    }
    if (state.expanded[target] === undefined) {
      state.expanded[target] = true;
    }
  }

  function textMatches(value, query) {
    return !query || String(value).toLowerCase().indexOf(query) !== -1;
  }

  function renderDivisionTree() {
    var mount = document.getElementById("sidebarDivisionTree");
    var count = document.getElementById("sidebarSchoolCount");
    if (!mount) {
      return;
    }
    var search = state.divisionSearch.trim().toLowerCase();
    if (!state.hierarchyLoaded) {
      mount.innerHTML = divisionSkeleton();
      return;
    }
    var districts = state.hierarchy.districts || [];
    if (!districts.length) {
      mount.innerHTML =
        '<div class="sidebar-empty"><i class="bi bi-diagram-3" aria-hidden="true"></i><p>No districts available.</p></div>';
      if (count) {
        count.textContent = "No districts";
      }
      return;
    }

    var selectedSchool = queryParam("schoolId");
    var selectedDistrict = queryParam("districtId");
    var visibleDistricts = 0;
    var visibleSchools = 0;

    var html = districts
      .map(function (district) {
        var districtHaystack = [district.name, district.code]
          .concat((district.psds || []).map(function (supervisor) {
            return supervisor.name;
          }))
          .join(" ");
        var districtMatch = textMatches(districtHaystack, search);
        var schools = (district.schools || []).filter(function (school) {
          return districtMatch || textMatches([school.name, school.code, school.type].join(" "), search);
        });
        if (search && !districtMatch && !schools.length) {
          return "";
        }
        visibleDistricts += 1;
        visibleSchools += schools.length;

        var expanded = search ? true : Boolean(state.expanded[district.id]);
        var psds = (district.psds || []).map(function (supervisor) {
          return supervisor.name;
        });
        var psdsLabel = psds.length ? psds.join(" · ") : "PSDS not assigned";
        var districtActive =
          state.page === "schools" && String(selectedDistrict) === String(district.id);

        var schoolsHtml = schools
          .map(function (school) {
            var active = state.page === "schools" && String(school.id) === String(selectedSchool);
            return (
              '<a class="school-nav-item school-nav-item--nested' +
              (active ? " is-active" : "") +
              '" href="schools.html?schoolId=' +
              encodeURIComponent(school.id) +
              "&districtId=" +
              encodeURIComponent(district.id) +
              '" role="listitem"' +
              (active ? ' aria-current="true"' : "") +
              ">" +
              '<span class="school-nav-icon"><i class="bi bi-building" aria-hidden="true"></i></span>' +
              '<span class="school-nav-copy"><strong>' +
              window.UI.escapeHtml(school.name) +
              "</strong><small>" +
              window.UI.escapeHtml(school.code) +
              "</small></span>" +
              "</a>"
            );
          })
          .join("");

        return (
          '<div class="division-district" role="listitem">' +
          '<div class="district-row' +
          (districtActive ? " is-active" : "") +
          '">' +
          '<button type="button" class="district-toggle" data-district-toggle="' +
          district.id +
          '" aria-expanded="' +
          String(expanded) +
          '" aria-controls="districtSchools-' +
          district.id +
          '">' +
          '<i class="bi bi-chevron-right district-chevron" aria-hidden="true"></i>' +
          '<span class="district-copy"><strong>' +
          window.UI.escapeHtml(district.name) +
          '</strong><small class="district-psds"><i class="bi bi-person-badge" aria-hidden="true"></i> ' +
          window.UI.escapeHtml(psdsLabel) +
          "</small></span>" +
          '<span class="district-count">' +
          schools.length +
          "</span>" +
          "</button>" +
          '<a class="district-open" href="schools.html?districtId=' +
          encodeURIComponent(district.id) +
          '" aria-label="Open schools in ' +
          window.UI.escapeHtml(district.name) +
          '" title="Open district schools"><i class="bi bi-arrow-up-right" aria-hidden="true"></i></a>' +
          "</div>" +
          '<div class="district-schools" id="districtSchools-' +
          district.id +
          '" role="list"' +
          (expanded ? "" : " hidden") +
          ">" +
          (schoolsHtml ||
            '<p class="division-empty">' +
              (search ? "No matching schools." : "No schools yet.") +
              "</p>") +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    if (!html) {
      mount.innerHTML =
        '<div class="sidebar-empty"><i class="bi bi-search" aria-hidden="true"></i><p>No district or school matches your search.</p></div>';
    } else {
      mount.innerHTML = html;
    }

    if (count) {
      if (search) {
        count.textContent =
          visibleDistricts + (visibleDistricts === 1 ? " district · " : " districts · ") +
          visibleSchools + (visibleSchools === 1 ? " school" : " schools");
      } else {
        count.textContent =
          districts.length + (districts.length === 1 ? " district · " : " districts · ") +
          visibleSchools + (visibleSchools === 1 ? " school" : " schools");
      }
    }
  }

  function loadHierarchy() {
    var mount = document.getElementById("sidebarDivisionTree");
    var count = document.getElementById("sidebarSchoolCount");
    if (!mount && !count) {
      // The division tree is only rendered for roles that can open schools and
      // districts; skip the request instead of provoking a denied call.
      return;
    }
    if (mount && !state.hierarchyLoaded) {
      mount.innerHTML = divisionSkeleton();
    }
    API.get("/districts/hierarchy")
      .then(function (payload) {
        state.hierarchy = (payload.data && payload.data.districts)
          ? payload.data
          : { districts: [], totals: {} };
        state.hierarchyLoaded = true;
        defaultExpand();
        renderDivisionTree();
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        state.hierarchyLoaded = true;
        state.hierarchy = { districts: [], totals: {} };
        if (count) {
          count.textContent = "Unavailable";
        }
        if (mount) {
          mount.innerHTML =
            '<div class="sidebar-empty"><i class="bi bi-exclamation-circle" aria-hidden="true"></i><p>Districts could not be loaded.</p></div>';
        }
      });
  }

  function workspaceRootLabel() {
    if (isDistrictWorkspace(state.session)) {
      return "District";
    }
    if (isSchoolWorkspace(state.session)) {
      return "School";
    }
    return "Class";
  }

  function breadcrumbsHtml(items) {
    var parts = ['<li class="breadcrumb-item"><a href="dashboard.html"><i class="bi bi-house-door" aria-hidden="true"></i><span>' + workspaceRootLabel() + '</span></a></li>'];
    (items || []).forEach(function (item, index) {
      var last = index === (items || []).length - 1;
      parts.push(
        '<li class="breadcrumb-item' +
          (last ? " active" : "") +
          '"' +
          (last ? ' aria-current="page"' : "") +
          ">" +
          window.UI.escapeHtml(item) +
          "</li>"
      );
    });
    return parts.join("");
  }

  function renderTopbar(options) {
    var mount = document.getElementById("appTopbar");
    if (!mount) {
      return;
    }
    var session = state.session;
    var user = session.user;
    var roleMeta = window.UI.ROLE[user.role] || { label: window.UI.titleCase(user.role) };
    mount.innerHTML =
      '<div class="topbar-left">' +
      '<button type="button" class="icon-button sidebar-toggle" id="sidebarToggle" aria-label="Open navigation" aria-controls="appSidebar" aria-expanded="false"><i class="bi bi-list" aria-hidden="true"></i></button>' +
      '<nav aria-label="Breadcrumb"><ol class="breadcrumb app-breadcrumb mb-0">' +
      breadcrumbsHtml(options.breadcrumbs) +
      "</ol></nav>" +
      "</div>" +
      '<div class="topbar-right">' +
      (isClassWorkspace(session) || isSchoolWorkspace(session)
        ? ""
        : '<form class="topbar-search" id="globalSchoolSearch" role="search">' +
          '<i class="bi bi-search" aria-hidden="true"></i>' +
          '<input type="search" id="globalSchoolSearchInput" placeholder="Search schools…" aria-label="Search schools" autocomplete="off">' +
          '<kbd>↵</kbd>' +
          "</form>") +
      '<div class="dropdown">' +
      '<button type="button" class="icon-button notification-button" id="notificationToggle" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false" aria-label="Notifications">' +
      '<i class="bi bi-bell" aria-hidden="true"></i>' +
      '<span class="notification-badge d-none" id="notificationBadge">0</span>' +
      "</button>" +
      '<div class="dropdown-menu dropdown-menu-right notification-menu" aria-labelledby="notificationToggle">' +
      '<div class="notification-menu__head">' +
      "<div><strong>Notifications</strong><span id=\"notificationUnreadLabel\">Checking…</span></div>" +
      '<button type="button" class="text-button" id="markAllRead">Mark all read</button>' +
      "</div>" +
      '<div class="notification-list" id="notificationList"><div class="notification-loading"><span class="spinner-border spinner-border-sm" aria-hidden="true"></span> Loading…</div></div>' +
      '<a class="notification-menu__foot" href="announcements.html"><i class="bi bi-megaphone" aria-hidden="true"></i> View announcements</a>' +
      "</div>" +
      "</div>" +
      '<div class="dropdown profile-dropdown">' +
      '<button type="button" class="profile-trigger" id="profileToggle" data-toggle="dropdown" aria-haspopup="true" aria-expanded="false">' +
      window.UI.avatarMarkup(user, "avatar--" + user.role, "Your profile photo") +
      '<span class="profile-trigger__copy"><strong>' +
      window.UI.escapeHtml(user.fullName) +
      "</strong><small>" +
      window.UI.escapeHtml(roleMeta.label) +
      "</small></span>" +
      '<i class="bi bi-chevron-down" aria-hidden="true"></i>' +
      "</button>" +
      '<div class="dropdown-menu dropdown-menu-right profile-menu" aria-labelledby="profileToggle">' +
      '<div class="profile-menu__head">' +
      window.UI.avatarMarkup(user, "avatar--lg avatar--" + user.role, "Your profile photo") +
      "<div><strong>" +
      window.UI.escapeHtml(user.fullName) +
      "</strong><span>" +
      window.UI.escapeHtml(user.email) +
      "</span><em>" +
      window.UI.escapeHtml(roleMeta.label) +
      "</em></div>" +
      "</div>" +
      '<a class="profile-menu__item" href="profile.html"><i class="bi bi-person" aria-hidden="true"></i> My Profile</a>' +
      '<a class="profile-menu__item" href="settings.html"><i class="bi bi-sliders" aria-hidden="true"></i> Account Settings</a>' +
      '<div class="dropdown-divider"></div>' +
      '<button type="button" class="profile-menu__item profile-menu__item--danger" id="topbarLogout"><i class="bi bi-box-arrow-right" aria-hidden="true"></i> Logout</button>' +
      "</div></div>" +
      "</div>";
  }

  function openSidebar() {
    state.sidebarOpen = true;
    document.body.classList.add("sidebar-open");
    var toggle = document.getElementById("sidebarToggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", "true");
    }
    var firstLink = document.querySelector("#appSidebar .sidebar-link");
    if (firstLink) {
      window.setTimeout(function () {
        firstLink.focus();
      }, 180);
    }
  }

  function closeSidebar() {
    state.sidebarOpen = false;
    document.body.classList.remove("sidebar-open");
    var toggle = document.getElementById("sidebarToggle");
    if (toggle) {
      toggle.setAttribute("aria-expanded", "false");
    }
  }

  function wireShellEvents() {
    var sidebarToggle = document.getElementById("sidebarToggle");
    var sidebarClose = document.getElementById("sidebarClose");
    var backdrop = document.getElementById("appBackdrop");
    var sidebarSearch = document.getElementById("sidebarSchoolSearch");
    var searchForm = document.getElementById("globalSchoolSearch");
    var markAll = document.getElementById("markAllRead");
    var notificationList = document.getElementById("notificationList");
    var sidebarLogout = document.getElementById("sidebarLogout");
    var topbarLogout = document.getElementById("topbarLogout");
    var sidebarProfile = document.getElementById("sidebarProfile");

    if (sidebarToggle) {
      sidebarToggle.addEventListener("click", function () {
        if (state.sidebarOpen) {
          closeSidebar();
        } else {
          openSidebar();
        }
      });
    }
    if (sidebarClose) {
      sidebarClose.addEventListener("click", closeSidebar);
    }
    if (backdrop) {
      backdrop.addEventListener("click", closeSidebar);
    }
    if (sidebarProfile) {
      sidebarProfile.addEventListener("click", function () {
        window.location.href = "profile.html";
      });
    }
    if (sidebarSearch) {
      sidebarSearch.addEventListener(
        "input",
        window.UI.debounce(function () {
          state.divisionSearch = sidebarSearch.value;
          renderDivisionTree();
        }, 140)
      );
    }
    var divisionTree = document.getElementById("sidebarDivisionTree");
    if (divisionTree) {
      divisionTree.addEventListener("click", function (event) {
        var toggle = event.target.closest("[data-district-toggle]");
        if (!toggle) {
          return;
        }
        var id = toggle.dataset.districtToggle;
        var expanded = toggle.getAttribute("aria-expanded") === "true";
        state.expanded[id] = !expanded;
        toggle.setAttribute("aria-expanded", String(!expanded));
        var panel = document.getElementById("districtSchools-" + id);
        if (panel) {
          panel.hidden = expanded;
        }
      });
    }
    if (searchForm) {
      searchForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var input = document.getElementById("globalSchoolSearchInput");
        var value = input ? input.value.trim() : "";
        if (state.page === "schools") {
          document.dispatchEvent(new CustomEvent("sdms:schoolsearch", { detail: { search: value } }));
          input.blur();
          return;
        }
        window.location.href = "schools.html" + (value ? "?search=" + encodeURIComponent(value) : "");
      });
    }
    if (markAll) {
      markAll.addEventListener("click", function () {
        markAll.disabled = true;
        API.patch("/notifications/read-all")
          .then(function () {
            window.UI.toast("", "All notifications marked as read.", "success");
            loadNotifications();
          })
          .catch(function (error) {
            window.UI.toast("Could not update notifications", error.message, "danger");
          })
          .then(function () {
            markAll.disabled = false;
          });
      });
    }
    if (notificationList) {
      notificationList.addEventListener("click", function (event) {
        var item = event.target.closest("[data-notification-id]");
        if (!item || item.classList.contains("is-read")) {
          return;
        }
        var id = item.dataset.notificationId;
        API.patch("/notifications/" + encodeURIComponent(id) + "/read")
          .then(function () {
            item.classList.add("is-read");
            item.classList.remove("is-unread");
            loadNotifications();
          })
          .catch(function (error) {
            window.UI.toast("Could not mark notification", error.message, "danger");
          });
      });
    }
    [sidebarLogout, topbarLogout].forEach(function (button) {
      if (!button) {
        return;
      }
      button.addEventListener("click", function () {
        window.UI.confirm({
          title: "Sign out of SDMS?",
          message: "You will need to sign in again to access the district dashboard.",
          confirmLabel: "Sign out",
          tone: "danger"
        }).then(function (confirmed) {
          if (!confirmed) {
            return;
          }
          API.post("/auth/logout")
            .catch(function () {
              /* The session is cleared locally either way. */
            })
            .then(function () {
              window.location.replace("/index.html");
            });
        });
      });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && state.sidebarOpen) {
        closeSidebar();
      }
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth >= 992 && state.sidebarOpen) {
        closeSidebar();
      }
    });
  }

  function notificationItem(notification) {
    var unread = !notification.isRead;
    return (
      '<button type="button" class="notification-item ' +
      (unread ? "is-unread" : "is-read") +
      '" data-notification-id="' +
      notification.id +
      '" aria-label="' +
      window.UI.escapeHtml(notification.title + ". " + (unread ? "Unread. Click to mark as read." : "Read.")) +
      '">' +
      '<span class="notification-item__dot" aria-hidden="true"></span>' +
      '<span class="notification-item__copy"><strong>' +
      window.UI.escapeHtml(notification.title) +
      "</strong><span>" +
      window.UI.escapeHtml(notification.message) +
      "</span><time datetime=\"" +
      window.UI.escapeHtml(notification.createdAt) +
      '">' +
      window.UI.escapeHtml(window.UI.relativeTime(notification.createdAt)) +
      "</time></span>" +
      "</button>"
    );
  }

  function loadNotifications() {
    var list = document.getElementById("notificationList");
    var label = document.getElementById("notificationUnreadLabel");
    var badge = document.getElementById("notificationBadge");
    if (!list) {
      return;
    }
    API.get("/notifications")
      .then(function (payload) {
        var notifications = payload.data.notifications || [];
        var unread = Number(payload.data.unreadCount || 0);
        if (badge) {
          badge.textContent = unread > 9 ? "9+" : String(unread);
          badge.classList.toggle("d-none", unread === 0);
        }
        if (label) {
          label.textContent = unread === 0 ? "You're all caught up" : unread + (unread === 1 ? " unread" : " unread");
        }
        if (!notifications.length) {
          list.innerHTML =
            '<div class="notification-empty"><i class="bi bi-bell-slash" aria-hidden="true"></i><p>No notifications yet.</p></div>';
          return;
        }
        list.innerHTML = notifications.slice(0, 8).map(notificationItem).join("");
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        if (label) {
          label.textContent = "Unavailable";
        }
        list.innerHTML =
          '<div class="notification-empty"><i class="bi bi-exclamation-circle" aria-hidden="true"></i><p>Notifications could not be loaded.</p></div>';
      });
  }

  function showShell() {
    var loading = document.getElementById("appLoading");
    var layout = document.getElementById("appLayout");
    if (loading) {
      loading.classList.add("d-none");
    }
    if (layout) {
      layout.classList.remove("d-none");
    }
    document.body.classList.add("shell-ready");
    window.UI.consumeFlash();
  }

  function showFatalError(error) {
    var loading = document.getElementById("appLoading");
    if (!loading) {
      return;
    }
    loading.innerHTML =
      '<div class="shell-error">' +
      '<span class="shell-error__icon"><i class="bi bi-cloud-slash" aria-hidden="true"></i></span>' +
      "<h1>The dashboard is unavailable</h1>" +
      "<p>" +
      window.UI.escapeHtml(error && error.message ? error.message : "The application could not start.") +
      "</p>" +
      '<button type="button" class="btn btn-primary" id="shellRetry">Try again</button>' +
      "</div>";
    var retry = document.getElementById("shellRetry");
    if (retry) {
      retry.addEventListener("click", function () {
        window.location.reload();
      });
    }
  }

  function init(options) {
    var settings = Object.assign({ page: "dashboard", breadcrumbs: [], requiredPermission: null }, options || {});
    state.page = settings.page || document.body.dataset.page || "dashboard";
    document.body.dataset.page = state.page;
    var backdrops = document.getElementById("appBackdrop");
    if (backdrops) {
      backdrops.addEventListener("click", closeSidebar);
    }

    return API.get("/auth/me")
      .then(function (payload) {
        state.session = payload.data;
        API.setCsrfToken(state.session.csrfToken);
        var minimum = PAGE_MIN_WORKSPACE[state.page];
        if (minimum && !workspaceAllowed(state.session, minimum)) {
          window.location.replace("/dashboard.html?denied=" + encodeURIComponent(state.page));
          return null;
        }
        if (isCoordinatorOnly(state.session) && !COORDINATOR_PAGES[state.page]) {
          window.location.replace("/dashboard.html?denied=" + encodeURIComponent(state.page));
          return null;
        }
        renderSidebar();
        renderTopbar(settings);
        wireShellEvents();
        loadHierarchy();
        loadNotifications();
        if (settings.requiredPermission && !state.session.permissions[settings.requiredPermission]) {
          window.UI.flash("You do not have permission to open that page.", "danger");
          window.location.replace("/dashboard.html");
          return null;
        }
        showShell();
        return state.session;
      })
      .catch(function (error) {
        if (error.status === 401) {
          API.redirectToLogin();
          return null;
        }
        showFatalError(error);
        return null;
      });
  }

  function refreshSchools() {
    loadHierarchy();
  }

  function updateUser(user) {
    if (!state.session || !user) {
      return;
    }
    state.session.user = Object.assign({}, state.session.user, user);
    renderSidebar();
    var topbarToggle = document.getElementById("profileToggle");
    var options = { breadcrumbs: [] };
    if (topbarToggle) {
      var crumb = document.querySelector(".app-breadcrumb");
      if (crumb) {
        crumb.querySelectorAll(".breadcrumb-item").forEach(function (item, index) {
          if (index > 0) {
            options.breadcrumbs.push(item.textContent.trim());
          }
        });
      }
    }
    renderTopbar(options);
    wireShellEvents();
  }

  window.AppShell = {
    init: init,
    refreshSchools: refreshSchools,
    updateUser: updateUser,
    closeSidebar: closeSidebar,
    getSession: function () {
      return state.session;
    }
  };
})(window, document);
