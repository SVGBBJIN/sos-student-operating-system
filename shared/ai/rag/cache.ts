// Two-layer cache for AI responses on idempotent intents.
//   L1: in-process LRU keyed by intent + prompt sha
//   L2: semantic cache stored in Supabase (response_cache table)
//
// L2 is read-through only — writes happen async after a successful call.
// This module is intentionally narrow: only summarize / proofread_classify
// call it. Action routing must never hit a cache (it would short-circuit
// ask_clarification).

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const L1 = new Map<string, CacheEntry<unknown>>();
const L1_MAX = 256;

function evictIfFull(): void {
  if (L1.size <= L1_MAX) return;
  const firstKey = L1.keys().next().value as string | undefined;
  if (firstKey) L1.delete(firstKey);
}

export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function l1Get<T>(key: string): T | null {
  const e = L1.get(key);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    L1.delete(key);
    return null;
  }
  return e.value as T;
}

export function l1Set<T>(key: string, value: T, ttlMs = 5 * 60_000): void {
  evictIfFull();
  L1.set(key, { value, expiresAt: Date.now() + ttlMs });
}
