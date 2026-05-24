// Generic content script for user-added custom LMS domains.
//
// We don't know the host's DOM structure ahead of time, so this script relies
// only on signals that work for any LMS-ish page:
//   - Visible-text indicators ("Turned in", "Submitted", "Submission received")
//   - URL pattern matches (/turned_in, /submit/success, ?submitted=true)
//   - Successful submission POSTs (via shared/net.js → page-context wrapper)
//   - File uploads (supporting evidence only)
//
// `lms_assignment_id` defaults to the URL pathname so we get a stable key per
// page; `lms_assignment_title` falls back to <h1> textContent then document.title.
// These are heuristics — schools with truly bespoke LMSes may need a tailored
// content script later, but the URL+text+network triad catches most cases.

(() => {
  window.SOS_LMS = "custom";
  window.SOS_LAST_CTX = window.SOS_LAST_CTX || {};

  const P = window.SOS_PARSE;
  if (!P) return;

  function readContext() {
    // The hostname tells us which custom connector this is — surfaced in the
    // ingest endpoint and in the SOS Settings UI for debugging.
    const customHost = location.hostname;
    // Stable per-page id. We strip query/hash so revisiting an assignment with
    // a different tracking param doesn't create a duplicate.
    const assignmentId = location.pathname || "/";
    const titleEl = document.querySelector("h1, [role='heading'][aria-level='1']");
    const assignmentTitle = (titleEl?.textContent || document.title || "").trim() || null;
    return { customHost, assignmentId, assignmentTitle };
  }

  function emit(kind, detail = {}) {
    const ctx = window.SOS_LAST_CTX || {};
    if (!ctx.assignmentId) return;
    P.send({
      lms: "custom",
      lms_custom_host: ctx.customHost,
      lms_assignment_id: ctx.assignmentId,
      lms_assignment_title: ctx.assignmentTitle,
      evidence_kind: kind,
      evidence_detail: detail,
    });
  }

  function refreshContext() {
    window.SOS_LAST_CTX = readContext();
    return true;
  }

  function scan() {
    refreshContext();
    emit("page_visit", { path: location.pathname, host: location.hostname });
    const phrase = P.hasSubmissionText();
    if (phrase) emit("text_indicator", { phrase });
    const urlHit = P.urlMatchesSubmission(location.href);
    if (urlHit) emit("url_state", { pattern: urlHit });
  }

  const debouncedScan = P.debounce(scan, 1000);

  setTimeout(scan, 1500);

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      debouncedScan();
    }
  }, 1200);

  const mo = new MutationObserver(debouncedScan);
  mo.observe(document.documentElement, { subtree: true, childList: true });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t && t.tagName === "INPUT" && t.type === "file" && t.files && t.files.length > 0) {
      refreshContext();
      emit("upload", { fileCount: t.files.length });
    }
  }, true);
})();
