// Shared parsing primitives for both LMS content scripts.
//
// Lives in window scope (loaded as a regular content script before each
// per-LMS script). Exposes `window.SOS_PARSE` so the per-LMS scripts can pull
// helpers off it without import/export ceremony — content scripts in MV3 don't
// share an ES-module graph.

(function attachParseHelpers() {
  if (window.SOS_PARSE) return; // re-injection guard

  // Submission-indicator phrases we look for in visible page text. Case-insensitive.
  // Kept short and intentional — broader patterns produce false positives on
  // assignment-listing pages that mention "submitted" in a tooltip.
  const SUBMISSION_TEXT_INDICATORS = [
    "turned in",
    "submitted",
    "submission received",
    "assignment complete",
    "marked as done",
  ];

  // URL fragments that, on their own, are strong evidence of a successful submit.
  const SUBMISSION_URL_PATTERNS = [
    /\/turned[_-]?in\b/i,
    /\/submit\/success\b/i,
    /\/submission_complete\b/i,
    /\bsubmitted=true\b/i,
  ];

  function visibleText(root) {
    const node = root || document.body;
    if (!node) return "";
    // Limit to ~50KB so we don't burn CPU on huge pages.
    return (node.innerText || "").slice(0, 50_000);
  }

  function hasSubmissionText(root) {
    const text = visibleText(root).toLowerCase();
    for (const phrase of SUBMISSION_TEXT_INDICATORS) {
      if (text.includes(phrase)) return phrase;
    }
    return null;
  }

  function urlMatchesSubmission(url) {
    for (const re of SUBMISSION_URL_PATTERNS) {
      if (re.test(url)) return re.source;
    }
    return null;
  }

  // Debounced runner — many MutationObserver callbacks coalesce into one
  // invocation, which is plenty for "did the page now show 'Turned in'".
  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn(...args); }, ms);
    };
  }

  function send(event) {
    // Tagged with a sentinel so the background can ignore stray messages.
    try {
      chrome.runtime.sendMessage({ type: "sos:event", event }, () => void chrome.runtime.lastError);
    } catch {
      // Service worker may be asleep; the next message wakes it.
    }
  }

  window.SOS_PARSE = {
    SUBMISSION_TEXT_INDICATORS,
    SUBMISSION_URL_PATTERNS,
    visibleText,
    hasSubmissionText,
    urlMatchesSubmission,
    debounce,
    send,
  };
})();
