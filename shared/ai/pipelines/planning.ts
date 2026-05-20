// Three-pass planning pipeline: draft → critique → refine.
//
// Each pass uses the Pro tier (Gemini 2.5 Pro). Tier-downgrade fallback to
// Gemini 3 Flash is owned by callModel. The pipeline degrades gracefully:
// critique/refine failures still ship the draft.

import { callModel, type ChatAction } from "../chat-core.js";
import type { Message } from "../providers/types.js";

export class PlanningPipelineError extends Error {
  public override readonly name = "PlanningPipelineError";
  public readonly stage: "draft" | "critique" | "refine";
  public readonly cause_code: string;
  constructor(stage: PlanningPipelineError["stage"], cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`Planning pipeline failed at ${stage}: ${causeMsg}`);
    this.stage = stage;
    this.cause_code = (cause as { cause_code?: string } | null)?.cause_code ?? "stage_failed";
  }
}

const DRAFT_HINT = "\n\nPLANNING PASS: DRAFT — Write a complete first-draft plan using make_plan. Cover the topic with enough steps to be realistic. Don't hold back.";
const CRITIQUE_HINT = "\n\nPLANNING PASS: CRITIQUE — A drafted plan is shown. Respond in plain text (no tool call) identifying gaps: missing prerequisites, unrealistic time allocations, missing review steps, ordering issues. Be direct and concrete. 2-4 sentences max.";
const REFINE_HINT = "\n\nPLANNING PASS: REFINE — You have the draft and a critique. Produce the final improved plan using make_plan, incorporating the critique's suggestions. Make it actionable and time-realistic.";

export interface PlanningPipelineInput {
  systemPrompt: string;
  staticSystemPrompt?: string | null;
  dynamicContext?: string | null;
  messages: Message[];
}

export interface PlanningPipelineOutput {
  proposal: ChatAction;
  critiqueText: string;
  iterations: number;
}

// Wall-clock budget for the whole 3-pass pipeline. Stays under the platform
// function ceiling (vercel.json maxDuration=60); each pass is capped, and the
// degradable critique/refine passes are skipped when the budget is nearly
// spent — the pipeline still ships the draft.
const PIPELINE_BUDGET_MS = 50_000;
const DRAFT_CAP_MS = 22_000;
const CRITIQUE_CAP_MS = 10_000;
const REFINE_CAP_MS = 22_000;
const PASS_FLOOR_MS = 6_000;

export async function runPlanningPipeline(input: PlanningPipelineInput): Promise<PlanningPipelineOutput> {
  const { systemPrompt, staticSystemPrompt, dynamicContext, messages } = input;
  const deadline = Date.now() + PIPELINE_BUDGET_MS;

  // ── Pass 1: Draft ──
  let draftAction: ChatAction | undefined;
  try {
    const draft = await callModel({
      intent: "planning",
      systemPrompt,
      staticSystemPrompt: staticSystemPrompt ?? undefined,
      dynamicContext: (dynamicContext ?? "") + DRAFT_HINT,
      messages,
      toolSet: "studio",
      customTools: [],
      toolChoice: "required",
      maxOutputTokens: 3000,
      temperature: 0.4,
      thinkingBudget: 4096,
      budgetMs: Math.min(DRAFT_CAP_MS, deadline - Date.now()),
    });
    draftAction = draft.actions.find((a) => a.type === "make_plan") ?? draft.actions[0];
  } catch (err) {
    throw new PlanningPipelineError("draft", err);
  }
  if (!draftAction) {
    throw new PlanningPipelineError("draft", new Error("model returned no plan action"));
  }

  // ── Pass 2: Critique ──
  const stepLines = Array.isArray(draftAction.steps)
    ? (draftAction.steps as Array<{ title?: string; estimated_minutes?: number; date?: string }>)
      .map((s, i) => `${i + 1}. ${s.title ?? ""}${s.estimated_minutes ? ` (~${s.estimated_minutes}min)` : ""}${s.date ? ` [${s.date}]` : ""}`)
      .join("; ")
    : "";
  const draftSummary = `Plan title: ${draftAction.title ?? "(untitled)"}\nSteps: ${stepLines}`;

  let critiqueText = "";
  if (deadline - Date.now() >= PASS_FLOOR_MS) {
    try {
      const critique = await callModel({
        intent: "planning",
        systemPrompt,
        staticSystemPrompt: staticSystemPrompt ?? undefined,
        dynamicContext: (dynamicContext ?? "") + CRITIQUE_HINT,
        messages: [
          ...messages,
          { role: "assistant", content: `Draft plan:\n${draftSummary}` },
          { role: "user", content: "Critique the draft plan above. What is missing or unrealistic?" },
        ],
        toolSet: "none",
        maxOutputTokens: 600,
        temperature: 0.3,
        thinkingBudget: 1024,
        budgetMs: Math.min(CRITIQUE_CAP_MS, deadline - Date.now()),
      });
      critiqueText = critique.content.trim();
    } catch (err) {
      console.warn(`[planning-pipeline] critique pass failed (${err instanceof Error ? err.message : err}) — proceeding with draft`);
    }
  } else {
    console.warn("[planning-pipeline] skipping critique — pipeline budget nearly spent");
  }

  // ── Pass 3: Refine ──
  let proposal: ChatAction = draftAction;
  let iterations = critiqueText ? 2 : 1;
  if (deadline - Date.now() >= PASS_FLOOR_MS) {
    try {
      const refine = await callModel({
        intent: "planning",
        systemPrompt,
        staticSystemPrompt: staticSystemPrompt ?? undefined,
        dynamicContext: (dynamicContext ?? "") + REFINE_HINT,
        messages: [
          ...messages,
          { role: "assistant", content: `Draft plan:\n${draftSummary}` },
          { role: "user", content: `Critique:\n${critiqueText || "No major issues found."}\n\nNow produce the final, improved plan.` },
        ],
        toolSet: "studio",
        customTools: [],
        toolChoice: "required",
        maxOutputTokens: 3000,
        temperature: 0.4,
        thinkingBudget: 4096,
        budgetMs: Math.min(REFINE_CAP_MS, deadline - Date.now()),
      });
      proposal = refine.actions.find((a) => a.type === "make_plan") ?? draftAction;
      iterations = 3;
    } catch (err) {
      console.warn(`[planning-pipeline] refine pass failed (${err instanceof Error ? err.message : err}) — returning draft`);
    }
  } else {
    console.warn("[planning-pipeline] skipping refine — pipeline budget nearly spent");
  }

  return { proposal, critiqueText, iterations };
}
