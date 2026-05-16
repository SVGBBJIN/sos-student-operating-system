// Per-model Requests-Per-Minute tracker. Process-local sliding window — good
// enough for a single Vercel function or Supabase Edge instance. When the same
// API key is shared across many instances, the upstream provider 429 + circuit
// breaker in resilience.ts is the real safety net; this tracker exists to:
//
//   1. Tell the client how close it is to its share of the budget (so the UI
//      can queue requests instead of firing them blindly).
//   2. Preemptively downgrade Pro → Flash when Pro is near its limit (cheap
//      win — most chat traffic doesn't need Pro).
//   3. Reject obviously-over-limit calls before they hit the wire.
//
// Limits are tier-shaped (flash/pro/embed), overridable via env.
//
// TODO(groq-migration): defaults below still reflect Gemini paid-tier quotas
// (2026-05). After observing a week of real Groq traffic, recalibrate against
// Groq's published gpt-oss-20b / gpt-oss-120b paid-tier limits and rename the
// env vars to GROQ_RPM_FLASH / GROQ_RPM_PRO. Embed stays on Gemini.
//
//   GEMINI_RPM_FLASH=1000     (legacy name; applies to flash tier)
//   GEMINI_RPM_PRO=360        (legacy name; applies to pro tier)
//   GEMINI_RPM_EMBED=3000     (gemini-embedding-002)

import { getEnv } from "../env.js";
import type { Tier } from "./router.js";

const WINDOW_MS = 60_000;

const DEFAULT_LIMITS: Record<Tier, number> = {
  flash: 1000,
  pro: 360,
  embed: 3000,
};

function envNumber(name: string, fallback: number): number {
  const raw = getEnv(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function limitForTier(tier: Tier): number {
  switch (tier) {
    case "flash": return envNumber("GEMINI_RPM_FLASH", DEFAULT_LIMITS.flash);
    case "pro":   return envNumber("GEMINI_RPM_PRO",   DEFAULT_LIMITS.pro);
    case "embed": return envNumber("GEMINI_RPM_EMBED", DEFAULT_LIMITS.embed);
  }
}

// Sliding window of request timestamps, keyed by tier. We key by tier (not
// model) because the Gemini quotas are tier-shaped — a Flash request consumes
// against the Flash budget regardless of whether it hit `gemini-3-flash` or
// the `gemini-2.5-flash` fallback.
const WINDOWS = new Map<Tier, number[]>();

function pruneWindow(tier: Tier, nowMs: number): number[] {
  const cutoff = nowMs - WINDOW_MS;
  const arr = WINDOWS.get(tier) ?? [];
  let start = 0;
  while (start < arr.length && arr[start]! < cutoff) start += 1;
  const pruned = start === 0 ? arr : arr.slice(start);
  WINDOWS.set(tier, pruned);
  return pruned;
}

export interface RpmStatus {
  tier: Tier;
  used: number;
  remaining: number;
  limit: number;
  resetAtMs: number;
}

export function getRpmStatus(tier: Tier): RpmStatus {
  const now = Date.now();
  const arr = pruneWindow(tier, now);
  const limit = limitForTier(tier);
  const used = arr.length;
  const remaining = Math.max(0, limit - used);
  const oldest = arr[0];
  const resetAtMs = oldest != null ? oldest + WINDOW_MS : now;
  return { tier, used, remaining, limit, resetAtMs };
}

export function recordRequest(tier: Tier): RpmStatus {
  const now = Date.now();
  const arr = pruneWindow(tier, now);
  arr.push(now);
  WINDOWS.set(tier, arr);
  return getRpmStatus(tier);
}

export function nearLimit(tier: Tier, thresholdFraction = 0.05): boolean {
  const s = getRpmStatus(tier);
  return s.remaining / s.limit <= thresholdFraction;
}

export function overLimit(tier: Tier): boolean {
  return getRpmStatus(tier).remaining <= 0;
}

// Aggregate snapshot the frontend uses for its top-bar indicator. We surface
// the most-constrained tier (smallest fraction remaining) so the user sees
// the binding limit. Pro is usually the one to watch.
export function aggregateRpmStatus(): { remaining: number; limit: number; resetAtMs: number; tier: Tier } {
  const tiers: Tier[] = ["pro", "flash", "embed"];
  let worst: RpmStatus | null = null;
  for (const t of tiers) {
    const s = getRpmStatus(t);
    if (!worst || s.remaining / s.limit < worst.remaining / worst.limit) {
      worst = s;
    }
  }
  // tiers is non-empty so worst is always populated.
  const w = worst!;
  return { remaining: w.remaining, limit: w.limit, resetAtMs: w.resetAtMs, tier: w.tier };
}

// Test-only — clears all windows. Not exported from the public index.
export function _resetRpmTracker(): void {
  WINDOWS.clear();
}
