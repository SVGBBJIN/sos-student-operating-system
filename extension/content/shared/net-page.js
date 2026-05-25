// Runs in PAGE context (injected via web_accessible_resources). Wraps
// window.fetch and XMLHttpRequest.prototype.send so we can detect successful
// submission POSTs. Communicates back to the content script via postMessage —
// the only mechanism that crosses the page/isolated-world boundary cleanly.
//
// Wrappers are designed to be invisible: same return values, errors rethrown.

(() => {
  if (window.__SOS_NET_PAGE__) return;
  window.__SOS_NET_PAGE__ = true;

  const post = (payload) => {
    try { window.postMessage({ __sos: "net", ...payload }, "*"); } catch { /* noop */ }
  };

  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      const method = (init?.method || (typeof input !== "string" && input?.method) || "GET").toUpperCase();
      const url = typeof input === "string" ? input : input?.url || "";
      const p = origFetch.apply(this, arguments);
      if (method === "POST" || method === "PUT") {
        p.then((res) => post({ url, method, status: res.status })).catch(() => {});
      }
      return p;
    };
  }

  const XHRSend = XMLHttpRequest.prototype.send;
  const XHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__sosMethod = (method || "GET").toUpperCase();
    this.__sosUrl = url || "";
    return XHROpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (this.__sosMethod === "POST" || this.__sosMethod === "PUT") {
      this.addEventListener("loadend", () => {
        post({ url: this.__sosUrl, method: this.__sosMethod, status: this.status });
      });
    }
    return XHRSend.apply(this, arguments);
  };
})();
