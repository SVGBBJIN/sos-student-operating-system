// Three-pass planning pipeline: draft → critique → refine.
// Each pass is a separate callGroq invocation against PRIMARY_MODEL.
// The static system prompt is identical across all passes, preserving Groq's prompt cache.

import { callGroq, PRIMARY_MODEL, STUDIO_TOOLS } from "./chat-core.js";

// The make_plan tool — pulled from STUDIO_TOOLS to avoid duplication.
const MAKE_PLAN_TOOL = STUDIO_TOOLS.find(t => t.function.name === "make_plan");
if (!MAKE_PLAN_TOOL) throw new Error("planning-pipeline: make_plan tool not found in STUDIO_TOOLS");

const DRAFT_HINT = "\n\nPLANNING PASS: DRAFT — Write a complete first-draft plan using make_plan. Include enough steps to realistically cover the topic. Do not hold back.";
const CRITIQUE_HINT = "\n\nPLANNING PASS: CRITIQUE — You will be given a drafted plan. Respond in plain text (no tool call) identifying specific gaps: missing prerequisites, unrealistic time allocations, missing review steps, or steps out of order. Be direct and concrete. 2-4 sentences max.";
const REFINE_HINT = "\n\nPLANNING PASS: REFINE — You have seen the draft plan and a critique. Produce the final improved plan using make_plan, incorporating the critique's suggestions. Make it actionable and time-realistic.";

/**
 * @param {{
 *   apiKey: string,
 *   systemPrompt: string,
 *   staticSystemPrompt: string | null,
 *   dynamicContext: string | null,
 *   messages: {role:string,content:string}[],
 * }} opts
 * @returns {Promise<{proposal: object, critiqueText: string, iterations: number}>}
 */
export async function runPlanningPipeline(opts) {
  const { apiKey, systemPrompt, staticSystemPrompt, dynamicContext, messages } = opts;

  const baseCallOpts = {
    isContentGen: true,
    staticSystemPrompt: staticSystemPrompt || null,
    budgetMs: 20000,
  };

  // ── Pass 1: Draft ──
  const draftResult = await callGroq(
    apiKey,
    PRIMARY_MODEL,
    systemPrompt,
    messages,
    3000,
    null, null, true,
    [MAKE_PLAN_TOOL],
    "required",
    null,
    { ...baseCallOpts, dynamicContext: dynamicContext ? `${dynamicContext}${DRAFT_HINT}` : DRAFT_HINT }
  );
  const draftAction = draftResult.actions?.[0];
  if (!draftAction) {
    throw new Error("Planning pipeline draft pass returned no action.");
  }

  // ── Pass 2: Critique ──
  const draftSummary = [
    `Plan title: ${draftAction.title || "(untitled)"}`,
    `Steps: ${(draftAction.steps || []).map((s, i) => `${i + 1}. ${s.title}${s.estimated_minutes ? ` (~${s.estimated_minutes}min)` : ""}${s.date ? ` [${s.date}]` : ""}`).join("; ")}`,
  ].join("\n");

  const critiqueMessages = [
    ...messages,
    { role: "assistant", content: `Draft plan:\n${draftSummary}` },
    { role: "user", content: "Critique the draft plan above. What is missing or unrealistic?" },
  ];

  const critiqueResult = await callGroq(
    apiKey,
    PRIMARY_MODEL,
    systemPrompt,
    critiqueMessages,
    512,
    null, null, false,
    null,
    "auto",
    null,
    { ...baseCallOpts, dynamicContext: dynamicContext ? `${dynamicContext}${CRITIQUE_HINT}` : CRITIQUE_HINT }
  );
  const critiqueText = (critiqueResult.content || "").trim();

  // ── Pass 3: Refine ──
  const refineMessages = [
    ...messages,
    { role: "assistant", content: `Draft plan:\n${draftSummary}` },
    { role: "user", content: `Critique:\n${critiqueText || "No major issues found."}\n\nNow produce the final, improved plan.` },
  ];

  const refineResult = await callGroq(
    apiKey,
    PRIMARY_MODEL,
    systemPrompt,
    refineMessages,
    3000,
    null, null, true,
    [MAKE_PLAN_TOOL],
    "required",
    null,
    { ...baseCallOpts, dynamicContext: dynamicContext ? `${dynamicContext}${REFINE_HINT}` : REFINE_HINT }
  );
  const proposal = refineResult.actions?.[0] || draftAction;

  return { proposal, critiqueText, iterations: 3 };
}
