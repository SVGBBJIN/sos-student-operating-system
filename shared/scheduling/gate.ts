// Gated Home Screen — pure decision helpers.
//
// The home gate is a passive pass-through surface: it shows at most two tasks
// (chosen by the existing priority engine, never a new ranking), each carrying
// a trajectory chip that states what acting now buys toward the deadline. This
// module holds the two pieces of logic that must be deterministic and testable:
//
//   computeTrajectoryChip — a TRUE allocator fact (does the work still fit
//     before the deadline given already-committed time?), plus a real
//     completion-probability percentage ONLY once enough history exists. Never
//     fabricates a number.
//
//   currentCommitment — whether the student is inside a committed block right
//     now (school / sleep / lockdown / testing). When they are, the gate goes
//     dark rather than threading the needle.
//
// Pure + sync + Web-API only — safe in Node, Deno, and the browser.

import type { CalendarDensity } from "./priority.js";
import type { BehavioralSignals } from "../ai/signals/behavioral.js";

// The hard quota. The gate shows at most this many tasks, ever — never a list.
export const GATE_TASK_QUOTA = 2;

// A self-directed waking budget per day, in minutes. The trajectory fit fact is
// a coarse allocator check — capacity minus already-committed time vs the work
// remaining — so this is intentionally a single conservative daily ceiling, not
// a per-student model. It only ever produces "fits / tight", never a deadline.
const DEFAULT_DAILY_CAPACITY_MIN = 360;

// A chip can carry a real on-time percentage only after the student has enough
// logged history that the rate isn't noise. Below this, probabilityPct is null
// and the chip shows the allocator fact alone.
const MIN_HISTORY_FOR_PROBABILITY = 12;

// Categories that mean "the student is committed elsewhere — go dark". Anything
// not in this set (free time, optional, study) leaves the gate live.
const COMMITTED_CATEGORIES = new Set([
  "school", "sleep", "committed", "exam", "test", "testing", "lockdown",
]);

const WEEKDAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

function fmtDate(d: Date): string {
  return (
    d.getFullYear() +
    "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0")
  );
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface TrajectoryChip {
  // Pace fact, gain-framed: "on pace to finish by Thursday".
  label: string;
  // Whether the work still comfortably fits the runway. Drives styling only.
  tone: "fit" | "tight";
  // The share of THIS task's work that starting today clears — today's slice of
  // the allocator runway, 0..100, or null when it rounds to nothing. A real
  // allocator fact (est + committed time), NOT a probability, so it's always
  // safe to show. Gain-framed: "clears ~38% of it today".
  reductionPct: number | null;
  // A real on-time rate, 0..100, or null when there isn't enough history to
  // show one honestly. Callers must treat null as "show nothing", never 0.
  probabilityPct: number | null;
}

// What acting now buys toward the deadline. Returns null when there's nothing
// truthful to say — no due date or no estimate means no allocator fact, and an
// overdue task has no forward runway to report.
export function computeTrajectoryChip(
  task: { dueDate?: string | null; estTime?: number | null; subject?: string },
  now: Date,
  density: CalendarDensity,
  signals?: BehavioralSignals,
): TrajectoryChip | null {
  const est = typeof task?.estTime === "number" ? task.estTime : 0;
  if (!task?.dueDate || est <= 0) return null;

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const due = new Date(task.dueDate + "T00:00:00");
  if (Number.isNaN(due.getTime())) return null;
  const dueMidnight = new Date(due);
  dueMidnight.setHours(0, 0, 0, 0);
  if (dueMidnight < start) return null; // overdue — no forward fact to state

  // Sum the unblocked capacity across every day from today through the due
  // date, subtracting already-committed minutes the calendar reports. Track
  // today's free capacity separately so we can say what starting NOW clears.
  let available = 0;
  let todayFree = 0;
  const cursor = new Date(start);
  while (cursor <= dueMidnight) {
    const free = Math.max(0, DEFAULT_DAILY_CAPACITY_MIN - (density.blockedMinutesOnDate[fmtDate(cursor)] ?? 0));
    if (cursor.getTime() === start.getTime()) todayFree = free;
    available += free;
    cursor.setDate(cursor.getDate() + 1);
  }

  const fits = est <= available;
  // "Fits" with comfortable headroom reads as fit; barely-fits or doesn't reads
  // as tight, so the chip never over-promises.
  const tone: "fit" | "tight" = fits && est <= available * 0.7 ? "fit" : "tight";

  const days = Math.round((dueMidnight.getTime() - start.getTime()) / 86_400_000);
  let when: string;
  if (days <= 0) when = "today";
  else if (days === 1) when = "tomorrow";
  else when = WEEKDAYS[due.getDay()]!;

  let label: string;
  const verb = fits ? "on pace to finish" : "tight to finish";
  if (when === "today") label = `${verb} today`;
  else if (when === "tomorrow") label = `${verb} by tomorrow`;
  else label = `${verb} by ${when}`;

  // Workload cleared by starting today: today's free capacity as a share of the
  // whole runway, applied to the task, capped at what fits today and at the
  // whole task. Doing this slice now is what shrinks what's left.
  let reductionPct: number | null = null;
  if (available > 0) {
    const runwayShare = todayFree / available;
    const clearedToday = Math.min(est * runwayShare, todayFree, est);
    const pct = Math.round((clearedToday / est) * 100);
    reductionPct = pct >= 5 ? Math.min(100, pct) : null;
  }

  let probabilityPct: number | null = null;
  if (signals && signals.total_events_30d >= MIN_HISTORY_FOR_PROBABILITY) {
    probabilityPct = Math.round(clamp01(signals.completion_rate_30d) * 100);
  }

  return { label, tone, reductionPct, probabilityPct };
}

// Whether the student is inside a committed block right now. `daySlots` is the
// merged 30-minute slot map for today (recurring base + date overrides), keyed
// "HH:MM" → { name, category } | null — the shape buildBlocksForDate produces.
// Returns the active commitment so callers can log why they went dark, or null
// when the current slot is free.
export function currentCommitment(
  daySlots: Record<string, { name?: string; category?: string } | null> | undefined,
  now: Date,
): { name: string; category: string } | null {
  if (!daySlots) return null;
  const key =
    String(now.getHours()).padStart(2, "0") +
    ":" + (now.getMinutes() < 30 ? "00" : "30");
  const slot = daySlots[key];
  if (!slot) return null;
  // A slot with no explicit category is a structured block — default to school,
  // which is committed. Only an explicitly non-committed category stays live.
  const category = (slot.category || "school").toLowerCase();
  if (!COMMITTED_CATEGORIES.has(category)) return null;
  return { name: slot.name || category, category };
}
