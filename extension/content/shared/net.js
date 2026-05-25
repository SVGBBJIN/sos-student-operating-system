// Network-monitoring shim. Content scripts run in an isolated world and can't
// read `window.fetch` overrides made by the page; conversely the page can't
// see overrides made in the isolated world. The standard MV3 dance:
//   1. inject a tiny <script> tag pointing at net-page.js (a web-accessible
//      resource) so it runs in PAGE context
//   2. that page-context script wraps fetch/XHR and emits window.postMessage
//      events that this isolated-world script listens for and forwards to the
//      background as structured evidence.

(function attachNetMonitor() {
  if (window.SOS_NET_INSTALLED) return;
  window.SOS_NET_INSTALLED = true;

  try {
    const src = chrome.runtime.getURL("content/shared/net-page.js");
    const el = document.createElement("script");
    el.src = src;
    el.async = false;
    (document.head || document.documentElement).appendChild(el);
    el.remove(); // tag stays attached behaviorally; the element itself can go
  } catch {
    // If injection fails (e.g. strict CSP), we still have DOM/URL evidence.
  }

  window.addEventListener("message", (ev) => {
    if (!ev.data || ev.source !== window) return;
    const msg = ev.data;
    if (msg.__sos !== "net") return;
    // Only successful POST/PUT to anything that smells like submission.
    if (msg.status >= 200 && msg.status < 300 && /submit|turn[_-]?in|attempt|submissions?/i.test(msg.url)) {
      window.SOS_PARSE?.send({
        lms: window.SOS_LMS,
        lms_course_id: window.SOS_LAST_CTX?.courseId,
        lms_course_name: window.SOS_LAST_CTX?.courseName,
        lms_assignment_id: window.SOS_LAST_CTX?.assignmentId || "unknown",
        lms_assignment_title: window.SOS_LAST_CTX?.assignmentTitle,
        evidence_kind: "submission_post",
        evidence_detail: { url: msg.url, method: msg.method, status: msg.status },
      });
    }
  });
})();
