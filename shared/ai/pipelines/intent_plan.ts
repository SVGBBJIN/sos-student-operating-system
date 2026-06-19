// Three-pass intent-plan pipeline: draft → critique → refine.
//
// Converts a student goal ("survive finals week", "improve Chinese speaking")
// into a structured plan of recurring blocks + milestone tasks + review cadence.
//
// Uses Pro tier throughout; gracefully degrades if critique or refine fails.
// The shared draft→critique→refine scaffold lives in agentic.ts.

import { type ChatAction, type CallModelResponse } from "../chat-core.js";
import type { Message, ProgressEvent } from "../providers/types.js";
import { makePipelineError, runAgenticPipeline } from "./agentic.js";

export const IntentPlanPipelineError = makePipelineError("IntentPlanPipelineError", "Intent-plan pipeline");
export type IntentPlanPipelineError = InstanceType<typeof IntentPlanPipelineError>;

export interface IntentPlanInput {
  systemPrompt: string;
  staticSystemPrompt?: string | null;
  dynamicContext?: string | null;
  messages: Message[];
  onProgress?: (ev: ProgressEvent) => void;
}

export interface IntentPlanOutput {
  proposal: ChatAction;
  critiqueText: string;
  iterations: number;
}

// Turns an empty-action draft into an accurate error. callModel does not throw
// on provider failure — it returns a graceful fallback with no actions — so the
// pipeline must inspect finish_reason / validation warnings to report the real
// cause instead of a misleading "model returned no intent plan action".
function describeEmptyDraft(draft: CallModelResponse): string {
  if (draft.finish_reason === "provider_failed" || draft.finish_reason === "circuit_open") {
    return draft.content || "AI provider unavailable";
  }
  if (draft.validation_warnings.length > 0) {
    const detail = draft.validation_warnings
      .flatMap((w) => w.issues.map((i) => `${i.field}: ${i.message}`))
      .slice(0, 6)
      .join("; ");
    return `intent plan failed schema validation — ${detail}`;
  }
  return "model returned no intent plan action";
}

function summarizeIntentPlan(actions: ChatAction[]): string {
  const plan = actions[0]!;
  const blocksArr = Array.isArray(plan.recurring_blocks)
    ? (plan.recurring_blocks as Array<{ activity?: string; days?: string[]; start?: string; end?: string }>)
      .map((b) => `${b.activity ?? ""} on ${(b.days ?? []).join("/")} ${b.start ?? ""}–${b.end ?? ""}`)
      .join("; ")
    : "";
  const tasksArr = Array.isArray(plan.milestone_tasks)
    ? (plan.milestone_tasks as Array<{ task_name?: string; due_date?: string }>)
      .map((t) => `${t.task_name ?? ""} by ${t.due_date ?? ""}`)
      .join("; ")
    : "";
  return `Goal plan summary: ${String(plan.summary ?? "")}\nBlocks: ${blocksArr}\nTasks: ${tasksArr}`;
}

export async function runIntentPlanPipeline(input: IntentPlanInput): Promise<IntentPlanOutput> {
  const { actions, critiqueText, iterations } = await runAgenticPipeline({
    systemPrompt: input.systemPrompt,
    staticSystemPrompt: input.staticSystemPrompt,
    dynamicContext: input.dynamicContext,
    messages: input.messages,
    onProgress: input.onProgress,
    budgetMs: 50_000,
    passFloorMs: 6_000,
    logName: "[intent-plan-pipeline]",
    fail: (stage, cause) => new IntentPlanPipelineError(stage, cause),
    hints: {
      draft:
        "\n\nINTENT PLAN PASS: DRAFT — Use make_intent_plan to produce a complete first draft. " +
        "Build a realistic recurring routine (recurring_blocks), concrete milestone tasks, and a review cadence. " +
        "Dates must be real YYYY-MM-DD values starting from today. Times must be HH:MM (24h). " +
        "Aim for 2–5 recurring blocks and 5–12 milestone tasks. Do not hold back.",
      critique:
        "\n\nINTENT PLAN PASS: CRITIQUE — A drafted intent plan is shown. Respond in plain text (no tool call). " +
        "Identify: (1) Are the recurring blocks realistic given the existing schedule density? " +
        "(2) Are review loops embedded or missing? " +
        "(3) Are task estimates reasonable for a student? " +
        "Be direct and concrete. 2–4 sentences max.",
      refine:
        "\n\nINTENT PLAN PASS: REFINE — You have the draft and a critique. " +
        "Produce the final improved intent plan using make_intent_plan, incorporating the critique. " +
        "Keep it actionable and time-realistic for a student.",
    },
    labels: {
      analyzing: "Analyzing your goal…",
      drafting: "Building your study plan…",
      reviewing: "Reviewing for gaps…",
      finalizing: "Refining the final plan…",
    },
    draftPass: { intent: "intent_plan", toolSet: "intent_plan", toolChoice: "required", maxOutputTokens: 3000, temperature: 0.4, thinkingBudget: 4096, capMs: 22_000 },
    critiquePass: { intent: "intent_plan", maxOutputTokens: 600, temperature: 0.3, thinkingBudget: 1024, capMs: 10_000 },
    refinePass: { intent: "intent_plan", toolSet: "intent_plan", toolChoice: "required", maxOutputTokens: 3000, temperature: 0.4, thinkingBudget: 4096, capMs: 22_000 },
    draftLabel: "Draft intent plan",
    critiquePrompt: "Critique the draft plan above. Is it realistic and complete?",
    refineInstruction: "Now produce the final, improved intent plan.",
    refineOnlyIfCritique: true,
    matchActions: (resp) => {
      const a = resp.actions.find((x) => x.type === "make_intent_plan") ?? resp.actions[0];
      return a ? [a] : [];
    },
    summarizeActions: summarizeIntentPlan,
    reviewPayload: (actions) => actions[0] as Record<string, unknown>,
    onEmptyDraft: (resp) => ({ error: new Error(describeEmptyDraft(resp)) }),
  });
  return { proposal: actions[0]!, critiqueText, iterations };
}
