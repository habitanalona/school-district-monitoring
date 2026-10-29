/* DepEd Learner Records — printable and exportable reports */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var state = {
    session: null,
    definitions: [],
    search: "",
    preview: null
  };

  var META = {
    "master-list": {
      icon: "bi-people",
      description: "Complete learner roster with LRN, grade and section, adviser, guardian contact, and profile status."
    },
    "profile-sheet": {
      icon: "bi-person-vcard",
      description: "One-page permanent profile with personal data, guardians, enrollment, and activity record."
    },
    "section-list": {
      icon: "bi-list-ul",
      description: "Class roster for one section with adviser, learner contacts, and profile completeness."
    },
    "guardian-directory": {
      icon: "bi-people",
      description: "Parents and guardians for a school with relationship, contact details, and address."
    },
    "enrollment-list": {
      icon: "bi-journal-check",
      description: "School-year enrollment per learner with grade, section, adviser, and status."
    },
    "adviser-list": {
      icon: "bi-person-badge",
      description: "Every section for a school year with its adviser and enrolled learner count."
    },
    "assignment-list": {
      icon: "bi-easel2",
      description: "Subjects, sections, assigned teachers, employee numbers, and class periods."
    },
    "weekly-schedule": {
      icon: "bi-calendar-week",
      description: "Monday-to-Sunday class timetable for a section, ready for printing."
    },
    "activity-report": {
      icon: "bi-trophy",
      description: "Curricular and extracurricular activities with learner participation and achievements."
    },
    "enrollment-history": {
      icon: "bi-clock-history",
      description: "Every school-year enrollment record per learner, preserving promoted and transferred statuses."
    },
    "incomplete-profiles": {
      icon: "bi-exclamation-diamond",
      description: "Learners missing address, contact, or guardian details, with the exact missing fields."
    }
  };

  var SCOPE_LABEL = {
    learner: "One learner",
    section: "One section",
    school: "One school",
    "school-year": "School year"
  };

  function el(id) {
    return document.getElementById(id);
  }

  function reportMeta(type) {
    return META[type] || { icon: "bi-clipboard-data", description: "Official learner record export." };
  }

  function renderCards() {
    var grid = el("reportGrid");
    var query = state.search.trim().toLowerCase();
    var list = state.definitions.filter(function (definition) {
      var meta = reportMeta(definition.type);
      return (
        !query ||
        [definition.label, meta.description, definition.scope].join(" ").toLowerCase().indexOf(query) !== -1
      );
    });
    if (!list.length) {
      grid.innerHTML =
        '<div class="report-card"><h3>No reports found</h3><p>Try a different keyword such as “section”, “guardian”, or “schedule”.</p></div>';
      return;
    }
    grid.innerHTML = list
      .map(function (definition) {
        var meta = reportMeta(definition.type);
        return (
          '<article class="report-card">' +
          '<div class="report-card__icon"><i class="bi ' +
          meta.icon +
          '" aria-hidden="true"></i></div>' +
          "<div><span class=\"report-scope\">" +
          L.esc(SCOPE_LABEL[definition.scope] || definition.scope) +
          "</span><h3>" +
          L.esc(definition.label) +
          "</h3></div>" +
          "<p>" +
          L.esc(meta.description) +
          "</p>" +
          '<div class="report-card__actions">' +
          '<button type="button" class="btn btn-primary btn-sm" data-report="' +
          L.esc(definition.type) +
          '"><i class="bi bi-eye" aria-hidden="true"></i> Open report</button>' +
          "</div>" +
          "</article>"
        );
      })
      .join("");
  }

  function loadDefinitions() {
    return L.apiGet("/learner-reports")
      .then(function (list) {
        state.definitions = list || [];
        renderCards();
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        el("reportGrid").innerHTML =
          '<div class="report-card"><h3>Reports unavailable</h3><p>' + L.esc(L.friendlyError(error)) + "</p></div>";
      });
  }

  /* CSV -------------------------------------------------------------------- */

  function parseCsv(text) {
    var source = String(text || "").replace(/^\uFEFF/, "");
    var rows = [];
    var row = [];
    var field = "";
    var quoted = false;
    for (var index = 0; index < source.length; index += 1) {
      var char = source[index];
      if (quoted) {
        if (char === '"') {
          if (source[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            quoted = false;
          }
        } else {
          field += char;
        }
        continue;
      }
      if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\r" || char === "\n") {
        if (char === "\r" && source[index + 1] === "\n") {
          index += 1;
        }
        row.push(field);
        field = "";
        if (row.length > 1 || row[0] !== "") {
          rows.push(row);
        }
        row = [];
      } else {
        field += char;
      }
    }
    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function previewTable(rows, limit) {
    var headers = rows[0] || [];
    var body = rows.slice(1, limit ? limit + 1 : rows.length);
    return (
      '<div class="report-preview"><div class="report-preview__scroll"><table><thead><tr>' +
      headers
        .map(function (cell) {
          return "<th>" + L.esc(cell) + "</th>";
        })
        .join("") +
      "</tr></thead><tbody>" +
      (body.length
        ? body
            .map(function (row) {
              return (
                "<tr>" +
                headers
                  .map(function (cell, index) {
                    return "<td>" + L.esc(row[index] === undefined ? "" : row[index]) + "</td>";
                  })
                  .join("") +
                "</tr>"
              );
            })
            .join("")
        : '<tr><td colspan="' + Math.max(headers.length, 1) + '">No records match this scope.</td></tr>') +
      "</tbody></table></div></div>"
    );
  }

  function printRows(rows, meta) {
    var headers = rows[0] || [];
    var body = rows.slice(1);
    return (
      "<h1>" +
      L.esc(meta.title) +
      "</h1><p class=\"print-meta\">" +
      L.esc(meta.scope) +
      " · Generated " +
      L.esc(window.UI.phDate(new Date().toISOString().slice(0, 10))) +
      "</p>" +
      '<table><thead><tr>' +
      headers
        .map(function (cell) {
          return "<th>" + L.esc(cell) + "</th>";
        })
        .join("") +
      "</tr></thead><tbody>" +
      (body.length
        ? body
            .map(function (row) {
              return (
                "<tr>" +
                headers
                  .map(function (cell, index) {
                    return "<td>" + L.esc(row[index] === undefined ? "" : row[index]) + "</td>";
                  })
                  .join("") +
                "</tr>"
              );
            })
            .join("")
        : '<tr><td colspan="' + Math.max(headers.length, 1) + '">No records.</td></tr>') +
      "</tbody></table>" +
      '<div class="print-sign"><div>Prepared by / Registrar</div><div>School Head</div></div>'
    );
  }

  function csvUrl(type, params) {
    var query = new URLSearchParams();
    Object.keys(params).forEach(function (key) {
      if (params[key] !== undefined && params[key] !== null && params[key] !== "") {
        query.set(key, params[key]);
      }
    });
    var suffix = query.toString();
    return "/api/learner-reports/" + encodeURIComponent(type) + ".csv" + (suffix ? "?" + suffix : "");
  }

  function filenameFrom(header, fallback) {
    if (!header) {
      return fallback;
    }
    var star = /filename\*=UTF-8''([^;]+)/i.exec(header);
    if (star) {
      try {
        return decodeURIComponent(star[1]);
      } catch (error) {
        return fallback;
      }
    }
    var plain = /filename="([^"]+)"/i.exec(header);
    return plain ? plain[1] : fallback;
  }

  /* Report dialog ---------------------------------------------------------- */

  var reportDialogId = 0;
  var lastReportOpen = 0;

  function openReport(definition) {
    // Ignore a double click on the report card, but do not depend on Bootstrap
    // transition events: the editor's field ids are unique per dialog, so a
    // closing copy can never collide with the next one or hijack its footer.
    var now = Date.now();
    if (now - lastReportOpen < 350) {
      return;
    }
    lastReportOpen = now;
    var uid = "r" + ++reportDialogId;
    function fid(name) {
      return name + "-" + uid;
    }
    var meta = reportMeta(definition.type);
    var needsLearner = definition.scope === "learner";
    var needsSection = definition.scope === "section";
    var needsSchool = definition.scope === "school";
    var needsYear = definition.scope === "school-year";
    var fixed = L.schoolId();
    state.preview = null;

    var dialog = L.modal({
      title: definition.label,
      eyebrow: "Learner report",
      size: "modal-xl",
      body:
        '<form id="' + fid("reportForm") + '" novalidate>' +
        '<p class="report-dialog-note"><i class="bi ' +
        meta.icon +
        '" aria-hidden="true"></i> ' +
        L.esc(meta.description) +
        "</p>" +
        '<div id="' + fid("reportAlert") + '" class="d-none mb-3" role="alert"></div>' +
        '<div class="form-row">' +
        (fixed
          ? ""
          : '<div class="col-md-4"><div class="form-group"><label for="' + fid("reportSchool") + '">School</label>' +
            '<select class="custom-select" id="' + fid("reportSchool") + '" name="schoolId"><option value="">All schools in scope</option></select>' +
            (needsSchool ? '<span class="field-hint">Required for this report.</span>' : "") +
            "</div></div>") +
        '<div class="col-md-4"><div class="form-group"><label for="' + fid("reportYear") + '">School year</label>' +
        '<select class="custom-select" id="' + fid("reportYear") + '" name="schoolYearId"></select></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="' + fid("reportGrade") + '">Grade level</label>' +
        '<select class="custom-select" id="' + fid("reportGrade") + '" name="gradeLevelId"><option value="">All grade levels</option></select></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="' + fid("reportSection") + '">Section</label>' +
        '<select class="custom-select" id="' + fid("reportSection") + '" name="sectionId"><option value="">' +
        (needsSection ? "Select section" : "All sections") +
        "</option></select>" +
        (needsSection ? '<span class="field-hint">Required for this report.</span>' : "") +
        "</div></div>" +
        (needsLearner || definition.type === "enrollment-history" || definition.type === "activity-report"
          ? '<div class="col-md-4"><div class="form-group"><label for="' + fid("reportLearner") + '">Learner</label>' +
            '<select class="custom-select" id="' + fid("reportLearner") + '" name="learnerId"><option value="">All learners</option></select>' +
            (needsLearner ? '<span class="field-hint">Required for this report.</span>' : "") +
            "</div></div>" +
            '<div class="col-md-4"><div class="form-group"><label for="' + fid("reportLearnerSearch") + '">Find learner</label>' +
            '<input class="form-control" id="' + fid("reportLearnerSearch") + '" placeholder="Search LRN or name…" autocomplete="off"></div></div>'
          : "") +
        '<div class="col-md-4"><div class="form-group"><label for="' + fid("reportSearchTerm") + '">Search filter</label>' +
        '<input class="form-control" id="' + fid("reportSearchTerm") + '" name="search" maxlength="100" placeholder="Optional name or LRN filter">' +
        "</div></div>" +
        "</div>" +
        '<div id="' + fid("reportPreviewArea") + '" class="mt-3"></div>' +
        "</form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Close</button>' +
        '<button type="button" class="btn btn-outline-primary" id="' + fid("downloadReportButton") + '" disabled><i class="bi bi-download" aria-hidden="true"></i> Download CSV</button>' +
        '<button type="button" class="btn btn-outline-primary" id="' + fid("printReportButton") + '" disabled><i class="bi bi-printer" aria-hidden="true"></i> Print</button>' +
        '<button type="submit" form="' + fid("reportForm") + '" class="btn btn-primary" id="' + fid("previewReportButton") + '"><i class="bi bi-eye" aria-hidden="true"></i> Preview</button>'
    });

    var form = dialog.element.querySelector("#" + fid("reportForm"));
    var alertBox = dialog.element.querySelector("#" + fid("reportAlert"));
    var previewArea = dialog.element.querySelector("#" + fid("reportPreviewArea"));
    var previewButton = dialog.element.querySelector("#" + fid("previewReportButton"));
    var downloadButton = dialog.element.querySelector("#" + fid("downloadReportButton"));
    var printButton = dialog.element.querySelector("#" + fid("printReportButton"));
    var schoolSelect = form.querySelector("#" + fid("reportSchool"));
    var yearSelect = form.querySelector("#" + fid("reportYear"));
    var gradeSelect = form.querySelector("#" + fid("reportGrade"));
    var sectionSelect = form.querySelector("#" + fid("reportSection"));
    var learnerSelect = form.querySelector("#" + fid("reportLearner"));
    var learnerSearch = form.querySelector("#" + fid("reportLearnerSearch"));
    var schoolValue = function () {
      return fixed ? String(fixed) : schoolSelect ? schoolSelect.value : "";
    };

    function fillSchools() {
      if (!schoolSelect) {
        return Promise.resolve();
      }
      return L.schools().then(function (list) {
        schoolSelect.innerHTML =
          '<option value="">All schools in scope</option>' +
          list
            .map(function (school) {
              return '<option value="' + school.id + '">' + L.esc(school.name) + "</option>";
            })
            .join("");
        if (fixed) {
          schoolSelect.value = String(fixed);
        }
      });
    }

    function fillYears() {
      return L.years().then(function (years) {
        var current = years.find(function (year) {
          return year.isCurrent;
        });
        var selected = current ? current.id : "";
        if (yearSelect) {
          yearSelect.innerHTML =
            '<option value="">All school years</option>' +
            years
              .map(function (year) {
                return (
                  '<option value="' +
                  year.id +
                  '"' +
                  (String(year.id) === String(selected) ? " selected" : "") +
                  ">" +
                  L.esc(year.name) +
                  (year.isCurrent ? " · current" : "") +
                  "</option>"
                );
              })
              .join("");
        }
        return selected;
      });
    }

    function fillGrades() {
      return L.grades(schoolValue() || undefined).then(function (grades) {
        var selected = gradeSelect.value;
        gradeSelect.innerHTML =
          '<option value="">All grade levels</option>' +
          grades
            .map(function (grade) {
              return (
                '<option value="' +
                grade.id +
                '"' +
                (String(grade.id) === String(selected) ? " selected" : "") +
                ">" +
                L.esc(grade.name) +
                "</option>"
              );
            })
            .join("");
      });
    }

    function fillSections() {
      return L.sections({
        schoolId: schoolValue() || undefined,
        schoolYearId: yearSelect ? yearSelect.value || undefined : undefined,
        gradeLevelId: gradeSelect.value || undefined
      }).then(function (list) {
        var selected = sectionSelect.value;
        sectionSelect.innerHTML =
          '<option value="">' +
          (needsSection ? "Select section" : "All sections") +
          "</option>" +
          list
            .map(function (section) {
              return (
                '<option value="' +
                section.id +
                '"' +
                (String(section.id) === String(selected) ? " selected" : "") +
                ">" +
                L.esc(
                  (section.gradeLevel ? section.gradeLevel + " · " : "") +
                    section.name +
                    (fixed ? "" : " (" + (section.schoolName || "") + ")")
                ) +
                "</option>"
              );
            })
            .join("");
      });
    }

    function fillLearners(query) {
      if (!learnerSelect) {
        return Promise.resolve();
      }
      return L.apiGet("/learners", {
        schoolId: schoolValue() || undefined,
        schoolYearId: yearSelect ? yearSelect.value || undefined : undefined,
        status: "active",
        search: query || undefined,
        pageSize: 40
      })
        .then(function (rows) {
          var selected = learnerSelect.value;
          learnerSelect.innerHTML =
            '<option value="">All learners</option>' +
            (rows || [])
              .map(function (learner) {
                return (
                  '<option value="' +
                  learner.id +
                  '"' +
                  (String(learner.id) === String(selected) ? " selected" : "") +
                  ">" +
                  L.esc(learner.lrn + " · " + learner.fullName) +
                  "</option>"
                );
              })
              .join("");
        })
        .catch(function () {
          learnerSelect.innerHTML = '<option value="">Learners unavailable</option>';
        });
    }

    function scopeParams() {
      return {
        schoolId: schoolValue() || undefined,
        schoolYearId: yearSelect ? yearSelect.value || undefined : undefined,
        gradeLevelId: gradeSelect.value || undefined,
        sectionId: sectionSelect.value || undefined,
        learnerId: learnerSelect ? learnerSelect.value || undefined : undefined,
        search: form.querySelector("#" + fid("reportSearchTerm")).value.trim() || undefined
      };
    }

    function validateScope() {
      if (needsLearner && !learnerSelect.value) {
        window.UI.showAlert(alertBox, "warning", "Choose the learner for this profile sheet.", "Learner required");
        return false;
      }
      if (needsSection && !sectionSelect.value) {
        window.UI.showAlert(alertBox, "warning", "Choose the section for this report.", "Section required");
        return false;
      }
      if (needsSchool && !schoolValue()) {
        window.UI.showAlert(alertBox, "warning", "Choose the school for this directory.", "School required");
        return false;
      }
      if (needsYear && !yearSelect.value) {
        window.UI.showAlert(alertBox, "warning", "Choose the school year for this report.", "School year required");
        return false;
      }
      return true;
    }

    function scopeLabel() {
      var parts = [];
      if (yearSelect && yearSelect.value) {
        parts.push(yearSelect.options[yearSelect.selectedIndex].text.replace(" · current", ""));
      }
      if (schoolSelect && schoolSelect.value) {
        parts.push(schoolSelect.options[schoolSelect.selectedIndex].text);
      }
      if (gradeSelect.value) {
        parts.push(gradeSelect.options[gradeSelect.selectedIndex].text);
      }
      if (sectionSelect.value) {
        parts.push(sectionSelect.options[sectionSelect.selectedIndex].text);
      }
      if (learnerSelect && learnerSelect.value) {
        parts.push(learnerSelect.options[learnerSelect.selectedIndex].text);
      }
      return parts.length ? parts.join(" · ") : "All accessible records";
    }

    function fetchReport() {
      if (!validateScope()) {
        return;
      }
      window.UI.hideAlert(alertBox);
      previewArea.innerHTML = '<div class="skeleton skeleton-block"></div>';
      downloadButton.disabled = true;
      printButton.disabled = true;
      window.UI.setButtonLoading(previewButton, true, "Generating…");
      fetch(csvUrl(definition.type, scopeParams()), {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "text/csv" }
      })
        .then(function (response) {
          var contentType = response.headers.get("content-type") || "";
          if (!response.ok) {
            if (contentType.indexOf("application/json") !== -1) {
              return response.json().then(function (payload) {
                throw new Error((payload && (payload.error || payload.message)) || "The report could not be generated.");
              });
            }
            throw new Error("The report could not be generated.");
          }
          return response.text().then(function (text) {
            state.preview = {
              type: definition.type,
              label: definition.label,
              rows: parseCsv(text),
              csv: text,
              filename: filenameFrom(
                response.headers.get("content-disposition"),
                definition.type + ".csv"
              ),
              scope: scopeLabel()
            };
          });
        })
        .then(function () {
          window.UI.setButtonLoading(previewButton, false);
          var rows = state.preview.rows;
          if (!rows.length) {
            previewArea.innerHTML = '<p class="empty-cell">No records match this scope.</p>';
            return;
          }
          previewArea.innerHTML =
            '<div class="report-preview__head"><span>' +
            L.esc(state.preview.scope) +
            "</span><span>" +
            Math.max(rows.length - 1, 0) +
            " row" +
            (rows.length - 1 === 1 ? "" : "s") +
            "</span></div>" +
            previewTable(rows, 60) +
            (rows.length > 61
              ? '<p class="field-hint">Showing the first 60 rows. Print or download includes all ' +
                (rows.length - 1) +
                " rows.</p>"
              : "");
          downloadButton.disabled = false;
          printButton.disabled = false;
        })
        .catch(function (error) {
          window.UI.setButtonLoading(previewButton, false);
          previewArea.innerHTML = "";
          window.UI.showAlert(
            alertBox,
            "danger",
            error.message || "The report could not be generated.",
            "Could not generate the report"
          );
        });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      fetchReport();
    });

    if (schoolSelect) {
      schoolSelect.addEventListener("change", function () {
        fillGrades();
        fillSections();
        fillLearners(learnerSearch ? learnerSearch.value.trim() : "");
      });
    }
    if (yearSelect) {
      yearSelect.addEventListener("change", function () {
        fillSections();
        fillLearners(learnerSearch ? learnerSearch.value.trim() : "");
      });
    }
    gradeSelect.addEventListener("change", fillSections);
    if (learnerSearch) {
      learnerSearch.addEventListener(
        "input",
        window.UI.debounce(function () {
          fillLearners(learnerSearch.value.trim());
        }, 260)
      );
    }

    downloadButton.addEventListener("click", function () {
      if (!state.preview) {
        return;
      }
      var blob = new window.Blob([state.preview.csv], { type: "text/csv;charset=utf-8" });
      var url = window.URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = state.preview.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(function () {
        window.URL.revokeObjectURL(url);
      }, 2000);
    });

    printButton.addEventListener("click", function () {
      if (!state.preview) {
        return;
      }
      L.printHtml(state.preview.label, printRows(state.preview.rows, {
        title: state.preview.label,
        scope: state.preview.scope
      }));
    });

    Promise.all([fillSchools(), fillYears()])
      .then(function () {
        if (fixed && schoolSelect) {
          schoolSelect.value = String(fixed);
        }
        return Promise.all([fillGrades(), fillSections(), fillLearners("")]);
      })
      .catch(function (error) {
        if (error.status === 401) {
          return;
        }
        window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not prepare the report");
      });
  }

  function init() {
    window.AppShell.init({
      page: "learner-reports",
      breadcrumbs: ["Reports"],
      requiredPermission: "canViewLearners"
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      var search = el("reportSearch");
      search.addEventListener(
        "input",
        window.UI.debounce(function () {
          state.search = search.value;
          renderCards();
        }, 160)
      );
      el("reportGrid").addEventListener("click", function (event) {
        var button = event.target.closest("[data-report]");
        if (!button) {
          return;
        }
        var definition = state.definitions.find(function (item) {
          return item.type === button.dataset.report;
        });
        if (definition) {
          openReport(definition);
        }
      });
      loadDefinitions();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})(window, document);
