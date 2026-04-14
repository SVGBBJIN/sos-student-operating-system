/**
 * retryAI — wraps any async AI call with structured retry and rate-limit handling.
 *
 * Backoff schedule: 1s → 2s → 4s
 * 429 (rate limit)  : dispatch "sos:rate-limited" event, throw immediately (no retry)
 * 529 (overloaded)  : retry up to maxRetries times
 * Other errors      : retry once, then throw
 */
export async function retryAI(fn, opts = {}) {
  const maxRetries = opts.maxRetries ?? 3;
  const backoffMs = [1000, 2000, 4000];

  let otherErrorRetried = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status ?? err?.statusCode ?? null;

      if (status === 429) {
        // Rate limited — signal globally and fail immediately
        try {
          window.dispatchEvent(new CustomEvent("sos:rate-limited"));
        } catch (_) {}
        throw err;
      }

      if (status === 529) {
        // Groq overloaded — retry with backoff
        if (attempt < maxRetries) {
          await sleep(backoffMs[Math.min(attempt, backoffMs.length - 1)]);
          continue;
        }
        throw err;
      }

      // Any other error — retry once, then throw
      if (!otherErrorRetried) {
        otherErrorRetried = true;
        await sleep(backoffMs[0]);
        continue;
      }
      throw err;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
