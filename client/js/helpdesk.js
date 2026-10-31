/* School District Monitoring System — floating Helpdesk widget.
   Additive, dependency-free, and grounded in the knowledge base returned by
   /api/helpdesk/content. It never reads or changes form data. */
(function (window, document) {
  "use strict";

  var CONTENT_URL = "/api/helpdesk/content";
  var STOP_WORDS = {
    a: 1,
    an: 1,
    and: 1,
    are: 1,
    as: 1,
    at: 1,
    be: 1,
    by: 1,
    can: 1,
    do: 1,
    does: 1,
    for: 1,
    from: 1,
    how: 1,
    i: 1,
    if: 1,
    in: 1,
    is: 1,
    it: 1,
    me: 1,
    my: 1,
    of: 1,
    on: 1,
    or: 1,
    should: 1,
    that: 1,
    the: 1,
    their: 1,
    this: 1,
    to: 1,
    was: 1,
    what: 1,
    when: 1,
    where: 1,
    which: 1,
    why: 1,
    with: 1,
    would: 1
  };

  var state = {
    loaded: false,
    loading: false,
    error: "",
    categories: [],
    articles: [],
    query: "",
    contextKey: "",
    contextLabel: "",
    view: { name: "home" },
    open: false,
    minimized: false,
    searchTimer: null,
    closeTimer: null,
    lastFocus: null
  };

  var el = {};

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function detectContext() {
    var page = (document.body && document.body.getAttribute("data-page")) || "";
    if (!page) {
      var path = window.location.pathname.replace(/\/+$/, "");
      if (path === "" || path === "/index.html") {
        page = "sign-in";
      } else if (path === "/register" || path === "/register.html") {
        page = "register";
      } else if (path.indexOf("reset-password") !== -1) {
        page = "reset-password";
      } else {
        page = path.replace(/^\//, "").replace(/\.html$/, "");
      }
    }
    state.contextKey = page;
    var parts = String(document.title || "").split("·");
    state.contextLabel = (parts[0] || "").trim();
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

  function typeIcon(type) {
    if (type === "faq") {
      return "bi-question-circle";
    }
    if (type === "procedure") {
      return "bi-list-check";
    }
    if (type === "reference") {
      return "bi-book";
    }
    return "bi-journal-text";
  }

  function categoryBySlug(slug) {
    for (var i = 0; i < state.categories.length; i += 1) {
      if (state.categories[i].slug === slug) {
        return state.categories[i];
      }
    }
    return null;
  }

  function categoryCount(slug) {
    var total = 0;
    state.articles.forEach(function (article) {
      if (article.categorySlug === slug) {
        total += 1;
      }
    });
    return total;
  }

  function articleById(id) {
    var target = Number(id);
    for (var i = 0; i < state.articles.length; i += 1) {
      if (Number(state.articles[i].id) === target) {
        return state.articles[i];
      }
    }
    return null;
  }

  function articlesForPage(key) {
    return state.articles.filter(function (article) {
      return (article.pagePaths || []).indexOf(key) !== -1;
    });
  }

  function featuredArticles() {
    return state.articles.filter(function (article) {
      return article.isFeatured;
    });
  }

  function bodyParagraphs(article) {
    return String(article.body || "")
      .split(/\n{2,}/)
      .map(function (paragraph) {
        return paragraph.trim();
      })
      .filter(Boolean);
  }

  function articleListMarkup(articles, options) {
    var settings = options || {};
    if (!articles.length) {
      return (
        '<div class="helpdesk-empty">' +
        '<span class="helpdesk-empty__icon"><i class="bi bi-inbox" aria-hidden="true"></i></span>' +
        "<h3>No topics here yet</h3>" +
        "<p>An administrator can add guidance for this area in the Helpdesk Content page.</p>" +
        "</div>"
      );
    }
    var badges = settings.showBadges !== false;
    return articles
      .map(function (article) {
        var contextBadge =
          article.pagePaths && article.pagePaths.indexOf(state.contextKey) !== -1
            ? '<span class="helpdesk-badge helpdesk-badge--context">This page</span>'
            : "";
        return (
          '<button type="button" class="helpdesk-result" data-article-id="' +
          escapeHtml(article.id) +
          '">' +
          '<span class="helpdesk-result__meta">' +
          escapeHtml(article.categoryTitle) +
          (badges ? " · " + escapeHtml(typeLabel(article.articleType)) : "") +
          contextBadge +
          "</span>" +
          '<span class="helpdesk-result__title">' +
          escapeHtml(article.title) +
          "</span>" +
          '<span class="helpdesk-result__summary">' +
          escapeHtml(article.summary) +
          "</span>" +
          "</button>"
        );
      })
      .join("");
  }

  function suggestionMarkup(articles) {
    if (!articles.length) {
      return "";
    }
    return (
      '<div class="helpdesk-suggestions">' +
      articles
        .map(function (article) {
          return (
            '<button type="button" class="helpdesk-suggestion" data-article-id="' +
            escapeHtml(article.id) +
            '">' +
            '<span class="helpdesk-suggestion__icon"><i class="bi ' +
            typeIcon(article.articleType) +
            '" aria-hidden="true"></i></span>' +
            '<span class="helpdesk-suggestion__copy">' +
            escapeHtml(article.title) +
            "<small>" +
            escapeHtml(article.categoryTitle) +
            "</small></span>" +
            "</button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function categoryGridMarkup() {
    if (!state.categories.length) {
      return "";
    }
    return (
      '<div class="helpdesk-category-grid">' +
      state.categories
        .map(function (category) {
          return (
            '<button type="button" class="helpdesk-category-card" data-category-slug="' +
            escapeHtml(category.slug) +
            '">' +
            '<span class="helpdesk-category-card__icon"><i class="bi ' +
            escapeHtml(category.icon || "bi-question-circle") +
            '" aria-hidden="true"></i></span>' +
            "<span>" +
            escapeHtml(category.title) +
            "<small>" +
            categoryCount(category.slug) +
            " topic" +
            (categoryCount(category.slug) === 1 ? "" : "s") +
            "</small></span>" +
            "</button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function faqMarkup(articles) {
    if (!articles.length) {
      return "";
    }
    return (
      '<div class="helpdesk-faq-list">' +
      articles
        .map(function (article) {
          var answer = bodyParagraphs(article)
            .slice(0, 2)
            .map(function (paragraph) {
              return "<p>" + escapeHtml(paragraph) + "</p>";
            })
            .join("");
          return (
            '<details class="helpdesk-faq">' +
            "<summary>" +
            '<i class="bi ' +
            typeIcon(article.articleType) +
            '" aria-hidden="true"></i>' +
            "<span>" +
            escapeHtml(article.title) +
            "</span>" +
            '<i class="bi bi-chevron-down" aria-hidden="true"></i>' +
            "</summary>" +
            '<div class="helpdesk-faq__answer">' +
            answer +
            '<button type="button" class="helpdesk-text-btn" data-article-id="' +
            escapeHtml(article.id) +
            '">Read the full answer</button>' +
            "</div>" +
            "</details>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function homeMarkup() {
    var contextArticles = articlesForPage(state.contextKey);
    var featured = featuredArticles();
    var suggestions = contextArticles.length
      ? contextArticles.slice(0, 4)
      : (featured.length ? featured.slice(0, 5) : state.articles.slice(0, 5));
    var faqs = state.articles
      .filter(function (article) {
        return article.articleType === "faq";
      })
      .sort(function (a, b) {
        var aContext = a.pagePaths.indexOf(state.contextKey) !== -1 ? 1 : 0;
        var bContext = b.pagePaths.indexOf(state.contextKey) !== -1 ? 1 : 0;
        if (aContext !== bContext) {
          return bContext - aContext;
        }
        return a.sortOrder - b.sortOrder || a.title.localeCompare(b.title);
      })
      .slice(0, 6);

    var contextCard = "";
    if (state.contextKey && contextArticles.length) {
      contextCard =
        '<div class="helpdesk-context-card">' +
        '<span class="helpdesk-context-card__icon"><i class="bi bi-geo-alt" aria-hidden="true"></i></span>' +
        "<p>You are on the <strong>" +
        escapeHtml(state.contextLabel || state.contextKey) +
        "</strong> page. Showing " +
        contextArticles.length +
        " related topic" +
        (contextArticles.length === 1 ? "" : "s") +
        " first.</p>" +
        "</div>";
    }

    return (
      '<div class="helpdesk-welcome">' +
      '<p class="helpdesk-welcome__eyebrow">Built-in assistance</p>' +
      "<h2>How can we help?</h2>" +
      "<p>Search this guide or browse the categories below. Every answer is based on the installed School District Monitoring System.</p>" +
      contextCard +
      "</div>" +
      '<section class="helpdesk-section">' +
      '<div class="helpdesk-section__head"><h3>Suggested questions</h3></div>' +
      suggestionMarkup(suggestions) +
      "</section>" +
      '<section class="helpdesk-section">' +
      '<div class="helpdesk-section__head"><h3>Browse by category</h3>' +
      (state.categories.length
        ? '<button type="button" class="helpdesk-text-btn" data-action="browse-all">View all topics</button>'
        : "") +
      "</div>" +
      categoryGridMarkup() +
      "</section>" +
      (faqs.length
        ? '<section class="helpdesk-section"><div class="helpdesk-section__head"><h3>Frequently asked</h3></div>' +
          faqMarkup(faqs) +
          "</section>"
        : "")
    );
  }

  function categoryMarkup(slug) {
    var category = categoryBySlug(slug);
    if (!category) {
      return homeMarkup();
    }
    var articles = state.articles.filter(function (article) {
      return article.categorySlug === slug;
    });
    return (
      '<div class="helpdesk-article__toolbar">' +
      '<button type="button" class="helpdesk-back" data-action="home"><i class="bi bi-arrow-left" aria-hidden="true"></i> All topics</button>' +
      "</div>" +
      '<div class="helpdesk-welcome">' +
      '<p class="helpdesk-welcome__eyebrow">' +
      escapeHtml(category.title) +
      "</p>" +
      "<h2>" +
      escapeHtml(category.title) +
      "</h2>" +
      (category.description ? "<p>" + escapeHtml(category.description) + "</p>" : "") +
      "</div>" +
      '<section class="helpdesk-section" style="margin-top:8px">' +
      articleListMarkup(articles) +
      "</section>"
    );
  }

  function relatedArticles(article) {
    var seen = {};
    seen[Number(article.id)] = true;
    var pool = state.articles.filter(function (candidate) {
      return !seen[Number(candidate.id)];
    });
    var scored = pool
      .map(function (candidate) {
        var score = 0;
        if (candidate.categorySlug === article.categorySlug) {
          score += 4;
        }
        var sharedPages = (candidate.pagePaths || []).filter(function (page) {
          return (article.pagePaths || []).indexOf(page) !== -1;
        });
        score += sharedPages.length * 3;
        var keywords = (candidate.keywords || []).filter(function (word) {
          return (article.keywords || []).indexOf(word) !== -1;
        });
        score += keywords.length * 2;
        if (candidate.isFeatured) {
          score += 1;
        }
        return { article: candidate, score: score };
      })
      .filter(function (entry) {
        return entry.score > 0;
      })
      .sort(function (a, b) {
        return b.score - a.score || a.article.title.localeCompare(b.article.title);
      })
      .slice(0, 4)
      .map(function (entry) {
        return entry.article;
      });
    return scored;
  }

  function articleMarkup(article) {
    var paragraphs = bodyParagraphs(article)
      .map(function (paragraph) {
        return "<p>" + escapeHtml(paragraph) + "</p>";
      })
      .join("");
    var steps = (article.steps || [])
      .map(function (step) {
        return "<li>" + escapeHtml(step) + "</li>";
      })
      .join("");
    var notes = (article.notes || [])
      .map(function (note) {
        return '<li><i class="bi bi-info-circle" aria-hidden="true"></i><span>' + escapeHtml(note) + "</span></li>";
      })
      .join("");
    var related = relatedArticles(article);
    var pages = (article.pagePaths || []).length
      ? '<p class="helpdesk-result__meta" style="margin-top:14px">Applies to: ' +
        article.pagePaths
          .slice(0, 6)
          .map(function (page) {
            return '<span class="helpdesk-badge">' + escapeHtml(page.replace(/-/g, " ")) + "</span>";
          })
          .join(" ") +
        "</p>"
      : "";

    var from = state.view.from || { name: "home" };
    var backLabel = "Back to Helpdesk";
    if (from.name === "search") {
      backLabel = "Back to results";
    } else if (from.name === "category" && from.slug) {
      var fromCategory = categoryBySlug(from.slug);
      backLabel = fromCategory ? "Back to " + fromCategory.title : "Back to category";
    }

    return (
      '<div class="helpdesk-article__toolbar">' +
      '<button type="button" class="helpdesk-back" data-action="back"><i class="bi bi-arrow-left" aria-hidden="true"></i> ' +
      escapeHtml(backLabel) +
      "</button>" +
      "</div>" +
      '<article class="helpdesk-article">' +
      '<span class="helpdesk-article__category">' +
      escapeHtml(article.categoryTitle) +
      " · " +
      escapeHtml(typeLabel(article.articleType)) +
      "</span>" +
      "<h2>" +
      escapeHtml(article.title) +
      "</h2>" +
      '<p class="helpdesk-article__summary">' +
      escapeHtml(article.summary) +
      "</p>" +
      (paragraphs ? '<div class="helpdesk-article__body">' + paragraphs + "</div>" : "") +
      (steps
        ? '<section class="helpdesk-section"><div class="helpdesk-section__head"><h3>Step by step</h3></div><ol class="helpdesk-steps">' +
          steps +
          "</ol></section>"
        : "") +
      (notes
        ? '<section class="helpdesk-section"><div class="helpdesk-section__head"><h3>Reminders</h3></div><ul class="helpdesk-notes">' +
          notes +
          "</ul></section>"
        : "") +
      pages +
      (related.length
        ? '<section class="helpdesk-section"><div class="helpdesk-section__head"><h3>Related topics</h3></div><div class="helpdesk-related">' +
          related
            .map(function (item) {
              return (
                '<button type="button" class="helpdesk-related__item" data-article-id="' +
                escapeHtml(item.id) +
                '"><i class="bi bi-arrow-right-short" aria-hidden="true"></i><span>' +
                escapeHtml(item.title) +
                "</span></button>"
              );
            })
            .join("") +
          "</div></section>"
        : "") +
      "</article>"
    );
  }

  function tokensFor(query) {
    return String(query || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(function (token) {
        return token.length > 1 && !STOP_WORDS[token];
      });
  }

  function scoreArticle(article, query, tokens) {
    var title = String(article.title || "").toLowerCase();
    var summary = String(article.summary || "").toLowerCase();
    var body = String(article.body || "").toLowerCase();
    var keywords = (article.keywords || []).join(" ").toLowerCase();
    var category = String(article.categoryTitle || "").toLowerCase();
    var pages = (article.pagePaths || []).join(" ");
    var lower = query.toLowerCase().trim();
    var score = 0;
    if (lower && title.indexOf(lower) !== -1) {
      score += 14;
    }
    if (lower && summary.indexOf(lower) !== -1) {
      score += 5;
    }
    tokens.forEach(function (token) {
      if (title.indexOf(token) !== -1) {
        score += 7;
      }
      if (keywords.indexOf(token) !== -1) {
        score += 6;
      }
      if (summary.indexOf(token) !== -1) {
        score += 3;
      }
      if (category.indexOf(token) !== -1) {
        score += 2;
      }
      if (body.indexOf(token) !== -1) {
        score += 1;
      }
      if (pages.indexOf(token) !== -1) {
        score += 1;
      }
    });
    if (state.contextKey && article.pagePaths.indexOf(state.contextKey) !== -1) {
      score += 3;
    }
    if (article.isFeatured) {
      score += 1;
    }
    return score;
  }

  function searchResults(query) {
    var tokens = tokensFor(query);
    if (!query.trim()) {
      return [];
    }
    return state.articles
      .map(function (article) {
        return { article: article, score: scoreArticle(article, query, tokens) };
      })
      .filter(function (entry) {
        return entry.score > 0;
      })
      .sort(function (a, b) {
        return b.score - a.score || a.article.title.localeCompare(b.article.title);
      })
      .slice(0, 30)
      .map(function (entry) {
        return entry.article;
      });
  }

  function searchMarkup(query) {
    var results = searchResults(query);
    if (!results.length) {
      var suggestions = featuredArticles().slice(0, 3);
      return (
        '<div class="helpdesk-empty">' +
        '<span class="helpdesk-empty__icon"><i class="bi bi-search" aria-hidden="true"></i></span>' +
        "<h3>No matching answer found</h3>" +
        "<p>Try different words such as the module name, the field label, or the action you want to perform.</p>" +
        '<button type="button" class="helpdesk-back" data-action="home"><i class="bi bi-grid" aria-hidden="true"></i> Browse all topics</button>' +
        "</div>" +
        (suggestions.length
          ? '<section class="helpdesk-section"><div class="helpdesk-section__head"><h3>Popular questions</h3></div>' +
            suggestionMarkup(suggestions) +
            "</section>"
          : "")
      );
    }
    return (
      '<p class="helpdesk-results-meta"><span>' +
      results.length +
      " result" +
      (results.length === 1 ? "" : "s") +
      " for &ldquo;" +
      escapeHtml(query) +
      "&rdquo;</span>" +
      '<button type="button" class="helpdesk-text-btn" data-action="home">Clear</button></p>' +
      articleListMarkup(results)
    );
  }

  function loadingMarkup() {
    return (
      '<div class="helpdesk-loading">' +
      '<span class="helpdesk-spinner" aria-hidden="true"></span>' +
      "<span>Loading the help guide…</span>" +
      "</div>"
    );
  }

  function errorMarkup() {
    return (
      '<div class="helpdesk-empty">' +
      '<span class="helpdesk-empty__icon"><i class="bi bi-cloud-slash" aria-hidden="true"></i></span>' +
      "<h3>The help guide could not load</h3>" +
      "<p>" +
      escapeHtml(state.error || "Check the connection and try again.") +
      "</p>" +
      '<button type="button" class="helpdesk-back" data-action="retry"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i> Try again</button>' +
      "</div>"
    );
  }

  function render() {
    if (!el.body) {
      return;
    }
    var html;
    if (state.loading && !state.loaded) {
      html = loadingMarkup();
    } else if (state.error && !state.loaded) {
      html = errorMarkup();
    } else if (state.view.name === "search") {
      html = searchMarkup(state.query);
    } else if (state.view.name === "article") {
      var article = articleById(state.view.id);
      html = article ? articleMarkup(article) : homeMarkup();
    } else if (state.view.name === "category") {
      html = categoryMarkup(state.view.slug);
    } else if (state.view.name === "all") {
      html =
        '<div class="helpdesk-article__toolbar"><button type="button" class="helpdesk-back" data-action="home"><i class="bi bi-arrow-left" aria-hidden="true"></i> Back to Helpdesk</button></div>' +
        '<div class="helpdesk-welcome"><p class="helpdesk-welcome__eyebrow">Knowledge base</p><h2>All help topics</h2><p>' +
        state.articles.length +
        " answers across " +
        state.categories.length +
        " categories.</p></div>" +
        articleListMarkup(state.articles);
    } else {
      html = homeMarkup();
    }
    el.body.innerHTML = html;
    el.body.scrollTop = 0;
  }

  function navigateToArticle(id) {
    var article = articleById(id);
    if (!article) {
      return;
    }
    state.view = { name: "article", id: article.id, from: state.view.name === "article" ? state.view.from : state.view };
    render();
    var back = el.body.querySelector('[data-action="back"]');
    if (back) {
      back.focus();
    }
  }

  function goBack() {
    var from = state.view.from || { name: "home" };
    state.view = from;
    render();
  }

  function open() {
    if (state.open) {
      return;
    }
    state.open = true;
    state.minimized = false;
    state.lastFocus = document.activeElement;
    if (state.closeTimer) {
      window.clearTimeout(state.closeTimer);
      state.closeTimer = null;
    }
    el.panel.hidden = false;
    el.panel.classList.remove("is-minimized");
    el.launcher.hidden = true;
    el.launcher.setAttribute("aria-expanded", "true");
    updateBackdrop();
    window.requestAnimationFrame(function () {
      el.panel.classList.add("is-visible");
    });
    if (!state.loaded && !state.loading) {
      loadContent();
    } else {
      render();
    }
    window.setTimeout(function () {
      if (state.open && !state.minimized) {
        el.search.focus();
      }
    }, 120);
  }

  function close() {
    if (!state.open) {
      return;
    }
    state.open = false;
    el.panel.classList.remove("is-visible");
    el.launcher.hidden = false;
    el.launcher.setAttribute("aria-expanded", "false");
    document.body.classList.remove("helpdesk-lock");
    el.backdrop.hidden = true;
    if (state.closeTimer) {
      window.clearTimeout(state.closeTimer);
    }
    state.closeTimer = window.setTimeout(function () {
      el.panel.hidden = true;
      el.panel.classList.remove("is-minimized");
      state.minimized = false;
    }, 190);
    if (state.lastFocus && typeof state.lastFocus.focus === "function") {
      state.lastFocus.focus();
    }
  }

  function updateBackdrop() {
    var mobile = window.matchMedia("(max-width: 575.98px)").matches;
    var show = state.open && mobile && !state.minimized;
    el.backdrop.hidden = !show;
    if (show) {
      window.requestAnimationFrame(function () {
        el.backdrop.classList.add("is-visible");
      });
      document.body.classList.add("helpdesk-lock");
    } else {
      el.backdrop.classList.remove("is-visible");
      document.body.classList.remove("helpdesk-lock");
    }
  }

  function setMinimized(minimized) {
    state.minimized = minimized;
    el.panel.classList.toggle("is-minimized", minimized);
    el.minimize.setAttribute("aria-label", minimized ? "Restore helpdesk" : "Minimize helpdesk");
    el.minimize.setAttribute("title", minimized ? "Restore" : "Minimize");
    el.minimize.innerHTML = minimized
      ? '<i class="bi bi-chevron-up" aria-hidden="true"></i>'
      : '<i class="bi bi-dash-lg" aria-hidden="true"></i>';
    updateBackdrop();
    if (!minimized) {
      window.setTimeout(function () {
        el.search.focus();
      }, 50);
    }
  }

  function loadContent(force) {
    if (state.loading && !force) {
      return;
    }
    state.loading = true;
    state.error = "";
    render();
    window
      .fetch(CONTENT_URL, {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("The help guide is temporarily unavailable (" + response.status + ").");
        }
        return response.json();
      })
      .then(function (payload) {
        var data = (payload && payload.data) || {};
        state.categories = Array.isArray(data.categories) ? data.categories : [];
        state.articles = Array.isArray(data.articles) ? data.articles : [];
        state.loaded = true;
        state.loading = false;
        state.error = "";
        if (el.search && el.search.value.trim()) {
          state.query = el.search.value;
          state.view = { name: "search", from: state.searchFrom || { name: "home" } };
        }
        render();
      })
      .catch(function (error) {
        state.loading = false;
        state.error = (error && error.message) || "Unable to reach the help service.";
        render();
      });
  }

  function onBodyClick(event) {
    var target = event.target;
    var articleButton = target.closest("[data-article-id]");
    if (articleButton) {
      event.preventDefault();
      navigateToArticle(articleButton.getAttribute("data-article-id"));
      return;
    }
    var categoryButton = target.closest("[data-category-slug]");
    if (categoryButton) {
      event.preventDefault();
      state.view = { name: "category", slug: categoryButton.getAttribute("data-category-slug") };
      render();
      return;
    }
    var actionButton = target.closest("[data-action]");
    if (!actionButton) {
      return;
    }
    var action = actionButton.getAttribute("data-action");
    if (action === "home") {
      state.query = "";
      el.search.value = "";
      updateSearchClear();
      state.view = { name: "home" };
      render();
    } else if (action === "back") {
      goBack();
    } else if (action === "browse-all") {
      state.view = { name: "all" };
      render();
    } else if (action === "retry") {
      loadContent(true);
    }
  }

  function updateSearchClear() {
    el.searchClear.classList.toggle("is-visible", Boolean(el.search.value));
  }

  function onSearchInput() {
    var value = el.search.value;
    updateSearchClear();
    if (state.searchTimer) {
      window.clearTimeout(state.searchTimer);
    }
    state.searchTimer = window.setTimeout(function () {
      state.query = value;
      if (!state.loaded) {
        return;
      }
      if (value.trim()) {
        if (state.view.name !== "search") {
          // Keep the article or category the user came from so Back still works.
          state.searchFrom = state.view;
        }
        state.view = { name: "search", from: state.searchFrom || { name: "home" } };
      } else {
        state.view = state.searchFrom || { name: "home" };
      }
      render();
    }, 130);
  }

  function clearSearch() {
    el.search.value = "";
    updateSearchClear();
    state.query = "";
    state.view = (state.searchFrom && state.searchFrom.name) || "home";
    if (typeof state.view === "string") {
      state.view = { name: state.view };
    }
    render();
    el.search.focus();
  }

  function mount() {
    if (!document.body || document.getElementById("helpdeskLauncher")) {
      return;
    }
    detectContext();

    var wrapper = document.createElement("div");
    wrapper.innerHTML =
      '<button type="button" class="helpdesk-launcher" id="helpdeskLauncher" aria-haspopup="dialog" aria-controls="helpdeskPanel" aria-expanded="false">' +
      '<span class="helpdesk-launcher__icon"><i class="bi bi-life-preserver" aria-hidden="true"></i></span>' +
      '<span class="helpdesk-launcher__label">Helpdesk</span>' +
      "</button>" +
      '<div class="helpdesk-panel__backdrop" id="helpdeskBackdrop" hidden></div>' +
      '<section class="helpdesk-panel" id="helpdeskPanel" role="dialog" aria-labelledby="helpdeskTitle" aria-describedby="helpdeskContext" hidden>' +
      '<header class="helpdesk-panel__head">' +
      '<span class="helpdesk-panel__mark"><i class="bi bi-life-preserver" aria-hidden="true"></i></span>' +
      '<div class="helpdesk-panel__titles">' +
      '<h2 class="helpdesk-panel__title" id="helpdeskTitle">Helpdesk</h2>' +
      '<p class="helpdesk-panel__context" id="helpdeskContext">Built-in system guide</p>' +
      "</div>" +
      '<div class="helpdesk-panel__head-actions">' +
      '<button type="button" class="helpdesk-icon-btn" id="helpdeskMinimize" aria-label="Minimize helpdesk" title="Minimize"><i class="bi bi-dash-lg" aria-hidden="true"></i></button>' +
      '<button type="button" class="helpdesk-icon-btn" id="helpdeskClose" aria-label="Close helpdesk" title="Close"><i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
      "</div>" +
      "</header>" +
      '<div class="helpdesk-panel__search">' +
      '<i class="bi bi-search" aria-hidden="true"></i>' +
      '<input type="search" class="helpdesk-search-input" id="helpdeskSearch" placeholder="Ask a question about this system…" autocomplete="off" aria-label="Search help topics">' +
      '<button type="button" class="helpdesk-search-clear" id="helpdeskSearchClear" aria-label="Clear search"><i class="bi bi-x-lg" aria-hidden="true"></i></button>' +
      "</div>" +
      '<div class="helpdesk-panel__body" id="helpdeskBody" aria-live="polite"></div>' +
      '<footer class="helpdesk-panel__footer">Answers reflect the installed SDMS features · <strong>Esc</strong> closes</footer>' +
      "</section>";

    while (wrapper.firstChild) {
      document.body.appendChild(wrapper.firstChild);
    }

    el.launcher = document.getElementById("helpdeskLauncher");
    el.backdrop = document.getElementById("helpdeskBackdrop");
    el.panel = document.getElementById("helpdeskPanel");
    el.body = document.getElementById("helpdeskBody");
    el.search = document.getElementById("helpdeskSearch");
    el.searchClear = document.getElementById("helpdeskSearchClear");
    el.minimize = document.getElementById("helpdeskMinimize");
    el.context = document.getElementById("helpdeskContext");

    el.context.textContent = state.contextLabel
      ? "Help for " + state.contextLabel
      : "Built-in system guide";

    el.launcher.addEventListener("click", open);
    document.getElementById("helpdeskClose").addEventListener("click", close);
    el.minimize.addEventListener("click", function () {
      setMinimized(!state.minimized);
    });
    el.backdrop.addEventListener("click", close);
    el.body.addEventListener("click", onBodyClick);
    el.search.addEventListener("input", onSearchInput);
    el.searchClear.addEventListener("click", clearSearch);
    el.search.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && state.view.name === "search") {
        event.preventDefault();
        var first = el.body.querySelector("[data-article-id]");
        if (first) {
          navigateToArticle(first.getAttribute("data-article-id"));
        }
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && state.open) {
        close();
      }
    });
    window.addEventListener("resize", function () {
      if (state.open) {
        updateBackdrop();
        el.panel.setAttribute("aria-modal", window.matchMedia("(max-width: 575.98px)").matches ? "true" : "false");
      }
    });
    el.panel.setAttribute("aria-modal", window.matchMedia("(max-width: 575.98px)").matches ? "true" : "false");

    // Warm the knowledge base after the page settles so the first open is
    // instant without delaying the underlying form.
    var preload = function () {
      loadContent();
    };
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(preload, { timeout: 2500 });
    } else {
      window.setTimeout(preload, 1200);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})(window, document);
