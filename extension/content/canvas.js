// Canvas content script.
//
// Canvas assignment URLs look like /courses/<id>/assignments/<id> with various
// trailing segments (/submissions/<user>, /edit, ?submitted=true). We pull
// course + assignment ids from the URL and watch the same three signal sources
// as the Classroom script.

(() => {
  window.SOS_LMS = "canvas";
  window.SOS_LAST_CTX = window.SOS_LAST_CTX || {};

  const P = window.SOS_PARSE;
  if (!P) return;

  const ASSIGNMENT_RE = /\/courses\/(\d+)\/assignments\/(\d+)/;

  function readContext() {
    const m = ASSIGNMENT_RE.exec(location.pathname);
    if (!m) return null;
    const [, courseId, assignmentId] = m;
    // Canvas exposes the course name on the body element via data-course-id
    // and a sidebar nav title; the assignment title is in #assignment_show h1.
    const courseName =
      (document.querySelector('#breadcrumbs a[href*="/courses/"][href$="' + courseId + '"]')?.textContent
        || document.querySelector('h2.context_title')?.textContent
        || "").trim() || null;
    const assignmentTitle =
      (document.querySelector('#assignment_show h1, h1.title, h1[data-testid="assignment-name"]')?.textContent
        || "").trim() || null;
    return { courseId, assignmentId, courseName, assignmentTitle };
  }

  function emit(kind, detail = {}) {
    const ctx = window.SOS_LAST_CTX || {};
    if (!ctx.assignmentId) return;
    P.send({
      lms: "canvas",
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
    // Canvas posts a clear "Submitted!" header on the submission details page;
    // also surfaces "Submission Status: Submitted" in the sidebar. Both are
    // caught by the generic text_indicator path above.
    // Grades posted: look for a "Score:" or graded badge.
    if (/score[:\s]+\d/i.test(P.visibleText())) emit("grade_posted", {});
  }

  const debouncedScan = P.debounce(scan, 800);

  setTimeout(scan, 1200);

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
