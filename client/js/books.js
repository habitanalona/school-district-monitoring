/* DepEd Learner Records — textbook inventory and issuances */
(function (window, document) {
  "use strict";

  var L = window.LearnerUI;
  var F = window.FormsUI;

  var CONDITIONS = {
    new: { label: "New", tone: "success" },
    good: { label: "Good", tone: "info" },
    fair: { label: "Fair", tone: "warning" },
    poor: { label: "Poor", tone: "warning" },
    for_repair: { label: "For repair", tone: "danger" }
  };

  var state = {
    schoolId: "",
    yearId: "",
    catalog: [],
    issuances: [],
    summary: null,
    search: "",
    tab: "catalog",
    status: "",
    outstandingOnly: false
  };

  function el(id) {
    return document.getElementById(id);
  }

  function canManage() {
    return F.permission("canManageBooks");
  }

  function failed(error) {
    return error && error.status === 401;
  }

  function alertPage(tone, message, title) {
    F.pageAlert("booksAlert", tone, message, title);
  }

  function currentSchoolId() {
    if (L.schoolId()) {
      return String(L.schoolId());
    }
    var select = el("booksSchoolFilter");
    return select && select.value ? String(select.value) : "";
  }

  function scopeParams() {
    return {
      schoolId: currentSchoolId() || undefined,
      schoolYearId: state.yearId || undefined
    };
  }

  function scopeLabel() {
    var label = el("booksScopeLabel");
    if (!state.yearId) {
      label.textContent = "Choose a school year to begin.";
      return;
    }
    var year = state.years && state.years.find(function (item) {
      return String(item.id) === String(state.yearId);
    });
    var schoolName = currentSchoolId()
      ? L.schoolName(currentSchoolId()) || "Selected school"
      : "All accessible schools";
    label.textContent = schoolName + " · " + (year ? year.name : "School year");
  }

  function conditionBadge(condition) {
    var meta = CONDITIONS[condition] || { label: window.UI.titleCase(condition || "—"), tone: "neutral" };
    return window.UI.pillarBadge(meta.label, meta.tone);
  }

  function refreshSummary() {
    return L.apiGet("/books/summary", scopeParams())
      .then(function (data) {
        state.summary = data || {};
        el("summaryTitles").textContent = window.UI.number(data.titles || 0);
        el("summaryCopies").textContent = window.UI.number(data.copies || 0);
        el("summaryIssued").textContent = window.UI.number(data.issued || 0);
        el("summaryOutstanding").textContent = window.UI.number(data.outstanding || 0);
        el("summaryAvailable").textContent = window.UI.number(data.available || 0);
      })
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        el("booksAlert") && F.pageAlert("booksAlert", "danger", L.friendlyError(error), "Could not load the inventory summary");
      });
  }

  /* ---------------------------------------------------------------------- */
  /* Catalog                                                                */
  /* ---------------------------------------------------------------------- */

  function renderCatalog() {
    var body = el("catalogBody");
    if (!state.catalog.length) {
      body.innerHTML = F.emptyRow(8, "No titles recorded for this school year yet.");
      el("catalogMeta").textContent = "No titles recorded.";
      return;
    }
    body.innerHTML = state.catalog
      .map(function (item) {
        return (
          "<tr>" +
          "<td><strong>" + F.esc(item.title) + "</strong>" +
          (item.author || item.publisher || item.isbn
            ? '<span class="field-hint">' +
              F.esc([item.author, item.publisher, item.isbn ? "ISBN " + item.isbn : ""].filter(Boolean).join(" · ")) +
              "</span>"
            : "") +
          "</td>" +
          "<td>" + F.esc([item.subjectName, item.gradeLevelName].filter(Boolean).join(" · ") || "—") + "</td>" +
          "<td>" + F.esc(item.schoolYearName || "—") + "</td>" +
          '<td class="text-right">' + window.UI.number(item.quantityTotal) + "</td>" +
          '<td class="text-right">' + window.UI.number(item.outstandingQuantity) + "</td>" +
          '<td class="text-right"><strong>' + window.UI.number(item.availableQuantity) + "</strong></td>" +
          "<td>" + conditionBadge(item.condition) + "</td>" +
          '<td class="text-right"><div class="row-actions">' +
          (canManage() && item.availableQuantity > 0
            ? '<button type="button" class="btn btn-light btn-sm" data-issue="' + item.id + '" title="Issue copies"><i class="bi bi-person-up" aria-hidden="true"></i></button>'
            : "") +
          (canManage()
            ? '<button type="button" class="btn btn-light btn-sm" data-edit-catalog="' + item.id + '" title="Edit title"><i class="bi bi-pencil-square" aria-hidden="true"></i></button>' +
              '<button type="button" class="btn btn-light btn-sm" data-archive-catalog="' + item.id + '" title="Archive title"><i class="bi bi-archive" aria-hidden="true"></i></button>'
            : "") +
          "</div></td>" +
          "</tr>"
        );
      })
      .join("");
    el("catalogMeta").textContent =
      state.catalog.length + (state.catalog.length === 1 ? " title" : " titles") + " in the inventory register.";
  }

  function loadCatalog() {
    el("catalogBody").innerHTML = L.skeletonRows(8, 5);
    return L.apiGet("/books/catalog", Object.assign(scopeParams(), {
      search: state.search.trim() || undefined,
      pageSize: 100
    }))
      .then(function (payload) {
        state.catalog = (payload && payload.items) || [];
        renderCatalog();
      })
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        el("catalogBody").innerHTML = F.emptyRow(8, L.friendlyError(error));
        el("catalogMeta").textContent = "Inventory could not be loaded.";
      });
  }

  function catalogOptions(selected) {
    var available = state.catalog.filter(function (item) {
      return item.availableQuantity > 0 || String(item.id) === String(selected);
    });
    if (!available.length) {
      return '<option value="">No title with available copies</option>';
    }
    return (
      '<option value="">Select a title</option>' +
      available
        .map(function (item) {
          return L.option(
            item.id,
            item.title + " · " + item.availableQuantity + " available" + (item.isbn ? " · " + item.isbn : ""),
            selected
          );
        })
        .join("")
    );
  }

  function catalogModal(item) {
    var editing = Boolean(item);
    var data = item || {};
    var schoolId = currentSchoolId();
    if (!schoolId) {
      alertPage("warning", "Choose a specific school in the filter before adding a title.", "School required");
      return;
    }
    var dialog = L.modal({
      title: editing ? "Edit title" : "Add title",
      eyebrow: "Books and materials inventory",
      size: "modal-lg",
      body:
        '<div id="catalogAlert" class="d-none mb-3" role="alert"></div>' +
        '<form id="catalogForm" novalidate>' +
        '<div class="form-group"><label>School</label><input class="form-control" readonly value="' +
        F.esc(L.schoolName(schoolId) || "Selected school") +
        '"></div>' +
        '<div class="form-row">' +
        '<div class="col-md-8"><div class="form-group"><label for="catalogTitle">Title <span class="required-mark">*</span></label>' +
        '<input class="form-control" id="catalogTitle" name="title" maxlength="200" required value="' + F.esc(data.title || "") + '">' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="catalogQuantity">Total copies <span class="required-mark">*</span></label>' +
        '<input type="number" class="form-control" id="catalogQuantity" name="quantityTotal" min="0" max="100000" required value="' +
        (data.quantityTotal === undefined ? 0 : data.quantityTotal) + '"><span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="catalogSubject">Subject</label>' +
        '<select class="custom-select" id="catalogSubject" name="subjectId"><option value="">Not linked</option></select></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="catalogGrade">Grade level</label>' +
        '<select class="custom-select" id="catalogGrade" name="gradeLevelId"><option value="">Not linked</option></select></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="catalogCondition">Condition</label>' +
        '<select class="custom-select" id="catalogCondition" name="condition">' +
        Object.keys(CONDITIONS)
          .map(function (key) {
            return L.option(key, CONDITIONS[key].label, data.condition || "good");
          })
          .join("") +
        "</select></div></div>" +
        '<div class="col-md-6"><div class="form-group"><label for="catalogAuthor">Author</label>' +
        '<input class="form-control" id="catalogAuthor" name="author" maxlength="160" value="' + F.esc(data.author || "") + '"></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="catalogPublisher">Publisher</label>' +
        '<input class="form-control" id="catalogPublisher" name="publisher" maxlength="160" value="' + F.esc(data.publisher || "") + '"></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="catalogEdition">Edition</label>' +
        '<input class="form-control" id="catalogEdition" name="edition" maxlength="64" value="' + F.esc(data.edition || "") + '"></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="catalogYear">Publication year</label>' +
        '<input type="number" class="form-control" id="catalogYear" name="publicationYear" min="1900" max="2200" value="' +
        (data.publicationYear || "") + '"></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="catalogIsbn">ISBN</label>' +
        '<input class="form-control" id="catalogIsbn" name="isbn" maxlength="32" value="' + F.esc(data.isbn || "") + '"></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="catalogLocation">Storage location</label>' +
        '<input class="form-control" id="catalogLocation" name="location" maxlength="120" value="' + F.esc(data.location || "") + '"></div></div>' +
        '<div class="col-12"><div class="form-group"><label for="catalogRemarks">Remarks</label>' +
        '<textarea class="form-control" id="catalogRemarks" name="remarks" rows="2" maxlength="2000">' + F.esc(data.remarks || "") + "</textarea></div></div>" +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="catalogSaveButton">' + (editing ? "Save title" : "Add title") + "</button>"
    });
    var form = dialog.element.querySelector("#catalogForm");
    var button = dialog.element.querySelector("#catalogSaveButton");
    var alertBox = dialog.element.querySelector("#catalogAlert");
    var subjectSelect = dialog.element.querySelector("#catalogSubject");
    var gradeSelect = dialog.element.querySelector("#catalogGrade");

    L.subjects(schoolId).then(function (list) {
      subjectSelect.innerHTML = '<option value="">Not linked</option>' + L.options(list, "id", "name", data.subjectId, "");
    });
    L.grades(schoolId).then(function (list) {
      gradeSelect.innerHTML = '<option value="">Not linked</option>' + L.options(list, "id", "name", data.gradeLevelId, "");
    });

    button.addEventListener("click", function () {
      window.UI.clearFieldErrors(form);
      window.UI.hideAlert(alertBox);
      var values = L.formValues(form);
      values.title = values.title.trim();
      if (!values.title) {
        window.UI.fieldError(form.querySelector("#catalogTitle"), "Enter the title of the book or material.");
        return;
      }
      if (values.quantityTotal === "" || Number(values.quantityTotal) < 0) {
        window.UI.fieldError(form.querySelector("#catalogQuantity"), "Enter the total number of copies.");
        return;
      }
      var payload = {
        schoolId: Number(schoolId),
        schoolYearId: state.yearId ? Number(state.yearId) : undefined,
        title: values.title,
        subjectId: values.subjectId || null,
        gradeLevelId: values.gradeLevelId || null,
        author: values.author.trim(),
        publisher: values.publisher.trim(),
        edition: values.edition.trim(),
        publicationYear: values.publicationYear || null,
        isbn: values.isbn.trim(),
        quantityTotal: Number(values.quantityTotal),
        condition: values.condition,
        location: values.location.trim(),
        remarks: values.remarks.trim()
      };
      window.UI.setButtonLoading(button, true, "Saving…");
      var request = editing ? API.put("/books/catalog/" + item.id, payload) : API.post("/books/catalog", payload);
      request
        .then(function () {
          window.UI.setButtonLoading(button, false);
          dialog.close();
          window.UI.toast(editing ? "Title updated" : "Title added", values.title, "success");
          refreshSummary();
          loadCatalog();
          loadIssuances();
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (failed(error)) {
            return;
          }
          if (!window.UI.showFieldErrors(form, error)) {
            window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not save the title");
          }
        });
    });
  }

  function archiveCatalog(item) {
    window.UI.confirm({
      title: "Archive title",
      message: "Archive “" + item.title + "”? It is hidden from the active inventory but its issuance history is preserved.",
      confirmLabel: "Archive",
      tone: "danger"
    }).then(function (ok) {
      if (!ok) {
        return;
      }
      API.delete("/books/catalog/" + item.id)
        .then(function () {
          window.UI.toast("Title archived", "The inventory record was archived.", "success");
          refreshSummary();
          loadCatalog();
        })
        .catch(function (error) {
          if (failed(error)) {
            return;
          }
          alertPage("danger", L.friendlyError(error), "Could not archive the title");
        });
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Issuances                                                              */
  /* ---------------------------------------------------------------------- */

  function renderIssuances() {
    var body = el("issuanceBody");
    if (!state.issuances.length) {
      body.innerHTML = F.emptyRow(10, "No issuances match this filter.");
      el("issuanceMeta").textContent = "No issuances recorded.";
      return;
    }
    body.innerHTML = state.issuances
      .map(function (row) {
        var meta = F.ISSUANCE_STATUS[row.status] || { label: window.UI.titleCase(row.status || "—"), tone: "neutral" };
        return (
          "<tr>" +
          "<td><strong>" + F.esc(row.learnerName) + "</strong>" +
          '<span class="field-hint">' + F.esc([row.gradeLevelName, row.sectionName].filter(Boolean).join(" · ")) + "</span></td>" +
          '<td><code class="lrn-code">' + F.esc(row.lrn) + "</code></td>" +
          "<td>" + F.esc(row.title) + "</td>" +
          '<td class="text-right">' + window.UI.number(row.quantityIssued) + "</td>" +
          '<td class="text-right">' + window.UI.number(row.quantityReturned) + "</td>" +
          '<td class="text-right"><strong>' + window.UI.number(row.outstanding) + "</strong></td>" +
          "<td>" + F.esc(window.UI.phDate(row.issuedOn)) + "</td>" +
          "<td>" + F.esc(row.expectedReturnOn ? window.UI.phDate(row.expectedReturnOn) : "—") + "</td>" +
          "<td>" + window.UI.pillarBadge(meta.label, meta.tone) + "</td>" +
          '<td class="text-right"><div class="row-actions">' +
          '<button type="button" class="btn btn-light btn-sm" data-history="' + row.id + '" title="Return history"><i class="bi bi-clock-history" aria-hidden="true"></i></button>' +
          (canManage() && row.outstanding > 0
            ? '<button type="button" class="btn btn-light btn-sm" data-return="' + row.id + '" title="Record return"><i class="bi bi-arrow-return-left" aria-hidden="true"></i></button>'
            : "") +
          "</div></td>" +
          "</tr>"
        );
      })
      .join("");
    el("issuanceMeta").textContent =
      state.issuances.length + (state.issuances.length === 1 ? " issuance" : " issuances") + " shown.";
  }

  function loadIssuances() {
    el("issuanceBody").innerHTML = L.skeletonRows(10, 5);
    return L.apiGet("/books/issuances", Object.assign(scopeParams(), {
      status: state.status || undefined,
      outstandingOnly: state.outstandingOnly ? 1 : undefined,
      search: state.search.trim() || undefined,
      pageSize: 100
    }))
      .then(function (payload) {
        state.issuances = (payload && payload.items) || [];
        renderIssuances();
      })
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        el("issuanceBody").innerHTML = F.emptyRow(10, L.friendlyError(error));
        el("issuanceMeta").textContent = "Issuances could not be loaded.";
      });
  }

  function issueModal(catalogId) {
    var schoolId = currentSchoolId();
    if (!schoolId) {
      alertPage("warning", "Choose a specific school before issuing books.", "School required");
      return;
    }
    if (!state.yearId) {
      alertPage("warning", "Choose a school year before issuing books.", "School year required");
      return;
    }
    var dialog = L.modal({
      title: "Issue books",
      eyebrow: "Learner issuance",
      size: "modal-lg",
      body:
        '<div id="issueAlert" class="d-none mb-3" role="alert"></div>' +
        '<form id="issueForm" novalidate>' +
        '<div class="form-row">' +
        '<div class="col-md-8"><div class="form-group"><label for="issueCatalog">Title <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="issueCatalog" name="catalogId" required>' + catalogOptions(catalogId) + "</select>" +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="issueQuantity">Copies <span class="required-mark">*</span></label>' +
        '<input type="number" class="form-control" id="issueQuantity" name="quantity" min="1" max="1000" value="1" required>' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-12"><div class="form-group"><label for="issueLearner">Learner <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="issueLearner" name="learnerId" required><option value="">Loading learners…</option></select>' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="issueDate">Date issued <span class="required-mark">*</span></label>' +
        '<input type="date" class="form-control" id="issueDate" name="issuedOn" value="' + F.todayIso() + '" required>' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-6"><div class="form-group"><label for="issueDue">Expected return</label>' +
        '<input type="date" class="form-control" id="issueDue" name="expectedReturnOn"><span class="field-error"></span></div></div>' +
        '<div class="col-12"><div class="form-group mb-0"><label for="issueRemarks">Remarks</label>' +
        '<textarea class="form-control" id="issueRemarks" name="remarks" rows="2" maxlength="2000"></textarea></div></div>' +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="issueSaveButton">Issue copies</button>'
    });
    var form = dialog.element.querySelector("#issueForm");
    var button = dialog.element.querySelector("#issueSaveButton");
    var alertBox = dialog.element.querySelector("#issueAlert");
    var learnerSelect = dialog.element.querySelector("#issueLearner");
    var catalogSelect = dialog.element.querySelector("#issueCatalog");

    L.apiGet("/learners", { schoolId: schoolId, schoolYearId: state.yearId, status: "active", pageSize: 300 })
      .then(function (rows) {
        learnerSelect.innerHTML = (rows || []).length
          ? '<option value="">Select a learner</option>' +
            rows
              .map(function (learner) {
                var enrollment = learner.currentEnrollment;
                return L.option(
                  learner.id,
                  learner.lrn + " · " + learner.fullName +
                    (enrollment ? " · " + [enrollment.gradeLevel, enrollment.sectionName].filter(Boolean).join(" ") : "")
                );
              })
              .join("")
          : '<option value="">No active learners for this school year</option>';
      })
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        learnerSelect.innerHTML = '<option value="">Learners unavailable</option>';
      });

    catalogSelect.addEventListener("change", function () {
      var item = state.catalog.find(function (row) {
        return String(row.id) === String(catalogSelect.value);
      });
      var quantity = dialog.element.querySelector("#issueQuantity");
      if (item) {
        quantity.max = Math.max(1, item.availableQuantity);
      }
    });

    button.addEventListener("click", function () {
      window.UI.clearFieldErrors(form);
      window.UI.hideAlert(alertBox);
      var values = L.formValues(form);
      if (!values.catalogId) {
        window.UI.fieldError(catalogSelect, "Choose the title to issue.");
        return;
      }
      if (!values.learnerId) {
        window.UI.fieldError(learnerSelect, "Choose the learner receiving the books.");
        return;
      }
      var quantity = Number(values.quantity);
      if (!Number.isFinite(quantity) || quantity < 1) {
        window.UI.fieldError(form.querySelector("#issueQuantity"), "Enter at least one copy.");
        return;
      }
      var item = state.catalog.find(function (row) {
        return String(row.id) === String(values.catalogId);
      });
      if (item && quantity > item.availableQuantity) {
        window.UI.fieldError(form.querySelector("#issueQuantity"), "Only " + item.availableQuantity + " copies are available.");
        return;
      }
      if (values.expectedReturnOn && values.expectedReturnOn < values.issuedOn) {
        window.UI.fieldError(form.querySelector("#issueDue"), "Expected return cannot be before the date issued.");
        return;
      }
      window.UI.setButtonLoading(button, true, "Issuing…");
      API.post("/books/issuances", {
        catalogId: Number(values.catalogId),
        learnerId: Number(values.learnerId),
        schoolYearId: Number(state.yearId),
        quantity: quantity,
        issuedOn: values.issuedOn,
        expectedReturnOn: values.expectedReturnOn || null,
        remarks: values.remarks.trim()
      })
        .then(function () {
          window.UI.setButtonLoading(button, false);
          dialog.close();
          window.UI.toast("Books issued", quantity + " cop" + (quantity === 1 ? "y" : "ies") + " issued and recorded.", "success");
          refreshSummary();
          loadCatalog();
          loadIssuances();
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (failed(error)) {
            return;
          }
          if (!window.UI.showFieldErrors(form, error)) {
            window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not issue the books");
          }
        });
    });
  }

  function returnModal(row) {
    var dialog = L.modal({
      title: "Record return",
      eyebrow: row.learnerName + " · " + row.title,
      size: "",
      body:
        '<div id="returnAlert" class="d-none mb-3" role="alert"></div>' +
        '<div class="review-summary mb-3">' +
        "<div><span>Issued</span><strong>" + window.UI.number(row.quantityIssued) + "</strong></div>" +
        "<div><span>Already returned</span><strong>" + window.UI.number(row.quantityReturned) + "</strong></div>" +
        "<div><span>Outstanding</span><strong>" + window.UI.number(row.outstanding) + "</strong></div>" +
        "<div><span>Issued on</span><strong>" + F.esc(window.UI.phDate(row.issuedOn)) + "</strong></div>" +
        "</div>" +
        '<form id="returnForm" novalidate>' +
        '<div class="form-row">' +
        '<div class="col-md-4"><div class="form-group"><label for="returnQuantity">Copies returned <span class="required-mark">*</span></label>' +
        '<input type="number" class="form-control" id="returnQuantity" name="quantity" min="1" max="' + row.outstanding + '" value="' + row.outstanding + '">' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="returnDate">Date returned <span class="required-mark">*</span></label>' +
        '<input type="date" class="form-control" id="returnDate" name="returnedOn" value="' + F.todayIso() + '">' +
        '<span class="field-error"></span></div></div>' +
        '<div class="col-md-4"><div class="form-group"><label for="returnCondition">Condition <span class="required-mark">*</span></label>' +
        '<select class="custom-select" id="returnCondition" name="condition">' +
        ["good", "fair", "damaged", "lost"]
          .map(function (key) {
            return L.option(key, CONDITIONS[key] ? CONDITIONS[key].label : window.UI.titleCase(key), "good");
          })
          .join("") +
        "</select></div></div>" +
        '<div class="col-12"><div class="form-group mb-0"><label for="returnRemarks">Remarks</label>' +
        '<textarea class="form-control" id="returnRemarks" name="remarks" rows="2" maxlength="2000"></textarea></div></div>' +
        "</div></form>",
      footer:
        '<button type="button" class="btn btn-light" data-dismiss="modal">Cancel</button>' +
        '<button type="button" class="btn btn-primary" id="returnSaveButton">Record return</button>'
    });
    var form = dialog.element.querySelector("#returnForm");
    var button = dialog.element.querySelector("#returnSaveButton");
    var alertBox = dialog.element.querySelector("#returnAlert");
    button.addEventListener("click", function () {
      window.UI.clearFieldErrors(form);
      window.UI.hideAlert(alertBox);
      var values = L.formValues(form);
      var quantity = Number(values.quantity);
      if (!Number.isFinite(quantity) || quantity < 1 || quantity > row.outstanding) {
        window.UI.fieldError(form.querySelector("#returnQuantity"), "Enter between 1 and " + row.outstanding + " copies.");
        return;
      }
      if (values.returnedOn < row.issuedOn) {
        window.UI.fieldError(form.querySelector("#returnDate"), "Date returned cannot be before the date issued.");
        return;
      }
      window.UI.setButtonLoading(button, true, "Recording…");
      API.post("/books/issuances/" + row.id + "/returns", {
        quantity: quantity,
        returnedOn: values.returnedOn,
        condition: values.condition,
        remarks: values.remarks.trim()
      })
        .then(function () {
          window.UI.setButtonLoading(button, false);
          dialog.close();
          window.UI.toast("Return recorded", quantity + " cop" + (quantity === 1 ? "y" : "ies") + " returned as " + values.condition + ".", "success");
          refreshSummary();
          loadCatalog();
          loadIssuances();
        })
        .catch(function (error) {
          window.UI.setButtonLoading(button, false);
          if (failed(error)) {
            return;
          }
          if (!window.UI.showFieldErrors(form, error)) {
            window.UI.showAlert(alertBox, "danger", L.friendlyError(error), "Could not record the return");
          }
        });
    });
  }

  function historyModal(id) {
    var dialog = L.modal({
      title: "Issuance history",
      eyebrow: "Return records",
      size: "modal-lg",
      body: '<div id="historyBody"><div class="skeleton skeleton-block"></div></div>',
      footer: '<button type="button" class="btn btn-light" data-dismiss="modal">Close</button>'
    });
    var body = dialog.element.querySelector("#historyBody");
    L.apiGet("/books/issuances/" + id)
      .then(function (payload) {
        var issuance = payload.issuance || {};
        var returns = payload.returns || [];
        body.innerHTML =
          '<div class="review-summary mb-3">' +
          "<div><span>Learner</span><strong>" + F.esc(issuance.learnerName || "—") + "</strong></div>" +
          "<div><span>Title</span><strong>" + F.esc(issuance.title || "—") + "</strong></div>" +
          "<div><span>Issued</span><strong>" + window.UI.number(issuance.quantityIssued) + "</strong></div>" +
          "<div><span>Outstanding</span><strong>" + window.UI.number(issuance.outstanding) + "</strong></div>" +
          "</div>" +
          (returns.length
            ? '<div class="report-preview"><div class="report-preview__scroll"><table><thead><tr><th>Date</th><th class="text-right">Copies</th><th>Condition</th><th>Received by</th><th>Remarks</th></tr></thead><tbody>' +
              returns
                .map(function (row) {
                  return (
                    "<tr><td>" + F.esc(window.UI.phDate(row.returnedOn)) + "</td>" +
                    '<td class="text-right">' + window.UI.number(row.quantity) + "</td>" +
                    "<td>" + F.esc(window.UI.titleCase(row.condition)) + "</td>" +
                    "<td>" + F.esc(row.receivedBy || "—") + "</td>" +
                    "<td>" + F.esc(row.remarks || "—") + "</td></tr>"
                  );
                })
                .join("") +
              "</tbody></table></div></div>"
            : '<p class="empty-cell">No returns recorded for this issuance.</p>');
      })
      .catch(function (error) {
        if (failed(error)) {
          return;
        }
        body.innerHTML = '<p class="empty-cell">' + F.esc(L.friendlyError(error)) + "</p>";
      });
  }

  /* ---------------------------------------------------------------------- */
  /* Filters and tabs                                                       */
  /* ---------------------------------------------------------------------- */

  function switchTab(tab) {
    state.tab = tab;
    ["catalog", "issuances"].forEach(function (key) {
      var button = el("tab" + window.UI.titleCase(key));
      var panel = el("panel" + window.UI.titleCase(key));
      if (button) {
        button.setAttribute("aria-selected", key === tab ? "true" : "false");
        button.classList.toggle("is-active", key === tab);
      }
      if (panel) {
        panel.classList.toggle("d-none", key !== tab);
      }
    });
    if (tab === "catalog") {
      loadCatalog();
    } else {
      loadIssuances();
    }
  }

  function loadYears() {
    return L.years().then(function (years) {
      state.years = years || [];
      var current = state.years.find(function (year) {
        return year.isCurrent;
      });
      if (!state.yearId) {
        state.yearId = current ? String(current.id) : "";
      }
      el("booksYearFilter").innerHTML = L.yearOptions(state.years, state.yearId, "All school years");
    });
  }

  function reloadAll() {
    scopeLabel();
    return Promise.all([refreshSummary(), loadCatalog(), loadIssuances()]);
  }

  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll(".module-tabs [data-tab]"), function (button) {
      button.addEventListener("click", function () {
        switchTab(button.dataset.tab);
      });
    });

    el("booksSchoolFilter").addEventListener("change", function () {
      reloadAll();
    });
    el("booksYearFilter").addEventListener("change", function () {
      state.yearId = el("booksYearFilter").value;
      reloadAll();
    });
    el("bookSearch").addEventListener("input", window.UI.debounce(function () {
      state.search = el("bookSearch").value;
      loadCatalog();
      loadIssuances();
    }, 300));
    el("resetBookFilters").addEventListener("click", function () {
      state.search = "";
      state.status = "";
      state.outstandingOnly = false;
      el("bookSearch").value = "";
      el("issuanceStatusFilter").value = "";
      el("outstandingOnly").checked = false;
      reloadAll();
    });
    el("issuanceStatusFilter").addEventListener("change", function () {
      state.status = el("issuanceStatusFilter").value;
      loadIssuances();
    });
    el("outstandingOnly").addEventListener("change", function () {
      state.outstandingOnly = el("outstandingOnly").checked;
      loadIssuances();
    });
    el("newCatalogButton").addEventListener("click", function () {
      catalogModal(null);
    });
    el("issueBookButton").addEventListener("click", function () {
      if (!state.catalog.length) {
        alertPage("warning", "Add a title to the inventory before issuing copies.", "No titles available");
        return;
      }
      issueModal("");
    });

    el("catalogBody").addEventListener("click", function (event) {
      var issue = event.target.closest("[data-issue]");
      if (issue) {
        issueModal(issue.dataset.issue);
        return;
      }
      var edit = event.target.closest("[data-edit-catalog]");
      if (edit) {
        var item = state.catalog.find(function (row) {
          return String(row.id) === String(edit.dataset.editCatalog);
        });
        catalogModal(item);
        return;
      }
      var archive = event.target.closest("[data-archive-catalog]");
      if (archive) {
        var target = state.catalog.find(function (row) {
          return String(row.id) === String(archive.dataset.archiveCatalog);
        });
        if (target) {
          archiveCatalog(target);
        }
      }
    });

    el("issuanceBody").addEventListener("click", function (event) {
      var history = event.target.closest("[data-history]");
      if (history) {
        historyModal(history.dataset.history);
        return;
      }
      var back = event.target.closest("[data-return]");
      if (back) {
        var row = state.issuances.find(function (item) {
          return String(item.id) === String(back.dataset.return);
        });
        if (row) {
          returnModal(row);
        }
      }
    });
  }

  function init() {
    AppShell.init({
      page: "books",
      breadcrumbs: ["Books & Materials"],
      requiredPermission: "canViewBooks"
    }).then(function (session) {
      if (!session) {
        return;
      }
      wire();
      el("newCatalogButton").classList.toggle("d-none", !canManage());
      el("issueBookButton").classList.toggle("d-none", !canManage());
      F.schoolFilter("booksSchoolControl", "booksSchoolFilter", L.schoolId() || "");
      return loadYears().then(reloadAll);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})(window, document);
