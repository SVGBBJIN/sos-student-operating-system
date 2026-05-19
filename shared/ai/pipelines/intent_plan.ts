// Three-pass intent-plan pipeline: draft → critique → refine.
//
// Converts a student goal ("survive finals week", "improve Chinese speaking")
// into a structured plan of recurring blocks + milestone tasks + review cadence.
//
// Uses Pro tier throughout; gracefully degrades if critique or refine fails.

import { callModel, type ChatAction, type CallModelResponse } from "../chat-core.js";
import type { Message } from "../providers/types.js";

export class IntentPlanPipelineError extends Error {
  public override readonly name = "IntentPlanPipelineError";
  public readonly stage: "draft" | "critique" | "refine";
  public readonly cause_code: string;
  constructor(stage: IntentPlanPipelineError["stage"], cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`Intent-plan pipeline failed at ${stage}: ${causeMsg}`);
    this.stage = stage;
    this.cause_code = (cause as { cause_code?: string } | null)?.cause_code ?? "stage_failed";
  }
}

const DRAFT_HINT =
  "\n\nINTENT PLAN PASS: DRAFT — Use make_intent_plan to produce a complete first draft. " +
  "Build a realistic recurring routine (recurring_blocks), concrete milestone tasks, and a review cadence. " +
  "Dates must be real YYYY-MM-DD values starting from today. Times must be HH:MM (24h). " +
  "Aim for 2–5 recurring blocks and 5–12 milestone tasks. Do not hold back.";

const CRITIQUE_HINT =
  "\n\nINTENT PLAN PASS: CRITIQUE — A drafted intent plan is shown. Respond in plain text (no tool call). " +
  "Identify: (1) Are the recurring blocks realistic given the existing schedule density? " +
  "(2) Are review loops embedded or missing? " +
  "(3) Are task estimates reasonable for a student? " +
  "Be direct and concrete. 2–4 sentences max.";

const REFINE_HINT =
  "\n\nINTENT PLAN PASS: REFINE — You have the draft and a critique. " +
  "Produce the final improved intent plan using make_intent_plan, incorporating the critique. " +
  "Keep it actionable and time-realistic for a student.";

export interface IntentPlanInput {
  systemPrompt: string;
  staticSystemPrompt?: string | null;
  dynamicContext?: string | null;
  messages: Message[];
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

export async function runIntentPlanPipeline(
  input: IntentPlanInput
): Promise<IntentPlanOutput> {
  const { systemPrompt, staticSystemPrompt, dynamicContext, messages } = input;

  // ── Pass 1: Draft ──
  let draft: CallModelResponse;
  try {
    draft = await callModel({
      intent: "intent_plan",
      systemPrompt,
      staticSystemPrompt: staticSystemPrompt ?? undefined,
      dynamicContext: (dynamicContext ?? "") + DRAFT_HINT,
      messages,
      toolSet: "intent_plan",
      customTools: [],
      toolChoice: "required",
      maxOutputTokens: 3000,
      temperature: 0.4,
      thinkingBudget: 4096,
      budgetMs: 20000,
    });
  } catch (err) {
    throw new IntentPlanPipelineError("draft", err);
  }
  const draftAction = draft.actions.find((a) => a.type === "make_intent_plan") ?? draft.actions[0];
  if (!draftAction) {
    throw new IntentPlanPipelineError("draft", new Error(describeEmptyDraft(draft)));
  }

  // ── Pass 2: Critique ──
  const blocksArr = Array.isArray(draftAction.recurring_blocks)
    ? (draftAction.recurring_blocks as Array<{ activity?: string; days?: string[]; start?: string; end?: string }>)
      .map((b) => `${b.activity ?? ""} on ${(b.days ?? []).join("/")} ${b.start ?? ""}–${b.end ?? ""}`)
      .join("; ")
    : "";
  const tasksArr = Array.isArray(draftAction.milestone_tasks)
    ? (draftAction.milestone_tasks as Array<{ task_name?: string; due_date?: string }>)
      .map((t) => `${t.task_name ?? ""} by ${t.due_date ?? ""}`)
      .join("; ")
    : "";
  const draftSummary = `Goal plan summary: ${String(draftAction.summary ?? "")}\nBlocks: ${blocksArr}\nTasks: ${tasksArr}`;

  let critiqueText = "";
  try {
    const critique = await callModel({
      intent: "intent_plan",
      systemPrompt,
      staticSystemPrompt: staticSystemPrompt ?? undefined,
      dynamicContext: (dynamicContext ?? "") + CRITIQUE_HINT,
      messages: [
        ...messages,
        { role: "assistant", content: `Draft intent plan:\n${draftSummary}` },
        { role: "user", content: "Critique the draft plan above. Is it realistic and complete?" },
      ],
      toolSet: "none",
      maxOutputTokens: 600,
      temperature: 0.3,
      thinkingBudget: 1024,
      budgetMs: 12000,
    });
    critiqueText = critique.content.trim();
  } catch (err) {
    console.warn(
      `[intent-plan-pipeline] critique pass failed (${err instanceof Error ? err.message : err}) — proceeding with draft`
    );
  }

  // ── Pass 3: Refine ──
  let proposal: ChatAction = draftAction;
  let iterations = critiqueText ? 2 : 1;
  try {
    const refine = await callModel({
      intent: "intent_plan",
      systemPrompt,
      staticSystemPrompt: staticSystemPrompt ?? undefined,
      dynamicContext: (dynamicContext ?? "") + REFINE_HINT,
      messages: [
        ...messages,
        { role: "assistant", content: `Draft intent plan:\n${draftSummary}` },
        {
          role: "user",
          content: `Critique:\n${critiqueText || "No major issues found."}\n\nNow produce the final, improved intent plan.`,
        },
      ],
      toolSet: "intent_plan",
      customTools: [],
      toolChoice: "required",
      maxOutputTokens: 3000,
      temperature: 0.4,
      thinkingBudget: 4096,
      budgetMs: 20000,
    });
    proposal = refine.actions.find((a) => a.type === "make_intent_plan") ?? draftAction;
    iterations = 3;
  } catch (err) {
    console.warn(
      `[intent-plan-pipeline] refine pass failed (${err instanceof Error ? err.message : err}) — returning draft`
    );
  }

  return { proposal, critiqueText, iterations };
}
