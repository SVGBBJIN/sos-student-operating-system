// Best-effort dynamic-context enrichment, shared by both chat handlers.
//
// Runs the two independent reads — behavioral signals and RAG retrieval —
// concurrently, then folds the assembled context onto the caller's base
// string. Never throws and never blocks the request: any failure (or a slow
// upstream that trips the per-call timeouts in behavioral.ts / retrieve.ts)
// just yields the base context unchanged.

import { getBehavioralSignals } from "../signals/behavioral.js";
import { retrieve, type RetrievedChunk } from "../rag/retrieve.js";
import { assembleContext } from "./assembler.js";
import type { TaskForScoring, CalendarDensity } from "../../scheduling/priority.js";

export interface EnrichOptions {
  userId: string | null;
  workspaceContext: string;
  intentQuery: string;
  baseContext: string;
  clientTasks?: TaskForScoring[];
  clientCalendarDensity?: CalendarDensity;
  sources?: string[];
}

export async function enrichDynamicContext(opts: EnrichOptions): Promise<string> {
  const base = opts.baseContext;
  if (!opts.userId || !opts.clientTasks || opts.clientTasks.length === 0) {
    return base;
  }
  const tasks = opts.clientTasks.filter((t) => t.status !== "done").slice(0, 50);

  try {
    const [signals, retrieved] = await Promise.all([
      getBehavioralSignals(opts.userId).catch(() => undefined),
      opts.intentQuery.trim().length > 0
        ? retrieve({ userId: opts.userId, query: opts.intentQuery, sources: opts.sources, k: 8 })
            .catch((): RetrievedChunk[] => [])
        : Promise.resolve<RetrievedChunk[]>([]),
    ]);

    const assembled = await assembleContext({
      userId: opts.userId,
      workspaceContext: opts.workspaceContext,
      intentQuery: opts.intentQuery,
      behavioralSignals: signals,
      retrieved,
      clientTasks: tasks,
      clientCalendarDensity: opts.clientCalendarDensity,
    });
    return assembled.contextText ? `${base}\n\n${assembled.contextText}` : base;
  } catch {
    return base;
  }
}
