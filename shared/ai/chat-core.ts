// chat-core: the single entry point for AI inference.
//
// Responsibilities (in order):
//   1. Route intent → tier → model via router.ts
//   2. Dispatch to the resolved provider (chat or stream)
//   3. On provider error, attempt the tier-level fallback model once
//   4. Validate tool calls and structured output against Zod schemas
//   5. On validation error, repair with a single retry that surfaces the
//      validation messages to the model
//   6. Enrich actions (subject inference) for backwards compatibility
//   7. Emit telemetry and respect the per-key circuit breaker

import { inferSubjectFromTitle } from "../subjects.js";
import { route, type Intent, type Tier } from "./router.js";
import { getProvider, type ProviderName } from "./providers/index.js";
import type {
  Attachment,
  ChatRequest,
  ChatResponse,
  Message,
  StreamChunk,
  ToolCall,
  ToolDef,
  TokenUsage,
} from "./providers/types.js";
import {
  buildActionToolDefs,
  buildChatToolDefs,
  expandManageTask,
  validateAction,
  type ActionName,
} from "./schemas/actions.js";
import { buildStudioToolDefs, validateStudio, type StudioToolName } from "./schemas/studio.js";
import { buildIntentPlanToolDefs, validateIntentPlan } from "./schemas/intent_plan.js";
import { buildStudyPackToolDefs, validateStudyPack } from "./schemas/study_pack.js";
import { formatZodIssuesForModel, PLACEHOLDER_SUBJECT_STRINGS } from "./schemas/_helpers.js";
import { groundActionNames, type GroundingFlag } from "./grounding.js";
import { SCHEMA_VERSIONS } from "./schemas/versions.js";
import {
  circuitFallbackResponse,
  circuitOpen,
  isRetryable,
  recordFailure,
  recordSuccess,
} from "./resilience.js";
import { persistTelemetry, type RequestTelemetry } from "./telemetry.js";
import {
  aggregateRpmStatus,
  getRpmStatus,
  nearLimit,
  overLimit,
  recordRequest,
} from "./rpm-tracker.js";

// ── Public types ─────────────────────────────────────────────────────────────

export interface ChatAction extends Record<string, unknown> {
  type: string;
}

export interface ClarificationCard {
  reason?: string | null;
  question: string;
  options: string[];
  multi_select: boolean;
  context_action?: string | null;
  missing_fields?: string[];
  suggested_defaults?: Record<string, string>;
  known_fields?: Record<string, unknown> | null;
  severity?: "blocking" | "soft";
}

export interface CallModelRequest {
  intent: Intent;
  tierOverride?: Tier;
  providerOverride?: ProviderName;
  systemPrompt?: string;
  staticSystemPrompt?: string;
  dynamicContext?: string;
  messages: Message[];
  attachments?: Attachment[];
  toolSet?: "action" | "chat" | "studio" | "intent_plan" | "study_pack" | "none" | "custom";
  customTools?: ToolDef[];
  toolChoice?: "auto" | "required" | "none";
  responseSchema?: object;
  responseMimeType?: string;
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number;
  budgetMs?: number;
  grounding?: { googleSearch?: boolean };
  // When set, run the anti-hallucination name grounding pass over the validated
  // actions (default-chat path only). Off for forced/programmatic callers.
  groundTitles?: boolean;
  // When set, callModel will pump StreamChunks to the consumer in addition to
  // returning the aggregated final response.
  onChunk?: (chunk: StreamChunk) => void;
}

export interface CallModelResponse {
  content: string;
  actions: ChatAction[];
  clarification: ClarificationCard | null;
  clarifications: ClarificationCard[];
  validation_warnings: Array<{ tool: string; issues: Array<{ field: string; message: string }> }>;
  model_used: string;
  fallback_used: boolean;
  attempt_count: number;
  schema_version: string;
  usage: TokenUsage;
  grounding?: object;
  finish_reason?: string;
  tool_call_stats: {
    proposed: number;
    validated: number;
    proposed_tools: string[];
    validated_tools: string[];
  };
  rpm: { remaining: number; limit: number; resetAtMs: number; tier: Tier };
}

export class RpmExhaustedError extends Error {
  constructor(public tier: Tier, public resetAtMs: number) {
    super(`RPM budget exhausted for tier=${tier}`);
    this.name = "RpmExhaustedError";
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toolDefsForRequest(req: CallModelRequest): ToolDef[] | undefined {
  switch (req.toolSet) {
    case "action":
      return buildActionToolDefs();
    case "chat":
      return buildChatToolDefs();
    case "studio":
      return buildStudioToolDefs();
    case "intent_plan":
      return buildIntentPlanToolDefs();
    case "study_pack":
      return buildStudyPackToolDefs();
    case "custom":
      return req.customTools ?? [];
    case "none":
      return undefined;
    default:
      return buildActionToolDefs();
  }
}

function preEnrichSubject(toolName: string, args: Record<string, unknown>): Record<string, unknown> {
  const SUBJECT_ENRICHED = new Set(["add_event", "add_task", "add_recurring_event", "update_event"]);
  if (!SUBJECT_ENRICHED.has(toolName)) return args;
  const titleField = String(args.title ?? args.task_name ?? args.activity ?? "");
  if (!titleField) return args;
  const current = String(args.subject ?? "").trim().toLowerCase();
  const isGeneric = !current || PLACEHOLDER_SUBJECT_STRINGS.has(current);
  if (!isGeneric) return args;
  const inferred = inferSubjectFromTitle(titleField);
  if (inferred) return { ...args, subject: inferred };
  return args;
}

function clarificationFromIssues(
  toolName: string,
  issues: Array<{ path: (string | number)[]; message: string }>,
  args: Record<string, unknown>
): ClarificationCard {
  const missingFields = [...new Set(issues.map((i) => String(i.path[0] ?? "")).filter(Boolean))];
  const knownFields: Record<string, unknown> = {};
  const KNOWN = ["title", "task_name", "activity", "date", "due_date", "time", "start", "end", "subject", "event_type"];
  for (const f of KNOWN) {
    if (!missingFields.includes(f) && args[f] != null && String(args[f]).trim().length > 0) {
      knownFields[f] = args[f];
    }
  }
  const suggested_defaults: Record<string, string> = {};
  if (missingFields.includes("subject") && (args.title || args.task_name)) {
    const inferred = inferSubjectFromTitle(String(args.title ?? args.task_name ?? ""));
    if (inferred) suggested_defaults.subject = inferred;
  }
  const remaining = missingFields.filter((f) => !suggested_defaults[f]);
  const questionFor = (f: string): string => {
    switch (f) {
      case "title": return "What should the title be?";
      case "task_name": return "What should I name this task?";
      case "date": case "due_date": return "What date should I use? (e.g. next Friday)";
      case "time": return "What time? (e.g. 14:30) — or leave blank for all-day.";
      case "start": return "What start time? (HH:MM)";
      case "end": return "What end time? (HH:MM)";
      case "subject": return "Which subject is this for?";
      case "activity": return "What activity should I schedule?";
      case "new_title": return "What would you like to update this event to?";
      default: return `Can you share the ${f.replace(/_/g, " ")}?`;
    }
  };
  const question = remaining.length === 1
    ? questionFor(remaining[0]!)
    : remaining.length > 1
    ? `I still need: ${remaining.map((f) => f.replace(/_/g, " ")).join(", ")}. Can you share them in one reply?`
    : `Can you clarify the details for ${toolName}?`;
  const TOOL_REQUIRED: Record<string, string[]> = {
    add_event: ["title", "date"],
    add_task: ["task_name", "due_date"],
    add_block: ["date", "start", "end", "activity"],
    add_recurring_event: ["title", "days", "start_date", "end_date"],
    update_event: ["title"],
    delete_event: ["title"],
    delete_task: ["title"],
    clear_all: ["confirm"],
  };
  const blocking = (TOOL_REQUIRED[toolName] ?? []).some((f) => remaining.includes(f));
  return {
    reason: remaining.length === 0 ? null : `I need a couple details before I can run ${toolName}.`,
    question,
    options: [],
    multi_select: false,
    context_action: toolName,
    missing_fields: missingFields,
    suggested_defaults,
    known_fields: Object.keys(knownFields).length > 0 ? knownFields : null,
    severity: blocking ? "blocking" : "soft",
  };
}

// Turn a grounding flag into a soft clarification: surface the name we were
// about to save, carry the rest of the extracted fields forward as known_fields,
// and let the student confirm or correct it. Never blocking — the action simply
// waits for a yes/no instead of executing on an unverified name.
function clarificationFromGroundingFlag(flag: GroundingFlag): ClarificationCard {
  const knownFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(flag.action)) {
    if (k === "type" || k === flag.field) continue;
    if (v != null && String(v).trim().length > 0) knownFields[k] = v;
  }
  return {
    reason: flag.reason,
    question: `I want to save the right name — should this be "${flag.value}", or did you mean something else?`,
    options: [],
    multi_select: false,
    context_action: flag.type,
    missing_fields: [flag.field],
    known_fields: Object.keys(knownFields).length > 0 ? knownFields : null,
    severity: "soft",
  };
}

function enrichActionSubject(action: ChatAction): ChatAction {
  const titleField = String(action.title ?? action.task_name ?? action.activity ?? "");
  if (!titleField) return action;
  const current = String(action.subject ?? "").trim().toLowerCase();
  const isGeneric = !current || PLACEHOLDER_SUBJECT_STRINGS.has(current);
  if (!isGeneric) return action;
  const inferred = inferSubjectFromTitle(titleField);
  if (inferred) return { ...action, subject: inferred };
  return action;
}

// ── Provider invocation with tier fallback ───────────────────────────────────

// Default TOTAL wall-clock budget for a callModel invocation — covers the
// primary attempt, the cross-provider fallback, and any schema-repair retry.
// Kept safely under the platform function ceiling (vercel.json maxDuration=60).
const DEFAULT_BUDGET_MS = 46_000;

// A provider attempt needs at least this much runway left to be worth starting.
const MIN_ATTEMPT_MS = 1_500;

async function invokeProvider(
  req: CallModelRequest,
  modelOverride: string,
  providerName: ProviderName,
  deadline: number,
  consumer?: (c: StreamChunk) => void
): Promise<{ response: ChatResponse; chunks: number }> {
  const provider = getProvider(providerName);
  const tools = toolDefsForRequest(req);

  // Per-attempt timeout derived from the shared call deadline. The primary
  // attempt, the cross-provider fallback, and the repair retry all race the
  // same wall clock, so the whole callModel can never exceed its budget.
  const remaining = deadline - Date.now();
  if (remaining < MIN_ATTEMPT_MS) {
    throw new Error(`call budget exhausted — ${remaining}ms left`);
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`provider timeout after ${remaining}ms`)),
    remaining
  );

  const chatReq: ChatRequest = {
    model: modelOverride,
    systemPrompt: req.systemPrompt,
    staticSystemPrompt: req.staticSystemPrompt,
    dynamicContext: req.dynamicContext,
    messages: req.messages,
    attachments: req.attachments,
    tools,
    toolChoice: req.toolChoice ?? (tools ? "auto" : "none"),
    responseSchema: req.responseSchema,
    responseMimeType: req.responseMimeType,
    temperature: req.temperature,
    maxOutputTokens: req.maxOutputTokens,
    thinkingBudget: req.thinkingBudget,
    budgetMs: remaining,
    grounding: req.grounding,
    signal: controller.signal,
  };

  try {
    if (!consumer) {
      const response = await provider.chat(chatReq);
      return { response, chunks: 0 };
    }

    // Stream consumer path — accumulate deltas + tool calls, then synthesize a
    // ChatResponse compatible with the non-streaming branch.
    let aggregatedText = "";
    let aggregatedUsage: TokenUsage = {};
    let aggregatedGrounding: object | undefined;
    let finishReason: string | undefined;
    const toolCalls: ToolCall[] = [];
    let chunkCount = 0;
    for await (const chunk of provider.stream(chatReq)) {
      chunkCount += 1;
      consumer(chunk);
      if (chunk.type === "delta") aggregatedText += chunk.text;
      else if (chunk.type === "tool_call") toolCalls.push(chunk.toolCall);
      else if (chunk.type === "usage") aggregatedUsage = chunk.usage;
      else if (chunk.type === "grounding") aggregatedGrounding = chunk.metadata;
      else if (chunk.type === "done") finishReason = chunk.finishReason;
      else if (chunk.type === "error") {
        throw new Error(chunk.message);
      }
    }
    const response: ChatResponse = {
      content: aggregatedText.trim(),
      toolCalls,
      usage: aggregatedUsage,
      modelUsed: modelOverride,
      groundingMetadata: aggregatedGrounding,
      finishReason,
    };
    return { response, chunks: chunkCount };
  } finally {
    clearTimeout(timer);
  }
}

// ── Top-level entrypoint ─────────────────────────────────────────────────────

export async function callModel(req: CallModelRequest): Promise<CallModelResponse> {
  const startedAt = Date.now();
  // One wall-clock deadline shared by every provider attempt and the repair
  // retry — guarantees callModel returns within budgetMs of being called.
  const deadline = startedAt + (req.budgetMs ?? DEFAULT_BUDGET_MS);
  let r = route(req.intent, req.tierOverride, req.providerOverride);

  // Preemptive tier downgrade: if Pro is near-limit and the intent isn't one
  // that absolutely requires Pro reasoning, route to Flash instead. Planning
  // and intent-plan stay on Pro — their multi-pass draft/critique/refine
  // pipelines produce schema-invalid output on the weaker Flash model.
  const PRO_REQUIRED: Intent[] = ["planning", "intent_plan"];
  if (r.tier === "pro" && !PRO_REQUIRED.includes(req.intent) && nearLimit("pro")) {
    r = route(req.intent, "flash", req.providerOverride);
  }

  // Image-attachment routing override: GPT-OSS is text-only, so any request
  // carrying an image hops to Llama-4-Scout on Groq (vision-capable). Gemini
  // remains the cross-provider fallback for vision failures.
  const hasImage = (req.attachments?.some((a) => a.kind === "image") ?? false)
    || req.messages.some((m) => m.attachments?.some((a) => a.kind === "image") ?? false);
  if (hasImage && r.tier !== "embed") {
    r = {
      ...r,
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      provider: "groq",
      fallbackModel: "gemini-2.5-flash",
      fallbackProvider: "gemini",
    };
  }

  // Hard cap: if even Flash is exhausted, fail loud so the client can queue.
  if (overLimit(r.tier)) {
    const status = getRpmStatus(r.tier);
    throw new RpmExhaustedError(r.tier, status.resetAtMs);
  }

  const primaryCircuitKey = `${r.provider}:${r.tier}`;

  // Record the request against the tier window up-front. We do this before
  // dispatch (not after success) because: (a) a request in flight still counts
  // against the upstream quota, and (b) we want the next concurrent call to
  // see the budget shrink immediately. On hard provider failure the window
  // entry stays — slight over-counting beats double-spend.
  recordRequest(r.tier);

  let attempts = 0;
  let response: ChatResponse | null = null;
  let fallbackUsed = false;
  let successfulProvider: ProviderName = r.provider;
  let lastError: unknown;

  // Build the attempt ladder: primary (Groq) → cross-provider fallback (Gemini).
  // If the primary circuit is open we skip straight to the fallback rather than
  // erroring — the cross-provider hop is the point of having a fallback.
  type Attempt = { model: string; provider: ProviderName };
  const primaryOpen = circuitOpen(primaryCircuitKey);
  const attemptsLadder: Attempt[] = [];
  if (!primaryOpen) {
    attemptsLadder.push({ model: r.model, provider: r.provider });
  }
  if (r.fallbackModel && r.fallbackProvider) {
    attemptsLadder.push({ model: r.fallbackModel, provider: r.fallbackProvider });
  }

  if (attemptsLadder.length === 0) {
    // Primary circuit open and no fallback configured.
    const f = circuitFallbackResponse("circuit_open");
    return buildResponse(req, f, { fallbackUsed: false, attempts: 0, primaryModel: r.model, status: "error", causeCode: "circuit_open" });
  }

  for (const attempt of attemptsLadder) {
    attempts += 1;
    const circuitKey = `${attempt.provider}:${r.tier}`;
    if (circuitOpen(circuitKey)) {
      // Fallback's own circuit is also open — skip without counting as a failure.
      continue;
    }
    try {
      const { response: res } = await invokeProvider(req, attempt.model, attempt.provider, deadline, req.onChunk);
      response = res;
      fallbackUsed = attempt.model !== r.model || attempt.provider !== r.provider;
      successfulProvider = attempt.provider;
      recordSuccess(circuitKey);
      break;
    } catch (err) {
      lastError = err;
      recordFailure(circuitKey);
      void isRetryable(err);
      // Continue to the next attempt in the ladder.
    }
  }

  if (!response) {
    const errMsg = lastError instanceof Error ? lastError.message : String(lastError);
    const f = circuitFallbackResponse(primaryOpen ? "circuit_open" : "provider_failed", errMsg);
    return buildResponse(req, f, {
      fallbackUsed,
      attempts,
      primaryModel: r.model,
      status: "error",
      causeCode: primaryOpen ? "circuit_open" : "provider_failed",
      error: errMsg,
    });
  }

  let result = parseResponse(req, response);

  // Schema repair retry — single shot, on action/chat/studio/intent_plan tool sets.
  if (result.validation_warnings.length > 0 && (req.toolSet === "action" || req.toolSet === "chat" || req.toolSet === undefined || req.toolSet === "studio" || req.toolSet === "intent_plan" || req.toolSet === "study_pack")) {
    const feedback = result.validation_warnings.flatMap((w) =>
      formatZodIssuesForModel(w.tool, w.issues.map((i) => ({
        code: "custom",
        path: [i.field],
        message: i.message,
      })) as never).split("\n")
    ).join("\n");
    const retryReq: CallModelRequest = {
      ...req,
      messages: [...req.messages, { role: "user", content: feedback }],
    };
    try {
      attempts += 1;
      const { response: retryRes } = await invokeProvider(retryReq, response.modelUsed, successfulProvider, deadline);
      const retryParsed = parseResponse(retryReq, retryRes);
      if (retryParsed.actions.length > 0 || retryParsed.validation_warnings.length < result.validation_warnings.length) {
        result = retryParsed;
      }
    } catch {
      // Repair attempt failed — keep first parse.
    }
  }

  // Anti-hallucination grounding — verify chat-proposed names are tied to the
  // student's words (buried placeholder tokens + weak vector association). Pulls
  // any drifted action and replaces it with a soft clarification. Default-chat
  // only; bounded by the shared deadline and fails open on embed errors.
  if (req.groundTitles && result.actions.length > 0) {
    const remaining = deadline - Date.now();
    if (remaining > MIN_ATTEMPT_MS) {
      try {
        const { kept, flagged } = await groundActionNames({
          actions: result.actions,
          messages: req.messages,
          timeoutMs: Math.min(remaining - 500, 2500),
        });
        if (flagged.length > 0) {
          result.actions = kept;
          for (const f of flagged) {
            result.clarifications.push(clarificationFromGroundingFlag(f));
            result.validation_warnings.push({ tool: f.type, issues: [{ field: f.field, message: f.reason }] });
          }
          if (!result.clarification) result.clarification = result.clarifications[0] ?? null;
        }
      } catch {
        // Grounding is best-effort — never let it break the response.
      }
    }
  }

  // Enrich any actions that have a generic subject we can infer.
  result.actions = result.actions.map(enrichActionSubject);

  const proposedTools = result.tool_call_stats.proposed;
  const validatedTools = result.tool_call_stats.validated;
  const telemetry: RequestTelemetry = {
    request_id: makeRequestId(),
    intent: req.intent,
    tier: r.tier,
    provider: successfulProvider,
    model: response.modelUsed,
    fallback_used: fallbackUsed,
    attempt_count: attempts,
    schema_repair_triggered: attempts > attemptsLadder.length,
    tool_call_validation_rate: proposedTools > 0 ? validatedTools / proposedTools : 1,
    llm_ms: Date.now() - startedAt,
    total_ms: Date.now() - startedAt,
    prompt_tokens: response.usage.prompt_tokens,
    output_tokens: response.usage.output_tokens,
    cached_tokens: response.usage.cached_tokens,
    thinking_tokens: response.usage.thinking_tokens,
    status: "success",
  };
  void persistTelemetry(telemetry);

  return {
    ...result,
    model_used: response.modelUsed,
    fallback_used: fallbackUsed,
    attempt_count: attempts,
    schema_version: schemaVersionForRequest(req),
    usage: response.usage,
    grounding: response.groundingMetadata,
    finish_reason: response.finishReason,
    rpm: { ...aggregateRpmStatus() },
  };
}

function schemaVersionForRequest(req: CallModelRequest): string {
  switch (req.toolSet) {
    case "studio": return SCHEMA_VERSIONS.studio_tools;
    case "study_pack": return SCHEMA_VERSIONS.study_pack;
    case "intent_plan": return SCHEMA_VERSIONS.intent_plan;
    case "action":
    case undefined:
      return SCHEMA_VERSIONS.action_tools;
    default: return SCHEMA_VERSIONS.action_tools;
  }
}

function buildResponse(
  req: CallModelRequest,
  base: { content: string; toolCalls: ToolCall[]; usage: TokenUsage; modelUsed: string; finishReason?: string },
  meta: { fallbackUsed: boolean; attempts: number; primaryModel: string; status: "success" | "error"; causeCode?: string; error?: string }
): CallModelResponse {
  return {
    content: base.content,
    actions: [],
    clarification: null,
    clarifications: [],
    validation_warnings: [],
    model_used: base.modelUsed,
    fallback_used: meta.fallbackUsed,
    attempt_count: meta.attempts,
    schema_version: schemaVersionForRequest(req),
    usage: base.usage,
    finish_reason: base.finishReason,
    tool_call_stats: { proposed: 0, validated: 0, proposed_tools: [], validated_tools: [] },
    rpm: { ...aggregateRpmStatus() },
  };
}

function parseResponse(req: CallModelRequest, response: ChatResponse): Omit<CallModelResponse, "model_used" | "fallback_used" | "attempt_count" | "schema_version" | "usage" | "grounding" | "finish_reason" | "rpm"> {
  const validationWarnings: CallModelResponse["validation_warnings"] = [];
  const clarifications: ClarificationCard[] = [];
  const proposed: string[] = [];
  const validated: string[] = [];
  const actions: ChatAction[] = [];

  for (const tc of response.toolCalls) {
    const name = tc.name;
    proposed.push(name);

    // ask_clarification is handled distinctly — surface the question to the UI.
    if (name === "ask_clarification") {
      const v = validateAction(name, tc.args);
      if (!v.ok) {
        validationWarnings.push({ tool: name, issues: v.issues.map((i) => ({ field: String(i.path[0] ?? ""), message: i.message })) });
        clarifications.push(clarificationFromIssues(name, v.issues, tc.args));
        continue;
      }
      const data = v.data as { question: string; reason?: string; context_action?: string; missing_fields?: string[]; options?: string[]; multi_select?: boolean };
      clarifications.push({
        reason: data.reason ?? null,
        question: data.question,
        options: Array.isArray(data.options) ? data.options : [],
        multi_select: Boolean(data.multi_select),
        context_action: data.context_action ?? null,
        missing_fields: Array.isArray(data.missing_fields) ? data.missing_fields : [],
      });
      validated.push(name);
      continue;
    }

    // Studio / intent_plan / study_pack / action tools — pick the validator
    // from the active tool set. Content tool sets skip subject enrichment and
    // clarification cards (they always force a single complete tool call).
    const isStudioTool = req.toolSet === "studio";
    const isIntentPlanTool = req.toolSet === "intent_plan";
    const isStudyPackTool = req.toolSet === "study_pack";
    const isContentTool = isStudioTool || isIntentPlanTool || isStudyPackTool;
    const enriched = isContentTool ? tc.args : preEnrichSubject(name, tc.args);
    const v = isStudioTool
      ? validateStudio(name, enriched)
      : isIntentPlanTool
        ? validateIntentPlan(enriched)
        : isStudyPackTool
          ? validateStudyPack(name, enriched)
          : validateAction(name as ActionName, enriched);
    if (!v.ok) {
      validationWarnings.push({ tool: name, issues: v.issues.map((i) => ({ field: String(i.path[0] ?? ""), message: i.message })) });
      if (!isContentTool) clarifications.push(clarificationFromIssues(name, v.issues, enriched as Record<string, unknown>));
      continue;
    }
    // manage_task is the chat-menu consolidation of the four follow-up task
    // verbs — expand it back into the canonical per-operation action so the
    // client executor never sees the merged shape.
    if (name === "manage_task") {
      actions.push(expandManageTask(v.data as Record<string, unknown>));
      validated.push(name);
      continue;
    }
    const actionType = (v.data as { type?: string }).type ?? name;
    actions.push({ ...(v.data as Record<string, unknown>), type: actionType });
    validated.push(name);
  }

  return {
    content: response.content,
    actions,
    clarification: clarifications[0] ?? null,
    clarifications,
    validation_warnings: validationWarnings,
    tool_call_stats: {
      proposed: proposed.length,
      validated: validated.length,
      proposed_tools: proposed,
      validated_tools: validated,
    },
  };
}

function makeRequestId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Backwards-compatible thin re-exports for the old action surface ──────────
//
// A handful of callsites (planning pipeline, eval harness) import these names.
// They map onto the new TS-first surface.

export { buildActionToolDefs, validateAction, type ActionName } from "./schemas/actions.js";
export { buildStudioToolDefs, validateStudio, type StudioToolName } from "./schemas/studio.js";
export { route, type Intent, type Tier } from "./router.js";
export { SCHEMA_VERSIONS } from "./schemas/versions.js";
