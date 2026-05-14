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

export interface AssembleOptions {
  userId: string | null;
  workspaceContext: string;
  intentQuery: string;
  injectedFacts?: string[];
  budgetTokens?: number;
  sources?: string[];
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

  let retrieved: RetrievedChunk[] = [];
  if (opts.userId && opts.intentQuery && opts.intentQuery.trim().length > 0) {
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
