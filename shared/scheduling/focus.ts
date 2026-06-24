// Focus Sessions engine — Sprint & Marathon.
// Pure functions, sync, no I/O — safe in both Node and Deno.
//
// A focus session drives the student task-to-task off the TOP of the
// priority-ranked queue with no gap. Sprint is bound by the clock; Marathon is
// bound by a goal and runs as looped sprints with signal-driven breaks in the
// seams. Sprint and Marathon share one engine — Marathon is Sprint wrapped in a
// loop that inserts breaks at the seams.
//
// This module owns the decidable parts: queue selection, the active/on-deck
// pair, the Sprint soft-exit, goal completion, the Marathon break-offer logic,
// the fade-hour derivation, and the factual end line. The React layer owns the
// timers, rendering, ignition (the Start primitive) and persistence — nothing
// here touches I/O, so all of it is testable.

import type { BehavioralSignals } from "../ai/signals/behavioral.js";
import {
  rankTasks,
  type TaskForScoring,
  type CalendarDensity,
} from "./priority.js";

export type FocusMode = "sprint" | "marathon";

// Marathon is bound by a goal, not a clock. Either the top-N off the priority
// queue (count, zero config) or the specific tasks the student tapped.
export type MarathonGoal =
  | { kind: "count"; count: number }
  | { kind: "selection"; taskIds: string[] };

// ── Defaults ────────────────────────────────────────────────────────────────
// The Marathon break floor: no break is offered until BOTH a minimum number of
// sprints AND a minimum elapsed time are in. Both must clear so a burst of tiny
// tasks can't trip a break two minutes in, and one slow task can't either.
export const BREAK_FLOOR_SPRINTS = 2;
export const BREAK_FLOOR_MS = 15 * 60 * 1000;
// A break is short and timed; the next sprint auto-ignites at zero.
export const DEFAULT_BREAK_MS = 5 * 60 * 1000;
// Default Sprint window when the student doesn't pick one.
export const DEFAULT_SPRINT_MS = 25 * 60 * 1000;
// After any break decision (taken or declined) the seam goes quiet for this
// long so the offer can't spam every completion once a signal latches.
export const BREAK_COOLDOWN_MS = 8 * 60 * 1000;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid] ?? 0;
}

function asSet(ids: Set<string> | string[] | undefined): Set<string> {
  if (ids instanceof Set) return ids;
  return new Set(ids ?? []);
}

// ── Queue ─────────────────────────────────────────────────────────────────
// The session queue IS the priority-ranked order — the top of the queue, never
// the startability blend and never hand-picked. Returns ordered task ids; the
// React layer freezes this at session start so the order can't reshuffle under
// the student mid-session.
export function buildSessionQueue(
  tasks: TaskForScoring[],
  now: Date,
  density: CalendarDensity,
  signals?: BehavioralSignals
): string[] {
  return rankTasks(tasks, now, density, signals).map((r) => r.taskId);
}

// The active + on-deck pair: the next two ids in queue order that are neither
// completed nor skipped. On-deck is what surfaces before the current one closes
// so the seam has no gap.
export function activeAndOnDeck(
  queue: string[],
  completedIds: Set<string> | string[],
  skippedIds?: Set<string> | string[]
): { activeId: string | null; onDeckId: string | null } {
  const done = asSet(completedIds);
  const skipped = asSet(skippedIds);
  const remaining = queue.filter((id) => !done.has(id) && !skipped.has(id));
  return { activeId: remaining[0] ?? null, onDeckId: remaining[1] ?? null };
}

// How many of the queued tasks are still available to work (not done, not
// skipped). Zero means the queue has run dry and the session must close.
export function remainingCount(
  queue: string[],
  completedIds: Set<string> | string[],
  skippedIds?: Set<string> | string[]
): number {
  const done = asSet(completedIds);
  const skipped = asSet(skippedIds);
  return queue.filter((id) => !done.has(id) && !skipped.has(id)).length;
}

// ── Sprint soft exit ────────────────────────────────────────────────────────
// The clock is a bound, not a guillotine. Expiry only ARMS the exit; the bell
// never cuts a task in progress. The session actually closes at the first
// completion after the clock has expired. Returns whether completing the active
// task at `now` should close the Sprint.
export function sprintShouldClose(
  startedAt: number,
  durationMs: number,
  now: number
): boolean {
  return now >= startedAt + durationMs;
}

// ── Marathon goal ─────────────────────────────────────────────────────────
// Goal met → Marathon stops offering sprints. Count goals measure completions
// off the queue; selection goals measure the specific tapped tasks.
export function isGoalMet(
  goal: MarathonGoal,
  queue: string[],
  completedIds: Set<string> | string[]
): boolean {
  const done = asSet(completedIds);
  if (goal.kind === "selection") {
    return goal.taskIds.length > 0 && goal.taskIds.every((id) => done.has(id));
  }
  const completedFromQueue = queue.filter((id) => done.has(id)).length;
  return completedFromQueue >= goal.count;
}

// ── Marathon break offer ─────────────────────────────────────────────────────
// The break engine is the only thing Marathon adds over Sprint. It lives ONLY
// in the seams. Logic: a floor (nothing offered until a minimum time + sprint
// count in) plus an early trigger on fatigue signals — widening gaps between
// completions, friction (skips/postpones/abandons) creeping in, or being past
// the student's historical fade hour. Signal-driven off the floor, never a
// fixed cadence; the offer is never forced.

export type BreakReason =
  | "floor_not_met"
  | "cooldown"
  | "widening_gaps"
  | "friction"
  | "fade_hour"
  | "none";

export interface BreakInput {
  sprintsCompleted: number; // completions this session
  sessionElapsedMs: number; // since session start
  completionGapsMs: number[]; // gaps between consecutive completions this session
  frictionCount: number; // skips/postpones/abandons observed this session
  currentHour: number; // local hour 0..23
  fadeHour: number | null; // historical fade hour; null at cold start
  msSinceLastDecision?: number | null; // since the last break taken/declined
  floorSprints?: number;
  floorMs?: number;
  cooldownMs?: number;
}

export interface BreakDecision {
  offer: boolean;
  reason: BreakReason;
}

// Latest stretch between completions dragging out relative to the earlier pace.
function isWideningGaps(gaps: number[]): boolean {
  if (gaps.length < 3) return false;
  const last = gaps[gaps.length - 1]!;
  const earlier = gaps.slice(0, -1);
  const med = median(earlier);
  if (med <= 0) return false;
  return last >= med * 1.6;
}

export function decideBreak(input: BreakInput): BreakDecision {
  const floorSprints = input.floorSprints ?? BREAK_FLOOR_SPRINTS;
  const floorMs = input.floorMs ?? BREAK_FLOOR_MS;
  const cooldownMs = input.cooldownMs ?? BREAK_COOLDOWN_MS;

  // Floor gate: nothing until a minimum time AND sprint count are both in.
  const floorMet =
    input.sprintsCompleted >= floorSprints && input.sessionElapsedMs >= floorMs;
  if (!floorMet) return { offer: false, reason: "floor_not_met" };

  // Quiet window after the last decision so the offer can't spam each seam.
  if (
    input.msSinceLastDecision != null &&
    input.msSinceLastDecision < cooldownMs
  ) {
    return { offer: false, reason: "cooldown" };
  }

  // Past the floor the offer is signal-driven, never a fixed cadence.
  if (isWideningGaps(input.completionGapsMs)) {
    return { offer: true, reason: "widening_gaps" };
  }
  if (input.frictionCount >= 1) {
    return { offer: true, reason: "friction" };
  }
  // Fade hour only fires once telemetry exists (cold start → fadeHour null).
  if (input.fadeHour != null && input.currentHour >= input.fadeHour) {
    return { offer: true, reason: "fade_hour" };
  }

  return { offer: false, reason: "none" };
}

// One plain line for the break offer — terse, dry, never cheerful or parental.
export function breakOfferLine(reason: BreakReason): string {
  switch (reason) {
    case "widening_gaps":
      return "Pace is dragging. Five minutes?";
    case "friction":
      return "Bit of drag setting in. Five minutes?";
    case "fade_hour":
      return "You usually fade about now. Five minutes?";
    default:
      return "Five minutes?";
  }
}

// ── Fade hour ────────────────────────────────────────────────────────────────
// Derive the student's historical fade hour from the completion time-of-day
// histogram (24 buckets, completion counts per hour): the first hour AFTER
// their peak where output has dropped below a third of peak and stays low.
// Returns null when there isn't enough history to trust it — a cold-start user
// has no fade signal, so Marathon runs on the floor + in-session signals alone.
export function computeFadeHour(
  histogram: number[] | undefined,
  minEvents = 12
): number | null {
  if (!Array.isArray(histogram) || histogram.length < 24) return null;
  const total = histogram.reduce((a, b) => a + (b || 0), 0);
  if (total < minEvents) return null;
  const peak = Math.max(...histogram);
  if (peak <= 0) return null;
  const peakHour = histogram.indexOf(peak);
  for (let h = peakHour + 1; h < 24; h++) {
    if ((histogram[h] ?? 0) < peak * 0.34) return h;
  }
  return null;
}

// ── Completion gaps ───────────────────────────────────────────────────────
// Gaps (ms) between consecutive completion timestamps. Feeds the widening-gaps
// fatigue signal. Resets after each break so a fresh offer needs fresh fatigue.
export function gapsFromTimestamps(timestamps: number[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    const g = timestamps[i]! - timestamps[i - 1]!;
    if (g >= 0) gaps.push(g);
  }
  return gaps;
}

// ── End line ─────────────────────────────────────────────────────────────────
// The single factual completion line. No score, no streak, no praise.
export function summaryLine(tasksCleared: number, elapsedMs: number): string {
  const cleared = tasksCleared === 1 ? "1 task" : `${tasksCleared} tasks`;
  const mins = Math.max(1, Math.round(elapsedMs / 60000));
  const time =
    mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
  return `${cleared} cleared · ${time}`;
}
