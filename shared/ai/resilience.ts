// Retry classification and circuit-breaker behavior for AI calls.
//
// Two concerns:
//   1. Retry classification: isRetryable + backoffMs (exp backoff with jitter).
//   2. Circuit breaker (process-local): if the last N requests inside a short
//      window all errored, open the circuit for COOLDOWN ms and synthesize a
//      graceful fallback response.
//
// Per-attempt timeouts (budgetMs → AbortController) live in chat-core.ts, where
// the request deadline is known. Cross-provider fallback is also in chat-core.ts
// because it needs to re-route.

export function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; message?: string; name?: string };
  if (!e) return false;
  if (e.name === "AbortError") return true;
  if (e.status && e.status >= 500) return true;
  if (e.status === 429) return true;
  const msg = (e.message ?? "").toLowerCase();
  return /timeout|unavailable|temporarily|rate limit|exhausted|network/.test(msg);
}

export function backoffMs(attempt: number, base = 300, cap = 3000): number {
  const jitter = Math.random() * 0.3 + 0.85;
  return Math.min(cap, base * 2 ** attempt) * jitter;
}

// ── Circuit breaker (process-local) ──────────────────────────────────────────

interface CircuitState {
  failures: number[];
  openUntilMs: number;
}

const CIRCUIT = new Map<string, CircuitState>();
const WINDOW_MS = 30_000;
const THRESHOLD = 10;
const COOLDOWN_MS = 60_000;

export function circuitOpen(key: string): boolean {
  const s = CIRCUIT.get(key);
  if (!s) return false;
  return Date.now() < s.openUntilMs;
}

export function recordFailure(key: string): boolean {
  const now = Date.now();
  const s = CIRCUIT.get(key) ?? { failures: [], openUntilMs: 0 };
  s.failures = s.failures.filter((t) => now - t < WINDOW_MS);
  s.failures.push(now);
  if (s.failures.length >= THRESHOLD) {
    s.openUntilMs = now + COOLDOWN_MS;
    s.failures = [];
  }
  CIRCUIT.set(key, s);
  return now < s.openUntilMs;
}

export function recordSuccess(key: string): void {
  const s = CIRCUIT.get(key);
  if (!s) return;
  s.failures = [];
}

export type FallbackReason = "circuit_open" | "provider_failed";

export function circuitFallbackResponse(
  reason: FallbackReason = "circuit_open",
  lastErrorMessage?: string
): { content: string; toolCalls: never[]; usage: Record<string, never>; modelUsed: string; finishReason: FallbackReason } {
  const content = reason === "circuit_open"
    ? "AI service is recovering — try again in about 30 seconds."
    : lastErrorMessage
      ? `AI request failed: ${lastErrorMessage.slice(0, 240)}`
      : "AI request failed — give it a moment and try again.";
  return {
    content,
    toolCalls: [],
    usage: {},
    modelUsed: reason === "circuit_open" ? "circuit-open" : "provider-failed",
    finishReason: reason,
  };
}
