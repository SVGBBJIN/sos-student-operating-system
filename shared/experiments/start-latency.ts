// Start-latency experiment: shrink the gap between when a student SAYS they'll
// start a task and when they ACTUALLY start it.
//
// This module is the single source of truth for the experiment: the arm set,
// the (deterministic) assignment, the per-arm mechanism behavior, and the
// latency math. Pure + sync + Web-API only — safe in Node, Deno, and the
// browser, and trivially unit-testable.
//
// The metric:
//   pledged_start_at  — intention timestamp (pledge_start action / UI commit)
//   started_at        — action timestamp (the existing `start` primitive)
//   latency           = started_at - pledged_start_at   (lower is better)
//
// A "control" arm gets no mechanism; each other arm applies one intervention.
// Week-1 cohort users are pinned to one arm so start_latency_by_arm() (see the
// 20260614 migration) can rank which mechanism cuts the gap most.

export const START_LATENCY_EXPERIMENT_KEY = "start_latency_v1";

export const START_LATENCY_ARMS = [
  "control",
  "implementation_intention",
  "two_minute_starter",
  "timed_nudge",
  "commitment_lock",
  "micro_deadline",
  "temptation_bundle",
] as const;

export type StartLatencyArm = (typeof START_LATENCY_ARMS)[number];

export interface MechanismSpec {
  arm: StartLatencyArm;
  label: string;
  // Whether the mechanism is wired end-to-end yet. `false` arms are assignable
  // and logged (so the cohort is balanced from day one) but fall back to the
  // control experience until their surface ships. Keeps the framework honest
  // about what's actually being measured.
  active: boolean;
  // One-line description of the intervention (for dashboards / debugging).
  summary: string;
  // When the student pledges a start, this is the follow-up the assistant
  // sends to apply the mechanism. `null` for control / no-prompt arms.
  // `{task}` is substituted with the task title.
  pledgePrompt: ((taskTitle: string) => string) | null;
}

const MECHANISMS: Record<StartLatencyArm, MechanismSpec> = {
  control: {
    arm: "control",
    label: "Control",
    active: true,
    summary: "No intervention — pledge is recorded, nothing else changes.",
    pledgePrompt: null,
  },
  implementation_intention: {
    arm: "implementation_intention",
    label: "Implementation intention",
    active: true,
    summary:
      "Prompt an if-then plan binding the start to a concrete cue + place " +
      "(Gollwitzer). Strongest evidence base for closing the intention-action gap.",
    pledgePrompt: (task) =>
      `Locked it in. Quick — finish this sentence so it actually happens: ` +
      `"When I ___, I'll start ${task} at ___ (where)." ` +
      `e.g. "When I finish dinner, I'll start ${task} at my desk."`,
  },
  two_minute_starter: {
    arm: "two_minute_starter",
    label: "Two-minute starter",
    active: true,
    summary:
      "Reframe the task into a trivial first action so 'starting' is " +
      "frictionless. The only commitment is to open it.",
    pledgePrompt: (task) =>
      `Locked in. One rule: when the time comes, you're only doing the first ` +
      `2 minutes of **${task}** — just open it and read the first line. ` +
      `That's the whole job. You can stop after that.`,
  },
  timed_nudge: {
    arm: "timed_nudge",
    label: "Timed nudge",
    active: false,
    summary:
      "Fire a reminder at the pledged start time. Needs push/notification " +
      "infra not yet built — stubbed until then.",
    pledgePrompt: null,
  },
  commitment_lock: {
    arm: "commitment_lock",
    label: "Commitment lock",
    active: true,
    summary:
      "Pre-commit with a visible home-screen countdown to the pledged start " +
      "time. Makes the intention public to yourself.",
    // pledgePrompt is null — the visual countdown on the home screen is the
    // mechanism. The pledge_start executor adds a brief confirmation instead.
    pledgePrompt: null,
  },
  micro_deadline: {
    arm: "micro_deadline",
    label: "Micro-deadline",
    active: true,
    summary:
      "Lock in a 10-minute countdown starting now so the pledged time has " +
      "genuine time pressure, not just intention.",
    pledgePrompt: (task) =>
      `Starting the clock. You've got until your pledged time to kick off ` +
      `**${task}** — a reminder will fire then. Short window beats an open-ended 'later'.`,
  },
  temptation_bundle: {
    arm: "temptation_bundle",
    label: "Temptation bundle",
    active: true,
    summary:
      "Pair the task with something enjoyable so the start carries a " +
      "built-in reward (Milkman). Only available while working.",
    pledgePrompt: (task) =>
      `Here's the deal: pick one thing you enjoy — your focus playlist, a ` +
      `good drink, whatever — and it's yours *only* while you're on ` +
      `**${task}**. Queue it up before you start so it's waiting for you.`,
  },
};

export function getMechanism(arm: StartLatencyArm): MechanismSpec {
  return MECHANISMS[arm] ?? MECHANISMS.control;
}

export function isValidArm(value: unknown): value is StartLatencyArm {
  return (
    typeof value === "string" &&
    (START_LATENCY_ARMS as readonly string[]).includes(value)
  );
}

// Deterministic arm assignment from a user id. FNV-1a (32-bit) is fast, has no
// dependencies, and gives a stable, well-distributed bucket — so the client,
// Vercel, and Deno all derive the same arm before the DB row is even written.
// The persisted experiment_assignments row is authoritative; this just seeds it.
export function assignArm(userId: string): StartLatencyArm {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    // hash * 16777619, kept in 32-bit range via Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  const bucket = (hash >>> 0) % START_LATENCY_ARMS.length;
  return START_LATENCY_ARMS[bucket]!;
}

// Latency in ms between pledge and actual start. Returns null when there was no
// pledge, or when the start happened before the pledge (clock skew / bad data) —
// callers should treat null as "not measurable" rather than zero.
export function computeStartLatencyMs(
  pledgedStartAt: string | number | Date | null | undefined,
  startedAt: string | number | Date
): number | null {
  if (pledgedStartAt == null) return null;
  const pledged = new Date(pledgedStartAt).getTime();
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(pledged) || !Number.isFinite(started)) return null;
  const delta = started - pledged;
  return delta >= 0 ? delta : null;
}

// Human-readable latency for logs / UI. `<1 min` collapses to "on time".
export function formatLatency(ms: number | null): string {
  if (ms == null) return "n/a";
  const min = ms / 60000;
  if (min < 1) return "on time";
  if (min < 60) return `${Math.round(min)}m late`;
  const hrs = min / 60;
  if (hrs < 24) return `${Math.round(hrs * 10) / 10}h late`;
  return `${Math.round(hrs / 24)}d late`;
}
