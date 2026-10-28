/* School District Monitoring System — shared API client */
(function (window) {
  "use strict";

  var MUTATING = { POST: true, PUT: true, PATCH: true, DELETE: true };
  var csrfToken = null;
  var redirecting = false;

  function ApiError(message, status, code, details) {
    var error = new Error(message || "The request could not be completed.");
    error.name = "ApiError";
    error.status = status || 0;
    error.code = code || "REQUEST_FAILED";
    error.details = details || null;
    return error;
  }

  function isLoginPage() {
    var path = window.location.pathname.toLowerCase();
    return path === "/" || path.indexOf("index.html") !== -1 || path.indexOf("reset-password") !== -1 || path.indexOf("register") !== -1;
  }

  function redirectToLogin() {
    if (isLoginPage() || redirecting) {
      return;
    }
    redirecting = true;
    var next = window.location.pathname + window.location.search;
    var target = "/index.html";
    if (next && next !== "/" && next.indexOf("index.html") === -1) {
      target += "?next=" + encodeURIComponent(next);
    }
    window.location.replace(target);
  }

  function queryString(params) {
    if (!params) {
      return "";
    }
    var search = new URLSearchParams();
    Object.keys(params).forEach(function (key) {
      var value = params[key];
      if (value === undefined || value === null || value === "") {
        return;
      }
      search.set(key, value);
    });
    var serialized = search.toString();
    return serialized ? "?" + serialized : "";
  }

  function parseBody(response) {
    var contentType = response.headers.get("content-type") || "";
    if (response.status === 204 || response.status === 205) {
      return Promise.resolve(null);
    }
    if (contentType.indexOf("application/json") !== -1) {
      return response.json().catch(function () {
        return null;
      });
    }
    return response.text().then(function (text) {
      return text ? { error: text } : null;
    });
  }

  function fetchToken() {
    return window
      .fetch("/api/auth/csrf", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      })
      .then(function (response) {
        return parseBody(response).then(function (payload) {
          if (!response.ok || !payload || !payload.data || !payload.data.csrfToken) {
            throw ApiError("The security token could not be loaded. Refresh the page and try again.", response.status, "CSRF_UNAVAILABLE");
          }
          csrfToken = payload.data.csrfToken;
          return csrfToken;
        });
      });
  }

  function ensureCsrfToken(force) {
    if (csrfToken && !force) {
      return Promise.resolve(csrfToken);
    }
    return fetchToken();
  }

  function setCsrfToken(token) {
    csrfToken = token || null;
  }

  function rawRequest(method, path, options) {
    var opts = options || {};
    var upperMethod = method.toUpperCase();
    var mutating = Boolean(MUTATING[upperMethod]);
    var prepare = mutating ? ensureCsrfToken(false) : Promise.resolve(null);

    return prepare.then(function (token) {
      var headers = { Accept: "application/json" };
      if (opts.body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      if (mutating && token) {
        headers["X-CSRF-Token"] = token;
      }

      return window
        .fetch("/api" + path + queryString(opts.params), {
          method: upperMethod,
          credentials: "same-origin",
          headers: headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
        })
        .then(function (response) {
          return parseBody(response).then(function (payload) {
            if (response.ok) {
              return payload || {};
            }

            var message =
              (payload && (payload.error || payload.message)) ||
              (response.status === 429
                ? "Too many attempts. Please wait a moment and try again."
                : "The request could not be completed.");
            var code = (payload && payload.code) || "REQUEST_FAILED";
            var error = ApiError(message, response.status, code, payload && payload.details);

            if (
              code === "CSRF_INVALID" &&
              mutating &&
              opts.retryCsrf !== false
            ) {
              csrfToken = null;
              return rawRequest(method, path, Object.assign({}, opts, { retryCsrf: false }));
            }

            if (
              response.status === 401 &&
              path.indexOf("/auth/login") === -1 &&
              path.indexOf("/auth/me") === -1 &&
              opts.redirectOnAuth !== false &&
              !isLoginPage()
            ) {
              redirectToLogin();
            }

            throw error;
          });
        });
    }).catch(function (error) {
      if (error && error.name === "ApiError") {
        throw error;
      }
      throw ApiError(
        "Unable to reach the server. Check your connection and try again.",
        0,
        "NETWORK_ERROR"
      );
    });
  }

  function request(method, path, options) {
    return rawRequest(method, path, options || {});
  }

  window.API = {
    get: function (path, params, options) {
      return request("GET", path, Object.assign({}, options || {}, { params: params }));
    },
    post: function (path, body, options) {
      return request("POST", path, Object.assign({}, options || {}, { body: body }));
    },
    put: function (path, body, options) {
      return request("PUT", path, Object.assign({}, options || {}, { body: body }));
    },
    patch: function (path, body, options) {
      return request("PATCH", path, Object.assign({}, options || {}, { body: body }));
    },
    delete: function (path, options) {
      return request("DELETE", path, options || {});
    },
    request: request,
    ensureCsrfToken: ensureCsrfToken,
    setCsrfToken: setCsrfToken,
    getCsrfToken: function () {
      return csrfToken;
    },
    redirectToLogin: redirectToLogin,
    ApiError: ApiError
  };
})(window);
