// Compose the dynamic context string fed to a chat request. This is the bridge
// between the existing workspace-context strings the client sends and the new
// RAG layer.
//
// Inputs:
//   - workspaceContext: "chat" | "schedule" | "notes" | … (free-form)
//   - userId: who we're retrieving for; null disables RAG
//   - intentQuery: the latest user message text; used for the embedding query
//   - injectedFacts: any caller-supplied bullets (e.g. today's date, snapshots)
//
// Output:
//   { contextText, retrievedSourceIds, tokenEstimate }

import { retrieve, type RetrievedChunk } from "../rag/retrieve.js";
import { estimateTokens, trimToBudget } from "./ranker.js";
import type { BehavioralSignals } from "../signals/behavioral.js";
import { formatSignalsForContext } from "../signals/behavioral.js";
import type { StudySignals } from "../signals/study.js";
import { formatStudySignalsForContext } from "../signals/study.js";
import { rankTasks, buildCalendarDensity, type TaskForScoring, type CalendarDensity } from "../../scheduling/priority.js";

export interface AssembleOptions {
  userId: string | null;
  workspaceContext: string;
  intentQuery: string;
  injectedFacts?: string[];
  budgetTokens?: number;
  sources?: string[];
  behavioralSignals?: BehavioralSignals;
  studySignals?: StudySignals;
  clientTasks?: TaskForScoring[];
  clientCalendarDensity?: CalendarDensity;
  // Pre-fetched retrieval results. When supplied, assembleContext skips its own
  // retrieve() call — used by enrichDynamicContext to run retrieval in parallel
  // with the behavioral-signals fetch.
  retrieved?: RetrievedChunk[];
}

export interface AssembledContext {
  contextText: string;
  retrievedSourceIds: string[];
  tokenEstimate: number;
}

export async function assembleContext(opts: AssembleOptions): Promise<AssembledContext> {
  const budget = opts.budgetTokens ?? 1500;
  const sections: Array<{ heading: string; lines: string[]; pinned?: boolean }> = [];

  sections.push({
    heading: "Workspace",
    lines: [`workspace_context: ${opts.workspaceContext || "chat"}`],
    pinned: true,
  });

  if (opts.injectedFacts && opts.injectedFacts.length > 0) {
    sections.push({ heading: "Facts", lines: opts.injectedFacts, pinned: true });
  }

  let retrieved: RetrievedChunk[] = opts.retrieved ?? [];
  if (!opts.retrieved && opts.userId && opts.intentQuery && opts.intentQuery.trim().length > 0) {
    try {
      retrieved = await retrieve({
        userId: opts.userId,
        query: opts.intentQuery,
        sources: opts.sources,
        k: 8,
      });
    } catch {
      retrieved = [];
    }
  }

  if (retrieved.length > 0) {
    const rankable = retrieved.map((r) => ({
      text: `(${r.source} · sim=${r.similarity.toFixed(2)}) ${r.text}`,
      score: r.finalScore ?? r.similarity,
      sourceId: r.source_id,
    }));
    const trimmed = trimToBudget(rankable, Math.max(0, budget - 200));
    sections.push({
      heading: "Retrieved memories",
      lines: trimmed.kept.map((t) => `- ${t.text}`),
    });
  }

  // Priority ranking: top tasks right now, injected as a pinned hint.
  if (opts.clientTasks && opts.clientTasks.length > 0) {
    const density = opts.clientCalendarDensity ?? buildCalendarDensity(opts.clientTasks, {});
    const ranked = rankTasks(opts.clientTasks, new Date(), density, opts.behavioralSignals, 3);
    if (ranked.length > 0) {
      sections.push({
        heading: "Top tasks right now",
        lines: ranked.map((r) => `- ${r.explanation}`),
        pinned: true,
      });
    }
  }

  // Behavioral signals: compact summary injected as a pinned hint.
  if (opts.behavioralSignals && opts.behavioralSignals.total_events_30d > 0) {
    const summary = formatSignalsForContext(opts.behavioralSignals);
    if (summary) {
      sections.push({
        heading: "Behavioral patterns",
        lines: [summary],
        pinned: true,
      });
    }
  }

  // Weak topics from study-pack quiz performance: a pinned hint so the
  // assistant can gently suggest reviewing topics the student keeps missing.
  if (opts.studySignals && opts.studySignals.weak_topics.length > 0) {
    const summary = formatStudySignalsForContext(opts.studySignals);
    if (summary) {
      sections.push({
        heading: "Topics needing review",
        lines: [summary],
        pinned: true,
      });
    }
  }

  const contextText = sections
    .filter((s) => s.lines.length > 0)
    .map((s) => `[${s.heading}]\n${s.lines.join("\n")}`)
    .join("\n\n");

  return {
    contextText,
    retrievedSourceIds: retrieved.map((r) => r.source_id),
    tokenEstimate: estimateTokens(contextText),
  };
}
