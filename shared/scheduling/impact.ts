// Impact engine — the numbers behind the "this will help" CTAs.
//
// Every surface in SOS wants to say some version of "doing this moves the
// needle." This module is the one place that turns the data we already have
// (logged grades, task estimates, the calendar runway) into a TRUE, defensible
// estimate of that movement — or says nothing at all. It powers two claims:
//
//   projectGradeImpact   — "your <subject> average goes 84 → 86 if you score
//                           like usual here." A running-average projection over
//                           the grades the student has actually logged.
//
//   projectEventDeadlineImpact / projectStartDeadlineImpact
//                        — "scheduling this 2h event flips two deadlines from
//                           fits to tight" / "starting now clears ~38% of this
//                           before it's due." Allocator math over the real
//                           calendar runway (mirrors shared/scheduling/gate.ts).
//
// Honesty rules, inherited from gate.ts:
//   - Never fabricate a number. Below the history floor we return null and the
//     caller shows nothing — never a 0, never a guess.
//   - Grades carry no stored weights or point totals, so the projection is an
//     equal-weight running mean by default. An OPTIONAL per-type weight map can
//     be supplied once real gradebook weights exist; absent it, every grade
//     counts the same and the copy says "average", never "grade" or "GPA".
//
// Pure + sync + Web-API only — safe in Node, Deno, and the browser.

import type { CalendarDensity } from "./priority.js";

// ── Grade impact ──────────────────────────────────────────────────────────────

export interface GradeRecord {
  subject: string;
  grade: number;        // 0..100, already a percentage
  grade_type?: string;  // exam | quiz | homework | project | other
  created_at?: string;
}

// A new grade can only be projected once the subject has at least this many
// logged grades. Below it the running mean is noise and we say nothing.
export const MIN_GRADES_FOR_PROJECTION = 3;
// A per-type "perform like usual" basis needs its own small floor, otherwise a
// single past quiz would masquerade as a typical-quiz prediction.
const MIN_SAMPLES_FOR_TYPE_BASIS = 2;

export type ScoreBasis = "hypothetical" | "typical_for_type" | "typical_overall";

export interface GradeImpact {
  subject: string;
  currentAvg: number;        // 0..100, 1 dp — average over logged grades
  projectedAvg: number;      // 0..100, 1 dp — average once the new item lands
  deltaPoints: number;       // projectedAvg - currentAvg, signed, 1 dp
  scoreUsed: number;         // the score assumed for the new item
  scoreBasis: ScoreBasis;    // where scoreUsed came from
  sampleCount: number;       // grades that fed currentAvg
  label: string;             // terse CTA copy, gain-framed
}

export interface GradeImpactOptions {
  subject: string;
  // The kind of graded item being added (exam/quiz/...). Drives the
  // "perform like usual" basis and, when weights are supplied, the weighting.
  gradeType?: string;
  // A concrete score to model ("what if I get a 95 here?"). When omitted the
  // engine uses the student's own historical performance as the basis.
  hypotheticalScore?: number;
  // OPTIONAL real gradebook weights per grade_type. Absent → equal weight.
  // This is the seam for a future weighted-GPA mode; nothing fabricates it.
  weightByType?: Record<string, number>;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function clampScore(v: number): number {
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

function weightFor(
  gradeType: string | undefined,
  weightByType: Record<string, number> | undefined,
): number {
  if (!weightByType) return 1;
  const w = weightByType[(gradeType ?? "other").toLowerCase()];
  return typeof w === "number" && w > 0 ? w : 1;
}

function weightedMean(
  items: Array<{ grade: number; gradeType?: string }>,
  weightByType: Record<string, number> | undefined,
): number {
  let num = 0;
  let den = 0;
  for (const it of items) {
    const w = weightFor(it.gradeType, weightByType);
    num += it.grade * w;
    den += w;
  }
  return den > 0 ? num / den : 0;
}

// Project how one more graded item moves a subject's running average. Returns
// null when there isn't enough logged history to say anything truthful.
export function projectGradeImpact(
  grades: GradeRecord[],
  opts: GradeImpactOptions,
): GradeImpact | null {
  const subjectKey = opts.subject.trim().toLowerCase();
  if (!subjectKey) return null;

  const subjectGrades = grades.filter(
    (g) =>
      g &&
      typeof g.grade === "number" &&
      (g.subject ?? "").trim().toLowerCase() === subjectKey,
  );
  if (subjectGrades.length < MIN_GRADES_FOR_PROJECTION) return null;

  const items = subjectGrades.map((g) => ({
    grade: clampScore(g.grade),
    gradeType: (g.grade_type ?? "other").toLowerCase(),
  }));

  const currentAvg = weightedMean(items, opts.weightByType);

  // Decide the score the new item lands at.
  let scoreUsed: number;
  let scoreBasis: ScoreBasis;
  if (typeof opts.hypotheticalScore === "number") {
    scoreUsed = clampScore(opts.hypotheticalScore);
    scoreBasis = "hypothetical";
  } else if (opts.gradeType) {
    const typeKey = opts.gradeType.toLowerCase();
    const sameType = items.filter((it) => it.gradeType === typeKey);
    if (sameType.length >= MIN_SAMPLES_FOR_TYPE_BASIS) {
      scoreUsed = weightedMean(sameType, opts.weightByType);
      scoreBasis = "typical_for_type";
    } else {
      scoreUsed = currentAvg;
      scoreBasis = "typical_overall";
    }
  } else {
    scoreUsed = currentAvg;
    scoreBasis = "typical_overall";
  }

  const projected = weightedMean(
    [...items, { grade: scoreUsed, gradeType: (opts.gradeType ?? "other").toLowerCase() }],
    opts.weightByType,
  );

  const currentR = round1(currentAvg);
  const projectedR = round1(projected);
  const delta = round1(projectedR - currentR);

  return {
    subject: opts.subject,
    currentAvg: currentR,
    projectedAvg: projectedR,
    deltaPoints: delta,
    scoreUsed: round1(scoreUsed),
    scoreBasis,
    sampleCount: items.length,
    label: gradeImpactLabel(currentR, projectedR, delta, scoreBasis, opts.gradeType),
  };
}

function gradeImpactLabel(
  current: number,
  projected: number,
  delta: number,
  basis: ScoreBasis,
  gradeType?: string,
): string {
  if (delta === 0) return `keeps your avg at ${current}`;
  const arrow = `${current} → ${projected}`;
  const signed = delta > 0 ? `+${delta}` : `${delta}`;
  const typeWord = gradeType ? gradeType.toLowerCase() : "one";
  const tail =
    basis === "hypothetical"
      ? "with that score"
      : basis === "typical_for_type"
        ? `if you score like your usual ${typeWord}`
        : "if you score like usual";
  return `avg ${arrow} (${signed}) ${tail}`;
}

// ── Deadline impact ───────────────────────────────────────────────────────────

// Mirrors gate.ts: a single conservative self-directed daily capacity. The
// allocator only ever reports fits/tight, never a fabricated finish time.
const DEFAULT_DAILY_CAPACITY_MIN = 360;

export type FitState = "fits" | "tight" | "overdue" | "wont_fit";

export interface DeadlineTask {
  id: string;
  title: string;
  dueDate?: string | null;  // YYYY-MM-DD
  estTime?: number | null;  // minutes
}

function fmtDate(d: Date): string {
  return (
    d.getFullYear() +
    "-" + String(d.getMonth() + 1).padStart(2, "0") +
    "-" + String(d.getDate()).padStart(2, "0")
  );
}

// Sum unblocked capacity from `start` through the due date, applying an
// optional extra commitment (added minutes on a given date) on top of what the
// calendar already reports. Returns the runway and today's free slice.
function runway(
  dueDate: string,
  now: Date,
  density: CalendarDensity,
  extra?: { date: string; minutes: number },
): { available: number; todayFree: number; days: number } | null {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  if (Number.isNaN(due.getTime())) return null;
  const dueMidnight = new Date(due);
  dueMidnight.setHours(0, 0, 0, 0);
  if (dueMidnight < start) return null; // overdue — no forward runway

  let available = 0;
  let todayFree = 0;
  const cursor = new Date(start);
  while (cursor <= dueMidnight) {
    const key = fmtDate(cursor);
    let blocked = density.blockedMinutesOnDate[key] ?? 0;
    if (extra && extra.date === key) blocked += extra.minutes;
    const free = Math.max(0, DEFAULT_DAILY_CAPACITY_MIN - blocked);
    if (cursor.getTime() === start.getTime()) todayFree = free;
    available += free;
    cursor.setDate(cursor.getDate() + 1);
  }
  const days = Math.round((dueMidnight.getTime() - start.getTime()) / 86_400_000);
  return { available, todayFree, days };
}

// fits when the task clears with comfortable headroom; tight when it only just
// fits; wont_fit when the runway can no longer hold the estimate.
function fitFor(est: number, available: number): FitState {
  if (est > available) return "wont_fit";
  return est <= available * 0.7 ? "fits" : "tight";
}

export interface DeadlineImpact {
  taskId: string;
  title: string;
  before: FitState;
  after: FitState;
  changed: boolean;
  label: string;
}

export interface EventDeadlineImpactResult {
  // Only tasks whose fit actually degraded — the real cost of the event.
  squeezed: DeadlineImpact[];
  // How many schedulable tasks (due date + estimate) were considered.
  considered: number;
  label: string;  // terse rollup, or "" when nothing is affected
}

// Estimate what scheduling a new event/commitment costs the student's open
// deadlines: simulate `minutes` of blocked time on `date` and report every task
// whose fit state degrades. Tasks without a due date AND estimate are skipped —
// we never invent a runway we can't ground.
export function projectEventDeadlineImpact(
  tasks: DeadlineTask[],
  newEvent: { date: string; minutes: number },
  now: Date,
  density: CalendarDensity,
): EventDeadlineImpactResult {
  const squeezed: DeadlineImpact[] = [];
  let considered = 0;

  for (const t of tasks) {
    const est = typeof t.estTime === "number" ? t.estTime : 0;
    if (!t.dueDate || est <= 0) continue;
    // The event can only affect tasks due on or after it lands.
    if (t.dueDate < newEvent.date) continue;

    const before = runway(t.dueDate, now, density);
    const after = runway(t.dueDate, now, density, newEvent);
    if (!before || !after) continue;
    considered++;

    const beforeFit = fitFor(est, before.available);
    const afterFit = fitFor(est, after.available);
    if (afterFit === beforeFit) continue;

    // Only report degradation (fits→tight, tight→wont_fit, fits→wont_fit).
    if (rank(afterFit) <= rank(beforeFit)) continue;

    squeezed.push({
      taskId: t.id,
      title: t.title,
      before: beforeFit,
      after: afterFit,
      changed: true,
      label: `${t.title}: ${beforeFit} → ${afterFit}`,
    });
  }

  return { squeezed, considered, label: eventImpactLabel(squeezed) };
}

// Higher rank = worse fit, so we can detect degradation regardless of states.
function rank(f: FitState): number {
  return f === "fits" ? 0 : f === "tight" ? 1 : f === "overdue" ? 2 : 3;
}

function eventImpactLabel(squeezed: DeadlineImpact[]): string {
  if (squeezed.length === 0) return "";
  if (squeezed.length === 1) return `tightens 1 deadline (${squeezed[0]!.title})`;
  return `tightens ${squeezed.length} deadlines`;
}

export interface StartDeadlineImpact {
  taskId: string;
  fits: FitState;
  // Share of THIS task's estimate that starting now clears, 0..100, or null
  // when it rounds to nothing. A real allocator fact, never a probability.
  clearsPct: number | null;
  label: string;
}

// Estimate what starting a task right now buys toward its deadline: the slice
// of its estimate today's free capacity can clear. Null runway → null result
// (no due date / estimate / overdue), so the caller shows nothing.
export function projectStartDeadlineImpact(
  task: DeadlineTask,
  now: Date,
  density: CalendarDensity,
): StartDeadlineImpact | null {
  const est = typeof task.estTime === "number" ? task.estTime : 0;
  if (!task.dueDate || est <= 0) return null;
  const r = runway(task.dueDate, now, density);
  if (!r) return null;

  const fits = fitFor(est, r.available);

  let clearsPct: number | null = null;
  if (r.available > 0) {
    const runwayShare = r.todayFree / r.available;
    const clearedToday = Math.min(est * runwayShare, r.todayFree, est);
    const pct = Math.round((clearedToday / est) * 100);
    clearsPct = pct >= 5 ? Math.min(100, pct) : null;
  }

  const label =
    clearsPct != null
      ? `clears ~${clearsPct}% of it today`
      : fits === "wont_fit"
        ? "won't fit before it's due as planned"
        : "starts the runway";

  return { taskId: task.id, fits, clearsPct, label };
}
