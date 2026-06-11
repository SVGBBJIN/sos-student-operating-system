// Three-pass brain-dump pipeline: draft → critique → refine.
//
// Turns a free-form voice transcript (or any messy text dump) into a batch of
// add_task / add_event / add_block actions. Items that are uncertain land with
// a low `confidence` and `status: 'tentative'` / `commitment: 'tentative'`,
// which the client routes through its review rail instead of auto-applying.
//
// Shares the draft→critique→refine scaffold in agentic.ts but produces a batch
// of regular action tool calls instead of a single structured object.

import { type ChatAction, type CallModelResponse } from "../chat-core.js";
import type { Message, ProgressEvent } from "../providers/types.js";
import { makePipelineError, runAgenticPipeline } from "./agentic.js";

export const BrainDumpPipelineError = makePipelineError("BrainDumpPipelineError", "Brain-dump pipeline");
export type BrainDumpPipelineError = InstanceType<typeof BrainDumpPipelineError>;

export interface BrainDumpInput {
  systemPrompt: string;
  staticSystemPrompt?: string | null;
  dynamicContext?: string | null;
  messages: Message[];
  onProgress?: (ev: ProgressEvent) => void;
}

export interface BrainDumpOutput {
  actions: ChatAction[];
  summary: string;
  critiqueText: string;
  iterations: number;
}

function describeEmptyDraft(draft: CallModelResponse): string {
  if (draft.finish_reason === "provider_failed" || draft.finish_reason === "circuit_open") {
    return draft.content || "AI provider unavailable";
  }
  if (draft.validation_warnings.length > 0) {
    const detail = draft.validation_warnings
      .flatMap((w) => w.issues.map((i) => `${i.field}: ${i.message}`))
      .slice(0, 6)
      .join("; ");
    return `brain-dump draft failed schema validation — ${detail}`;
  }
  return "model extracted no actionable items from the brain dump";
}

function summarizeActions(actions: ChatAction[]): string {
  if (actions.length === 0) return "(no items extracted)";
  return actions
    .map((a) => {
      const conf = typeof a.confidence === "number" ? ` conf=${(a.confidence as number).toFixed(2)}` : "";
      const tent = a.status === "tentative" || a.commitment === "tentative" ? " [tentative]" : "";
      switch (a.type) {
        case "add_task":
          return `- add_task "${a.task_name ?? a.title ?? ""}" due ${a.due_date ?? "?"}${conf}${tent}`;
        case "add_event":
          return `- add_event "${a.title ?? ""}" on ${a.date ?? "?"}${a.time ? " at " + a.time : ""}${conf}${tent}`;
        case "add_block":
          return `- add_block "${a.activity ?? ""}" ${a.date ?? "?"} ${a.start ?? "?"}–${a.end ?? "?"}${conf}${tent}`;
        default:
          return `- ${a.type}${conf}${tent}`;
      }
    })
    .join("\n");
}

export async function runBrainDumpPipeline(input: BrainDumpInput): Promise<BrainDumpOutput> {
  const result = await runAgenticPipeline({
    systemPrompt: input.systemPrompt,
    staticSystemPrompt: input.staticSystemPrompt,
    dynamicContext: input.dynamicContext,
    messages: input.messages,
    onProgress: input.onProgress,
    budgetMs: 45_000,
    passFloorMs: 5_000,
    logName: "[brain-dump-pipeline]",
    fail: (stage, cause) => new BrainDumpPipelineError(stage, cause),
    hints: {
      draft:
        "\n\nBRAIN DUMP PASS: DRAFT — The student just dumped a messy message (often a voice transcript). " +
        "Extract every concrete task, event, or block they mentioned, each as its own tool call " +
        "(add_task, add_event, add_block). Use exact phrasing from the transcript for titles. " +
        "If a date or time wasn't stated, infer the most likely one but ALWAYS mark that item with " +
        "`status: 'tentative'` (events) or `commitment: 'tentative'` (tasks) and `confidence` below 0.7. " +
        "Items where the date/time/subject were stated verbatim get `confidence` >= 0.85. " +
        "Do not call ask_clarification — the review rail handles uncertainty. " +
        "If the transcript contains no actionable items, return no tool calls and a short content explanation.",
      critique:
        "\n\nBRAIN DUMP PASS: CRITIQUE — A first draft of extracted actions is shown. Respond in plain " +
        "text (no tool call). Identify: (1) Items that were missed. (2) Items whose date/time were " +
        "inferred but not marked tentative. (3) Confidence scores that look miscalibrated. " +
        "Be direct and concrete. 2–4 sentences max.",
      refine:
        "\n\nBRAIN DUMP PASS: REFINE — You have the draft and a critique. Re-emit the full batch of " +
        "action tool calls, applying the critique. Every inferred date/time MUST carry tentative + " +
        "confidence < 0.7. Verbatim items keep confidence >= 0.85.",
    },
    labels: {
      analyzing: "Listening to your dump…",
      drafting: "Pulling out tasks and events…",
      reviewing: "Reviewing extracted items…",
      finalizing: "Refining the list…",
    },
    draftPass: { intent: "action_routing", toolSet: "action", toolChoice: "auto", maxOutputTokens: 1800, temperature: 0.3, capMs: 20_000 },
    critiquePass: { intent: "action_routing", maxOutputTokens: 400, temperature: 0.3, capMs: 8_000 },
    refinePass: { intent: "action_routing", toolSet: "action", toolChoice: "auto", maxOutputTokens: 1800, temperature: 0.3, capMs: 18_000 },
    draftLabel: "Draft extracted items",
    critiquePrompt: "Critique the draft above. What's missing or miscalibrated?",
    refineInstruction: "Now re-emit the full corrected batch of action tool calls.",
    matchActions: (resp) => resp.actions ?? [],
    summarizeActions,
    reviewPayload: (actions) => ({ actions }),
    // Empty draft is not an error — the transcript may have been chit-chat.
    onEmptyDraft: (resp) =>
      resp.content || resp.validation_warnings.length === 0
        ? { ship: [] }
        : { error: new Error(describeEmptyDraft(resp)) },
    refineOnlyIfCritique: true,
  });

  if (result.shippedEmpty) {
    return {
      actions: [],
      summary: result.draftContent || "Nothing to add from that.",
      critiqueText: "",
      iterations: 1,
    };
  }

  const { actions } = result;
  const summary = `${actions.length} item${actions.length === 1 ? "" : "s"} extracted` +
    (actions.some((a) => a.status === "tentative" || a.commitment === "tentative")
      ? ` — some marked tentative for you to confirm`
      : "");
  return { actions, summary, critiqueText: result.critiqueText, iterations: result.iterations };
}
