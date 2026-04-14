/**
 * agentLoop — orchestrates multi-step AI requests by chaining sequential callAI calls.
 *
 * Detects multi-step intent by checking for connector words (e.g. "and", "also", "then")
 * in the user message. If detected, splits the message into sub-requests and runs each
 * sequentially, passing prior results as context to the next step.
 *
 * Usage:
 *   const result = await runAgentLoop({ userMessage, sessionContext, authToken });
 *   // result.wasAgentic: boolean
 *   // result.response: string (final summary)
 *   // result.agentSteps: [{subRequest, result}]
 *
 * Falls back to a single callAI call when the message doesn't appear multi-step.
 */

import { callAI } from "./aiClient.js";

const MULTI_STEP_CONNECTORS = /\b(and also|and then|as well as|plus|both|and|also|then)\b/i;

// Keywords that suggest scheduling/task intent — used to score sub-requests
const INTENT_KEYWORDS = [
  "add", "create", "schedule", "plan", "set", "make", "remind",
  "delete", "remove", "cancel", "update", "edit", "change",
  "note", "task", "event", "flashcard", "quiz",
];

const MAX_STEPS = 4;

/**
 * Splits a user message into sub-requests at connector words.
 * Attempts to keep meaningful chunks; returns [original] if splitting fails.
 *
 * @param {string} message
 * @returns {string[]}
 */
function splitIntoSubRequests(message) {
  const parts = message
    .split(/\b(?:and also|and then|as well as|also|then|plus|and)\b/i)
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length < 2) return [message];
  return parts.slice(0, MAX_STEPS);
}

/**
 * Checks whether a message looks like it contains multiple distinct AI intents.
 *
 * @param {string} message
 * @returns {boolean}
 */
export function likelyMultiStep(message) {
  if (!MULTI_STEP_CONNECTORS.test(message)) return false;
  const lower = message.toLowerCase();
  const matchCount = INTENT_KEYWORDS.filter((kw) => lower.includes(kw)).length;
  // Require at least 2 intent keywords alongside a connector
  return matchCount >= 2;
}

/**
 * runAgentLoop — main entry point.
 *
 * @param {{
 *   userMessage: string,
 *   sessionContext?: {messages?: unknown[], systemPrompt?: string, workspaceContext?: string},
 *   maxSteps?: number,
 *   authToken?: string,
 * }} params
 * @returns {Promise<{response: string, agentSteps: Array<{subRequest: string, result: unknown}>, wasAgentic: boolean}>}
 */
export async function runAgentLoop({
  userMessage,
  sessionContext = {},
  maxSteps = MAX_STEPS,
  authToken,
}) {
  const subRequests = splitIntoSubRequests(userMessage).slice(0, maxSteps);

  if (subRequests.length < 2) {
    // Single step — just a normal callAI
    const result = await callAI({
      messages: [
        ...(sessionContext.messages ?? []),
        { role: "user", content: userMessage },
      ],
      systemPrompt: sessionContext.systemPrompt,
      workspaceContext: sessionContext.workspaceContext,
      agentStep: false,
      authToken,
    });
    return {
      response: result.content,
      agentSteps: [{ subRequest: userMessage, result }],
      wasAgentic: false,
    };
  }

  const agentSteps = [];
  let accumulatedContext = "";

  for (let i = 0; i < subRequests.length; i++) {
    const subRequest = subRequests[i];
    const contextPrefix = accumulatedContext
      ? `Previous steps completed:\n${accumulatedContext}\n\nNow handle: `
      : "";

    const messages = [
      ...(sessionContext.messages ?? []),
      { role: "user", content: contextPrefix + subRequest },
    ];

    let stepResult;
    try {
      stepResult = await callAI({
        messages,
        systemPrompt: sessionContext.systemPrompt,
        workspaceContext: sessionContext.workspaceContext,
        agentStep: true,
        authToken,
      });
    } catch (err) {
      stepResult = { content: `Step ${i + 1} failed: ${err?.message ?? "unknown error"}`, actions: [] };
    }

    agentSteps.push({ subRequest, result: stepResult });
    if (stepResult.content) {
      accumulatedContext += `Step ${i + 1} (${subRequest}): ${stepResult.content}\n`;
    }
  }

  // Build a final summary response
  const summaryParts = agentSteps.map((s, i) => `${i + 1}. ${s.subRequest}: ${s.result?.content ?? "done"}`);
  const response =
    agentSteps.length > 0
      ? `Done! Here's what I handled:\n${summaryParts.join("\n")}`
      : "I wasn't able to complete those steps. Let me know if you'd like to try again.";

  return { response, agentSteps, wasAgentic: true };
}
