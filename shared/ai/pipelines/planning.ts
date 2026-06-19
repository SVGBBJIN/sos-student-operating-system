// Three-pass planning pipeline: draft → critique → refine.
//
// Each pass uses the Pro tier (Gemini 2.5 Pro). Tier-downgrade fallback to
// Gemini 3 Flash is owned by callModel. The pipeline degrades gracefully:
// critique/refine failures still ship the draft. The shared draft→critique→
// refine scaffold lives in agentic.ts; this file is just the planning config.

import type { ChatAction } from "../chat-core.js";
import type { Message, ProgressEvent } from "../providers/types.js";
import { makePipelineError, runAgenticPipeline } from "./agentic.js";

export const PlanningPipelineError = makePipelineError("PlanningPipelineError", "Planning pipeline");
export type PlanningPipelineError = InstanceType<typeof PlanningPipelineError>;

export interface PlanningPipelineInput {
  systemPrompt: string;
  staticSystemPrompt?: string | null;
  dynamicContext?: string | null;
  messages: Message[];
  onProgress?: (ev: ProgressEvent) => void;
}

export interface PlanningPipelineOutput {
  proposal: ChatAction;
  critiqueText: string;
  iterations: number;
}

function summarizePlan(actions: ChatAction[]): string {
  const plan = actions[0]!;
  const stepLines = Array.isArray(plan.steps)
    ? (plan.steps as Array<{ title?: string; kind?: string; estimated_minutes?: number; date?: string; time?: string; end_time?: string }>)
      .map((s, i) => {
        const when = s.date ? ` [${s.date}${s.time ? ` ${s.time}${s.end_time ? `-${s.end_time}` : ""}` : ""}]` : "";
        const tag = s.kind ? ` <${s.kind}>` : "";
        return `${i + 1}. ${s.title ?? ""}${tag}${s.estimated_minutes ? ` (~${s.estimated_minutes}min)` : ""}${when}`;
      })
      .join("; ")
    : "";
  return `Plan title: ${plan.title ?? "(untitled)"}\nSteps: ${stepLines}`;
}

export async function runPlanningPipeline(input: PlanningPipelineInput): Promise<PlanningPipelineOutput> {
  const { actions, critiqueText, iterations } = await runAgenticPipeline({
    systemPrompt: input.systemPrompt,
    staticSystemPrompt: input.staticSystemPrompt,
    dynamicContext: input.dynamicContext,
    messages: input.messages,
    onProgress: input.onProgress,
    // Stays under the platform function ceiling (vercel.json maxDuration=60).
    budgetMs: 50_000,
    passFloorMs: 6_000,
    logName: "[planning-pipeline]",
    fail: (stage, cause) => new PlanningPipelineError(stage, cause),
    hints: {
      draft: "\n\nPLANNING PASS: DRAFT — Write a complete first-draft plan using make_plan. Cover the topic with enough steps to be realistic. Don't hold back. Categorize every step: study/work/break/meal/exercise/leisure sessions and timed exams are kind='block' (give date, time, end_time so they appear on the calendar); hard due items are kind='deadline' (give a date). Resolve all dates from the DATE MAP in context — never compute dates yourself.",
      critique: "\n\nPLANNING PASS: CRITIQUE — A drafted plan is shown. Respond in plain text (no tool call) identifying gaps: missing prerequisites, unrealistic time allocations, missing review steps, missing breaks/downtime, ordering issues. Be direct and concrete. 2-4 sentences max.",
      refine: "\n\nPLANNING PASS: REFINE — You have the draft and a critique. Produce the final improved plan using make_plan, incorporating the critique's suggestions. Keep each step categorized as kind='block' (with date/time/end_time) or kind='deadline' (with date). Make it actionable and time-realistic, with real breaks so the week isn't all grind.",
    },
    labels: {
      analyzing: "Analyzing your request…",
      drafting: "Drafting the plan…",
      reviewing: "Reviewing for gaps…",
      finalizing: "Refining the final plan…",
    },
    draftPass: { intent: "planning", toolSet: "studio", toolChoice: "required", maxOutputTokens: 3000, temperature: 0.4, thinkingBudget: 4096, capMs: 22_000 },
    critiquePass: { intent: "planning", maxOutputTokens: 600, temperature: 0.3, thinkingBudget: 1024, capMs: 10_000 },
    refinePass: { intent: "planning", toolSet: "studio", toolChoice: "required", maxOutputTokens: 3000, temperature: 0.4, thinkingBudget: 4096, capMs: 22_000 },
    draftLabel: "Draft plan",
    critiquePrompt: "Critique the draft plan above. What is missing or unrealistic?",
    refineInstruction: "Now produce the final, improved plan.",
    refineOnlyIfCritique: true,
    matchActions: (resp) => {
      const a = resp.actions.find((x) => x.type === "make_plan") ?? resp.actions[0];
      return a ? [a] : [];
    },
    summarizeActions: summarizePlan,
    reviewPayload: (actions) => actions[0] as Record<string, unknown>,
    onEmptyDraft: () => ({ error: new Error("model returned no plan action") }),
  });
  return { proposal: actions[0]!, critiqueText, iterations };
}
