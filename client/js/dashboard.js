/* School District Monitoring System — dashboard page */
(function (window, document) {
  "use strict";

  var state = {
    session: null,
    districtId: "",
    period: "",
    focusSchool: "",
    refreshing: false
  };
  var learnerFilters = { grades: [], sections: [], yearId: null };
  var charts = {};
  var schoolTable = null;
  var refreshSequence = 0;
  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var elements = {};

  function cacheElements() {
    [
      "greetingHeading",
      "dashboardDate",
      "districtOverview",
      "districtControl",
      "districtFilter",
      "periodFilter",
      "refreshDashboard",
      "dashboardAlert",
      "statSchools",
      "statActive",
      "statStudents",
      "statTeachers",
      "statPending",
      "statAttention",
      "statActiveRate",
      "statPendingTag",
      "statPendingDescription",
      "statSchoolsDescription",
      "chartFocus",
      "enrollmentChart",
      "enrollmentEmpty",
      "enrollmentSummary",
      "enrollmentChartSubtitle",
      "performanceChart",
      "performanceEmpty",
      "performanceSummary",
      "performanceChartSubtitle",
      "reportStatusChart",
      "reportStatusLegend",
      "reportStatusTotal",
      "reportStatusSummary",
      "reportChartPeriod",
      "reportStatusEmpty",
      "reportStatusCenter",
      "classificationChart",
      "classificationLegend",
      "classificationTotal",
      "classificationSummary",
      "classificationEmpty",
      "classificationCenter",
      "recentActivity",
      "activityAuditLink",
      "footerUpdated",
      "learnerSnapshotNote",
      "learnerKpiYear",
      "learnerKpiTotal",
      "learnerKpiEnrolled",
      "learnerKpiEnrolledNote",
      "learnerKpiIncomplete",
      "learnerKpiIncompleteNote",
      "learnerKpiSections",
      "learnerKpiSectionsNote",
      "learnerGradeList",
      "learnerGradeSubtitle",
      "learnerGradeSummary",
      "dashboardLearnerSearch",
      "dashboardLearnerSearchInput",
      "dashboardLearnerGrade",
      "dashboardLearnerSection"
    ].forEach(function (id) {
      elements[id] = document.getElementById(id);
    });
  }

  function setGreeting(session) {
    var hour = new Date().getHours();
    var phrase = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    var name =
      session.user.role === "system_admin" ? "Administrator" : window.UI.firstName(session.user.fullName);
    if (elements.greetingHeading) {
      elements.greetingHeading.textContent = phrase + ", " + name + "!";
    }
    if (elements.dashboardDate) {
      elements.dashboardDate.textContent = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric"
      }).format(new Date());
    }
  }

  function configureDistrictControl(session) {
    if (!session.permissions.canSelectDistrict || !elements.districtControl) {
      return;
    }
    var select = elements.districtFilter;
    var options = ['<option value="">All districts</option>'];
    (session.districts || []).forEach(function (district) {
      options.push(
        '<option value="' +
          district.id +
          '">' +
          window.UI.escapeHtml(district.name) +
          "</option>"
      );
    });
    select.innerHTML = options.join("");
    elements.districtControl.classList.remove("d-none");
    select.addEventListener("change", function () {
      state.districtId = select.value;
      state.period = "";
      state.focusSchool = "";
      refreshAll();
    });
  }

  function scopeName() {
    if (!state.session) {
      return "";
    }
    if (!state.districtId) {
      return state.session.user.role === "system_admin" ? "" : state.session.user.districtName || "";
    }
    var district = (state.session.districts || []).find(function (item) {
      return String(item.id) === String(state.districtId);
    });
    return district ? district.name : "";
  }

  function scopeParams() {
    var params = {};
    if (state.districtId) {
      params.districtId = state.districtId;
    }
    return params;
  }

  function populatePeriods(periods, selected) {
    if (!elements.periodFilter) {
      return;
    }
    var unique = [];
    [selected]
      .concat(periods || [])
      .filter(Boolean)
      .forEach(function (period) {
        if (unique.indexOf(period) === -1) {
          unique.push(period);
        }
      });
    unique.sort().reverse();
    elements.periodFilter.innerHTML = unique
      .map(function (period) {
        return (
          '<option value="' +
          window.UI.escapeHtml(period) +
          '"' +
          (period === selected ? " selected" : "") +
          ">" +
          window.UI.escapeHtml(window.UI.month(period)) +
          "</option>"
        );
      })
      .join("");
    elements.periodFilter.disabled = unique.length === 0;
  }

  function updateFocusOptions(schools) {
    if (!elements.chartFocus) {
      return;
    }
    var exists = schools.some(function (school) {
      return String(school.id) === String(state.focusSchool) && state.focusSchool;
    });
    if (!exists) {
      state.focusSchool = "";
    }
    elements.chartFocus.innerHTML =
      '<option value="">All schools</option>' +
      schools
        .map(function (school) {
          return (
            '<option value="' +
            school.id +
            '"' +
            (String(school.id) === String(state.focusSchool) ? " selected" : "") +
            ">" +
            window.UI.escapeHtml(school.name) +
            "</option>"
          );
        })
        .join("");
    elements.chartFocus.disabled = schools.length === 0;
  }

  function renderSummary(data) {
    var total = Number(data.totalSchools || 0);
    var active = Number(data.activeSchools || 0);
    var students = Number(data.totalStudents || 0);
    var teachers = Number(data.totalTeachers || 0);
    var pending = Number(data.pendingReports || 0);
    var attention = Number(data.attentionSchools || 0);
    var period = data.period || state.period;

    elements.statSchools.textContent = window.UI.number(total);
    elements.statActive.textContent = window.UI.number(active);
    elements.statStudents.textContent = window.UI.number(students);
    elements.statTeachers.textContent = window.UI.number(teachers);
    elements.statPending.textContent = window.UI.number(pending);
    elements.statAttention.textContent = window.UI.number(attention);
    elements.statActiveRate.textContent = total ? Math.round((active / total) * 100) + "% active" : "No schools";
    elements.statPendingTag.textContent = period ? window.UI.month(period).split(" ")[0] : "Reports";
    elements.statPendingDescription.textContent = period
      ? "Awaiting submission for " + window.UI.month(period)
      : "Awaiting submission for the selected period";
    elements.statSchoolsDescription.textContent = scopeName()
      ? scopeName() + " register"
      : "All districts combined";

    elements.districtOverview.textContent =
      window.UI.number(total) +
      " schools · " +
      window.UI.number(active) +
      " active · " +
      window.UI.number(students) +
      " students monitored";

    if (elements.footerUpdated) {
      elements.footerUpdated.textContent =
        "Data refreshed " +
        new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date());
    }
  }

  function enrollmentConfig(schools) {
    var sorted = schools.slice().sort(function (a, b) {
      return Number(b.students) - Number(a.students);
    });
    var focus = sorted.find(function (school) {
      return String(school.id) === String(state.focusSchool);
    });
    var visible = sorted.slice(0, 8);
    if (focus && visible.indexOf(focus) === -1) {
      visible = [focus].concat(sorted.slice(0, 7));
      visible.sort(function (a, b) {
        return Number(b.students) - Number(a.students);
      });
    }
    var labels = visible.map(function (school) {
      return school.name;
    });
    var values = visible.map(function (school) {
      return Number(school.students);
    });
    var colors = visible.map(function (school) {
      if (!state.focusSchool) {
        return window.UI.CHART_COLORS.blue;
      }
      return String(school.id) === String(state.focusSchool)
        ? window.UI.CHART_COLORS.royal
        : "rgba(61, 143, 209, .28)";
    });

    return {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Students",
            data: values,
            backgroundColor: colors,
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 22
          }
        ]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: reducedMotion ? 0 : 550 },
        layout: { padding: { right: 8 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#0a2342",
            padding: 12,
            cornerRadius: 8,
            displayColors: false,
            titleFont: { weight: "600" },
            callbacks: {
              label: function (context) {
                return window.UI.number(context.parsed.x) + " students";
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: "#eef3f9", drawBorder: false },
            border: { display: false },
            ticks: {
              color: "#7a8ea4",
              callback: function (value) {
                return window.UI.compactNumber(value);
              }
            }
          },
          y: {
            reverse: true,
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: "#41566c",
              font: { size: 11.5 },
              callback: function (value) {
                var label = this.getLabelForValue(value);
                return label.length > 26 ? label.slice(0, 24) + "…" : label;
              }
            }
          }
        }
      }
    };
  }

  function performanceConfig(schools) {
    var sorted = schools.slice().sort(function (a, b) {
      return Number(b.score) - Number(a.score);
    });
    var focus = sorted.find(function (school) {
      return String(school.id) === String(state.focusSchool);
    });
    var visible = sorted.slice(0, 8);
    if (focus && visible.indexOf(focus) === -1) {
      visible = [focus].concat(sorted.slice(0, 7));
      visible.sort(function (a, b) {
        return Number(b.score) - Number(a.score);
      });
    }
    var labels = visible.map(function (school) {
      return school.name;
    });
    var values = visible.map(function (school) {
      return Number(school.score);
    });
    var colors = visible.map(function (school) {
      var focused = String(school.id) === String(state.focusSchool);
      var base =
        school.score >= 90
          ? window.UI.CHART_COLORS.teal
          : school.score >= 80
            ? window.UI.CHART_COLORS.royal
            : window.UI.CHART_COLORS.amber;
      if (!state.focusSchool || focused) {
        return base;
      }
      return "rgba(138, 155, 176, .35)";
    });

    return {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Performance score",
            data: values,
            backgroundColor: colors,
            borderRadius: 6,
            borderSkipped: false,
            maxBarThickness: 22
          }
        ]
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: reducedMotion ? 0 : 550 },
        layout: { padding: { right: 8 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#0a2342",
            padding: 12,
            cornerRadius: 8,
            displayColors: false,
            callbacks: {
              label: function (context) {
                return "Score: " + context.parsed.x + " / 100";
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            max: 100,
            grid: { color: "#eef3f9", drawBorder: false },
            border: { display: false },
            ticks: { color: "#7a8ea4", stepSize: 20 }
          },
          y: {
            reverse: true,
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: "#41566c",
              font: { size: 11.5 },
              callback: function (value) {
                var label = this.getLabelForValue(value);
                return label.length > 26 ? label.slice(0, 24) + "…" : label;
              }
            }
          }
        }
      }
    };
  }

  function reportStatusConfig(data) {
    var order = ["submitted", "reviewed", "pending", "late", "missing"];
    var colors = {
      submitted: "#3d8fd1",
      reviewed: "#17a09a",
      pending: "#e29a2d",
      late: "#c8474f",
      missing: "#8a9bb0"
    };
    var labels = [];
    var values = [];
    var palette = [];
    order.forEach(function (key) {
      var count = Number((data.statuses && data.statuses[key]) || 0);
      labels.push(window.UI.REPORT_STATUS[key].label);
      values.push(count);
      palette.push(colors[key]);
    });

    elements.reportStatusLegend.innerHTML = order
      .map(function (key) {
        return (
          '<li><span class="legend-dot" style="background:' +
          colors[key] +
          '"></span><span class="legend-label">' +
          window.UI.REPORT_STATUS[key].label +
          '</span><strong class="legend-value">' +
          window.UI.number((data.statuses && data.statuses[key]) || 0) +
          "</strong></li>"
        );
      })
      .join("");
    elements.reportStatusTotal.textContent = window.UI.number(data.total || 0);
    if (elements.reportChartPeriod) {
      elements.reportChartPeriod.textContent =
        "For " + window.UI.month(data.period) + " · " + window.UI.number(data.total || 0) + " monitored schools";
    }

    return {
      type: "doughnut",
      data: {
        labels: labels,
        datasets: [
          {
            data: values,
            backgroundColor: palette,
            borderColor: "#ffffff",
            borderWidth: 3,
            hoverOffset: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "70%",
        animation: { duration: reducedMotion ? 0 : 500 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#0a2342",
            padding: 12,
            cornerRadius: 8,
            displayColors: true,
            callbacks: {
              label: function (context) {
                var total = context.dataset.data.reduce(function (sum, value) {
                  return sum + Number(value);
                }, 0);
                var pct = total ? Math.round((Number(context.raw) / total) * 100) : 0;
                return " " + context.label + ": " + context.raw + " schools (" + pct + "%)";
              }
            }
          }
        }
      }
    };
  }

  function classificationConfig(summary) {
    var total = Number(summary.totalSchools || 0);
    var active = Number(summary.activeSchools || 0);
    var inactive = Math.max(0, total - active);
    var labels = ["Active", "Inactive"];
    var values = [active, inactive];
    var colors = [window.UI.CHART_COLORS.teal, "#b9c6d6"];
    elements.classificationTotal.textContent = window.UI.number(total);
    elements.classificationLegend.innerHTML =
      '<li><span class="legend-dot" style="background:' +
      colors[0] +
      '"></span><span class="legend-label">Active</span><strong class="legend-value">' +
      window.UI.number(active) +
      "</strong></li>" +
      '<li><span class="legend-dot" style="background:' +
      colors[1] +
      '"></span><span class="legend-label">Inactive</span><strong class="legend-value">' +
      window.UI.number(inactive) +
      "</strong></li>";

    return {
      type: "doughnut",
      data: {
        labels: labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors,
            borderColor: "#ffffff",
            borderWidth: 3,
            hoverOffset: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "70%",
        animation: { duration: reducedMotion ? 0 : 500 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#0a2342",
            padding: 12,
            cornerRadius: 8,
            displayColors: true,
            callbacks: {
              label: function (context) {
                var pct = total ? Math.round((Number(context.raw) / total) * 100) : 0;
                return " " + context.label + ": " + context.raw + " schools (" + pct + "%)";
              }
            }
          }
        }
      }
    };
  }

  function upsertChart(name, canvas, config) {
    if (!canvas || !window.Chart) {
      return;
    }
    if (charts[name]) {
      charts[name].data = config.data;
      charts[name].options = config.options;
      charts[name].update();
      return;
    }
    charts[name] = new window.Chart(canvas.getContext("2d"), config);
  }

  function toggleChartEmpty(canvas, emptyElement, isEmpty) {
    if (canvas) {
      canvas.classList.toggle("d-none", isEmpty);
    }
    if (emptyElement) {
      emptyElement.classList.toggle("d-none", !isEmpty);
    }
  }

  function renderEnrollment(schools) {
    var data = schools || [];
    var empty = data.length === 0;
    toggleChartEmpty(elements.enrollmentChart, elements.enrollmentEmpty, empty);
    if (empty) {
      elements.enrollmentSummary.textContent = "No enrollment data is available for this district scope.";
      if (elements.enrollmentChartSubtitle) {
        elements.enrollmentChartSubtitle.textContent = "No schools to display";
      }
      return;
    }
    var focus = data.find(function (school) {
      return String(school.id) === String(state.focusSchool);
    });
    var total = data.reduce(function (sum, school) {
      return sum + Number(school.students);
    }, 0);
    var leader = data.slice().sort(function (a, b) {
      return Number(b.students) - Number(a.students);
    })[0];
    var focusTotal = state.focusSchool
      ? data
          .filter(function (school) {
            return String(school.id) === String(state.focusSchool);
          })
          .reduce(function (sum, school) {
            return sum + Number(school.students);
          }, 0)
      : null;

    if (elements.enrollmentChartSubtitle) {
      elements.enrollmentChartSubtitle.textContent = focus
        ? "Highlighting " + focus.name
        : data.length > 8
          ? "Top 8 schools by enrolled students"
          : "All monitored schools";
    }
    elements.enrollmentSummary.textContent =
      window.UI.number(total) +
      " students across " +
      data.length +
      " schools. " +
      leader.name +
      " has the largest enrollment at " +
      window.UI.number(leader.students) +
      " students." +
      (focus ? " Focus school: " + focus.name + ", " + window.UI.number(focusTotal) + " students." : "");
    elements.enrollmentChart.setAttribute("aria-label", elements.enrollmentSummary.textContent);
    upsertChart("enrollment", elements.enrollmentChart, enrollmentConfig(data));
  }

  function renderPerformance(schools) {
    var data = schools || [];
    var empty = data.length === 0;
    toggleChartEmpty(elements.performanceChart, elements.performanceEmpty, empty);
    if (empty) {
      elements.performanceSummary.textContent = "No performance scores have been recorded for this district scope.";
      if (elements.performanceChartSubtitle) {
        elements.performanceChartSubtitle.textContent = "No scored schools to display";
      }
      return;
    }
    var focus = data.find(function (school) {
      return String(school.id) === String(state.focusSchool);
    });
    var average =
      data.reduce(function (sum, school) {
        return sum + Number(school.score);
      }, 0) / data.length;
    var leader = data.slice().sort(function (a, b) {
      return Number(b.score) - Number(a.score);
    })[0];
    var focusSchool = state.focusSchool
      ? data.find(function (school) {
          return String(school.id) === String(state.focusSchool);
        })
      : null;

    if (elements.performanceChartSubtitle) {
      elements.performanceChartSubtitle.textContent = focus
        ? "Highlighting " + focus.name + " · score out of 100"
        : data.length > 8
          ? "Top 8 schools · score out of 100"
          : "Performance score out of 100";
    }
    elements.performanceSummary.textContent =
      "Average performance score of " +
      average.toFixed(1) +
      " across " +
      data.length +
      " scored schools. " +
      leader.name +
      " leads with " +
      leader.score +
      "." +
      (focusSchool ? " Focus school: " + focusSchool.name + ", score " + focusSchool.score + "." : "");
    elements.performanceChart.setAttribute("aria-label", elements.performanceSummary.textContent);
    upsertChart("performance", elements.performanceChart, performanceConfig(data));
  }

  function renderReportStatus(data) {
    var total = Number(data.total || 0);
    var isEmpty = total === 0;
    toggleChartEmpty(elements.reportStatusChart, elements.reportStatusEmpty, isEmpty);
    if (elements.reportStatusCenter) {
      elements.reportStatusCenter.classList.toggle("d-none", isEmpty);
    }
    if (elements.reportStatusTotal) {
      elements.reportStatusTotal.textContent = window.UI.number(total);
    }
    var summary = ["pending", "submitted", "late", "reviewed", "missing"]
      .map(function (key) {
        return window.UI.number(data.statuses[key] || 0) + " " + window.UI.REPORT_STATUS[key].label.toLowerCase();
      })
      .join(", ");
    elements.reportStatusSummary.textContent =
      "For " + window.UI.month(data.period) + ": " + summary + ".";
    if (isEmpty) {
      elements.reportStatusSummary.textContent =
        "No monthly reports have been recorded for " + window.UI.month(data.period) + " yet.";
    }
    var chart = document.getElementById("reportStatusChart");
    if (chart) {
      chart.setAttribute("aria-label", elements.reportStatusSummary.textContent);
    }
    upsertChart("reportStatus", chart, reportStatusConfig(data));
  }

  function renderClassification(summary) {
    var total = Number(summary.totalSchools || 0);
    var active = Number(summary.activeSchools || 0);
    var inactive = Math.max(0, total - active);
    var pct = total ? Math.round((active / total) * 100) : 0;
    elements.classificationSummary.textContent = total
      ? active + " of " + total + " schools are active (" + pct + "%), with " + inactive + " inactive."
      : "No schools are currently registered in this district scope.";
    var chart = document.getElementById("classificationChart");
    toggleChartEmpty(chart, elements.classificationEmpty, total === 0);
    if (elements.classificationCenter) {
      elements.classificationCenter.classList.toggle("d-none", total === 0);
    }
    if (chart) {
      chart.setAttribute("aria-label", elements.classificationSummary.textContent);
    }
    if (total > 0) {
      upsertChart("classification", chart, classificationConfig(summary));
    }
  }

  function renderActivity(activities) {
    if (!elements.recentActivity) {
      return;
    }
    if (!activities || !activities.length) {
      elements.recentActivity.innerHTML = window.UI.emptyState({
        icon: "bi-activity",
        title: "No recent activity",
        message: "Administrative actions will be listed here as they happen."
      });
      return;
    }
    elements.recentActivity.innerHTML = activities
      .slice(0, 7)
      .map(function (activity) {
        var tone = window.UI.actionTone(activity.action);
        var detail = window.UI.detailSummary(activity.details);
        return (
          '<article class="activity-item">' +
          '<span class="activity-icon activity-icon--' +
          tone +
          '"><i class="bi ' +
          window.UI.actionIcon(activity.action) +
          '" aria-hidden="true"></i></span>' +
          '<div class="activity-copy">' +
          "<p><strong>" +
          window.UI.escapeHtml(activity.userName || "System") +
          "</strong> " +
          window.UI.escapeHtml(window.UI.actionLabel(activity.action)) +
          "</p>" +
          '<div class="activity-meta">' +
          (detail ? "<span>" + window.UI.escapeHtml(detail) + "</span>" : "") +
          '<time datetime="' +
          window.UI.escapeHtml(activity.createdAt) +
          '" title="' +
          window.UI.escapeHtml(window.UI.dateTime(activity.createdAt)) +
          '">' +
          window.UI.escapeHtml(window.UI.relativeTime(activity.createdAt)) +
          "</time>" +
          "</div></div></article>"
        );
      })
      .join("");
  }

  function loadActivity() {
    return API.get("/dashboard/recent-activity", scopeParams())
      .then(function (payload) {
        renderActivity(payload.data.activities || []);
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        if (elements.recentActivity) {
          elements.recentActivity.innerHTML = window.UI.emptyState({
            icon: "bi-cloud-slash",
            title: "Activity unavailable",
            message: "Recent district activity could not be loaded."
          });
        }
      });
  }

  function setRefreshing(refreshing) {
    state.refreshing = refreshing;
    var button = elements.refreshDashboard;
    if (!button) {
      return;
    }
    button.disabled = refreshing;
    var icon = button.querySelector("i");
    if (icon) {
      icon.classList.toggle("spin", refreshing);
    }
    button.setAttribute("aria-busy", String(refreshing));
  }

  function renderLearnerSummary(data) {
    var totals = (data && data.totals) || {};
    var year = data && data.schoolYear;
    var total = Number(totals.learners || 0);
    var incomplete = Number(totals.incomplete || 0);
    if (elements.learnerKpiTotal) {
      elements.learnerKpiTotal.textContent = window.UI.number(total);
    }
    if (elements.learnerKpiEnrolled) {
      elements.learnerKpiEnrolled.textContent = window.UI.number(totals.enrolled);
    }
    if (elements.learnerKpiIncomplete) {
      elements.learnerKpiIncomplete.textContent = window.UI.number(incomplete);
    }
    if (elements.learnerKpiSections) {
      elements.learnerKpiSections.textContent = window.UI.number(totals.sections);
    }
    if (elements.learnerKpiYear) {
      elements.learnerKpiYear.textContent = year ? year.name : "No SY";
    }
    if (elements.learnerSnapshotNote) {
      elements.learnerSnapshotNote.textContent = year
        ? year.name +
          " · " +
          window.UI.number(total) +
          " active learner profile" +
          (total === 1 ? "" : "s") +
          " · " +
          window.UI.number(totals.enrolled) +
          " enrolled"
        : "Create a school year to begin tracking learner enrollment.";
    }
    if (elements.learnerKpiEnrolledNote) {
      elements.learnerKpiEnrolledNote.textContent = year
        ? window.UI.number(totals.notEnrolled) +
          " active learner" +
          (Number(totals.notEnrolled) === 1 ? "" : "s") +
          " not yet enrolled"
        : "No current school year configured";
    }
    if (elements.learnerKpiIncompleteNote) {
      elements.learnerKpiIncompleteNote.textContent = total
        ? Math.round((incomplete / total) * 100) +
          "% of profiles missing address, contact, or a guardian"
        : "No learner profiles yet";
    }
    if (elements.learnerKpiSectionsNote) {
      elements.learnerKpiSectionsNote.textContent =
        window.UI.number(totals.advisers) +
        " adviser" +
        (Number(totals.advisers) === 1 ? "" : "s") +
        " · " +
        window.UI.number(totals.teachers) +
        " teacher" +
        (Number(totals.teachers) === 1 ? "" : "s");
    }

    var byGrade = (data && data.byGrade) || [];
    if (elements.learnerGradeList) {
      if (!byGrade.length) {
        elements.learnerGradeList.innerHTML =
          '<p class="empty-cell">' +
          (year
            ? "No learners are enrolled for " + window.UI.escapeHtml(year.name) + " yet."
            : "Create a school year to see grade-level enrollment.") +
          "</p>";
      } else {
        var max = byGrade.reduce(function (highest, grade) {
          return Math.max(highest, Number(grade.count) || 0);
        }, 1);
        elements.learnerGradeList.innerHTML = byGrade
          .map(function (grade) {
            var width = Math.max(3, Math.round((Number(grade.count) / max) * 100));
            return (
              '<div class="grade-bar">' +
              "<strong>" +
              window.UI.escapeHtml(grade.name) +
              "</strong>" +
              '<span class="grade-bar__track"><span class="grade-bar__fill" style="width:' +
              width +
              '%"></span></span>' +
              "<span class=\"grade-bar__value\">" +
              window.UI.number(grade.count) +
              "</span>" +
              "</div>"
            );
          })
          .join("");
      }
    }
    if (elements.learnerGradeSummary) {
      elements.learnerGradeSummary.textContent = byGrade.length
        ? byGrade.length +
          " grade level" +
          (byGrade.length === 1 ? "" : "s") +
          " · " +
          window.UI.number(totals.enrolled) +
          " enrolled learners" +
          (Number(totals.unassigned)
            ? " · " + window.UI.number(totals.unassigned) + " without a section"
            : "")
        : "";
    }
    if (elements.learnerGradeSubtitle && year) {
      elements.learnerGradeSubtitle.textContent = "Enrollment for " + year.name + " by grade level";
    }

    learnerFilters.yearId = year ? year.id : null;
    if (learnerFilters.yearId && !learnerFilters.sections.length) {
      loadLearnerFilterOptions();
    }
  }

  function populateLearnerGradeFilter() {
    if (!elements.dashboardLearnerGrade) {
      return;
    }
    var selected = elements.dashboardLearnerGrade.value;
    elements.dashboardLearnerGrade.innerHTML =
      '<option value="">All grades</option>' +
      learnerFilters.grades
        .map(function (grade) {
          return (
            '<option value="' +
            grade.id +
            '"' +
            (String(grade.id) === String(selected) ? " selected" : "") +
            ">" +
            window.UI.escapeHtml(grade.name) +
            "</option>"
          );
        })
        .join("");
  }

  function populateLearnerSectionFilter() {
    if (!elements.dashboardLearnerSection) {
      return;
    }
    var gradeId = elements.dashboardLearnerGrade ? elements.dashboardLearnerGrade.value : "";
    var selected = elements.dashboardLearnerSection.value;
    var list = learnerFilters.sections.filter(function (section) {
      return !gradeId || String(section.gradeLevelId) === String(gradeId);
    });
    elements.dashboardLearnerSection.innerHTML =
      '<option value="">All sections</option>' +
      list
        .map(function (section) {
          return (
            '<option value="' +
            section.id +
            '"' +
            (String(section.id) === String(selected) ? " selected" : "") +
            ">" +
            window.UI.escapeHtml(
              (section.gradeLevel ? section.gradeLevel + " · " : "") + section.name
            ) +
            "</option>"
          );
        })
        .join("");
  }

  function loadLearnerFilterOptions() {
    Promise.all([
      API.get("/academic/grade-levels"),
      API.get("/academic/sections", { schoolYearId: learnerFilters.yearId || undefined })
    ])
      .then(function (results) {
        learnerFilters.grades = results[0].data || [];
        learnerFilters.sections = results[1].data || [];
        populateLearnerGradeFilter();
        populateLearnerSectionFilter();
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        if (elements.dashboardLearnerGrade) {
          elements.dashboardLearnerGrade.innerHTML = '<option value="">Grades unavailable</option>';
        }
        if (elements.dashboardLearnerSection) {
          elements.dashboardLearnerSection.innerHTML = '<option value="">Sections unavailable</option>';
        }
      });
  }

  function loadLearnerSummary() {
    if (!elements.learnerKpiTotal) {
      return;
    }
    API.get("/learners/summary")
      .then(function (payload) {
        renderLearnerSummary(payload.data || {});
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        ["learnerKpiTotal", "learnerKpiEnrolled", "learnerKpiIncomplete", "learnerKpiSections"].forEach(function (id) {
          if (elements[id]) {
            elements[id].textContent = "—";
          }
        });
        if (elements.learnerGradeList) {
          elements.learnerGradeList.innerHTML =
            '<p class="empty-cell">Learner statistics are unavailable for your account.</p>';
        }
      });
  }

  function wireLearnerSearch() {
    var form = elements.dashboardLearnerSearch;
    if (!form) {
      return;
    }
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var params = new URLSearchParams();
      var search = elements.dashboardLearnerSearchInput
        ? elements.dashboardLearnerSearchInput.value.trim()
        : "";
      var grade = elements.dashboardLearnerGrade ? elements.dashboardLearnerGrade.value : "";
      var section = elements.dashboardLearnerSection ? elements.dashboardLearnerSection.value : "";
      if (search) {
        params.set("search", search);
      }
      if (grade) {
        params.set("gradeLevelId", grade);
      }
      if (section) {
        params.set("sectionId", section);
      }
      window.location.href = "learners.html" + (params.toString() ? "?" + params.toString() : "");
    });
    if (elements.dashboardLearnerGrade) {
      elements.dashboardLearnerGrade.addEventListener("change", populateLearnerSectionFilter);
    }
  }

  function refreshAll(options) {
    var settings = Object.assign({ includeTable: true }, options || {});
    if (state.refreshing) {
      return Promise.resolve();
    }
    var sequence = ++refreshSequence;
    var params = Object.assign({}, scopeParams());
    if (state.period) {
      params.period = state.period;
    }
    setRefreshing(true);
    window.UI.hideAlert(elements.dashboardAlert);

    return Promise.all([
      API.get("/dashboard/report-status", params),
      API.get("/dashboard/summary", params),
      API.get("/dashboard/enrollment", scopeParams()),
      API.get("/dashboard/performance", scopeParams())
    ])
      .then(function (results) {
        if (sequence !== refreshSequence) {
          return;
        }
        var statusData = results[0].data;
        var summaryData = results[1].data;
        var enrollment = results[2].data.schools || [];
        var performance = results[3].data.schools || [];

        if (!state.period) {
          state.period = statusData.period || summaryData.period || "";
        }
        populatePeriods(statusData.periods || [], state.period);
        renderSummary(Object.assign({}, summaryData, { period: summaryData.period || state.period }));
        renderReportStatus(statusData);
        updateFocusOptions(enrollment);
        renderEnrollment(enrollment);
        renderPerformance(performance);
        renderClassification(summaryData);

        if (schoolTable) {
          if (settings.includeTable) {
            schoolTable.setPeriod(state.period);
          } else {
            schoolTable.period = state.period;
          }
        }
        loadActivity();
        loadLearnerSummary();
      })
      .catch(function (error) {
        if (error.status === 401 || sequence !== refreshSequence) {
          return;
        }
        window.UI.showAlert(
          elements.dashboardAlert,
          "danger",
          error.status === 403
            ? "You do not have access to this district scope."
            : error.message,
          "Dashboard data could not be loaded"
        );
        if (elements.footerUpdated) {
          elements.footerUpdated.textContent = "Update failed";
        }
      })
      .then(function () {
        if (sequence === refreshSequence) {
          setRefreshing(false);
        }
      });
  }

  function bindControls() {
    if (elements.periodFilter) {
      elements.periodFilter.addEventListener("change", function () {
        state.period = elements.periodFilter.value;
        refreshAll();
      });
    }
    if (elements.chartFocus) {
      elements.chartFocus.addEventListener("change", function () {
        state.focusSchool = elements.chartFocus.value;
        API.get("/dashboard/enrollment", scopeParams())
          .then(function (payload) {
            renderEnrollment(payload.data.schools || []);
          })
          .catch(function () {
            /* The focus highlight is non-critical. */
          });
        API.get("/dashboard/performance", scopeParams())
          .then(function (payload) {
            renderPerformance(payload.data.schools || []);
          })
          .catch(function () {
            /* The focus highlight is non-critical. */
          });
      });
    }
    if (elements.refreshDashboard) {
      elements.refreshDashboard.addEventListener("click", function () {
        refreshAll();
      });
    }
    document.addEventListener("sdms:schoolsearch", function (event) {
      if (schoolTable) {
        schoolTable.setSearch(event.detail.search);
      }
    });
  }

  function initialiseTable(session) {
    schoolTable = new window.SchoolTable({
      ids: {
        body: "schoolTableBody",
        meta: "schoolTableMeta",
        pagination: "schoolPagination",
        search: "schoolSearch",
        type: "schoolTypeFilter",
        status: "schoolStatusFilter",
        report: "reportStatusFilter",
        reset: "resetSchoolFilters"
      },
      pageSize: 8,
      defaultSort: "name",
      defaultDirection: "asc",
      defaultStatus: "",
      canManage: Boolean(session.permissions.canManageSchools),
      getContext: function () {
        return { districtId: state.districtId };
      },
      onChanged: function () {
        refreshAll({ includeTable: false });
      }
    });
  }

  function configureChartDefaults() {
    if (!window.Chart) {
      return;
    }
    window.Chart.defaults.font.family = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    window.Chart.defaults.color = "#5d7288";
    window.Chart.defaults.font.size = 12;
  }

  function init() {
    cacheElements();
    configureChartDefaults();
    window.AppShell.init({ page: "dashboard", breadcrumbs: ["Dashboard"] })
      .then(function (session) {
        if (!session) {
          return;
        }
        state.session = session;
        setGreeting(session);
        configureDistrictControl(session);
        if (elements.activityAuditLink && session.permissions.canViewAuditLogs) {
          elements.activityAuditLink.classList.remove("d-none");
        }
        initialiseTable(session);
        bindControls();
        wireLearnerSearch();
        refreshAll();
      })
      .catch(function (error) {
        if (elements.dashboardAlert) {
          window.UI.showAlert(
            elements.dashboardAlert,
            "danger",
            error.message || "The dashboard could not be prepared.",
            "Dashboard error"
          );
        }
      });
  }

  document.addEventListener("DOMContentLoaded", init);
})(window, document);
