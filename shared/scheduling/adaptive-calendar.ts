// Internal adaptive calendar: a scheduling layer that keeps running whether or
// not the student has the calendar UI turned on. The user-facing calendar
// panel is now an optional/toggle-able view (see App.jsx `calendarEnabled`
// setting); this module is the part that never turns off — the priority
// engine, context enrichment, and plan pipeline all read from it regardless.
//
// "Adaptive" = block placements aren't fixed once created. Given behavioral
// signals (completion rate by time-of-day, postpone rate by subject), this
// reflows an existing block's suggested time toward slots the student
// actually follows through on, instead of the slot it happened to be typed
// into. Pure, sync, no I/O — safe in both Node and Deno.

import type { BehavioralSignals } from "../ai/signals/behavioral.js";

export interface AdaptiveBlockInput {
  id: string;
  activity: string;
  date: string;       // YYYY-MM-DD
  start: string;       // HH:MM
  end: string;         // HH:MM
  category?: string;
  subject?: string;
}

export interface AdaptiveSuggestion {
  blockId: string;
  currentStart: string;
  suggestedStart: string | null; // null = no change suggested
  confidence: number;            // 0..1 — how strongly the signal supports the move
  reason: string;
}

function hourOf(hhmm: string): number {
  const h = Number(hhmm.split(":")[0]);
  return Number.isFinite(h) ? h : 0;
}

function formatHour(h: number): string {
  const clamped = Math.max(0, Math.min(23, Math.round(h)));
  return `${String(clamped).padStart(2, "0")}:00`;
}

// Behavioral signals expose a 24-bucket histogram of completion counts by
// hour-of-day. Normalize to a 0..1 share of total completions, then find the
// best nearby hour (within `radiusHours`) with a meaningfully higher share
// than the block's current slot.
function bestNearbyHour(
  currentHour: number,
  histogram: number[] | undefined,
  radiusHours: number
): { hour: number; delta: number } | null {
  if (!histogram || histogram.length !== 24) return null;
  const total = histogram.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const share = (h: number) => (histogram[h] ?? 0) / total;
  const current = share(currentHour);
  let best: { hour: number; delta: number } | null = null;
  for (let offset = -radiusHours; offset <= radiusHours; offset++) {
    if (offset === 0) continue;
    const hour = ((currentHour + offset) % 24 + 24) % 24;
    const delta = share(hour) - current;
    if (delta > 0.1 && (!best || delta > best.delta)) {
      best = { hour, delta };
    }
  }
  return best;
}

// Compute adaptive suggestions for a set of blocks. Never mutates or returns a
// block the student needs to act on immediately — callers decide whether to
// surface the suggestion (e.g. only for recurring blocks, not one-off events).
export function computeAdaptiveSuggestions(
  blocks: AdaptiveBlockInput[],
  signals?: BehavioralSignals
): AdaptiveSuggestion[] {
  const histogram = signals?.time_of_day_histogram;
  return blocks.map((b) => {
    const currentHour = hourOf(b.start);
    const match = bestNearbyHour(currentHour, histogram, 3);
    if (!match) {
      return {
        blockId: b.id,
        currentStart: b.start,
        suggestedStart: null,
        confidence: 0,
        reason: "No stronger time-of-day signal found — keeping the current slot.",
      };
    }
    return {
      blockId: b.id,
      currentStart: b.start,
      suggestedStart: formatHour(match.hour),
      confidence: Math.min(1, match.delta * 4),
      reason: `"${b.activity}" tends to stick when started around ${formatHour(match.hour)} (completion share +${Math.round(match.delta * 100)}pts vs. its current slot).`,
    };
  });
}

// Always-on density snapshot the internal calendar feeds into priority scoring
// and context enrichment, independent of whether the user-facing calendar
// panel is toggled on. Mirrors buildCalendarDensity in priority.ts but scoped
// to this module so it stays decoupled from any one caller's block shape.
export function internalCalendarDensity(
  blocks: AdaptiveBlockInput[]
): Record<string, number> {
  const perDate: Record<string, number> = {};
  for (const b of blocks) {
    perDate[b.date] = (perDate[b.date] ?? 0) + 1;
  }
  return perDate;
}
