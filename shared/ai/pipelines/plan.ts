// Three-pass unified plan pipeline: draft → critique → refine.
//
// Replaces the former planning / intent_plan / brain_dump pipelines. All three
// were the same draft→critique→refine shape over a Pro-tier call — the only
// real difference was which buckets of one make_plan tool call the model was
// meant to fill. Classification (explicit request vs. goal vs. brain dump) now
// happens via prompting inside the draft pass rather than three separate
// entry points. The shared scaffold lives in agentic.ts.

import type { ChatAction } from "../chat-core.js";
import type { Message, ProgressEvent } from "../providers/types.js";
import { describeEmptyDraft, makePipelineError, runAgenticPipeline } from "./agentic.js";

export const PlanPipelineError = makePipelineError("PlanPipelineError", "Plan pipeline");
export type PlanPipelineError = InstanceType<typeof PlanPipelineError>;

export interface PlanPipelineInput {
  systemPrompt: string;
  staticSystemPrompt?: string | null;
  dynamicContext?: string | null;
  messages: Message[];
  onProgress?: (ev: ProgressEvent) => void;
}

export interface PlanPipelineOutput {
  // null when the draft legitimately extracted nothing (e.g. a brain-dump-
  // shaped input that turned out to be chit-chat) — not an error.
  proposal: ChatAction | null;
  summary: string;
  critiqueText: string;
  iterations: number;
}

function summarizePlan(actions: ChatAction[]): string {
  const plan = actions[0]!;
  const steps = Array.isArray(plan.steps) ? plan.steps as Array<{ title?: string; kind?: string; estimated_minutes?: number; date?: string; time?: string; end_time?: string }> : [];
  const blocks = Array.isArray(plan.recurring_blocks) ? plan.recurring_blocks as Array<{ activity?: string; days?: string[]; start?: string; end?: string }> : [];
  const milestones = Array.isArray(plan.milestone_tasks) ? plan.milestone_tasks as Array<{ task_name?: string; due_date?: string }> : [];
  const batch = Array.isArray(plan.batch_actions) ? plan.batch_actions as Array<{ type?: string; title?: string; task_name?: string; activity?: string; date?: string; due_date?: string }> : [];

  const parts: string[] = [`Plan title: ${plan.title ?? "(untitled)"}`];
  if (steps.length > 0) {
    const stepLines = steps.map((s, i) => {
      const when = s.date ? ` [${s.date}${s.time ? ` ${s.time}${s.end_time ? `-${s.end_time}` : ""}` : ""}]` : "";
      const tag = s.kind ? ` <${s.kind}>` : "";
      return `${i + 1}. ${s.title ?? ""}${tag}${s.estimated_minutes ? ` (~${s.estimated_minutes}min)` : ""}${when}`;
    }).join("; ");
    parts.push(`Steps: ${stepLines}`);
  }
  if (blocks.length > 0) {
    parts.push(`Recurring blocks: ${blocks.map((b) => `${b.activity ?? ""} on ${(b.days ?? []).join("/")} ${b.start ?? ""}–${b.end ?? ""}`).join("; ")}`);
  }
  if (milestones.length > 0) {
    parts.push(`Milestones: ${milestones.map((t) => `${t.task_name ?? ""} by ${t.due_date ?? ""}`).join("; ")}`);
  }
  if (batch.length > 0) {
    parts.push(`Extracted items: ${batch.map((a) => `${a.type ?? ""} "${a.title ?? a.task_name ?? a.activity ?? ""}" ${a.date ?? a.due_date ?? "?"}`).join("; ")}`);
  }
  return parts.join("\n");
}

export async function runPlanPipeline(input: PlanPipelineInput): Promise<PlanPipelineOutput> {
  const result = await runAgenticPipeline({
    systemPrompt: input.systemPrompt,
    staticSystemPrompt: input.staticSystemPrompt,
    dynamicContext: input.dynamicContext,
    messages: input.messages,
    onProgress: input.onProgress,
    // Stays under the platform function ceiling (vercel.json maxDuration=60).
    // Union of the three former budgets (worst case output is now larger).
    budgetMs: 50_000,
    passFloorMs: 6_000,
    logName: "[plan-pipeline]",
    fail: (stage, cause) => new PlanPipelineError(stage, cause),
    hints: {
      draft:
        "\n\nPLAN PASS: DRAFT — Use make_plan. First decide input_kind: " +
        "'explicit_request' if the student asked for a concrete multi-step plan (fill `steps`, categorizing each as kind='block' with date/time/end_time, or kind='deadline' with just a date — resolve all dates from the DATE MAP in context, never compute them yourself); " +
        "'goal' if the student stated a broader goal or intent rather than a step list (fill `recurring_blocks` [2-5 realistic weekly blocks] + `milestone_tasks` [5-12 concrete deliverables] + `review_cadence`, all dates YYYY-MM-DD, times HH:MM 24h); " +
        "'brain_dump' if the student dumped a messy list of things they need to do (fill `batch_actions`, one entry per item, using exact phrasing for titles; mark any inferred date/time with status/commitment='tentative' and confidence < 0.7, verbatim items get confidence >= 0.85; do not call ask_clarification — the review rail handles uncertainty). " +
        "Only fill the bucket(s) matching the input_kind — leave the others empty. Don't hold back on completeness.",
      critique:
        "\n\nPLAN PASS: CRITIQUE — A drafted plan is shown. Respond in plain text (no tool call). " +
        "If it used `steps`: check for missing prerequisites, unrealistic time allocations, missing breaks, ordering issues. " +
        "If it used `recurring_blocks`/`milestone_tasks`: check realism against existing schedule density, missing review loops, unreasonable task estimates. " +
        "If it used `batch_actions`: check for missed items, inferred dates/times not marked tentative, miscalibrated confidence. " +
        "Be direct and concrete. 2-4 sentences max.",
      refine:
        "\n\nPLAN PASS: REFINE — You have the draft and a critique. Produce the final improved plan using make_plan, " +
        "in the same buckets as the draft, incorporating the critique's suggestions. Keep it actionable and time-realistic, with real breaks so the week isn't all grind.",
    },
    labels: {
      analyzing: "Analyzing your request…",
      drafting: "Drafting the plan…",
      reviewing: "Reviewing for gaps…",
      finalizing: "Refining the final plan…",
    },
    draftPass: { intent: "plan", toolSet: "plan", toolChoice: "required", maxOutputTokens: 3000, temperature: 0.4, thinkingBudget: 4096, capMs: 22_000 },
    critiquePass: { intent: "plan", maxOutputTokens: 600, temperature: 0.3, thinkingBudget: 1024, capMs: 10_000 },
    refinePass: { intent: "plan", toolSet: "plan", toolChoice: "required", maxOutputTokens: 3000, temperature: 0.4, thinkingBudget: 4096, capMs: 22_000 },
    draftLabel: "Draft plan",
    critiquePrompt: "Critique the draft plan above. What is missing, unrealistic, or miscalibrated?",
    refineInstruction: "Now produce the final, improved plan.",
    refineOnlyIfCritique: true,
    matchActions: (resp) => {
      const a = resp.actions.find((x) => x.type === "make_plan") ?? resp.actions[0];
      return a ? [a] : [];
    },
    summarizeActions: summarizePlan,
    reviewPayload: (actions) => actions[0] as Record<string, unknown>,
    // Empty draft is not necessarily an error — a brain-dump-shaped input may
    // have contained no actionable items (chit-chat). But a real provider
    // failure or schema-invalid output must still surface as an error rather
    // than silently shipping an empty plan.
    onEmptyDraft: (resp) =>
      resp.finish_reason === "provider_failed" || resp.finish_reason === "circuit_open" || resp.validation_warnings.length > 0
        ? { error: new Error(describeEmptyDraft(resp, "plan")) }
        : { ship: [] },
  });

  if (result.shippedEmpty) {
    return {
      proposal: null,
      summary: result.draftContent || "Nothing to add from that.",
      critiqueText: "",
      iterations: 1,
    };
  }

  const proposal = result.actions[0]!;
  const stepCount = Array.isArray(proposal.steps) ? (proposal.steps as unknown[]).length : 0;
  const blockCount = Array.isArray(proposal.recurring_blocks) ? (proposal.recurring_blocks as unknown[]).length : 0;
  const milestoneCount = Array.isArray(proposal.milestone_tasks) ? (proposal.milestone_tasks as unknown[]).length : 0;
  const batchCount = Array.isArray(proposal.batch_actions) ? (proposal.batch_actions as unknown[]).length : 0;
  // The model called make_plan but left every bucket empty — a hollow plan
  // (this is the failure mode that used to reach the client as a silent
  // "0 blocks · 0 tasks" card). Treat it the same as an empty draft so the
  // student gets an explanation instead of a dead-end card.
  if (stepCount === 0 && blockCount === 0 && milestoneCount === 0 && batchCount === 0) {
    return {
      proposal: null,
      summary: "I couldn't put together a concrete plan from that — try again, or break the request into something more specific (e.g. a single deadline or one week of study blocks).",
      critiqueText: "",
      iterations: result.iterations,
    };
  }

  const batchActions = Array.isArray(proposal.batch_actions) ? proposal.batch_actions as Array<{ confidence?: number; status?: string; commitment?: string }> : [];
  // batch_actions-shaped plans skip the propose-mode card and go straight to
  // the review rail (see App.jsx's mode:'plan' dispatch) — that path reads
  // `content`/summary as the chat message, so it needs the tentative-items
  // callout the old brain_dump pipeline computed, not a blank string.
  const summary = batchActions.length > 0
    ? `${batchActions.length} item${batchActions.length === 1 ? "" : "s"} extracted` +
      (batchActions.some((a) => a.status === "tentative" || a.commitment === "tentative")
        ? " — some marked tentative for you to confirm"
        : "")
    : "";

  return { proposal, summary, critiqueText: result.critiqueText, iterations: result.iterations };
}
