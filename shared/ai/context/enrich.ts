// Best-effort dynamic-context enrichment, shared by both chat handlers.
//
// Runs the always-on behavioral/study signal reads concurrently, then folds the
// assembled context onto the caller's base string. Semantic memory retrieval is
// NOT done here — it is exposed to the model as the `search_memory` tool and
// only runs when the model decides it needs background context, so the common
// turn never pays for an embedding round-trip. Never throws and never blocks the
// request: any failure (or a slow upstream that trips the per-call timeout in
// behavioral.ts) just yields the base context unchanged.

import { getBehavioralSignals } from "../signals/behavioral.js";
import { getStudySignals } from "../signals/study.js";
import { assembleContext } from "./assembler.js";
import type { TaskForScoring, CalendarDensity } from "../../scheduling/priority.js";

export interface EnrichOptions {
  userId: string | null;
  workspaceContext: string;
  intentQuery: string;
  baseContext: string;
  clientTasks?: TaskForScoring[];
  clientCalendarDensity?: CalendarDensity;
}

export async function enrichDynamicContext(opts: EnrichOptions): Promise<string> {
  const base = opts.baseContext;
  if (!opts.userId || !opts.clientTasks || opts.clientTasks.length === 0) {
    return base;
  }
  const tasks = opts.clientTasks.filter((t) => t.status !== "done").slice(0, 50);

  try {
    const [signals, studySignals] = await Promise.all([
      getBehavioralSignals(opts.userId).catch(() => undefined),
      getStudySignals(opts.userId).catch(() => undefined),
    ]);

    const assembled = await assembleContext({
      userId: opts.userId,
      workspaceContext: opts.workspaceContext,
      intentQuery: opts.intentQuery,
      behavioralSignals: signals,
      studySignals,
      retrieved: [],
      clientTasks: tasks,
      clientCalendarDensity: opts.clientCalendarDensity,
    });
    return assembled.contextText ? `${base}\n\n${assembled.contextText}` : base;
  } catch {
    return base;
  }
}
