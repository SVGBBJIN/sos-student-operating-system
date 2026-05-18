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
