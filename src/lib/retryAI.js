/**
 * retryAI — wraps any async AI call with structured retry and rate-limit handling.
 *
 * Backoff schedule: 1s → 2s → 4s
 * 429 (rate limit)                    : dispatch "sos:rate-limited" event, throw immediately (no retry)
 * 502/503/504/529 or unavailable text : retry up to maxRetries times
 * Other errors                        : retry once, then throw
 */
export async function retryAI(fn, opts = {}) {
  const maxRetries = opts.maxRetries ?? 3;
  const backoffMs = opts.backoffMs ?? [1000, 2000, 4000];

  let otherErrorRetried = false;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err?.status ?? err?.statusCode ?? null;

      if (status === 429) {
        // Rate limited — signal globally and fail immediately.
        try {
          window.dispatchEvent(new CustomEvent("sos:rate-limited"));
        } catch (_) {}
        throw err;
      }

      if (isUnavailableError(err)) {
        // Provider/backend temporarily unavailable — retry automatically with backoff.
        if (attempt < maxRetries) {
          await sleep(backoffMs[Math.min(attempt, backoffMs.length - 1)]);
          continue;
        }
        throw err;
      }

      // Any other error — retry once, then throw.
      if (!otherErrorRetried) {
        otherErrorRetried = true;
        await sleep(backoffMs[0]);
        continue;
      }
      throw err;
    }
  }
}

function isUnavailableError(err) {
  const status = err?.status ?? err?.statusCode ?? null;
  if ([502, 503, 504, 529].includes(status)) return true;

  const text = [
    err?.message,
    err?.body,
    err?.error,
    err?.details,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return /\b(service|server|provider|model|ai)\b[^.]{0,80}\bunavailable\b/.test(text)
    || /\bunavailable\b[^.]{0,80}\b(service|server|provider|model|ai)\b/.test(text)
    || /temporarily unavailable|service is unavailable|service unavailable|overloaded/.test(text);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
