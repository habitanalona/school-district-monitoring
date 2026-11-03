/* SDMS Security Firewall console — SuperAdmin only */
(function (window, document) {
  "use strict";

  var BASE = "/api/security";
  var state = {
    session: null,
    view: "overview",
    csrfToken: null,
    events: [],
    stream: null,
    pollTimer: null,
    charts: []
  };

  // ---------------------------------------------------------------- helpers
  function byId(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmt(value) {
    if (!value) {
      return "—";
    }
    var date = new Date(value);
    if (isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function sevBadge(severity) {
    var key = String(severity || "informational").toLowerCase();
    return '<span class="sec-sev sec-sev--' + esc(key) + '">' + esc(key) + "</span>";
  }

  function statusBadge(status) {
    var key = String(status || "unknown").toLowerCase().replace(/\s+/g, "_");
    return '<span class="sec-status sec-status--' + esc(key) + '">' + esc(status || "unknown") + "</span>";
  }

  function toast(message, tone) {
    var stack = byId("secToasts");
    var node = document.createElement("div");
    node.className = "sec-toast" + (tone ? " sec-toast--" + tone : "");
    node.textContent = message;
    stack.appendChild(node);
    setTimeout(function () {
      node.remove();
    }, 5000);
  }

  function showAlert(message, tone) {
    var box = byId("secAlert");
    if (!message) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    box.className = "sec-alert" + (tone === "ok" ? " sec-alert--ok" : tone === "warn" ? " sec-alert--warn" : "");
    box.textContent = message;
  }

  function emptyRow(cols, message) {
    return '<tr><td colspan="' + cols + '"><div class="sec-empty">' + esc(message || "No records yet.") + "</div></td></tr>";
  }

  function request(path, options) {
    var config = Object.assign({ method: "GET", headers: {} }, options || {});
    config.credentials = "same-origin";
    config.headers = Object.assign({ Accept: "application/json" }, config.headers || {});
    var mutating = config.method !== "GET" && config.method !== "HEAD";
    var tokenPromise = mutating ? ensureCsrf() : Promise.resolve(null);
    return tokenPromise.then(function (token) {
      if (token) {
        config.headers["X-CSRF-Token"] = token;
      }
      if (config.body && typeof config.body !== "string") {
        config.headers["Content-Type"] = "application/json";
        config.body = JSON.stringify(config.body);
      }
      return window.fetch(BASE + path, config).then(function (response) {
        return response.json().catch(function () {
          return {};
        }).then(function (payload) {
          if (response.status === 401 || response.status === 403) {
            if (payload && payload.code === "SUPERADMIN_REQUIRED") {
              showLogin();
            }
            throw new Error((payload && payload.error) || "Not authorized.");
          }
          if (!response.ok) {
            throw new Error((payload && payload.error) || "The request failed (" + response.status + ").");
          }
          return payload;
        });
      });
    });
  }

  function ensureCsrf() {
    if (state.csrfToken) {
      return Promise.resolve(state.csrfToken);
    }
    return window
      .fetch(BASE + "/csrf", { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (response) {
        return response.json();
      })
      .then(function (payload) {
        state.csrfToken = payload && payload.csrfToken ? payload.csrfToken : null;
        return state.csrfToken;
      });
  }

  function confirmDialog(options) {
    return new Promise(function (resolve) {
      var modal = byId("secModal");
      var input = byId("secModalInput");
      var field = byId("secModalField");
      byId("secModalTitle").textContent = options.title || "Confirm action";
      byId("secModalText").textContent = options.text || "";
      byId("secModalLabel").textContent = options.label || "Reason";
      byId("secModalConfirm").textContent = options.confirmText || "Confirm";
      byId("secModalConfirm").className = "sec-btn " + (options.tone === "primary" ? "sec-btn--primary" : "sec-btn--danger");
      field.hidden = !options.needInput;
      input.value = options.defaultValue || "";
      modal.hidden = false;
      if (options.needInput) {
        setTimeout(function () {
          input.focus();
        }, 30);
      }

      function cleanup(result) {
        modal.hidden = true;
        byId("secModalConfirm").onclick = null;
        byId("secModalCancel").onclick = null;
        input.onkeydown = null;
        resolve(result);
      }
      byId("secModalCancel").onclick = function () {
        cleanup(null);
      };
      byId("secModalConfirm").onclick = function () {
        cleanup(options.needInput ? input.value.trim() : true);
      };
      input.onkeydown = function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          byId("secModalConfirm").click();
        }
      };
    });
  }

  // ---------------------------------------------------------------- charts
  function drawLineChart(canvas, series) {
    if (!canvas) {
      return;
    }
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(rect.width * dpr, 300);
    canvas.height = Math.max(rect.height * dpr, 150);
    var ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);
    var width = canvas.width / dpr;
    var height = canvas.height / dpr;
    ctx.clearRect(0, 0, width, height);

    var all = series.reduce(function (acc, entry) {
      return acc.concat(entry.values);
    }, []);
    var max = Math.max.apply(null, all.concat([1]));
    var pad = 26;
    var plotW = width - pad * 2;
    var plotH = height - pad * 2;

    ctx.strokeStyle = "rgba(29,44,68,0.9)";
    ctx.lineWidth = 1;
    for (var step = 0; step <= 4; step += 1) {
      var y = pad + (plotH / 4) * step;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(width - pad, y);
      ctx.stroke();
    }

    series.forEach(function (entry) {
      ctx.strokeStyle = entry.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      entry.values.forEach(function (value, index) {
        var x = pad + (plotW * index) / Math.max(entry.values.length - 1, 1);
        var y = pad + plotH - (plotH * value) / max;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
      ctx.fillStyle = entry.color;
      entry.values.forEach(function (value, index) {
        var x = pad + (plotW * index) / Math.max(entry.values.length - 1, 1);
        var y = pad + plotH - (plotH * value) / max;
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      });
    });

    ctx.fillStyle = "#8ea1bd";
    ctx.font = "11px Segoe UI, system-ui, sans-serif";
    ctx.fillText(String(max), 4, pad + 4);
    ctx.fillText("0", 4, height - pad + 4);
    if (series.length && series[0].labels.length) {
      ctx.fillText(series[0].labels[0], pad, height - 6);
      var last = series[0].labels[series[0].labels.length - 1];
      var textWidth = ctx.measureText(last).width;
      ctx.fillText(last, width - pad - textWidth, height - 6);
    }
  }

  // ---------------------------------------------------------------- boot/auth
  function showLogin() {
    stopPolling();
    closeStream();
    byId("secApp").hidden = true;
    byId("secLogin").hidden = false;
    byId("secPassword").value = "";
    byId("secTotp").value = "";
  }

  function showConsole() {
    byId("secLogin").hidden = true;
    byId("secApp").hidden = false;
    byId("secWho").textContent = state.session.superadmin.fullName + " · " + state.session.superadmin.username;
    var mode = byId("secModePill");
    if (state.session.maintenanceMode) {
      mode.textContent = "Maintenance Mode ON";
      mode.className = "sec-pill is-crit";
    } else {
      mode.textContent = "Firewall Online";
      mode.className = "sec-pill is-ok";
    }
    route(location.hash ? location.hash.replace("#", "") : "overview");
  }

  function boot() {
    byId("secLoginForm").addEventListener("submit", function (event) {
      event.preventDefault();
      var alertBox = byId("secLoginAlert");
      alertBox.hidden = true;
      var button = byId("secLoginSubmit");
      button.disabled = true;
      request("/auth/login", {
        method: "POST",
        body: {
          username: byId("secUsername").value.trim(),
          password: byId("secPassword").value,
          totpToken: byId("secTotp").value.trim()
        }
      })
        .then(function () {
          return refreshSession().then(showConsole);
        })
        .catch(function (error) {
          alertBox.hidden = false;
          alertBox.textContent = error.message;
        })
        .finally(function () {
          button.disabled = false;
        });
    });

    byId("secLogoutBtn").addEventListener("click", function () {
      request("/auth/logout", { method: "POST" })
        .catch(function () {})
        .finally(function () {
          state.session = null;
          state.csrfToken = null;
          showLogin();
        });
    });

    byId("secAlertBtn").addEventListener("click", function () {
      route("overview");
      setTimeout(function () {
        var target = byId("secAlertsCard");
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 350);
    });

    byId("secRefreshBtn").addEventListener("click", function () {
      renderView(state.view);
    });

    byId("secNav").addEventListener("click", function (event) {
      var button = event.target.closest("[data-view]");
      if (!button) {
        return;
      }
      location.hash = button.getAttribute("data-view");
    });

    window.addEventListener("hashchange", function () {
      if (state.session) {
        route(location.hash.replace("#", "") || "overview");
      }
    });

    refreshSession().then(function (session) {
      if (session && session.authenticated) {
        showConsole();
      } else {
        showLogin();
      }
    });
  }

  function refreshSession() {
    return request("/session").then(function (payload) {
      state.session = payload;
      return payload;
    });
  }

  var VIEW_META = {
    overview: ["Security Operations", "Security Overview"],
    control: ["Protection controls", "Firewall Control Center"],
    database: ["Database layer", "Database Protection Monitor"],
    code: ["Application layer", "Code Integrity Monitor"],
    live: ["Streaming", "Real-Time Activity Monitor"],
    intrusion: ["Threat detection", "Intrusion Detection Center"],
    incidents: ["Response", "Security Incident Management"],
    uploads: ["File handling", "Upload Security Monitor"],
    audit: ["Evidence", "Security Audit Logs"],
    dbhealth: ["Infrastructure", "Database Health Monitor"],
    apphealth: ["Infrastructure", "Application Health Monitor"],
    backup: ["Continuity", "Backup & Recovery Center"],
    recovery: ["Continuity", "Emergency Recovery Mode"],
    config: ["Policy", "Security Configuration"],
    accounts: ["Identity", "SuperAdmin Account Management"]
  };

  function route(view) {
    if (!VIEW_META[view]) {
      view = "overview";
    }
    state.view = view;
    Array.prototype.forEach.call(document.querySelectorAll(".sec-nav__item"), function (button) {
      button.classList.toggle("is-active", button.getAttribute("data-view") === view);
    });
    byId("secViewEyebrow").textContent = VIEW_META[view][0];
    byId("secViewTitle").textContent = VIEW_META[view][1];
    showAlert("");
    renderView(view);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
    state.charts = [];
  }

  function closeStream() {
    if (state.stream) {
      state.stream.close();
      state.stream = null;
    }
  }

  function renderView(view) {
    stopPolling();
    if (view !== "live") {
      closeStream();
    }
    var mount = byId("secView");
    mount.innerHTML = '<div class="sec-card"><div class="sec-empty">Loading security data…</div></div>';
    var renderer = VIEWS[view];
    if (!renderer) {
      mount.innerHTML = '<div class="sec-card"><div class="sec-empty">View unavailable.</div></div>';
      return;
    }
    Promise.resolve()
      .then(function () {
        return renderer(mount);
      })
      .catch(function (error) {
        mount.innerHTML = "";
        showAlert(error.message, "danger");
      })
      .then(function () {
        if (state.view === view && view !== "live") {
          state.pollTimer = setInterval(function () {
            if (document.visibilityState === "visible" && state.view === view) {
              renderView(view);
            }
          }, 30000);
        }
      });
  }

  // ---------------------------------------------------------------- views
  var VIEWS = {};

  VIEWS.overview = function (mount) {
    return Promise.all([
      request("/overview"),
      request("/events/timeline?hours=24"),
      request("/events?pageSize=12"),
      request("/alerts")
    ]).then(function (results) {
      var data = results[0];
      var timeline = results[1].timeline || [];
      var events = results[2].events || [];
      var alerts = results[3].alerts || [];
      var sw = data.switches || {};
      var stats = data.stats || {};
      var healthy = (data.health || []).every(function (row) {
        return row.status === "healthy";
      });
      var overallClass = sw.security_lockdown && sw.security_lockdown.enabled
        ? "sec-card--crit"
        : healthy
          ? "sec-card--ok"
          : "sec-card--warn";
      var overallLabel = sw.security_lockdown && sw.security_lockdown.enabled ? "LOCKDOWN" : healthy ? "PROTECTED" : "DEGRADED";
      var overallDot = sw.security_lockdown && sw.security_lockdown.enabled ? "red" : healthy ? "green" : "yellow";
      var unread = data.pendingAlerts || 0;

      mount.innerHTML =
        '<div class="sec-grid sec-grid--4">' +
        '<article class="sec-card ' + overallClass + '"><div class="sec-kpi-row"><p class="sec-card__label">Overall system status</p><span class="sec-dot sec-dot--' + overallDot + '"></span></div>' +
        '<p class="sec-card__value">' + overallLabel + "</p><p class=\"sec-card__sub\">Firewall " + (data.worker && data.worker.running ? "worker running" : "worker not running") + "</p></article>" +
        '<article class="sec-card"><p class="sec-card__label">Blocked unauthorized activities</p><p class="sec-card__value">' + (stats.blocked || 0) + '</p><p class="sec-card__sub">Last 24 hours</p></article>' +
        '<article class="sec-card"><p class="sec-card__label">Critical / high incidents</p><p class="sec-card__value">' + (stats.critical_total || 0) + " / " + (stats.high || 0) + '</p><p class="sec-card__sub">All time / 24h</p></article>' +
        '<article class="sec-card"><p class="sec-card__label">Failed authentications (24h)</p><p class="sec-card__value">' + (stats.failed_logins || 0) + '</p><p class="sec-card__sub">' + (stats.upload_events || 0) + " upload events · " + (stats.database_events || 0) + " DB events</p></article>" +
        "</div>" +

        '<div class="sec-section-title"><i class="bi bi-toggles"></i> Protection state</div>' +
        '<div class="sec-grid sec-grid--4">' +
        switchSummary("DATABASE WRITE PROTECTION", "db_write_protection", sw.db_write_protection) +
        switchSummary("APPLICATION CODE PROTECTION", "code_write_protection", sw.code_write_protection) +
        switchSummary("SYSTEM MAINTENANCE MODE", "maintenance_mode", sw.maintenance_mode) +
        switchSummary("SECURITY LOCKDOWN", "security_lockdown", sw.security_lockdown) +
        "</div>" +

        '<div class="sec-split" style="margin-top:18px">' +
        '<section class="sec-card"><div class="sec-kpi-row"><p class="sec-card__label">Security activity — last 24 hours</p><span class="sec-card__sub">total · blocked · high/critical</span></div>' +
        '<div class="sec-canvas-wrap"><canvas id="secOverviewChart"></canvas></div>' +
        '<p class="sec-hint" style="margin-top:8px"><span class="sec-dot sec-dot--green"></span> total &nbsp; <span class="sec-dot sec-dot--yellow"></span> blocked &nbsp; <span class="sec-dot sec-dot--red"></span> threats</p>' +
        "</section>" +
        '<section class="sec-card" id="secAlertsCard"><div class="sec-kpi-row"><p class="sec-card__label">Alerts</p><span class="sec-pill ' + (unread ? "is-crit" : "is-ok") + '">' + unread + " unread</span></div>" +
        '<ul class="sec-list">' +
        (alerts.length === 0
          ? '<li><span>No alerts recorded.</span></li>'
          : alerts.slice(0, 8).map(function (alert) {
              return "<li><span>" + sevBadge(alert.severity) + "</span><span style=\"text-align:right\">" + esc(alert.title) + "<br><small style=\"color:#8ea1bd\">" + fmt(alert.created_at) + "</small></span></li>";
            }).join("")) +
        "</ul></section></div>" +

        '<div class="sec-section-title"><i class="bi bi-hdd-network"></i> Security service snapshots</div>' +
        '<div class="sec-grid sec-grid--2">' +
        '<section class="sec-card"><p class="sec-card__label">Operational milestones</p><ul class="sec-list">' +
        "<li><span>Last verified backup</span><span>" + (data.lastVerifiedBackup ? esc(data.lastVerifiedBackup.label) + "<br><small>" + fmt(data.lastVerifiedBackup.verified_at) + "</small>" : "None yet") + "</span></li>" +
        "<li><span>Last integrity verification</span><span>" + fmt(data.lastIntegrityVerification) + "</span></li>" +
        "<li><span>Last security scan</span><span>" + fmt(data.lastSecurityScan) + "</span></li>" +
        "<li><span>Monitoring uptime</span><span>" + (data.worker && data.worker.running ? Math.floor((data.worker.uptimeSeconds || 0) / 60) + " min" : "Stopped") + "</span></li>" +
        "</ul></section>" +
        '<section class="sec-card"><p class="sec-card__label">Health checks</p><ul class="sec-list">' +
        ((data.health || []).length === 0
          ? "<li><span>No probes recorded yet.</span></li>"
          : data.health.map(function (row) {
              return "<li><span>" + esc(row.check_name) + "</span><span>" + statusBadge(row.status) + "<br><small>" + fmt(row.created_at) + "</small></span></li>";
            }).join("")) +
        "</ul></section></div>" +

        '<div class="sec-section-title"><i class="bi bi-clock-history"></i> Recent security events</div>' +
        eventsTable(events);

      drawLineChart(byId("secOverviewChart"), [
        { labels: timeline.map(function (row) { return row.bucket; }), values: timeline.map(function (row) { return row.total; }), color: "#22c55e" },
        { labels: timeline.map(function (row) { return row.bucket; }), values: timeline.map(function (row) { return row.blocked; }), color: "#f59e0b" },
        { labels: timeline.map(function (row) { return row.bucket; }), values: timeline.map(function (row) { return row.threats; }), color: "#ef4444" }
      ]);
    });
  };

  function switchSummary(title, key, info) {
    var on = info && info.enabled;
    var dot = key === "maintenance_mode" ? "yellow" : on ? "green" : "gray";
    return (
      '<article class="sec-card"><div class="sec-kpi-row"><p class="sec-card__label">' + esc(title) + '</p><span class="sec-dot sec-dot--' + (on ? dot : "gray") + '"></span></div>' +
      '<p class="sec-card__value" style="font-size:1.15rem">' + (on ? "ON" : "OFF") + "</p>" +
      '<p class="sec-card__sub">' + (info && info.updatedBy ? "by " + esc(info.updatedBy) + " · " + fmt(info.updatedAt) : "Default state") + "</p></article>"
    );
  }

  function eventsTable(events) {
    if (!events.length) {
      return '<div class="sec-table-wrap"><table class="sec-table"><tbody>' + emptyRow(6, "No security events recorded yet.") + "</tbody></table></div>";
    }
    return (
      '<div class="sec-table-wrap"><table class="sec-table"><thead><tr>' +
      "<th>Time</th><th>Severity</th><th>Action</th><th>Actor</th><th>Source</th><th>Decision</th></tr></thead><tbody>" +
      events.map(function (event) {
        return (
          "<tr><td>" + fmt(event.created_at) + "</td><td>" + sevBadge(event.severity) + "</td>" +
          "<td>" + esc(event.action) + (event.description ? '<br><small style="color:#8ea1bd">' + esc(String(event.description).slice(0, 140)) + "</small>" : "") + "</td>" +
          "<td>" + esc(event.username || "—") + "</td>" +
          '<td class="mono">' + esc(event.ip_address || "—") + "</td><td>" + esc(event.firewall_decision || "—") + "</td></tr>"
        );
      }).join("") +
      "</tbody></table></div>"
    );
  }

  VIEWS.control = function (mount) {
    return Promise.all([request("/switches"), request("/maintenance-sessions")]).then(function (results) {
      var switches = results[0].switches || [];
      var history = results[0].history || [];
      var sessions = results[1].sessions || [];
      var labels = {
        db_write_protection: "DATABASE WRITE PROTECTION",
        code_write_protection: "APPLICATION CODE WRITE PROTECTION",
        maintenance_mode: "SYSTEM MAINTENANCE MODE",
        security_lockdown: "SECURITY LOCKDOWN"
      };
      var descriptions = {
        db_write_protection: "Rejects unauthorized INSERT/UPDATE/DELETE at the SQL choke point. Schema changes always require a migration.",
        code_write_protection: "Verifies application file hashes; unexpected changes open a critical incident.",
        maintenance_mode: "Redirects ordinary users to the maintenance notice; SuperAdmin keeps security access.",
        security_lockdown: "Emergency freeze: blocks all application writes and sensitive operations while an incident is investigated."
      };

      mount.innerHTML =
        '<div class="sec-grid sec-grid--2">' +
        switches.map(function (item) {
          var meta = item;
          return (
            '<article class="sec-card sec-switch-card">' +
            '<div class="sec-switch-card__head"><div><h2 class="sec-switch-card__name">' + esc(labels[item.key] || item.key) + '</h2><span class="sec-switch-card__key">' + esc(item.key) + "</span></div>" +
            '<span class="sec-switch-card__flag ' + (item.enabled ? "on" : "off") + '">' + (item.enabled ? "ON" : "OFF") + "</span></div>" +
            '<p class="sec-switch-card__meta">' + esc(descriptions[item.key] || item.policy_note) + "</p>" +
            '<p class="sec-switch-card__meta">Last change: ' + (item.updated_by_name ? esc(item.updated_by_name) + " · " : "") + fmt(item.updated_at) + "</p>" +
            '<div><button type="button" class="sec-btn ' + (item.enabled ? "sec-btn--danger" : "sec-btn--primary") + '" data-toggle="' + esc(item.key) + '" data-next="' + (item.enabled ? "false" : "true") + '">' +
            (item.enabled ? "Turn OFF" : "Turn ON") + "</button></div>" +
            "</article>"
          );
        }).join("") +
        "</div>" +
        '<p class="sec-hint" style="margin-top:12px"><i class="bi bi-info-circle"></i> Switching one control never changes the others. Authentication, authorization, CSRF, input validation and audit logging stay active in every state.</p>' +

        '<div class="sec-section-title"><i class="bi bi-journal-text"></i> Change history</div>' +
        '<div class="sec-table-wrap"><table class="sec-table"><thead><tr><th>When</th><th>Switch</th><th>Change</th><th>By</th><th>Reason</th><th>IP</th></tr></thead><tbody>' +
        (history.length === 0
          ? emptyRow(6, "No switch changes recorded yet.")
          : history.map(function (row) {
              return (
                "<tr><td>" + fmt(row.created_at) + "</td><td class=\"mono\">" + esc(row.key) + "</td><td>" + (row.previous ? "ON" : "OFF") + " → " + (row.next ? "ON" : "OFF") + "</td>" +
                "<td>" + esc(row.actor_username || row.actor_name || "—") + "</td><td>" + esc(row.reason || "—") + '</td><td class="mono">' + esc(row.ip_address || "—") + "</td></tr>"
              );
            }).join("")) +
        "</tbody></table></div>" +

        '<div class="sec-section-title"><i class="bi bi-clipboard-check"></i> Approved maintenance sessions</div>' +
        '<p class="sec-hint">Record the authorized purpose before switching DB or code protection OFF, so the security audit log ties the window to an approval.</p>' +
        '<form class="sec-inline-form" id="secMaintenanceForm">' +
        '<label class="sec-field"><span>Purpose</span><input type="text" name="purpose" required maxlength="300" placeholder="e.g. School year rollover import"></label>' +
        '<label class="sec-field"><span>Scope</span><input type="text" name="scope" maxlength="200" placeholder="database | code"></label>' +
        '<label class="sec-field"><span>Switch</span><select name="switchKey"><option value="db_write_protection">db_write_protection</option><option value="code_write_protection">code_write_protection</option><option value="maintenance_mode">maintenance_mode</option></select></label>' +
        '<button type="submit" class="sec-btn sec-btn--primary">Record approval</button>' +
        "</form>" +
        '<div class="sec-table-wrap" style="margin-top:12px"><table class="sec-table"><thead><tr><th>When</th><th>Purpose</th><th>Scope</th><th>Switch</th><th>Approved by</th></tr></thead><tbody>' +
        (sessions.length === 0
          ? emptyRow(5, "No maintenance sessions recorded.")
          : sessions.map(function (row) {
              return "<tr><td>" + fmt(row.active_from) + "</td><td>" + esc(row.purpose) + "</td><td>" + esc(row.scope || "—") + '</td><td class="mono">' + esc(row.switch_key) + "</td><td>" + esc(row.approved_by_name) + "</td></tr>";
            }).join("")) +
        "</tbody></table></div>";

      mount.addEventListener("click", function (event) {
        var button = event.target.closest("[data-toggle]");
        if (!button) {
          return;
        }
        var key = button.getAttribute("data-toggle");
        var next = button.getAttribute("data-next") === "true";
        var critical = key === "security_lockdown" || key === "maintenance_mode";
        confirmDialog({
          title: (next ? "Enable " : "Disable ") + key,
          text:
            (next ? "This activates " : "This deactivates ") + key + ". " +
            (critical ? "Ordinary users may be affected immediately. " : "") +
            "The change is recorded with your SuperAdmin identity.",
          needInput: true,
          label: "Reason (recorded in the audit trail)",
          confirmText: next ? "Turn ON" : "Turn OFF"
        }).then(function (reason) {
          if (!reason) {
            return;
          }
          request("/switches/" + encodeURIComponent(key), {
            method: "POST",
            body: { enabled: next, reason: reason }
          })
            .then(function () {
              toast("Switch updated.", "ok");
              renderView("control");
            })
            .catch(function (error) {
              showAlert(error.message);
            });
        });
      });

      var form = byId("secMaintenanceForm");
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var data = new FormData(form);
        request("/maintenance-sessions", {
          method: "POST",
          body: {
            purpose: data.get("purpose"),
            scope: data.get("scope"),
            switchKey: data.get("switchKey")
          }
        })
          .then(function () {
            toast("Maintenance approval recorded.", "ok");
            renderView("control");
          })
          .catch(function (error) {
            showAlert(error.message);
          });
      });
    });
  };

  VIEWS.database = function (mount) {
    var decision = state.dbDecision || "";
    return Promise.all([request("/database-activity?decision=" + encodeURIComponent(decision)), request("/database-health")]).then(function (results) {
      var logs = results[0].logs || [];
      var aggregates = results[0].aggregates || [];
      var health = results[1];
      var guard = health.guardState || {};
      var switched = guard.switches || {};

      mount.innerHTML =
        '<div class="sec-grid sec-grid--4">' +
        '<article class="sec-card"><p class="sec-card__label">Recorded write operations</p><p class="sec-card__value">' + (health.recordedOperations || 0) + '</p><p class="sec-card__sub">Ledger entries</p></article>' +
        '<article class="sec-card"><p class="sec-card__label">Rejected operations</p><p class="sec-card__value">' + (health.rejectedOperations || 0) + '</p><p class="sec-card__sub">Blocked by the guard</p></article>' +
        '<article class="sec-card"><p class="sec-card__label">Write protection</p><p class="sec-card__value">' + (switched.db_write_protection ? "ON" : "OFF") + '</p><p class="sec-card__sub">Lockdown: ' + (switched.security_lockdown ? "ON" : "OFF") + "</p></article>" +
        '<article class="sec-card ' + (guard.degraded ? "sec-card--crit" : "") + '"><p class="sec-card__label">Guard state</p><p class="sec-card__value">' + (guard.degraded ? "FAIL-CLOSED" : guard.initialized ? "ACTIVE" : "INIT") + '</p><p class="sec-card__sub">Auth/validation always enforced</p></article>' +
        "</div>" +
        '<div class="sec-section-title"><i class="bi bi-sliders"></i> Activity ledger</div>' +
        '<div class="sec-toolbar"><label class="sec-field"><select id="secDbFilter"><option value="">All decisions</option><option value="allowed"' + (decision === "allowed" ? " selected" : "") + '>Allowed</option><option value="rejected"' + (decision === "rejected" ? " selected" : "") + ">Rejected</option></select></label></div>" +
        '<div class="sec-table-wrap"><table class="sec-table"><thead><tr><th>When</th><th>Operation</th><th>Table</th><th>Decision</th><th>Reason</th><th>Actor</th><th>Source</th></tr></thead><tbody>' +
        (logs.length === 0
          ? emptyRow(7, "No database activity recorded yet.")
          : logs.map(function (row) {
              return (
                "<tr><td>" + fmt(row.created_at) + "</td><td>" + esc(row.operation) + '</td><td class="mono">' + esc(row.table_name || "—") + "</td><td>" + statusBadge(row.decision) + "</td>" +
                "<td>" + esc(row.reason || "—") + "</td><td>" + esc(row.actor || "—") + "</td><td>" + esc(row.source || "—") + "</td></tr>"
              );
            }).join("")) +
        "</tbody></table></div>" +
        '<div class="sec-section-title"><i class="bi bi-pie-chart"></i> Decision summary</div>' +
        '<div class="sec-table-wrap"><table class="sec-table"><thead><tr><th>Decision</th><th>Operation</th><th>Count</th></tr></thead><tbody>' +
        (aggregates.length === 0
          ? emptyRow(3, "No aggregates yet.")
          : aggregates.map(function (row) {
              return "<tr><td>" + statusBadge(row.decision) + "</td><td>" + esc(row.operation) + "</td><td>" + row.total + "</td></tr>";
            }).join("")) +
        "</tbody></table></div>";

      var filter = byId("secDbFilter");
      filter.addEventListener("change", function () {
        state.dbDecision = filter.value;
        renderView("database");
      });
    });
  };

  VIEWS.code = function (mount) {
    return request("/code-integrity").then(function (data) {
      var records = data.records || [];
      var changed = records.filter(function (row) {
        return row.status !== "verified";
      });
      mount.innerHTML =
        '<div class="sec-grid sec-grid--3">' +
        '<article class="sec-card"><p class="sec-card__label">Baseline</p><p class="sec-card__value">' + (data.baseline ? data.baseline.files : 0) + ' files</p><p class="sec-card__sub">' + (data.baseline ? "Created " + fmt(data.baseline.createdAt) : "No baseline recorded") + "</p></article>" +
        '<article class="sec-card ' + (changed.length ? "sec-card--warn" : "sec-card--ok") + '"><p class="sec-card__label">Unexpected changes</p><p class="sec-card__value">' + changed.length + '</p><p class="sec-card__sub">Modified / missing / added</p></article>' +
        '<article class="sec-card"><p class="sec-card__label">Tracked files</p><p class="sec-card__value">' + records.length + '</p><p class="sec-card__sub">server/, client/, package manifests</p></article>' +
        "</div>" +
        '<div class="sec-toolbar" style="margin-top:14px">' +
        '<button type="button" class="sec-btn sec-btn--primary" id="secVerifyCode"><i class="bi bi-search"></i> Verify now</button>' +
        '<button type="button" class="sec-btn" id="secBaselineCode"><i class="bi bi-flag"></i> Set current tree as baseline</button>' +
        "</div>" +
        '<p class="sec-hint">Changing the baseline accepts the current files as trusted. Do this only after a reviewed, authorized deployment.</p>' +
        '<div class="sec-table-wrap"><table class="sec-table"><thead><tr><th>File</th><th>Status</th><th>SHA-256</th><th>Last verified</th></tr></thead><tbody>' +
        (records.length === 0
          ? emptyRow(4, "No integrity records yet. Set a baseline to start monitoring.")
          : records.slice(0, 250).map(function (row) {
              return (
                '<tr><td class="mono">' + esc(row.file_path) + "</td><td>" + statusBadge(row.status) + '</td><td class="mono">' + esc(String(row.sha256 || "").slice(0, 16)) + "…</td><td>" + fmt(row.last_verified_at) + "</td></tr>"
              );
            }).join("")) +
        "</tbody></table></div>";

      byId("secVerifyCode").addEventListener("click", function () {
        this.disabled = true;
        request("/code-integrity/verify", { method: "POST" })
          .then(function (report) {
            toast("Verification: " + report.status + " (" + report.changes.length + " change(s)).", report.changes.length ? "error" : "ok");
            renderView("code");
          })
          .catch(function (error) {
            showAlert(error.message);
          });
      });

      byId("secBaselineCode").addEventListener("click", function () {
        confirmDialog({
          title: "Set code baseline",
          text: "This records the current application files as trusted. Only do this after a reviewed deployment.",
          needInput: false,
          confirmText: "Set baseline"
        }).then(function (ok) {
          if (!ok) {
            return;
          }
          request("/code-integrity/baseline", { method: "POST" })
            .then(function (result) {
              toast("Baseline recorded for " + result.files + " files.", "ok");
              renderView("code");
            })
            .catch(function (error) {
              showAlert(error.message);
            });
        });
      });
    });
  };

  VIEWS.live = function (mount) {
    state.events = [];
    mount.innerHTML =
      '<div class="sec-toolbar">' +
      '<button type="button" class="sec-btn sec-btn--primary" id="secLiveToggle">Pause stream</button>' +
      '<span class="sec-pill is-ok" id="secLiveStatus">Connecting…</span>' +
      '<span class="sec-hint" style="margin:0">Server-sent events stream directly from the monitoring engine; closing this browser does not stop monitoring.</span>' +
      "</div>" +
      '<div class="sec-card"><div class="sec-live-log" id="secLiveLog"></div></div>';

    var log = byId("secLiveLog");
    var toggle = byId("secLiveToggle");
    var status = byId("secLiveStatus");
    var paused = false;

    function row(event) {
      return (
        '<div class="sec-live-log__row is-' + esc(event.severity) + '">' +
        '<span class="sec-live-log__time">' + new Date(event.createdAt || Date.now()).toLocaleTimeString() + "</span>" +
        "<span>" + sevBadge(event.severity) + "</span>" +
        "<span>" + esc(event.action) + " · " + esc(String(event.description || "").slice(0, 160)) + "</span></div>"
      );
    }

    function open() {
      closeStream();
      state.stream = new EventSource(BASE + "/events/stream");
      state.stream.addEventListener("hello", function () {
        status.textContent = "Live";
        status.className = "sec-pill is-ok";
      });
      state.stream.onmessage = function (message) {
        if (paused) {
          return;
        }
        try {
          var event = JSON.parse(message.data);
          var node = document.createElement("div");
          node.innerHTML = row(event);
          log.insertBefore(node.firstChild, log.firstChild);
          while (log.children.length > 200) {
            log.removeChild(log.lastChild);
          }
        } catch (error) {
          /* ignore malformed frame */
        }
      };
      state.stream.onerror = function () {
        status.textContent = "Reconnecting…";
        status.className = "sec-pill is-warn";
      };
    }

    toggle.addEventListener("click", function () {
      paused = !paused;
      toggle.textContent = paused ? "Resume stream" : "Pause stream";
    });

    log.innerHTML = '<div class="sec-empty">Waiting for events…</div>';
    open();
  };

  VIEWS.intrusion = function (mount) {
    var category = state.intrusionCategory || "";
    var severity = state.intrusionSeverity || "";
    var query = "/events?pageSize=100";
    if (category) {
      query += "&category=" + encodeURIComponent(category);
    }
    if (severity) {
      query += "&severity=" + encodeURIComponent(severity);
    }
    return request(query).then(function (data) {
      var events = data.events || [];
      mount.innerHTML =
        '<div class="sec-toolbar">' +
        '<label class="sec-field"><select id="secIntrusionCategory"><option value="">All categories</option>' +
        ["network", "auth", "database", "upload", "code", "firewall", "recovery"].map(function (item) {
          return '<option value="' + item + '"' + (category === item ? " selected" : "") + ">" + item + "</option>";
        }).join("") +
        "</select></label>" +
        '<label class="sec-field"><select id="secIntrusionSeverity"><option value="">All severities</option>' +
        ["informational", "low", "medium", "high", "critical"].map(function (item) {
          return '<option value="' + item + '"' + (severity === item ? " selected" : "") + ">" + item + "</option>";
        }).join("") +
        "</select></label>" +
        '<span class="sec-pill">' + (data.total || 0) + " events</span>" +
        "</div>" +
        '<p class="sec-hint">Indicators are detected from request content and response outcomes. Detection is recorded and escalated; blocking remains with authentication, authorization and the firewall switches.</p>' +
        eventsTable(events);

      byId("secIntrusionCategory").addEventListener("change", function () {
        state.intrusionCategory = this.value;
        renderView("intrusion");
      });
      byId("secIntrusionSeverity").addEventListener("change", function () {
        state.intrusionSeverity = this.value;
        renderView("intrusion");
      });
    });
  };

  var INCIDENT_FLOW = {
    new: ["investigating", "closed"],
    investigating: ["contained", "resolved", "closed"],
    contained: ["recovery_in_progress", "resolved"],
    recovery_in_progress: ["resolved"],
    resolved: ["closed"],
    closed: []
  };

  VIEWS.incidents = function (mount) {
    return request("/incidents?pageSize=100").then(function (data) {
      var incidents = data.incidents || [];
      mount.innerHTML =
        '<div class="sec-grid sec-grid--4">' +
        ["new", "investigating", "contained", "resolved"].map(function (status) {
          var total = incidents.filter(function (row) { return row.status === status; }).length;
          return '<article class="sec-card"><p class="sec-card__label">' + status + '</p><p class="sec-card__value">' + total + "</p></article>";
        }).join("") +
        "</div>" +
        '<div class="sec-section-title"><i class="bi bi-exclamation-octagon"></i> Incidents</div>' +
        '<div class="sec-table-wrap"><table class="sec-table"><thead><tr><th>Reference</th><th>Severity</th><th>Title</th><th>Status</th><th>Opened</th><th>Action</th></tr></thead><tbody>' +
        (incidents.length === 0
          ? emptyRow(6, "No incidents recorded. Critical events create incidents automatically.")
          : incidents.map(function (row) {
              var next = (INCIDENT_FLOW[row.status] || [])[0];
              return (
                "<tr><td class=\"mono\">" + esc(row.reference) + "</td><td>" + sevBadge(row.severity) + "</td>" +
                "<td>" + esc(row.title) + '<br><small style="color:#8ea1bd">' + esc(String(row.description || "").slice(0, 120)) + "</small></td>" +
                "<td>" + statusBadge(row.status) + "</td><td>" + fmt(row.opened_at) + "</td>" +
                "<td>" +
                (next
                  ? '<button type="button" class="sec-btn" data-incident="' + row.id + '" data-next="' + next + '">Mark ' + next.replace(/_/g, " ") + "</button>"
                  : "—") +
                "</td></tr>"
              );
            }).join("")) +
        "</tbody></table></div>";

      mount.addEventListener("click", function (event) {
        var button = event.target.closest("[data-incident]");
        if (!button) {
          return;
        }
        var id = button.getAttribute("data-incident");
        var next = button.getAttribute("data-next");
        confirmDialog({
          title: "Update incident",
          text: "Move this incident to \"" + next + "\"? Resolution notes are attached when provided.",
          needInput: true,
          label: "Resolution / investigation note (optional)",
          confirmText: "Update",
          tone: "primary"
        }).then(function (note) {
          if (note === null) {
            return;
          }
          request("/incidents/" + id + "/status", {
            method: "POST",
            body: { status: next, resolution: note || null }
          })
            .then(function () {
              toast("Incident updated.", "ok");
              renderView("incidents");
            })
            .catch(function (error) {
              showAlert(error.message);
            });
        });
      });
    });
  };

  VIEWS.uploads = function (mount) {
    var result = state.uploadResult || "";
    return request("/uploads?result=" + encodeURIComponent(result)).then(function (data) {
      var logs = data.logs || [];
      mount.innerHTML =
        '<div class="sec-toolbar"><label class="sec-field"><select id="secUploadFilter"><option value="">All results</option>' +
        ["clean", "rejected", "pending", "error"].map(function (item) {
          return '<option value="' + item + '"' + (result === item ? " selected" : "") + ">" + item + "</option>";
        }).join("") +
        '</select></label><span class="sec-pill">' + (data.total || 0) + " uploads</span></div>" +
        '<p class="sec-hint">Every upload that passes through the API is logged with declared vs detected type, size, actor and outcome. Executable and mismatched files are rejected.</p>' +
        '<div class="sec-table-wrap"><table class="sec-table"><thead><tr><th>When</th><th>File</th><th>User</th><th>Size</th><th>Declared → detected</th><th>Result</th><th>Reason</th></tr></thead><tbody>' +
        (logs.length === 0
          ? emptyRow(7, "No uploads recorded yet.")
          : logs.map(function (row) {
              return (
                "<tr><td>" + fmt(row.created_at) + "</td><td>" + esc(row.original_name) + "</td><td>" + esc(row.username || "—") + "</td>" +
                "<td>" + (row.file_size ? Math.round(row.file_size / 1024) + " KB" : "—") + '</td><td class="mono">' + esc(row.declared_mime || "?") + " → " + esc(row.detected_mime || "?") + "</td>" +
                "<td>" + statusBadge(row.scan_result) + "</td><td>" + esc(row.rejection_reason || "—") + "</td></tr>"
              );
            }).join("")) +
        "</tbody></table></div>";

      byId("secUploadFilter").addEventListener("change", function () {
        state.uploadResult = this.value;
        renderView("uploads");
      });
    });
  };

  VIEWS.audit = function (mount) {
    return request("/audit-logs?pageSize=100").then(function (data) {
      var logs = data.logs || [];
      mount.innerHTML =
        '<div class="sec-toolbar">' +
        '<button type="button" class="sec-btn sec-btn--primary" id="secAuditVerify"><i class="bi bi-link-45deg"></i> Verify hash chain</button>' +
        '<a class="sec-btn" href="' + BASE + '/audit-logs/export"><i class="bi bi-filetype-csv"></i> Export CSV</a>' +
        '<span class="sec-pill">' + (data.total || 0) + " entries</span>" +
        "</div>" +
        '<p class="sec-hint">Each entry hashes the previous one. Verification walks the chain and reports the first broken link; entries are append-only.</p>' +
        '<div class="sec-table-wrap"><table class="sec-table"><thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Target</th><th>IP</th><th>Hash</th></tr></thead><tbody>' +
        (logs.length === 0
          ? emptyRow(6, "No audit entries yet.")
          : logs.map(function (row) {
              return (
                "<tr><td>" + fmt(row.occurred_at) + "</td><td>" + esc(row.action) + "</td><td>" + esc(row.actor_name) + "</td>" +
                "<td>" + esc(row.target_type || "—") + (row.target_id ? " · " + esc(row.target_id) : "") + '</td><td class="mono">' + esc(row.ip_address || "—") + "</td>" +
                '<td class="mono">' + esc(String(row.entry_hash || "").slice(0, 14)) + "…</td></tr>"
              );
            }).join("")) +
        "</tbody></table></div>";

      byId("secAuditVerify").addEventListener("click", function () {
        request("/audit-logs/verify")
          .then(function (result) {
            if (result.intact) {
              showAlert("Audit chain intact — " + result.entries + " entries verified.", "ok");
            } else {
              showAlert("Audit chain BROKEN at entry " + result.brokenAtId + ". Preserve evidence and investigate.");
            }
          })
          .catch(function (error) {
            showAlert(error.message);
          });
      });
    });
  };

  VIEWS.dbhealth = function (mount) {
    return request("/database-health").then(function (data) {
      var history = data.history || [];
      mount.innerHTML =
        '<div class="sec-grid sec-grid--4">' +
        '<article class="sec-card"><p class="sec-card__label">Recorded operations</p><p class="sec-card__value">' + (data.recordedOperations || 0) + '</p></article>' +
        '<article class="sec-card"><p class="sec-card__label">Rejected operations</p><p class="sec-card__value">' + (data.rejectedOperations || 0) + '</p></article>' +
        '<article class="sec-card"><p class="sec-card__label">Guard</p><p class="sec-card__value">' + (data.guardState && data.guardState.degraded ? "FAIL-CLOSED" : "ACTIVE") + "</p></article>" +
        '<article class="sec-card"><p class="sec-card__label">Write protection</p><p class="sec-card__value">' + (data.guardState && data.guardState.switches.db_write_protection ? "ON" : "OFF") + "</p></article>" +
        "</div>" +
        '<div class="sec-section-title"><i class="bi bi-graph-up"></i> Probe latency (24h)</div>' +
        '<div class="sec-card"><div class="sec-canvas-wrap"><canvas id="secDbChart"></canvas></div></div>' +
        '<div class="sec-section-title"><i class="bi bi-clipboard-pulse"></i> Probe summary</div>' +
        '<div class="sec-table-wrap"><table class="sec-table"><thead><tr><th>Status</th><th>Probes</th><th>Avg latency</th><th>Last probe</th></tr></thead><tbody>' +
        ((data.probes || []).length === 0
          ? emptyRow(4, "No probes recorded yet.")
          : data.probes.map(function (row) {
              return "<tr><td>" + statusBadge(row.status) + "</td><td>" + row.probes + "</td><td>" + (row.avg_latency || 0) + " ms</td><td>" + fmt(row.last_at) + "</td></tr>";
            }).join("")) +
        "</tbody></table></div>";

      drawLineChart(byId("secDbChart"), [
        { labels: history.map(function (row) { return row.bucket; }), values: history.map(function (row) { return row.avg_latency || 0; }), color: "#38bdf8" }
      ]);
    });
  };

  VIEWS.apphealth = function (mount) {
    return request("/health").then(function (data) {
      var worker = data.worker || {};
      mount.innerHTML =
        '<div class="sec-grid sec-grid--3">' +
        '<article class="sec-card ' + (worker.running ? "sec-card--ok" : "sec-card--crit") + '"><p class="sec-card__label">Monitoring worker</p><p class="sec-card__value">' + (worker.running ? "RUNNING" : "STOPPED") + "</p><p class=\"sec-card__sub\">Uptime " + Math.floor((worker.uptimeSeconds || 0) / 60) + " min · started " + fmt(worker.startedAt) + "</p></article>" +
        '<article class="sec-card"><p class="sec-card__label">Health interval</p><p class="sec-card__value">' + Math.round((worker.intervals ? worker.intervals.healthMs : 0) / 1000) + 's</p><p class="sec-card__sub">Database + heartbeat probes</p></article>' +
        '<article class="sec-card"><p class="sec-card__label">Code scan interval</p><p class="sec-card__value">' + Math.round((worker.intervals ? worker.intervals.codeScanMs : 0) / 60000) + ' min</p><p class="sec-card__sub">Retention ' + (worker.retentionDays || 0) + " days</p></article>" +
        "</div>" +
        '<div class="sec-section-title"><i class="bi bi-heart-pulse"></i> Component health</div>' +
        '<div class="sec-table-wrap"><table class="sec-table"><thead><tr><th>Check</th><th>Status</th><th>Probes</th><th>Avg latency</th><th>Last</th></tr></thead><tbody>' +
        ((data.probes || []).length === 0
          ? emptyRow(5, "No health probes recorded yet.")
          : data.probes.map(function (row) {
              return "<tr><td>" + esc(row.check_name) + "</td><td>" + statusBadge(row.status) + "</td><td>" + row.probes + "</td><td>" + (row.avg_latency ? row.avg_latency + " ms" : "—") + "</td><td>" + fmt(row.last_at) + "</td></tr>";
            }).join("")) +
        "</tbody></table></div>" +
        '<p class="sec-hint" style="margin-top:12px">Health probes persist regardless of whether a dashboard is open. Server-level monitoring (external uptime checks, log shipping) is documented in REQUIREMENTS.md as an additional layer.</p>';
    });
  };

  VIEWS.backup = function (mount) {
    return request("/backups").then(function (data) {
      var backups = data.backups || [];
      mount.innerHTML =
        '<div class="sec-toolbar">' +
        '<input type="text" id="secBackupLabel" placeholder="Backup label" maxlength="120" style="min-width:240px">' +
        '<button type="button" class="sec-btn sec-btn--primary" id="secCreateBackup"><i class="bi bi-hdd"></i> Create database backup</button>' +
        '<span class="sec-pill">' + esc(data.backupDir || "") + "</span>" +
        "</div>" +
        '<p class="sec-hint">Backups are written outside the served application tree with pg_dump and must pass pg_restore verification before recovery will accept them.</p>' +
        '<div class="sec-table-wrap"><table class="sec-table"><thead><tr><th>Label</th><th>Created</th><th>Size</th><th>Status</th><th>Verified</th><th>Actions</th></tr></thead><tbody>' +
        (backups.length === 0
          ? emptyRow(6, "No backups recorded yet.")
          : backups.map(function (row) {
              return (
                "<tr><td>" + esc(row.label) + '</td><td>' + fmt(row.created_at) + "</td><td>" + (row.file_size ? Math.round(row.file_size / 1024) + " KB" : "—") + "</td>" +
                "<td>" + statusBadge(row.status) + "</td><td>" + fmt(row.verified_at) + "</td><td>" +
                '<button type="button" class="sec-btn" data-verify="' + row.id + '">Verify</button> ' +
                '<button type="button" class="sec-btn sec-btn--danger" data-restore="' + row.id + '"' + (row.status !== "verified" ? " disabled" : "") + ">Restore</button>" +
                "</td></tr>"
              );
            }).join("")) +
        "</tbody></table></div>";

      byId("secCreateBackup").addEventListener("click", function () {
        var label = byId("secBackupLabel").value.trim();
        if (label.length < 3) {
          toast("Enter a backup label first.", "error");
          return;
        }
        this.disabled = true;
        request("/backups", { method: "POST", body: { label: label } })
          .then(function () {
            toast("Backup created. Run verification next.", "ok");
            renderView("backup");
          })
          .catch(function (error) {
            showAlert(error.message);
          })
          .finally(function () {
            this.disabled = false;
          }.bind(this));
      });

      mount.addEventListener("click", function (event) {
        var verifyBtn = event.target.closest("[data-verify]");
        var restoreBtn = event.target.closest("[data-restore]");
        if (verifyBtn) {
          request("/backups/" + verifyBtn.getAttribute("data-verify") + "/verify", { method: "POST" })
            .then(function (result) {
              toast("Backup " + result.status + ".", result.status === "verified" ? "ok" : "error");
              renderView("backup");
            })
            .catch(function (error) {
              showAlert(error.message);
            });
        }
        if (restoreBtn) {
          confirmDialog({
            title: "Restore verified backup",
            text: "Type DEFINITELY-RESTORE and your current SuperAdmin password. Evidence is exported before the restore; this cannot be undone casually.",
            needInput: true,
            label: "Type: DEFINITELY-RESTORE",
            confirmText: "Continue"
          }).then(function (phrase) {
            if (!phrase) {
              return;
            }
            var password = window.prompt("Re-enter your SuperAdmin password to authorize the restore:");
            if (!password) {
              return;
            }
            request("/backups/" + restoreBtn.getAttribute("data-restore") + "/restore", {
              method: "POST",
              body: { confirmation: phrase, currentPassword: password }
            })
              .then(function (result) {
                toast("Restore completed. Evidence: " + result.evidencePath, "ok");
                renderView("backup");
              })
              .catch(function (error) {
                showAlert(error.message);
              });
          });
        }
      });
    });
  };

  var RECOVERY_FLOW = ["detect", "contain", "preserve", "assess", "verify_backup", "restore", "verify_integrity", "reactivate", "completed"];

  VIEWS.recovery = function (mount) {
    return Promise.all([request("/recovery"), request("/backups")]).then(function (results) {
      var sessions = results[0].sessions || [];
      var backups = (results[1].backups || []).filter(function (row) {
        return row.status === "verified";
      });
      var active = sessions.find(function (row) {
        return row.status !== "completed" && row.status !== "aborted";
      });

      function flowHtml(status) {
        var index = RECOVERY_FLOW.indexOf(status);
        return (
          '<div class="sec-flow">' +
          RECOVERY_FLOW.map(function (step, position) {
            var cls = position < index ? " done" : position === index ? " current" : "";
            return '<span class="sec-flow__step' + cls + '">' + step.replace(/_/g, " ") + "</span>" + (position < RECOVERY_FLOW.length - 1 ? '<span class="sec-flow__arrow">→</span>' : "");
          }).join("") +
          "</div>"
        );
      }

      mount.innerHTML =
        '<div class="sec-toolbar">' +
        '<button type="button" class="sec-btn sec-btn--danger" id="secStartRecovery"><i class="bi bi-exclamation-triangle"></i> Activate emergency recovery</button>' +
        "</div>" +
        '<p class="sec-hint">Activation engages SECURITY LOCKDOWN (freezes database and code changes), preserves evidence, and walks the DETECT → REACTIVATE workflow. Restoration itself requires a verified backup and re-authentication.</p>' +
        (active
          ? '<section class="sec-card" style="margin-bottom:16px"><div class="sec-kpi-row"><p class="sec-card__label">Active recovery ' + esc(active.reference) + '</p><span class="sec-pill is-crit">' + esc(active.status) + "</span></div>" +
            flowHtml(active.status) +
            '<p class="sec-hint">Trigger: ' + esc(active.trigger_event) + " · Activated " + fmt(active.activated_at) + " by " + esc(active.activated_by_name || "—") + "</p>" +
            '<div class="sec-toolbar">' +
            (active.status === "restore" && backups.length
              ? '<select id="secRecoveryBackup" class="sec-field" style="min-width:260px">' + backups.map(function (row) { return '<option value="' + row.id + '">' + esc(row.label) + " · " + fmt(row.created_at) + "</option>"; }).join("") + "</select>"
              : "") +
            '<button type="button" class="sec-btn sec-btn--primary" id="secAdvanceRecovery" data-id="' + active.id + '" data-next="' + nextStep(active.status) + '"' + (nextStep(active.status) ? "" : " disabled") + ">" +
            (nextStep(active.status) ? "Advance to " + nextStep(active.status).replace(/_/g, " ") : "Workflow complete") + "</button>" +
            (active.status === "verify_integrity" ? '<button type="button" class="sec-btn" id="secIntegrityCheck" data-id="' + active.id + '">Run integrity check</button>' : "") +
            '<button type="button" class="sec-btn" id="secAbortRecovery" data-id="' + active.id + '">Abort</button>' +
            "</div>" +
            '<ul class="sec-list" style="margin-top:10px">' +
            (active.progress_notes || []).slice(-6).map(function (note) {
              return "<li><span>" + fmt(note.at) + " · " + esc(note.by) + "</span><span style=\"text-align:right;max-width:60%\">" + esc(note.message) + "</span></li>";
            }).join("") +
            "</ul></section>"
          : "") +
        '<div class="sec-section-title"><i class="bi bi-clock-history"></i> Recovery history</div>' +
        '<div class="sec-table-wrap"><table class="sec-table"><thead><tr><th>Reference</th><th>Trigger</th><th>Status</th><th>Activated by</th><th>Activated</th><th>Completed</th></tr></thead><tbody>' +
        (sessions.length === 0
          ? emptyRow(6, "No recovery sessions recorded.")
          : sessions.map(function (row) {
              return "<tr><td class=\"mono\">" + esc(row.reference) + "</td><td>" + esc(row.trigger_event) + "</td><td>" + statusBadge(row.status) + "</td><td>" + esc(row.activated_by_name || "—") + "</td><td>" + fmt(row.activated_at) + "</td><td>" + fmt(row.completed_at) + "</td></tr>";
            }).join("")) +
        "</tbody></table></div>";

      byId("secStartRecovery").addEventListener("click", function () {
        confirmDialog({
          title: "Activate emergency recovery",
          text: "This engages SECURITY LOCKDOWN immediately and freezes all application database writes. Use only for a genuine critical incident.",
          needInput: true,
          label: "Describe the triggering incident",
          confirmText: "Activate"
        }).then(function (notes) {
          if (!notes) {
            return;
          }
          request("/recovery", { method: "POST", body: { triggerEvent: "manual", affectedNotes: notes } })
            .then(function () {
              toast("Recovery session activated; lockdown engaged.", "error");
              renderView("recovery");
            })
            .catch(function (error) {
              showAlert(error.message);
            });
        });
      });

      var advanceBtn = byId("secAdvanceRecovery");
      if (advanceBtn) {
        advanceBtn.addEventListener("click", function () {
          var id = advanceBtn.getAttribute("data-id");
          var next = advanceBtn.getAttribute("data-next");
          var select = byId("secRecoveryBackup");
          var body = { to: next, backupId: select ? select.value : null };
          if (next === "restore") {
            confirmDialog({
              title: "Restore verified backup",
              text: "Restoration is destructive. Confirm that evidence has been preserved and the selected backup is the intended recovery point.",
              needInput: true,
              label: "Note for the recovery log",
              confirmText: "Proceed to restore"
            }).then(function (note) {
              if (!note) {
                return;
              }
              body.message = note;
              request("/recovery/" + id + "/advance", { method: "POST", body: body })
                .then(function () {
                  toast("Recovery advanced.", "ok");
                  renderView("recovery");
                })
                .catch(function (error) {
                  showAlert(error.message);
                });
            });
            return;
          }
          request("/recovery/" + id + "/advance", { method: "POST", body: body })
            .then(function () {
              toast("Recovery advanced to " + next + ".", "ok");
              renderView("recovery");
            })
            .catch(function (error) {
              showAlert(error.message);
            });
        });
      }

      var integrityBtn = byId("secIntegrityCheck");
      if (integrityBtn) {
        integrityBtn.addEventListener("click", function () {
          request("/recovery/" + integrityBtn.getAttribute("data-id") + "/integrity-check", { method: "POST" })
            .then(function (result) {
              toast("Integrity check complete: code " + result.code.status + ".", "ok");
              renderView("recovery");
            })
            .catch(function (error) {
              showAlert(error.message);
            });
        });
      }

      var abortBtn = byId("secAbortRecovery");
      if (abortBtn) {
        abortBtn.addEventListener("click", function () {
          confirmDialog({
            title: "Abort recovery",
            text: "Abort this recovery session? Lockdown stays engaged until you turn it off in the control center.",
            needInput: true,
            label: "Abort reason",
            confirmText: "Abort"
          }).then(function (reason) {
            if (!reason) {
              return;
            }
            request("/recovery/" + abortBtn.getAttribute("data-id") + "/abort", { method: "POST", body: { reason: reason } })
              .then(function () {
                toast("Recovery aborted.", "error");
                renderView("recovery");
              })
              .catch(function (error) {
                showAlert(error.message);
              });
          });
        });
      }
    });
  };

  function nextStep(status) {
    var index = RECOVERY_FLOW.indexOf(status);
    if (index === -1 || index >= RECOVERY_FLOW.length - 1) {
      return null;
    }
    return RECOVERY_FLOW[index + 1];
  }

  VIEWS.config = function (mount) {
    return Promise.all([request("/config"), request("/switches")]).then(function (results) {
      var config = results[0];
      var switches = results[1].switches || [];
      mount.innerHTML =
        '<div class="sec-grid sec-grid--2">' +
        '<section class="sec-card"><p class="sec-card__label">Monitoring</p><ul class="sec-list">' +
        "<li><span>Health probe interval</span><span>" + Math.round((config.intervals ? config.intervals.healthMs : 0) / 1000) + " s</span></li>" +
        "<li><span>Code scan interval</span><span>" + Math.round((config.intervals ? config.intervals.codeScanMs : 0) / 60000) + " min</span></li>" +
        "<li><span>Retention</span><span>" + (config.retentionDays || 0) + " days</span></li>" +
        "<li><span>Event table size</span><span>" + esc(config.eventsTableSize || "—") + "</span></li>" +
        "</ul></section>" +
        '<section class="sec-card"><p class="sec-card__label">Integrations</p><ul class="sec-list">' +
        "<li><span>Alert email</span><span>" + (config.alertEmailConfigured ? "Configured" : "Not configured") + "</span></li>" +
        "<li><span>Backup directory</span><span class=\"mono\">" + esc(config.backupDir || "") + "</span></li>" +
        "<li><span>Malware scanner</span><span>Signature + type inspection built in</span></li>" +
        "<li><span>Log export</span><span>CSV available in Audit Logs</span></li>" +
        "</ul></section></div>" +
        '<div class="sec-section-title"><i class="bi bi-shield-check"></i> Current policy state</div>' +
        '<div class="sec-table-wrap"><table class="sec-table"><thead><tr><th>Switch</th><th>State</th><th>Policy note</th><th>Updated</th></tr></thead><tbody>' +
        switches.map(function (row) {
          return "<tr><td class=\"mono\">" + esc(row.key) + "</td><td>" + (row.enabled ? "ON" : "OFF") + "</td><td>" + esc(row.policy_note) + "</td><td>" + fmt(row.updated_at) + "</td></tr>";
        }).join("") +
        "</tbody></table></div>" +
        '<p class="sec-hint" style="margin-top:14px">Environment variables: SECURITY_HEALTH_INTERVAL_MS, SECURITY_CODE_SCAN_INTERVAL_MS, SECURITY_RETENTION_DAYS, SECURITY_BACKUP_DIR, SECURITY_ALERT_EMAIL. Server-level requirements are listed in docs/security-module/REQUIREMENTS.md.</p>';
    });
  };

  VIEWS.accounts = function (mount) {
    return request("/accounts").then(function (data) {
      var accounts = data.accounts || [];
      mount.innerHTML =
        '<div class="sec-section-title"><i class="bi bi-person-plus"></i> Create SuperAdmin</div>' +
        '<form class="sec-inline-form" id="secAccountForm">' +
        '<label class="sec-field"><span>Username</span><input name="username" required maxlength="33" placeholder="lowercase, 4-33 chars"></label>' +
        '<label class="sec-field"><span>Full name</span><input name="fullName" required maxlength="160"></label>' +
        '<label class="sec-field"><span>Email (optional)</span><input name="email" type="email" maxlength="160"></label>' +
        '<label class="sec-field"><span>Password (12+, mixed)</span><input name="password" type="password" required minlength="12"></label>' +
        '<button type="submit" class="sec-btn sec-btn--primary">Create account</button>' +
        "</form>" +
        '<p class="sec-hint">The TOTP secret is shown once after creation. Existing SDMS administrators cannot be promoted here or anywhere else.</p>' +
        '<div id="secTotpBox"></div>' +
        '<div class="sec-section-title"><i class="bi bi-people"></i> SuperAdmin accounts</div>' +
        '<div class="sec-table-wrap"><table class="sec-table"><thead><tr><th>Username</th><th>Name</th><th>MFA</th><th>Active</th><th>Last sign-in</th><th>Actions</th></tr></thead><tbody>' +
        accounts.map(function (row) {
          return (
            "<tr><td>" + esc(row.username) + "</td><td>" + esc(row.fullName) + "</td><td>" + (row.totpEnabled ? "Enabled" : "—") + "</td>" +
            "<td>" + (row.isActive ? "Yes" : "No") + "</td><td>" + fmt(row.lastLoginAt) + "</td><td>" +
            '<button type="button" class="sec-btn" data-account="' + row.id + '" data-active="' + (!row.isActive) + '">' + (row.isActive ? "Deactivate" : "Activate") + "</button> " +
            '<button type="button" class="sec-btn" data-reset-totp="' + row.id + '">Reset MFA</button>' +
            "</td></tr>"
          );
        }).join("") +
        "</tbody></table></div>";

      byId("secAccountForm").addEventListener("submit", function (event) {
        event.preventDefault();
        var form = event.target;
        var data = new FormData(form);
        request("/accounts", {
          method: "POST",
          body: {
            username: data.get("username"),
            fullName: data.get("fullName"),
            email: data.get("email") || null,
            password: data.get("password")
          }
        })
          .then(function (result) {
            form.reset();
            byId("secTotpBox").innerHTML =
              '<div class="sec-alert sec-alert--ok">Account created. TOTP secret (store it now): <div class="sec-code" style="margin-top:8px">' +
              esc(result.totpSecret) +
              "</div></div>";
            renderView("accounts");
          })
          .catch(function (error) {
            showAlert(error.message);
          });
      });

      mount.addEventListener("click", function (event) {
        var toggle = event.target.closest("[data-account]");
        var reset = event.target.closest("[data-reset-totp]");
        if (toggle) {
          var active = toggle.getAttribute("data-active") === "true";
          confirmDialog({
            title: active ? "Activate SuperAdmin" : "Deactivate SuperAdmin",
            text: "Account status changes take effect before the next request and are audited.",
            needInput: false,
            confirmText: active ? "Activate" : "Deactivate"
          }).then(function (ok) {
            if (!ok) {
              return;
            }
            request("/accounts/" + toggle.getAttribute("data-account") + "/active", {
              method: "POST",
              body: { isActive: active }
            })
              .then(function () {
                toast("Account updated.", "ok");
                renderView("accounts");
              })
              .catch(function (error) {
                showAlert(error.message);
              });
          });
        }
        if (reset) {
          confirmDialog({
            title: "Reset MFA",
            text: "A new TOTP secret is generated and shown once. The account keeps its password.",
            needInput: false,
            confirmText: "Reset"
          }).then(function (ok) {
            if (!ok) {
              return;
            }
            request("/accounts/" + reset.getAttribute("data-reset-totp") + "/reset-totp", { method: "POST" })
              .then(function (result) {
                byId("secTotpBox").innerHTML =
                  '<div class="sec-alert sec-alert--warn">New TOTP secret: <div class="sec-code" style="margin-top:8px">' + esc(result.totpSecret) + "</div></div>";
                renderView("accounts");
              })
              .catch(function (error) {
                showAlert(error.message);
              });
          });
        }
      });
    });
  };

  boot();
})(window, document);
