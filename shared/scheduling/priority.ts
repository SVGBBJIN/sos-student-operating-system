// Deterministic priority scorer for tasks.
// Pure functions, sync, no I/O — safe in both Node and Deno.
//
// Score = weighted sum of five factors (all 0..1):
//   urgency          0.35 — deadline proximity, exponential decay
//   importance       0.25 — priority field + subject heuristic
//   momentum         0.15 — postpone-rate signal from behavioral history
//   deadline_density 0.15 — how crowded the due date is
//   friction         0.10 — accumulated postpone count on this task

import type { BehavioralSignals } from "../ai/signals/behavioral.js";

export interface TaskForScoring {
  id: string;
  title: string;
  subject?: string;
  dueDate: string;       // YYYY-MM-DD
  estTime?: number;      // minutes
  status: string;        // 'not_started' | 'in_progress' | 'done'
  priority?: string;     // 'low' | 'medium' | 'high'
  createdAt?: string;
  postponeCount?: number;
  lastAttemptedAt?: string | null;
}

export interface CalendarDensity {
  tasksDueOnDate: Record<string, number>;        // YYYY-MM-DD → count
  blockedMinutesOnDate: Record<string, number>;  // YYYY-MM-DD → total blocked minutes
}

export interface PriorityFactors {
  urgency: number;
  importance: number;
  momentum: number;
  deadline_density: number;
  friction: number;
}

export interface PriorityResult {
  taskId: string;
  score: number;
  factors: PriorityFactors;
  explanation: string;
  daysUntilDue: number;
}

const WEIGHTS = {
  urgency: 0.35,
  importance: 0.25,
  momentum: 0.15,
  deadline_density: 0.15,
  friction: 0.10,
} as const;

const PRIORITY_VALUES: Record<string, number> = {
  high: 1.0,
  medium: 0.6,
  low: 0.3,
};

// Subjects where missing a task has outsized academic consequences.
const HIGH_STAKES_SUBJECTS = new Set([
  "math", "chemistry", "chem", "physics", "biology", "bio",
  "calculus", "ap", "sat", "act", "finals",
]);

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function daysBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / 86_400_000;
}

export function computePriority(
  task: TaskForScoring,
  now: Date,
  density: CalendarDensity,
  signals?: BehavioralSignals
): PriorityResult {
  const dueDate = new Date(task.dueDate + "T23:59:59");
  const daysUntilDue = daysBetween(now, dueDate);

  // Urgency: exponential decay with 3-day half-life; overdue → max urgency.
  const urgency = daysUntilDue <= 0
    ? 1
    : clamp(Math.exp(-daysUntilDue / 3));

  // Importance: priority field → value, boosted if high-stakes subject.
  const basePriority = PRIORITY_VALUES[task.priority?.toLowerCase() ?? ""] ?? 0.5;
  const subjectBoost = HIGH_STAKES_SUBJECTS.has(
    (task.subject ?? "").toLowerCase()
  ) ? 0.15 : 0;
  const importance = clamp(basePriority + subjectBoost);

  // Momentum: drawn from postpone-rate signals — high rate means needs more urgency.
  const subjectKey = (task.subject ?? "other").toLowerCase();
  const postponeRate = signals?.postpone_rate_by_subject[subjectKey] ?? 0;
  const momentum = clamp(postponeRate);

  // Deadline density: fraction of 5 tasks that share the same due date.
  const sameDayCount = density.tasksDueOnDate[task.dueDate] ?? 1;
  const deadline_density = clamp((sameDayCount - 1) / 5);

  // Friction: accumulated postponements on this specific task.
  const friction = clamp((task.postponeCount ?? 0) * 0.15);

  const score = clamp(
    WEIGHTS.urgency * urgency +
    WEIGHTS.importance * importance +
    WEIGHTS.momentum * momentum +
    WEIGHTS.deadline_density * deadline_density +
    WEIGHTS.friction * friction
  );

  const explanation = buildExplanation(task, daysUntilDue, score, {
    urgency, importance, momentum, deadline_density, friction,
  });

  return {
    taskId: task.id,
    score: Math.round(score * 1000) / 1000,
    factors: { urgency, importance, momentum, deadline_density, friction },
    explanation,
    daysUntilDue: Math.round(daysUntilDue * 1000) / 1000,
  };
}

function buildExplanation(
  task: TaskForScoring,
  daysUntilDue: number,
  score: number,
  factors: PriorityFactors
): string {
  if (daysUntilDue <= 0) return `"${task.title}" is overdue — do this first.`;
  if (daysUntilDue <= 1) return `"${task.title}" is due today or tomorrow (score ${(score * 100).toFixed(0)}).`;
  if (factors.momentum > 0.4) {
    return `"${task.title}" has a high postpone history — tackle it soon (score ${(score * 100).toFixed(0)}).`;
  }
  if (factors.deadline_density > 0.5) {
    return `"${task.title}" is on a crowded day — consider an earlier slot (score ${(score * 100).toFixed(0)}).`;
  }
  return `"${task.title}" due in ${Math.ceil(daysUntilDue)} day${Math.ceil(daysUntilDue) !== 1 ? "s" : ""} (score ${(score * 100).toFixed(0)}).`;
}

export function rankTasks(
  tasks: TaskForScoring[],
  now: Date,
  density: CalendarDensity,
  signals?: BehavioralSignals,
  topN?: number
): PriorityResult[] {
  const active = tasks.filter((t) => t.status !== "done");
  const results = active.map((t) => computePriority(t, now, density, signals));
  results.sort((a, b) => b.score - a.score);
  return topN !== undefined ? results.slice(0, topN) : results;
}

// ── Startability: the second dimension ──────────────────────────────────────
// Priority answers "what matters most"; startability answers "what's easiest to
// begin right now". They are orthogonal — the most important task is often the
// most daunting (a 5-page essay), which is exactly what a procrastinating
// student bounces off. Startability scores how low the activation energy is:
// short tasks, concrete/atomic work, and tasks that haven't been repeatedly
// avoided are the easiest on-ramps. 0..1, higher = easier to start.

export interface StartabilityFactors {
  effort_ease: number;   // shorter estimated time → easier to begin
  concreteness: number;  // atomic/well-defined work vs big ambiguous projects
  freshness: number;     // not repeatedly postponed (postpones = avoidance)
}

// Work that is concrete and atomic — you can sit down and just do the next bit.
const STARTABLE_KEYWORDS =
  /\b(read|reading|review|practice|problem|pset|worksheet|quiz|flashcard|vocab|exercise|watch|outline|notes?|memoriz|drill|recap|skim)\b/i;
// Big, open-ended deliverables with high activation energy.
const DAUNTING_KEYWORDS =
  /\b(essay|paper|project|presentation|research|thesis|dissertation|report|study\s*guide|portfolio|proposal|draft\s*a)\b/i;

const STARTABILITY_WEIGHTS = {
  effort_ease: 0.5,
  concreteness: 0.35,
  freshness: 0.15,
} as const;

export function computeStartability(task: TaskForScoring): {
  score: number;
  factors: StartabilityFactors;
} {
  // Effort: a 15-min task is trivially startable; a 2-hour one is a wall.
  // Unknown estimate defaults to 30 min (a moderate on-ramp).
  const est = typeof task.estTime === "number" && task.estTime > 0 ? task.estTime : 30;
  const effort_ease = clamp(1 - (est - 15) / 105); // 15min→1.0, 120min→0.0

  // Concreteness: keyword heuristic on title + subject.
  const text = `${task.title ?? ""} ${task.subject ?? ""}`;
  let concreteness = 0.6; // neutral default
  if (DAUNTING_KEYWORDS.test(text)) concreteness = 0.3;
  else if (STARTABLE_KEYWORDS.test(text)) concreteness = 0.9;

  // Freshness: each postpone is evidence the task is hard to face.
  const freshness = clamp(1 - (task.postponeCount ?? 0) * 0.2);

  const score = clamp(
    STARTABILITY_WEIGHTS.effort_ease * effort_ease +
    STARTABILITY_WEIGHTS.concreteness * concreteness +
    STARTABILITY_WEIGHTS.freshness * freshness
  );

  return {
    score: Math.round(score * 1000) / 1000,
    factors: { effort_ease, concreteness, freshness },
  };
}

export interface QuickStartResult {
  taskId: string;
  priority: number;
  startability: number;
  quickStart: number;   // the blended objective the ranking optimizes
  estMinutes: number;
  explanation: string;
}

// How the two dimensions trade off for the "just start me" path. We lean toward
// startability (the whole point is breaking the freeze with the easiest on-ramp)
// while keeping priority as a guardrail so an urgent deadline can still surface.
const QUICK_START_PRIORITY_WEIGHT = 0.4;
const QUICK_START_STARTABILITY_WEIGHT = 0.6;

// Rank tasks for the procrastination on-ramp: find the optimum of the two
// dimensions rather than the single highest-priority task. Returns the blended
// ranking with both component scores exposed.
export function rankForQuickStart(
  tasks: TaskForScoring[],
  now: Date,
  density: CalendarDensity,
  signals?: BehavioralSignals,
  topN?: number
): QuickStartResult[] {
  const active = tasks.filter((t) => t.status !== "done");
  const results = active.map((t) => {
    const p = computePriority(t, now, density, signals);
    const s = computeStartability(t);
    const quickStart = clamp(
      QUICK_START_PRIORITY_WEIGHT * p.score +
      QUICK_START_STARTABILITY_WEIGHT * s.score
    );
    return {
      taskId: t.id,
      priority: p.score,
      startability: s.score,
      quickStart: Math.round(quickStart * 1000) / 1000,
      estMinutes: typeof t.estTime === "number" && t.estTime > 0 ? t.estTime : 30,
      explanation: p.explanation,
    };
  });
  results.sort((a, b) => b.quickStart - a.quickStart);
  return topN !== undefined ? results.slice(0, topN) : results;
}

export function buildCalendarDensity(
  tasks: Array<{ dueDate: string; status: string; estTime?: number }>,
  blocks: Record<string, Record<string, unknown>>
): CalendarDensity {
  const tasksDueOnDate: Record<string, number> = {};
  const blockedMinutesOnDate: Record<string, number> = {};

  for (const t of tasks) {
    if (t.status !== "done") {
      tasksDueOnDate[t.dueDate] = (tasksDueOnDate[t.dueDate] ?? 0) + 1;
    }
  }

  for (const [date, slots] of Object.entries(blocks)) {
    blockedMinutesOnDate[date] = Object.keys(slots).length * 30;
  }

  return { tasksDueOnDate, blockedMinutesOnDate };
}
