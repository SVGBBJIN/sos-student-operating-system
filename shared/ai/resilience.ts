// Retry, timeout, and circuit-breaker behavior for AI calls.
//
// Three layers, in order:
//   1. Per-attempt timeout (AbortController + budgetMs)
//   2. Retry ladder: 429 → exp backoff; 5xx → bounded; network → 1 shot
//   3. Circuit breaker (process-local): if the last N requests inside a short
//      window all errored, open the circuit for COOLDOWN ms and synthesize a
//      graceful fallback response.
//
// In-tier and tier-downgrade fallback (Gemini 3 Flash → 2.5 Flash, 2.5 Pro →
// Gemini 3 Flash) is implemented in chat-core.ts because it needs to re-route.

export interface RetryOptions {
  budgetMs: number;
  maxAttempts: number;
}

export const DEFAULT_RETRY: RetryOptions = { budgetMs: 12000, maxAttempts: 4 };

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

export async function withTimeout<T>(p: Promise<T>, ms: number, label = "operation"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
