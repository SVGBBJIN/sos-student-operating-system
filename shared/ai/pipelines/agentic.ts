// Shared scaffold for the draft → critique → refine agentic pipelines.
//
// planning, intent_plan and brain_dump all run the same three-pass shape: a
// Pro/Flash draft pass, a plain-text critique pass, then a refine pass — each
// wall-clock-budgeted, with the degradable critique/refine passes skipped when
// the budget is nearly spent so the draft still ships. The only differences are
// the intent/toolset, the prompt hints, how the draft is summarized for the
// follow-up passes, and the output shape. Everything else (deadline math,
// graceful degradation, progress events, error shaping) lived in triplicate and
// now lives here once.

import { callModel, type ChatAction, type CallModelResponse } from "../chat-core.js";
import type { Intent } from "../router.js";
import type { Message, ProgressEvent } from "../providers/types.js";

export type PipelineStage = "draft" | "critique" | "refine";

// Factory for the per-pipeline error classes. Each surface keeps its own named
// class (chat-handler reads .stage / .cause_code off the catch) but the body is
// identical, so it is generated here.
export function makePipelineError(name: string, label: string) {
  const Cls = class extends Error {
    public override readonly name = name;
    public readonly stage: PipelineStage;
    public readonly cause_code: string;
    constructor(stage: PipelineStage, cause: unknown) {
      const causeMsg = cause instanceof Error ? cause.message : String(cause);
      super(`${label} failed at ${stage}: ${causeMsg}`);
      this.stage = stage;
      this.cause_code = (cause as { cause_code?: string } | null)?.cause_code ?? "stage_failed";
    }
  };
  return Cls;
}

type ToolSet = Parameters<typeof callModel>[0]["toolSet"];
type ToolChoice = Parameters<typeof callModel>[0]["toolChoice"];

export interface PassSpec {
  intent: Intent;
  toolSet: ToolSet;
  toolChoice?: ToolChoice;
  maxOutputTokens: number;
  temperature: number;
  thinkingBudget?: number;
  capMs: number;
}

// onEmptyDraft lets a pipeline decide what an actionless draft means: ship it
// gracefully (brain_dump chit-chat) or fail with a domain-specific message.
export type EmptyDraftOutcome =
  | { ship: ChatAction[] }
  | { error: unknown };

export interface AgenticConfig {
  systemPrompt: string;
  staticSystemPrompt?: string | null;
  dynamicContext?: string | null;
  messages: Message[];
  onProgress?: (ev: ProgressEvent) => void;

  budgetMs: number;
  passFloorMs: number;
  logName: string;
  fail: (stage: PipelineStage, cause: unknown) => Error;

  hints: { draft: string; critique: string; refine: string };
  labels: { analyzing: string; drafting: string; reviewing: string; finalizing: string };

  draftPass: PassSpec;
  critiquePass: Omit<PassSpec, "toolSet" | "toolChoice">;
  refinePass: PassSpec;

  // Label the draft carries when it is fed back into the critique/refine turns.
  draftLabel: string;
  critiquePrompt: string;
  refineInstruction: string;

  // Domain hooks.
  matchActions: (resp: CallModelResponse) => ChatAction[];
  summarizeActions: (actions: ChatAction[]) => string;
  reviewPayload: (actions: ChatAction[]) => Record<string, unknown>;
  onEmptyDraft?: (resp: CallModelResponse) => EmptyDraftOutcome;
  refineOnlyIfCritique?: boolean;
}

export interface AgenticResult {
  actions: ChatAction[];
  critiqueText: string;
  iterations: number;
  // Raw draft content, surfaced for pipelines (brain_dump) that ship the
  // model's prose when no actions were extracted.
  draftContent: string;
  shippedEmpty: boolean;
}

export async function runAgenticPipeline(cfg: AgenticConfig): Promise<AgenticResult> {
  const deadline = Date.now() + cfg.budgetMs;
  const remaining = () => deadline - Date.now();
  const ctx = (hint: string) => (cfg.dynamicContext ?? "") + hint;

  cfg.onProgress?.({ phase: "analyzing", label: cfg.labels.analyzing, step: 1, totalSteps: 4 });

  // ── Pass 1: Draft ──
  cfg.onProgress?.({ phase: "drafting", label: cfg.labels.drafting, step: 2, totalSteps: 4 });
  let draftResp: CallModelResponse;
  try {
    draftResp = await callModel({
      intent: cfg.draftPass.intent,
      systemPrompt: cfg.systemPrompt,
      staticSystemPrompt: cfg.staticSystemPrompt ?? undefined,
      dynamicContext: ctx(cfg.hints.draft),
      messages: cfg.messages,
      toolSet: cfg.draftPass.toolSet,
      toolChoice: cfg.draftPass.toolChoice,
      maxOutputTokens: cfg.draftPass.maxOutputTokens,
      temperature: cfg.draftPass.temperature,
      thinkingBudget: cfg.draftPass.thinkingBudget,
      budgetMs: Math.min(cfg.draftPass.capMs, remaining()),
    });
  } catch (err) {
    throw cfg.fail("draft", err);
  }

  const draftActions = cfg.matchActions(draftResp);
  if (draftActions.length === 0) {
    const outcome = cfg.onEmptyDraft?.(draftResp);
    if (outcome && "ship" in outcome) {
      return {
        actions: outcome.ship,
        critiqueText: "",
        iterations: 1,
        draftContent: draftResp.content ?? "",
        shippedEmpty: true,
      };
    }
    throw cfg.fail("draft", outcome && "error" in outcome ? outcome.error : new Error("model returned no action"));
  }

  cfg.onProgress?.({
    phase: "reviewing",
    label: cfg.labels.reviewing,
    step: 3,
    totalSteps: 4,
    draft: cfg.reviewPayload(draftActions),
  });

  const draftSummary = cfg.summarizeActions(draftActions);

  // ── Pass 2: Critique (plain text, degradable) ──
  let critiqueText = "";
  if (remaining() >= cfg.passFloorMs) {
    try {
      const critique = await callModel({
        intent: cfg.critiquePass.intent,
        systemPrompt: cfg.systemPrompt,
        staticSystemPrompt: cfg.staticSystemPrompt ?? undefined,
        dynamicContext: ctx(cfg.hints.critique),
        messages: [
          ...cfg.messages,
          { role: "assistant", content: `${cfg.draftLabel}:\n${draftSummary}` },
          { role: "user", content: cfg.critiquePrompt },
        ],
        toolSet: "none",
        maxOutputTokens: cfg.critiquePass.maxOutputTokens,
        temperature: cfg.critiquePass.temperature,
        thinkingBudget: cfg.critiquePass.thinkingBudget,
        budgetMs: Math.min(cfg.critiquePass.capMs, remaining()),
      });
      critiqueText = critique.content.trim();
    } catch (err) {
      console.warn(`${cfg.logName} critique pass failed (${err instanceof Error ? err.message : err}) — proceeding with draft`);
    }
  } else {
    console.warn(`${cfg.logName} skipping critique — pipeline budget nearly spent`);
  }

  // ── Pass 3: Refine (degradable) ──
  cfg.onProgress?.({ phase: "finalizing", label: cfg.labels.finalizing, step: 4, totalSteps: 4 });
  let actions = draftActions;
  let iterations = critiqueText ? 2 : 1;
  const wantRefine = cfg.refineOnlyIfCritique ? !!critiqueText : true;
  if (wantRefine && remaining() >= cfg.passFloorMs) {
    try {
      const refine = await callModel({
        intent: cfg.refinePass.intent,
        systemPrompt: cfg.systemPrompt,
        staticSystemPrompt: cfg.staticSystemPrompt ?? undefined,
        dynamicContext: ctx(cfg.hints.refine),
        messages: [
          ...cfg.messages,
          { role: "assistant", content: `${cfg.draftLabel}:\n${draftSummary}` },
          { role: "user", content: `Critique:\n${critiqueText || "No major issues found."}\n\n${cfg.refineInstruction}` },
        ],
        toolSet: cfg.refinePass.toolSet,
        toolChoice: cfg.refinePass.toolChoice,
        maxOutputTokens: cfg.refinePass.maxOutputTokens,
        temperature: cfg.refinePass.temperature,
        thinkingBudget: cfg.refinePass.thinkingBudget,
        budgetMs: Math.min(cfg.refinePass.capMs, remaining()),
      });
      const refined = cfg.matchActions(refine);
      if (refined.length > 0) {
        actions = refined;
        iterations = 3;
      }
    } catch (err) {
      console.warn(`${cfg.logName} refine pass failed (${err instanceof Error ? err.message : err}) — returning draft`);
    }
  } else if (wantRefine) {
    console.warn(`${cfg.logName} skipping refine — pipeline budget nearly spent`);
  }

  // The critique describes the DRAFT. Once a refine pass has folded it into a
  // new plan, surfacing the old critique as "AI review" is stale and misleading
  // (it complains about gaps the final plan already fixed). Only keep the
  // critique when the shipped plan IS the draft it critiqued.
  const surfacedCritique = iterations === 3 ? "" : critiqueText;

  return { actions, critiqueText: surfacedCritique, iterations, draftContent: draftResp.content ?? "", shippedEmpty: false };
}
