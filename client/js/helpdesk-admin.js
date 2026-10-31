/* School District Monitoring System — Helpdesk content administration */
(function (window, document) {
  "use strict";

  var state = {
    session: null,
    meta: { pageKeys: [], articleTypes: [] },
    categories: [],
    articles: [],
    pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 },
    filters: { search: "", categoryId: "", status: "all" },
    editingArticleId: null,
    editingCategoryId: null,
    searchTimer: null,
    savingArticle: false,
    savingCategory: false
  };

  function el(id) {
    return document.getElementById(id);
  }

  function escape(value) {
    return window.UI.escapeHtml(value);
  }

  function typeLabel(type) {
    if (type === "faq") {
      return "FAQ";
    }
    if (type === "procedure") {
      return "Procedure";
    }
    if (type === "reference") {
      return "Reference";
    }
    return "Guide";
  }

  function pageLabel(key) {
    return window.UI.titleCase(String(key || "").replace(/-/g, " "));
  }

  function splitLines(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map(function (line) {
        return line.trim();
      })
      .filter(Boolean);
  }

  function splitKeywords(value) {
    return String(value || "")
      .split(",")
      .map(function (word) {
        return word.trim();
      })
      .filter(Boolean);
  }

  function showPageError(error) {
    window.UI.showAlert(
      el("helpdeskPageAlert"),
      "danger",
      (error && error.message) || "The helpdesk content could not be loaded.",
      "Unable to load content"
    );
  }

  function clearPageError() {
    window.UI.hideAlert(el("helpdeskPageAlert"));
  }

  function showModal(id) {
    if (window.jQuery) {
      window.jQuery("#" + id).modal("show");
    }
  }

  function hideModal(id) {
    if (window.jQuery) {
      window.jQuery("#" + id).modal("hide");
    }
  }

  function loadMetaAndCategories() {
    return Promise.all([
      window.API.get("/helpdesk/admin/meta"),
      window.API.get("/helpdesk/admin/categories")
    ]).then(function (results) {
      state.meta = results[0].data || { pageKeys: [], articleTypes: [] };
      state.categories = results[1].data || [];
      populateCategoryFilters();
      renderStats();
      renderCategories();
    });
  }

  function loadArticles() {
    var params = {
      page: state.pagination.page,
      pageSize: state.pagination.pageSize,
      status: state.filters.status
    };
    if (state.filters.search) {
      params.search = state.filters.search;
    }
    if (state.filters.categoryId) {
      params.categoryId = state.filters.categoryId;
    }
    return window.API.get("/helpdesk/admin/articles", params)
      .then(function (payload) {
        state.articles = payload.data || [];
        state.pagination = payload.pagination || {
          page: 1,
          pageSize: params.pageSize,
          total: state.articles.length,
          totalPages: 1
        };
        renderArticles();
      })
      .catch(function (error) {
        showPageError(error);
      });
  }

  function loadAll() {
    clearPageError();
    return loadMetaAndCategories().then(loadArticles).catch(showPageError);
  }

  function renderStats() {
    var categories = state.categories.length;
    var published = 0;
    var total = 0;
    state.categories.forEach(function (category) {
      published += Number(category.publishedCount || 0);
      total += Number(category.articleCount || 0);
    });
    el("helpdeskStatCategories").textContent = String(categories);
    el("helpdeskStatPublished").textContent = String(published);
    el("helpdeskStatDrafts").textContent = String(Math.max(0, total - published));
  }

  function populateCategoryFilters() {
    var filter = el("helpdeskCategoryFilter");
    var selected = state.filters.categoryId;
    filter.innerHTML =
      '<option value="">All categories</option>' +
      state.categories
        .map(function (category) {
          return (
            '<option value="' +
            escape(category.id) +
            '">' +
            escape(category.title) +
            "</option>"
          );
        })
        .join("");
    if (selected) {
      filter.value = String(selected);
    }
  }

  function renderArticles() {
    var body = el("helpdeskArticleRows");
    if (!state.articles.length) {
      body.innerHTML =
        '<tr><td colspan="6" class="helpdesk-admin-empty">' +
        (state.filters.search || state.filters.categoryId || state.filters.status !== "all"
          ? "No articles match these filters."
          : "No help articles yet. Use New article to add the first one.") +
        "</td></tr>";
    } else {
      body.innerHTML = state.articles
        .map(function (article) {
          return (
            "<tr>" +
            '<td><span class="helpdesk-admin-title">' +
            escape(article.title) +
            '</span><span class="helpdesk-admin-slug">' +
            escape(article.slug) +
            "</span></td>" +
            "<td>" +
            escape(article.categoryTitle) +
            "</td>" +
            "<td>" +
            escape(typeLabel(article.articleType)) +
            "</td>" +
            '<td><span class="helpdesk-admin-badge ' +
            (article.isPublished ? "" : "helpdesk-admin-badge--warning") +
            '">' +
            (article.isPublished ? "Published" : "Draft") +
            (article.isFeatured ? ' · Featured' : "") +
            "</span></td>" +
            "<td>" +
            escape(window.UI.dateTime(article.updatedAt)) +
            "</td>" +
            '<td><span class="helpdesk-admin-actions">' +
            '<button type="button" class="helpdesk-admin-icon-btn" data-action="edit-article" data-id="' +
            escape(article.id) +
            '" aria-label="Edit ' +
            escape(article.title) +
            '" title="Edit"><i class="bi bi-pencil" aria-hidden="true"></i></button>' +
            '<button type="button" class="helpdesk-admin-icon-btn" data-action="toggle-article" data-id="' +
            escape(article.id) +
            '" aria-label="' +
            (article.isPublished ? "Unpublish " : "Publish ") +
            escape(article.title) +
            '" title="' +
            (article.isPublished ? "Unpublish" : "Publish") +
            '"><i class="bi ' +
            (article.isPublished ? "bi-eye-slash" : "bi-eye") +
            '" aria-hidden="true"></i></button>' +
            '<button type="button" class="helpdesk-admin-icon-btn helpdesk-admin-icon-btn--danger" data-action="delete-article" data-id="' +
            escape(article.id) +
            '" aria-label="Delete ' +
            escape(article.title) +
            '" title="Delete"><i class="bi bi-trash" aria-hidden="true"></i></button>' +
            "</span></td>" +
            "</tr>"
          );
        })
        .join("");
    }

    var total = Number(state.pagination.total || 0);
    var page = Number(state.pagination.page || 1);
    var pageSize = Number(state.pagination.pageSize || 10);
    var totalPages = Math.max(1, Number(state.pagination.totalPages || 1));
    var start = total ? (page - 1) * pageSize + 1 : 0;
    var end = Math.min(total, page * pageSize);
    el("helpdeskArticleMeta").textContent =
      total === 0
        ? "No articles"
        : "Showing " + start + "–" + end + " of " + total + " article" + (total === 1 ? "" : "s");

    el("helpdeskArticlePager").innerHTML =
      '<button type="button" data-page="' +
      (page - 1) +
      '"' +
      (page <= 1 ? " disabled" : "") +
      ' aria-label="Previous page"><i class="bi bi-chevron-left" aria-hidden="true"></i></button>' +
      "<span>Page " +
      page +
      " of " +
      totalPages +
      "</span>" +
      '<button type="button" data-page="' +
      (page + 1) +
      '"' +
      (page >= totalPages ? " disabled" : "") +
      ' aria-label="Next page"><i class="bi bi-chevron-right" aria-hidden="true"></i></button>';
  }

  function renderCategories() {
    var list = el("helpdeskCategoryList");
    if (!state.categories.length) {
      list.innerHTML =
        '<p class="helpdesk-admin-empty">No categories yet. Add one before creating articles.</p>';
      return;
    }
    list.innerHTML = state.categories
      .map(function (category) {
        return (
          '<div class="helpdesk-category-row">' +
          '<span class="helpdesk-category-row__icon"><i class="bi ' +
          escape(category.icon || "bi-question-circle") +
          '" aria-hidden="true"></i></span>' +
          '<span class="helpdesk-category-row__copy"><strong>' +
          escape(category.title) +
          "</strong><small>" +
          escape(
            (category.articleCount || 0) +
              " article" +
              (Number(category.articleCount) === 1 ? "" : "s") +
              " · " +
              (category.publishedCount || 0) +
              " published · sort " +
              category.sortOrder
          ) +
          "</small></span>" +
          '<span class="helpdesk-category-row__meta">' +
          '<span class="helpdesk-admin-badge ' +
          (category.isActive ? "" : "helpdesk-admin-badge--muted") +
          '">' +
          (category.isActive ? "Visible" : "Hidden") +
          "</span>" +
          '<button type="button" class="helpdesk-admin-icon-btn" data-action="edit-category" data-id="' +
          escape(category.id) +
          '" aria-label="Edit ' +
          escape(category.title) +
          '" title="Edit"><i class="bi bi-pencil" aria-hidden="true"></i></button>' +
          '<button type="button" class="helpdesk-admin-icon-btn" data-action="toggle-category" data-id="' +
          escape(category.id) +
          '" aria-label="' +
          (category.isActive ? "Hide " : "Show ") +
          escape(category.title) +
          '" title="' +
          (category.isActive ? "Hide" : "Show") +
          '"><i class="bi ' +
          (category.isActive ? "bi-eye-slash" : "bi-eye") +
          '" aria-hidden="true"></i></button>' +
          '<button type="button" class="helpdesk-admin-icon-btn helpdesk-admin-icon-btn--danger" data-action="delete-category" data-id="' +
          escape(category.id) +
          '" aria-label="Delete ' +
          escape(category.title) +
          '" title="Delete"><i class="bi bi-trash" aria-hidden="true"></i></button>' +
          "</span></div>"
        );
      })
      .join("");
  }

  function articleById(id) {
    var target = Number(id);
    for (var index = 0; index < state.articles.length; index += 1) {
      if (Number(state.articles[index].id) === target) {
        return state.articles[index];
      }
    }
    return null;
  }

  function categoryById(id) {
    var target = Number(id);
    for (var index = 0; index < state.categories.length; index += 1) {
      if (Number(state.categories[index].id) === target) {
        return state.categories[index];
      }
    }
    return null;
  }

  function fillArticleCategoryOptions(selectedId) {
    el("helpdeskArticleCategory").innerHTML = state.categories
      .map(function (category) {
        return (
          '<option value="' +
          escape(category.id) +
          '">' +
          escape(category.title) +
          (category.isActive ? "" : " (hidden)") +
          "</option>"
        );
      })
      .join("");
    if (selectedId) {
      el("helpdeskArticleCategory").value = String(selectedId);
    }
  }

  function fillPageOptions(selected) {
    var defaults = {};
    (selected || []).forEach(function (key) {
      defaults[key] = true;
    });
    el("helpdeskArticlePages").innerHTML = state.meta.pageKeys
      .map(function (key) {
        return (
          '<option value="' +
          escape(key) +
          '"' +
          (defaults[key] ? " selected" : "") +
          ">" +
          escape(pageLabel(key)) +
          "</option>"
        );
      })
      .join("");
  }

  function updateSummaryCount() {
    el("helpdeskSummaryCount").textContent = String(el("helpdeskArticleSummary").value.length);
  }

  function openArticleModal(article) {
    var form = el("helpdeskArticleForm");
    window.UI.clearFieldErrors(form);
    window.UI.hideAlert(el("helpdeskArticleAlert"));
    state.editingArticleId = article ? Number(article.id) : null;
    el("helpdeskArticleModalTitle").textContent = article ? "Edit help article" : "New help article";
    el("helpdeskArticleTitle").value = article ? article.title : "";
    el("helpdeskArticleSlug").value = article ? article.slug : "";
    el("helpdeskArticleType").value = article ? article.articleType : "article";
    el("helpdeskArticleSummary").value = article ? article.summary : "";
    el("helpdeskArticleBody").value = article ? article.body : "";
    el("helpdeskArticleSteps").value = article ? (article.steps || []).join("\n") : "";
    el("helpdeskArticleNotes").value = article ? (article.notes || []).join("\n") : "";
    el("helpdeskArticleKeywords").value = article ? (article.keywords || []).join(", ") : "";
    el("helpdeskArticleSort").value = article ? article.sortOrder : 0;
    el("helpdeskArticleFeatured").checked = article ? Boolean(article.isFeatured) : false;
    el("helpdeskArticlePublished").checked = article ? Boolean(article.isPublished) : true;
    fillArticleCategoryOptions(article ? article.categoryId : state.filters.categoryId);
    fillPageOptions(article ? article.pagePaths : []);
    updateSummaryCount();
    showModal("helpdeskArticleModal");
    window.setTimeout(function () {
      el("helpdeskArticleTitle").focus();
    }, 250);
  }

  function openCategoryModal(category) {
    var form = el("helpdeskCategoryForm");
    window.UI.clearFieldErrors(form);
    window.UI.hideAlert(el("helpdeskCategoryAlert"));
    state.editingCategoryId = category ? Number(category.id) : null;
    el("helpdeskCategoryModalTitle").textContent = category ? "Edit category" : "New category";
    el("helpdeskCategoryTitle").value = category ? category.title : "";
    el("helpdeskCategorySlug").value = category ? category.slug : "";
    el("helpdeskCategoryDescription").value = category ? category.description : "";
    el("helpdeskCategoryIcon").value = category ? category.icon : "bi-question-circle";
    el("helpdeskCategorySort").value = category ? category.sortOrder : 0;
    el("helpdeskCategoryActive").checked = category ? Boolean(category.isActive) : true;
    showModal("helpdeskCategoryModal");
    window.setTimeout(function () {
      el("helpdeskCategoryTitle").focus();
    }, 250);
  }

  function collectArticle() {
    var form = el("helpdeskArticleForm");
    window.UI.clearFieldErrors(form);
    window.UI.hideAlert(el("helpdeskArticleAlert"));

    var title = el("helpdeskArticleTitle").value.trim();
    var summary = el("helpdeskArticleSummary").value.trim();
    var categoryId = Number(el("helpdeskArticleCategory").value);
    if (title.length < 3) {
      window.UI.fieldError(el("helpdeskArticleTitle"), "Title must be at least 3 characters.");
      return null;
    }
    if (!categoryId) {
      window.UI.showAlert(el("helpdeskArticleAlert"), "warning", "Choose a category for this article.");
      return null;
    }
    if (summary.length < 10) {
      window.UI.fieldError(el("helpdeskArticleSummary"), "Summary must be at least 10 characters.");
      return null;
    }

    var pages = Array.prototype.map.call(
      el("helpdeskArticlePages").selectedOptions || [],
      function (option) {
        return option.value;
      }
    );

    return {
      title: title,
      slug: el("helpdeskArticleSlug").value.trim(),
      categoryId: categoryId,
      articleType: el("helpdeskArticleType").value,
      summary: summary,
      body: el("helpdeskArticleBody").value.trim(),
      steps: splitLines(el("helpdeskArticleSteps").value),
      notes: splitLines(el("helpdeskArticleNotes").value),
      keywords: splitKeywords(el("helpdeskArticleKeywords").value),
      pagePaths: pages,
      sortOrder: Number(el("helpdeskArticleSort").value || 0),
      isFeatured: el("helpdeskArticleFeatured").checked,
      isPublished: el("helpdeskArticlePublished").checked
    };
  }

  function saveArticle(event) {
    event.preventDefault();
    if (state.savingArticle) {
      return;
    }
    var payload = collectArticle();
    if (!payload) {
      return;
    }
    state.savingArticle = true;
    var button = el("helpdeskArticleSave");
    window.UI.setButtonLoading(button, true, "Saving…");
    var request = state.editingArticleId
      ? window.API.put("/helpdesk/admin/articles/" + state.editingArticleId, payload)
      : window.API.post("/helpdesk/admin/articles", payload);

    request
      .then(function () {
        hideModal("helpdeskArticleModal");
        window.UI.toast(
          state.editingArticleId ? "Article updated" : "Article created",
          "The Helpdesk knowledge base is up to date.",
          "success"
        );
        clearPageError();
        return loadMetaAndCategories().then(loadArticles);
      })
      .catch(function (error) {
        window.UI.showAlert(
          el("helpdeskArticleAlert"),
          "danger",
          (error && error.message) || "The article could not be saved."
        );
        window.UI.showFieldErrors(el("helpdeskArticleForm"), error);
      })
      .then(function () {
        state.savingArticle = false;
        window.UI.setButtonLoading(button, false);
      });
  }

  function collectCategory() {
    var form = el("helpdeskCategoryForm");
    window.UI.clearFieldErrors(form);
    window.UI.hideAlert(el("helpdeskCategoryAlert"));
    var title = el("helpdeskCategoryTitle").value.trim();
    if (title.length < 2) {
      window.UI.fieldError(el("helpdeskCategoryTitle"), "Category title must be at least 2 characters.");
      return null;
    }
    return {
      title: title,
      slug: el("helpdeskCategorySlug").value.trim(),
      description: el("helpdeskCategoryDescription").value.trim(),
      icon: el("helpdeskCategoryIcon").value.trim() || "bi-question-circle",
      sortOrder: Number(el("helpdeskCategorySort").value || 0),
      isActive: el("helpdeskCategoryActive").checked
    };
  }

  function saveCategory(event) {
    event.preventDefault();
    if (state.savingCategory) {
      return;
    }
    var payload = collectCategory();
    if (!payload) {
      return;
    }
    state.savingCategory = true;
    var button = el("helpdeskCategorySave");
    window.UI.setButtonLoading(button, true, "Saving…");
    var request = state.editingCategoryId
      ? window.API.put("/helpdesk/admin/categories/" + state.editingCategoryId, payload)
      : window.API.post("/helpdesk/admin/categories", payload);

    request
      .then(function () {
        hideModal("helpdeskCategoryModal");
        window.UI.toast(
          state.editingCategoryId ? "Category updated" : "Category created",
          "The Helpdesk category list is up to date.",
          "success"
        );
        clearPageError();
        return loadMetaAndCategories().then(loadArticles);
      })
      .catch(function (error) {
        window.UI.showAlert(
          el("helpdeskCategoryAlert"),
          "danger",
          (error && error.message) || "The category could not be saved."
        );
        window.UI.showFieldErrors(el("helpdeskCategoryForm"), error);
      })
      .then(function () {
        state.savingCategory = false;
        window.UI.setButtonLoading(button, false);
      });
  }

  function toggleArticle(article) {
    var publishing = !article.isPublished;
    window.API.put("/helpdesk/admin/articles/" + article.id, { isPublished: publishing })
      .then(function () {
        window.UI.toast(
          publishing ? "Article published" : "Article unpublished",
          publishing
            ? "Users can now see this answer in the Helpdesk."
            : "The article is now a draft and hidden from users.",
          "success"
        );
        return loadMetaAndCategories().then(loadArticles);
      })
      .catch(showPageError);
  }

  function deleteArticle(article) {
    window.UI.confirm({
      title: "Delete this article?",
      message:
        '“' +
        article.title +
        '” will be removed from the Helpdesk. The slug stays reserved so a later migration cannot recreate it.',
      confirmLabel: "Delete article",
      tone: "danger"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      window.API.delete("/helpdesk/admin/articles/" + article.id)
        .then(function () {
          window.UI.toast("Article deleted", "The help entry was removed.", "success");
          return loadMetaAndCategories().then(loadArticles);
        })
        .catch(showPageError);
    });
  }

  function toggleCategory(category) {
    window.API.put("/helpdesk/admin/categories/" + category.id, { isActive: !category.isActive })
      .then(function () {
        window.UI.toast(
          category.isActive ? "Category hidden" : "Category visible",
          category.isActive
            ? "Its articles no longer appear in the Helpdesk."
            : "Its published articles appear in the Helpdesk again.",
          "success"
        );
        return loadMetaAndCategories().then(loadArticles);
      })
      .catch(showPageError);
  }

  function deleteCategory(category) {
    window.UI.confirm({
      title: "Delete this category?",
      message:
        '“' +
        category.title +
        '” can only be removed when it has no articles. To hide it temporarily, use the visibility button instead.',
      confirmLabel: "Delete category",
      tone: "danger"
    }).then(function (confirmed) {
      if (!confirmed) {
        return;
      }
      window.API.delete("/helpdesk/admin/categories/" + category.id)
        .then(function () {
          window.UI.toast("Category deleted", "The category was removed.", "success");
          return loadMetaAndCategories().then(loadArticles);
        })
        .catch(function (error) {
          showPageError(error);
        });
    });
  }

  function onArticlesClick(event) {
    var button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }
    var action = button.getAttribute("data-action");
    if (action === "edit-article") {
      var article = articleById(button.getAttribute("data-id"));
      if (article) {
        openArticleModal(article);
      }
    } else if (action === "toggle-article") {
      var target = articleById(button.getAttribute("data-id"));
      if (target) {
        toggleArticle(target);
      }
    } else if (action === "delete-article") {
      var doomed = articleById(button.getAttribute("data-id"));
      if (doomed) {
        deleteArticle(doomed);
      }
    }
  }

  function onCategoriesClick(event) {
    var button = event.target.closest("[data-action]");
    if (!button) {
      return;
    }
    var action = button.getAttribute("data-action");
    var category = categoryById(button.getAttribute("data-id"));
    if (!category) {
      return;
    }
    if (action === "edit-category") {
      openCategoryModal(category);
    } else if (action === "toggle-category") {
      toggleCategory(category);
    } else if (action === "delete-category") {
      deleteCategory(category);
    }
  }

  function bind() {
    el("helpdeskNewArticle").addEventListener("click", function () {
      if (!state.categories.length) {
        window.UI.toast(
          "Add a category first",
          "Every article belongs to a category. Create a category, then add the article.",
          "warning"
        );
        openCategoryModal(null);
        return;
      }
      openArticleModal(null);
    });
    el("helpdeskNewCategory").addEventListener("click", function () {
      openCategoryModal(null);
    });
    el("helpdeskRefresh").addEventListener("click", function () {
      loadAll().then(function () {
        window.UI.toast("Content refreshed", "The knowledge base is up to date.", "success");
      });
    });
    el("helpdeskSearch").addEventListener("input", function () {
      var value = el("helpdeskSearch").value;
      if (state.searchTimer) {
        window.clearTimeout(state.searchTimer);
      }
      state.searchTimer = window.setTimeout(function () {
        state.filters.search = value.trim();
        state.pagination.page = 1;
        loadArticles();
      }, 260);
    });
    el("helpdeskCategoryFilter").addEventListener("change", function () {
      state.filters.categoryId = el("helpdeskCategoryFilter").value;
      state.pagination.page = 1;
      loadArticles();
    });
    el("helpdeskStatusFilter").addEventListener("change", function () {
      state.filters.status = el("helpdeskStatusFilter").value;
      state.pagination.page = 1;
      loadArticles();
    });
    el("helpdeskArticleRows").addEventListener("click", onArticlesClick);
    el("helpdeskCategoryList").addEventListener("click", onCategoriesClick);
    el("helpdeskArticlePager").addEventListener("click", function (event) {
      var button = event.target.closest("[data-page]");
      if (!button || button.disabled) {
        return;
      }
      state.pagination.page = Number(button.getAttribute("data-page"));
      loadArticles();
    });
    el("helpdeskArticleForm").addEventListener("submit", saveArticle);
    el("helpdeskCategoryForm").addEventListener("submit", saveCategory);
    el("helpdeskArticleSummary").addEventListener("input", updateSummaryCount);
  }

  function init() {
    window.AppShell.init({
      page: "helpdesk-admin",
      breadcrumbs: ["Administration", "Helpdesk Content"],
      requiredPermission: "canManageHelpdesk"
    }).then(function (session) {
      if (!session) {
        return;
      }
      state.session = session;
      bind();
      loadAll();
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})(window, document);
