// Adaptive allocation for the start-latency experiment — the "test what works
// and push it" layer on top of the fixed arm set.
//
// Pure + sync + Web-API only (Node / Deno / browser). No I/O: callers fetch the
// per-arm performance (see experiment_arm_performance() in the 20260615
// migration) and feed it in; this module decides the allocation distribution
// and draws a stable arm for a given user.
//
// Policy: an annealed, floored softmax bandit.
//   - reward(arm) in [0,1] rewards BOTH converting a pledge into a start AND
//     starting soon — so an arm that gets people moving fast wins.
//   - while any active arm is under the min-sample gate, allocation stays
//     UNIFORM (pure exploration) so every mechanism earns a fair baseline.
//   - past the gate, weights = softmax(reward / temperature), with temperature
//     annealing down over the first weeks: early on the split stays broad
//     (explore), later it sharpens toward the leaders (exploit).
//   - an exploration FLOOR guarantees every active arm keeps a slice of traffic
//     forever, so the experiment never stops learning even as it exploits.
//   - sampling is deterministic from the user id, so an assignment is stable
//     and reproducible without storing the RNG state.

import {
  type StartLatencyArm,
  getActiveArms,
  hashString,
  isValidArm,
} from "./start-latency.js";

// Raw per-arm performance, as returned by experiment_arm_performance().
export interface ArmStat {
  arm: StartLatencyArm;
  pledges: number;             // pledge events logged under this arm
  starts: number;              // starts that had a measurable pledge→start gap
  medianLatencyMin: number | null;
}

export interface AllocationOptions {
  // Pledges an arm needs before it leaves pure-exploration. Until EVERY active
  // arm clears this, allocation is uniform.
  minSamplesPerArm?: number;   // default 20
  // Minimum traffic share each active arm always keeps (ongoing exploration).
  explorationFloor?: number;   // default 0.05
  // Days since the experiment started — drives temperature annealing.
  daysSinceStart?: number;     // default 0
  // Latency (minutes) at which the latency-score halves. Smaller = stricter.
  latencyHalfLifeMin?: number; // default 60
  // Softmax temperature bounds + how fast it anneals (days).
  baseTemperature?: number;    // default 0.5 (broad early)
  minTemperature?: number;     // default 0.08 (greedy late)
  annealTauDays?: number;      // default 7
}

const DEFAULTS = {
  minSamplesPerArm: 20,
  explorationFloor: 0.05,
  daysSinceStart: 0,
  latencyHalfLifeMin: 60,
  baseTemperature: 0.5,
  minTemperature: 0.08,
  annealTauDays: 7,
} as const;

// Per-pull reward in [0,1]. An arm is good when pledges convert to starts
// (conversion) AND those starts happen soon (latency score). Multiplying the
// two means an arm has to do both — high conversion with huge delays, or fast
// starts that almost never happen, both score low.
export function armReward(stat: ArmStat, halfLifeMin: number): number {
  if (stat.pledges <= 0) return 0;
  const conversion = clamp01(stat.starts / stat.pledges);
  if (stat.medianLatencyMin == null) return 0;
  // exp decay: latency 0 → 1.0, latency == halfLife → 0.5, etc.
  const latencyScore = Math.pow(2, -Math.max(0, stat.medianLatencyMin) / halfLifeMin);
  return clamp01(conversion * latencyScore);
}

// Temperature annealed by elapsed days: base at day 0, decaying toward the
// floor with time constant tau. Lower temperature ⇒ greedier (more exploit).
export function annealedTemperature(opts: Required<AllocationOptions>): number {
  const t =
    opts.minTemperature +
    (opts.baseTemperature - opts.minTemperature) *
      Math.exp(-Math.max(0, opts.daysSinceStart) / opts.annealTauDays);
  return Math.max(opts.minTemperature, t);
}

export interface AllocationResult {
  weights: Record<string, number>;   // active arm → probability (sums to ~1)
  phase: "explore" | "adapt";
  temperature: number;
  reason: string;
}

// Turn raw stats into an allocation distribution over the active arms.
export function computeAllocation(
  stats: ArmStat[],
  options?: AllocationOptions,
  activeArms: StartLatencyArm[] = getActiveArms()
): AllocationResult {
  const opts = { ...DEFAULTS, ...(options ?? {}) } as Required<AllocationOptions>;
  const arms = activeArms.length > 0 ? activeArms : [...getActiveArms()];
  const byArm = new Map(stats.map((s) => [s.arm, s]));

  const statFor = (arm: StartLatencyArm): ArmStat =>
    byArm.get(arm) ?? { arm, pledges: 0, starts: 0, medianLatencyMin: null };

  // Gate: any active arm short on samples ⇒ stay uniform (pure exploration).
  const underGate = arms.some((a) => statFor(a).pledges < opts.minSamplesPerArm);
  if (underGate) {
    const w = 1 / arms.length;
    return {
      weights: Object.fromEntries(arms.map((a) => [a, w])),
      phase: "explore",
      temperature: opts.baseTemperature,
      reason: `exploring — waiting for ${opts.minSamplesPerArm} pledges per arm`,
    };
  }

  // Adapt: floored softmax over rewards at the annealed temperature.
  const temperature = annealedTemperature(opts);
  const rewards = arms.map((a) => armReward(statFor(a), opts.latencyHalfLifeMin));
  const maxR = Math.max(...rewards); // subtract max for numerical stability
  const exps = rewards.map((r) => Math.exp((r - maxR) / temperature));
  const sumExp = exps.reduce((a, b) => a + b, 0) || 1;

  const floor = Math.min(opts.explorationFloor, 1 / arms.length);
  const free = 1 - floor * arms.length; // mass distributed by softmax
  const weights: Record<string, number> = {};
  arms.forEach((a, i) => {
    weights[a] = floor + free * (exps[i]! / sumExp);
  });

  const best = arms[rewards.indexOf(maxR)]!;
  return {
    weights,
    phase: "adapt",
    temperature,
    reason: `adapting — leading arm "${best}" (reward ${maxR.toFixed(3)}), temp ${temperature.toFixed(2)}`,
  };
}

// Deterministic draw from a weight distribution for a specific user. Uses a
// salted hash as the uniform variate so the same user always lands the same
// arm without persisting RNG state. Walks the cumulative distribution.
export function sampleArm(
  weights: Record<string, number>,
  userId: string
): StartLatencyArm {
  const entries = Object.entries(weights).filter(([a]) => isValidArm(a)) as Array<
    [StartLatencyArm, number]
  >;
  if (entries.length === 0) return "control";
  const total = entries.reduce((s, [, w]) => s + Math.max(0, w), 0) || 1;
  // hash → [0,1); salt keeps this stream independent of the bucket hash.
  const u = (hashString(userId, "alloc:") / 0x100000000) * total;
  let acc = 0;
  for (const [arm, w] of entries) {
    acc += Math.max(0, w);
    if (u < acc) return arm;
  }
  return entries[entries.length - 1]![0];
}

// One-shot: stats + user → the arm to assign, plus the rationale (handy for
// logging why a given user landed where they did).
export function adaptiveAssign(
  userId: string,
  stats: ArmStat[],
  options?: AllocationOptions,
  activeArms?: StartLatencyArm[]
): { arm: StartLatencyArm; allocation: AllocationResult } {
  const allocation = computeAllocation(stats, options, activeArms);
  return { arm: sampleArm(allocation.weights, userId), allocation };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
