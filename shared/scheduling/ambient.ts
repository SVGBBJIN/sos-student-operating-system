// Ambient status selector — the "always watching" layer.
//
// Pure functions, sync, no I/O — safe in both Node and Deno (mirrors priority.ts).
//
// Watches recent activity and surfaces AT MOST ONE terse status (plus an
// optional single action), or — by default — nothing. The bar to break silence
// is high: a candidate must clear `silenceThreshold` AND survive dismissal +
// per-class engagement suppression. Task-derived candidates are scored through
// the existing priority engine (computePriority) so the proven urgency /
// importance / momentum / density / friction weights decide what is worth
// saying. Activity candidates (LMS auto-close, imminent block) are scored on
// time-criticality and are the only kinds that may ever escalate to `push`.

import { computePriority } from "./priority.js";
import type { TaskForScoring, CalendarDensity } from "./priority.js";
import type { BehavioralSignals } from "../ai/signals/behavioral.js";

export type AmbientTier = "ambient" | "push";

// Stable taxonomy — used as both the dismissal `kind` and the
// engagement-adaptation key. Add new surfaces here, not as free strings.
export type AmbientKind =
  | "lms_pending_close"
  | "block_starting"
  | "plan_slippage"
  | "overdue_cluster"
  | "abandon_drift"
  | "due_imminent";

export type AmbientVerb =
  | "reject_lms"
  | "pull_back_plan"
  | "open_plan"
  | "open_task";

export interface AmbientAction {
  label: string;          // terse, lower-case, e.g. "not yet" / "pull back"
  verb: AmbientVerb;      // opaque — the client maps it to an existing handler
  targetId?: string;      // task id / plan id
}

export interface AmbientStatus {
  kind: AmbientKind;
  tier: AmbientTier;
  text: string;           // terse, factual, dry
  signature: string;      // stable identity of THIS item (dismissal + SW tag + key)
  score: number;          // 0..1, for telemetry / debugging
  action?: AmbientAction; // at most one
}

export interface AmbientCandidate {
  kind: AmbientKind;
  signature: string;
  baseScore: number;          // intrinsic salience 0..1
  priorityScore?: number;     // precomputed priority-engine score (task kinds)
  pushEligible: boolean;
  window?: number;            // minutes — activity kinds only
  minutesLeft?: number;       // minutes — activity kinds only
  text: string;
  action?: AmbientAction;
}

// Activity items waiting to auto-close (mapped from client task state).
export interface PendingCloseInput {
  taskId: string;
  title: string;
  lms?: string;               // "Canvas" / "Google Classroom" / …
  minutesLeft: number;        // until auto-close
}

// A calendar block starting imminently.
export interface BlockStartInput {
  id: string;
  name: string;
  startsInMin: number;
}

// One study plan that has drifted vs its milestone targets.
export interface PlanSlippageInput {
  planId: string;
  planTitle: string;
  slippedCount: number;
  taskIds: string[];          // the slipped tasks (for priority scoring)
}

export interface AmbientInput {
  tasks: TaskForScoring[];
  pendingCloses?: PendingCloseInput[];
  blockStartsSoon?: BlockStartInput[];
  planSlippage?: PlanSlippageInput[];
  density: CalendarDensity;
  signals?: BehavioralSignals;
  now: Date;
  dismissedSignatures: Set<string>;
  classDismissalCounts: Partial<Record<AmbientKind, number>>;
}

export interface AmbientConfig {
  silenceThreshold: number;
  pushThreshold: number;
  classPenaltyStep: number;
  classPenaltyMax: number;
  pendingCloseWindow: number; // minutes — the auto-close horizon
  blockWindow: number;        // minutes — "starting soon" horizon for push
}

export const DEFAULT_AMBIENT_CONFIG: AmbientConfig = {
  silenceThreshold: 0.62,
  pushThreshold: 0.85,
  classPenaltyStep: 0.08,
  classPenaltyMax: 0.4,
  pendingCloseWindow: 5,
  blockWindow: 5,
};

const ACTIVITY_KINDS = new Set<AmbientKind>(["lms_pending_close", "block_starting"]);

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function plural(n: number): string {
  return n === 1 ? "" : "s";
}

// Highest priority-engine score across a set of task ids (0 if none resolve).
function maxPriorityScore(
  taskIds: string[],
  byId: Map<string, TaskForScoring>,
  input: AmbientInput,
): number {
  let best = 0;
  for (const id of taskIds) {
    const task = byId.get(id);
    if (!task) continue;
    const { score } = computePriority(task, input.now, input.density, input.signals);
    if (score > best) best = score;
  }
  return best;
}

/**
 * Build every raw candidate from the input. No scoring threshold, dismissal, or
 * selection is applied here — that is `selectAmbientStatus`'s job. Exported so
 * the candidate set can be asserted directly in tests.
 */
export function buildAmbientCandidates(
  input: AmbientInput,
  cfg: AmbientConfig = DEFAULT_AMBIENT_CONFIG,
): AmbientCandidate[] {
  const out: AmbientCandidate[] = [];
  const byId = new Map(input.tasks.map((t) => [t.id, t]));
  const todayStr = localDateStr(input.now);

  // ── lms_pending_close (push-eligible) ──
  for (const pc of input.pendingCloses ?? []) {
    const left = Math.max(0, pc.minutesLeft);
    const via = pc.lms ? ` from ${pc.lms}` : "";
    out.push({
      kind: "lms_pending_close",
      signature: `lms_pending_close:${pc.taskId}`,
      baseScore: 0.9,
      pushEligible: true,
      window: cfg.pendingCloseWindow,
      minutesLeft: left,
      text: `"${pc.title}" auto-marks done in ${Math.ceil(left)} min${via} — not yet?`,
      action: { label: "not yet", verb: "reject_lms", targetId: pc.taskId },
    });
  }

  // ── block_starting (push-eligible) ──
  for (const b of input.blockStartsSoon ?? []) {
    if (b.startsInMin < 0 || b.startsInMin > cfg.blockWindow) continue;
    out.push({
      kind: "block_starting",
      signature: `block_starting:${b.id}:${todayStr}`,
      baseScore: 0.85,
      pushEligible: true,
      window: cfg.blockWindow,
      minutesLeft: b.startsInMin,
      text: `${b.name} starts in ${Math.max(1, Math.round(b.startsInMin))} min.`,
    });
  }

  // ── plan_slippage ──
  for (const p of input.planSlippage ?? []) {
    if (p.slippedCount <= 0) continue;
    out.push({
      kind: "plan_slippage",
      signature: `plan_slippage:${p.planId}:${p.slippedCount}`,
      baseScore: 0.6,
      priorityScore: maxPriorityScore(p.taskIds, byId, input),
      pushEligible: false,
      text: `${p.slippedCount} task${plural(p.slippedCount)} slipped behind your ${p.planTitle} plan.`,
      action: { label: "pull back", verb: "pull_back_plan", targetId: p.planId },
    });
  }

  // ── overdue_cluster / due_imminent (derived from the task list) ──
  const active = input.tasks.filter((t) => t.status !== "done" && t.dueDate);
  const overdueOrToday = active.filter((t) => t.dueDate <= todayStr);

  if (overdueOrToday.length >= 3) {
    const n = overdueOrToday.length;
    out.push({
      kind: "overdue_cluster",
      signature: `overdue_cluster:${todayStr}:${n}`,
      baseScore: 0.7,
      priorityScore: maxPriorityScore(overdueOrToday.map((t) => t.id), byId, input),
      pushEligible: false,
      text: `${n} task${plural(n)} overdue or due today.`,
    });
  } else if (overdueOrToday.length >= 1) {
    // Single most-urgent task — only when there is no cluster.
    let top: TaskForScoring | undefined;
    let topScore = -1;
    for (const t of overdueOrToday) {
      const s = computePriority(t, input.now, input.density, input.signals).score;
      if (s > topScore) { top = t; topScore = s; }
    }
    if (top) {
      const overdue = top.dueDate < todayStr;
      out.push({
        kind: "due_imminent",
        signature: `due_imminent:${top.id}:${top.dueDate}`,
        baseScore: 0.6,
        priorityScore: topScore,
        pushEligible: false,
        text: `"${top.title}" is ${overdue ? "overdue" : "due today"}.`,
      });
    }
  }

  // ── abandon_drift — a task pushed repeatedly ──
  let worst: TaskForScoring | undefined;
  for (const t of input.tasks) {
    if (t.status === "done") continue;
    const pc = t.postponeCount ?? 0;
    if (pc >= 3 && (!worst || (worst.postponeCount ?? 0) < pc)) worst = t;
  }
  if (worst) {
    const pc = worst.postponeCount ?? 0;
    out.push({
      kind: "abandon_drift",
      signature: `abandon_drift:${worst.id}:${pc}`,
      baseScore: 0.65,
      priorityScore: computePriority(worst, input.now, input.density, input.signals).score,
      pushEligible: false,
      text: `"${worst.title}" has been pushed ${pc} times.`,
    });
  }

  return out;
}

/**
 * Score a single candidate. Task-derived kinds blend their intrinsic salience
 * with the priority-engine score; activity kinds are driven by time-criticality.
 * The per-class engagement penalty is then subtracted, so repeatedly dismissing
 * a class raises that class's bar until the dismissal window decays.
 */
export function scoreAmbientCandidate(
  c: AmbientCandidate,
  input: AmbientInput,
  cfg: AmbientConfig = DEFAULT_AMBIENT_CONFIG,
): number {
  let base: number;
  if (ACTIVITY_KINDS.has(c.kind)) {
    const window = c.window ?? cfg.pendingCloseWindow;
    const minutesLeft = c.minutesLeft ?? 0;
    const urgency = window > 0 ? clamp(1 - minutesLeft / window) : 1;
    base = clamp(0.6 + urgency * 0.4);
  } else {
    base = clamp(0.5 * c.baseScore + 0.5 * (c.priorityScore ?? 0));
  }
  const dismissals = input.classDismissalCounts[c.kind] ?? 0;
  const penalty = Math.min(cfg.classPenaltyMax, dismissals * cfg.classPenaltyStep);
  return clamp(base - penalty);
}

/**
 * The entry point. Returns at most one status worth surfacing, or `null`
 * (silence — the default). Drops dismissed items, scores the rest, drops
 * anything below the silence threshold, and returns the single highest survivor.
 */
export function selectAmbientStatus(
  input: AmbientInput,
  cfg: AmbientConfig = DEFAULT_AMBIENT_CONFIG,
): AmbientStatus | null {
  const scored = buildAmbientCandidates(input, cfg)
    .filter((c) => !input.dismissedSignatures.has(c.signature))
    .map((c) => ({ c, score: scoreAmbientCandidate(c, input, cfg) }))
    .filter((x) => x.score >= cfg.silenceThreshold)
    .sort((a, b) => b.score - a.score);

  const winner = scored[0];
  if (!winner) return null;

  const { c, score } = winner;
  const tier: AmbientTier =
    c.pushEligible && score >= cfg.pushThreshold ? "push" : "ambient";

  return {
    kind: c.kind,
    tier,
    text: c.text,
    signature: c.signature,
    score: Math.round(score * 1000) / 1000,
    action: c.action,
  };
}
