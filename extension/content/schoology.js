// Schoology content script.
//
// Schoology serves on either app.schoology.com or a school-specific subdomain
// (e.g. bps.schoology.com). Assignment URLs are /assignment/<digits>; submitted
// state is reached either via the assignment page itself (with "Submitted"
// status in the sidebar) or via /assignment/<id>/dropbox after the student
// hits Submit. The Submit button POSTs to AJAX endpoints under /dropbox/* or
// /assignment/<id>/submit — net.js's generic submit/submission regex catches
// both.
//
// Course IDs aren't always in the assignment URL; they live in the section nav
// breadcrumb. Best-effort — the matcher only needs the title to be useful,
// course/subject is a bonus signal.

(() => {
  window.SOS_LMS = "schoology";
  window.SOS_LAST_CTX = window.SOS_LAST_CTX || {};

  const P = window.SOS_PARSE;
  if (!P) return;

  // /assignment/<id>, optionally followed by /dropbox or /comments.
  const ASSIGNMENT_RE = /\/assignment\/(\d+)(?:\/([a-z_]+))?/;
  // Section (course) URL: /course/<id> appears in breadcrumbs.
  const SECTION_RE = /\/course\/(\d+)/;

  function readContext() {
    const m = ASSIGNMENT_RE.exec(location.pathname);
    if (!m) return null;
    const [, assignmentId, subroute] = m;

    // Title shows up as the .page-title or .assignment-title element. Schoology
    // also exposes it on the breadcrumb, which is more resilient to redesigns.
    const titleEl =
      document.querySelector(".page-title")
      || document.querySelector(".assignment-title")
      || document.querySelector("#breadcrumbs li:last-child")
      || document.querySelector("h1");
    const assignmentTitle = (titleEl?.textContent || "").trim() || null;

    // Course name + id: walk the breadcrumb for the /course/<id> link.
    let courseId = null;
    let courseName = null;
    const courseLink = document.querySelector('a[href*="/course/"]');
    if (courseLink) {
      const sm = SECTION_RE.exec(courseLink.getAttribute("href") || "");
      if (sm) courseId = sm[1];
      courseName = (courseLink.textContent || "").trim() || null;
    }

    return { assignmentId, courseId, courseName, assignmentTitle, subroute };
  }

  function emit(kind, detail = {}) {
    const ctx = window.SOS_LAST_CTX || {};
    if (!ctx.assignmentId) return;
    P.send({
      lms: "schoology",
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

    // Schoology shows "Submitted on <date>" in the sidebar of a submitted
    // assignment. The shared text indicator already catches "submitted"; we
    // also look for the graded badge which is a strong signal.
    const text = P.visibleText();
    if (/grade[d:]\s*\d|score[:\s]+\d/i.test(text)) emit("grade_posted", {});
  }

  const debouncedScan = P.debounce(scan, 800);

  setTimeout(scan, 1200);

  // SPA-ish navigation — Schoology uses partial reloads when switching tabs
  // within an assignment, so URL polling + MutationObserver are both needed.
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      debouncedScan();
    }
  }, 1000);

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
