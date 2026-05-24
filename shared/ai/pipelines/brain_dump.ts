// Three-pass brain-dump pipeline: draft → critique → refine.
//
// Turns a free-form voice transcript (or any messy text dump) into a batch of
// add_task / add_event / add_block actions. Items that are uncertain land with
// a low `confidence` and `status: 'tentative'` / `commitment: 'tentative'`,
// which the client routes through its review rail instead of auto-applying.
//
// Shares the agentic shape of intent_plan.ts (draft/critique/refine, budgets,
// progress events) but produces a batch of regular action tool calls instead
// of a single make_intent_plan structured object.

import { callModel, type ChatAction, type CallModelResponse } from "../chat-core.js";
import type { Message, ProgressEvent } from "../providers/types.js";

export class BrainDumpPipelineError extends Error {
  public override readonly name = "BrainDumpPipelineError";
  public readonly stage: "draft" | "critique" | "refine";
  public readonly cause_code: string;
  constructor(stage: BrainDumpPipelineError["stage"], cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`Brain-dump pipeline failed at ${stage}: ${causeMsg}`);
    this.stage = stage;
    this.cause_code = (cause as { cause_code?: string } | null)?.cause_code ?? "stage_failed";
  }
}

const DRAFT_HINT =
  "\n\nBRAIN DUMP PASS: DRAFT — The student just dumped a messy message (often a voice transcript). " +
  "Extract every concrete task, event, or block they mentioned, each as its own tool call " +
  "(add_task, add_event, add_block). Use exact phrasing from the transcript for titles. " +
  "If a date or time wasn't stated, infer the most likely one but ALWAYS mark that item with " +
  "`status: 'tentative'` (events) or `commitment: 'tentative'` (tasks) and `confidence` below 0.7. " +
  "Items where the date/time/subject were stated verbatim get `confidence` >= 0.85. " +
  "Do not call ask_clarification — the review rail handles uncertainty. " +
  "If the transcript contains no actionable items, return no tool calls and a short content explanation.";

const CRITIQUE_HINT =
  "\n\nBRAIN DUMP PASS: CRITIQUE — A first draft of extracted actions is shown. Respond in plain " +
  "text (no tool call). Identify: (1) Items that were missed. (2) Items whose date/time were " +
  "inferred but not marked tentative. (3) Confidence scores that look miscalibrated. " +
  "Be direct and concrete. 2–4 sentences max.";

const REFINE_HINT =
  "\n\nBRAIN DUMP PASS: REFINE — You have the draft and a critique. Re-emit the full batch of " +
  "action tool calls, applying the critique. Every inferred date/time MUST carry tentative + " +
  "confidence < 0.7. Verbatim items keep confidence >= 0.85.";

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

const PIPELINE_BUDGET_MS = 45_000;
const DRAFT_CAP_MS = 20_000;
const CRITIQUE_CAP_MS = 8_000;
const REFINE_CAP_MS = 18_000;
const PASS_FLOOR_MS = 5_000;

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

export async function runBrainDumpPipeline(
  input: BrainDumpInput
): Promise<BrainDumpOutput> {
  const { systemPrompt, staticSystemPrompt, dynamicContext, messages, onProgress } = input;
  const deadline = Date.now() + PIPELINE_BUDGET_MS;

  onProgress?.({ phase: "analyzing", label: "Listening to your dump…", step: 1, totalSteps: 4 });

  // ── Pass 1: Draft ──
  onProgress?.({ phase: "drafting", label: "Pulling out tasks and events…", step: 2, totalSteps: 4 });
  let draft: CallModelResponse;
  try {
    draft = await callModel({
      intent: "action_routing",
      systemPrompt,
      staticSystemPrompt: staticSystemPrompt ?? undefined,
      dynamicContext: (dynamicContext ?? "") + DRAFT_HINT,
      messages,
      toolSet: "action",
      toolChoice: "auto",
      maxOutputTokens: 1800,
      temperature: 0.3,
      budgetMs: Math.min(DRAFT_CAP_MS, deadline - Date.now()),
    });
  } catch (err) {
    throw new BrainDumpPipelineError("draft", err);
  }

  const draftActions = draft.actions ?? [];
  if (draftActions.length === 0) {
    // Empty draft is not an error — the transcript may have been chit-chat.
    // Return the model's content as the summary so the UI can render it.
    if (draft.content || draft.validation_warnings.length === 0) {
      return {
        actions: [],
        summary: draft.content || "Nothing to add from that.",
        critiqueText: "",
        iterations: 1,
      };
    }
    throw new BrainDumpPipelineError("draft", new Error(describeEmptyDraft(draft)));
  }

  onProgress?.({
    phase: "reviewing",
    label: "Reviewing extracted items…",
    step: 3,
    totalSteps: 4,
    draft: { actions: draftActions } as Record<string, unknown>,
  });

  // ── Pass 2: Critique ──
  const draftSummary = summarizeActions(draftActions);
  let critiqueText = "";
  if (deadline - Date.now() >= PASS_FLOOR_MS) {
    try {
      const critique = await callModel({
        intent: "action_routing",
        systemPrompt,
        staticSystemPrompt: staticSystemPrompt ?? undefined,
        dynamicContext: (dynamicContext ?? "") + CRITIQUE_HINT,
        messages: [
          ...messages,
          { role: "assistant", content: `Draft extracted items:\n${draftSummary}` },
          { role: "user", content: "Critique the draft above. What's missing or miscalibrated?" },
        ],
        toolSet: "none",
        maxOutputTokens: 400,
        temperature: 0.3,
        budgetMs: Math.min(CRITIQUE_CAP_MS, deadline - Date.now()),
      });
      critiqueText = critique.content.trim();
    } catch (err) {
      console.warn(
        `[brain-dump-pipeline] critique pass failed (${err instanceof Error ? err.message : err}) — proceeding with draft`
      );
    }
  } else {
    console.warn("[brain-dump-pipeline] skipping critique — pipeline budget nearly spent");
  }

  // ── Pass 3: Refine ──
  onProgress?.({ phase: "finalizing", label: "Refining the list…", step: 4, totalSteps: 4 });
  let actions: ChatAction[] = draftActions;
  let iterations = critiqueText ? 2 : 1;
  if (critiqueText && deadline - Date.now() >= PASS_FLOOR_MS) {
    try {
      const refine = await callModel({
        intent: "action_routing",
        systemPrompt,
        staticSystemPrompt: staticSystemPrompt ?? undefined,
        dynamicContext: (dynamicContext ?? "") + REFINE_HINT,
        messages: [
          ...messages,
          { role: "assistant", content: `Draft extracted items:\n${draftSummary}` },
          {
            role: "user",
            content: `Critique:\n${critiqueText}\n\nNow re-emit the full corrected batch of action tool calls.`,
          },
        ],
        toolSet: "action",
        toolChoice: "auto",
        maxOutputTokens: 1800,
        temperature: 0.3,
        budgetMs: Math.min(REFINE_CAP_MS, deadline - Date.now()),
      });
      if (refine.actions.length > 0) {
        actions = refine.actions;
        iterations = 3;
      }
    } catch (err) {
      console.warn(
        `[brain-dump-pipeline] refine pass failed (${err instanceof Error ? err.message : err}) — returning draft`
      );
    }
  }

  const summary = `${actions.length} item${actions.length === 1 ? "" : "s"} extracted` +
    (actions.some((a) => a.status === "tentative" || a.commitment === "tentative")
      ? ` — some marked tentative for you to confirm`
      : "");

  return { actions, summary, critiqueText, iterations };
}
