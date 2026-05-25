// Google Classroom content script.
//
// Classroom is a heavy SPA — URLs change without full reloads and most state
// arrives via DOM mutation. We watch three signals:
//   1. URL changes (look for /c/<course>/a/<assignment> patterns and
//      submission-success URL fragments)
//   2. Visible-text indicators ("Turned in", "Assignment complete", grade
//      strings)
//   3. Network POSTs to submission endpoints (via shared/net.js → postMessage)
//
// Each fires a structured event to the background worker; the backend
// confidence engine fuses them into a single score per assignment.

(() => {
  window.SOS_LMS = "classroom";
  window.SOS_LAST_CTX = window.SOS_LAST_CTX || {};

  const P = window.SOS_PARSE;
  if (!P) return; // shared/parse.js must run first; manifest order guarantees it

  // Classroom assignment URL: /c/<course_id>/a/<assignment_id>/details
  // (the trailing segment varies — "details", "sa", etc.). The pair we care
  // about is course + assignment id.
  const ASSIGNMENT_RE = /\/c\/([^/]+)\/a\/([^/?#]+)/;

  function readContext() {
    const m = ASSIGNMENT_RE.exec(location.pathname);
    if (!m) return null;
    const [, courseId, assignmentId] = m;
    // Course name is in the top breadcrumb; assignment title is the first H1-ish
    // element. Use textContent (cheap) rather than a selector that LMS UI
    // updates might break.
    const courseName = (document.querySelector('[role="banner"] a[href*="/c/"]')?.textContent || "").trim() || null;
    const assignmentTitle = (document.querySelector('h1, [role="heading"][aria-level="1"]')?.textContent || "").trim() || null;
    return { courseId, assignmentId, courseName, assignmentTitle };
  }

  function emit(kind, detail = {}) {
    const ctx = window.SOS_LAST_CTX || {};
    if (!ctx.assignmentId) return; // never emit unscoped events
    P.send({
      lms: "classroom",
      lms_course_id: ctx.courseId,
      lms_course_name: ctx.courseName,
      lms_assignment_id: ctx.assignmentId,
      lms_assignment_title: ctx.assignmentTitle,
      evidence_kind: kind,
      evidence_detail: detail,
    });
  }

  function refreshContext() {
    const ctx = readContext();
    if (!ctx) return false;
    window.SOS_LAST_CTX = ctx;
    return true;
  }

  function scan() {
    if (!refreshContext()) return;
    emit("page_visit", { path: location.pathname });
    const phrase = P.hasSubmissionText();
    if (phrase) emit("text_indicator", { phrase });
    const urlHit = P.urlMatchesSubmission(location.href);
    if (urlHit) emit("url_state", { pattern: urlHit });
  }

  const debouncedScan = P.debounce(scan, 800);

  // Initial scan once the page is idle.
  setTimeout(scan, 1200);

  // SPA navigation — history.pushState fires no event, so poll URL changes.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      debouncedScan();
    }
  }, 1000);

  // DOM mutations — Classroom replaces large subtrees when switching tabs
  // within an assignment. One MutationObserver on body is enough.
  const mo = new MutationObserver(debouncedScan);
  mo.observe(document.documentElement, { subtree: true, childList: true });

  // File uploads — supporting evidence only.
  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t && t.tagName === "INPUT" && t.type === "file" && t.files && t.files.length > 0) {
      refreshContext();
      emit("upload", { fileCount: t.files.length });
    }
  }, true);
})();
