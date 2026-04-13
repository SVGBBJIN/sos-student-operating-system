/**
 * aiClient — client-side abstraction over the SOS backend AI endpoint.
 *
 * This module NEVER calls the Groq or any LLM API directly.
 * All AI requests go through EDGE_FN_URL (Vercel serverless or Supabase Edge),
 * keeping API keys server-side only.
 *
 * Model selection is locked per browser session via sessionStorage.sos_active_model.
 * The selected model is sent as `preferredModel` in the request body; the backend
 * validates and honours it (or falls back to PRIMARY_MODEL if unrecognised).
 */

import { EDGE_FN_URL, SUPABASE_ANON_KEY } from "./supabase.js";
import { retryAI } from "./retryAI.js";

const SESSION_MODEL_KEY = "sos_active_model";

// Groq model IDs — must mirror the constants in shared/ai/chat-core.js
const PRIMARY_MODEL        = "llama-3.3-70b-versatile";
const FAST_MODEL           = "llama-3.1-8b-instant";

/**
 * Selects the appropriate Groq model based on input characteristics.
 * Locks the result into sessionStorage so the same model is used for the
 * entire browser session (avoids context rot from mid-session model switches).
 *
 * @param {{ text?: string, toolCount?: number, agentStep?: boolean }} input
 * @returns {string} Groq model ID
 */
export function selectModel(input = {}) {
  const locked = sessionStorage.getItem(SESSION_MODEL_KEY);
  if (locked) return locked;

  let chosen;
  if (input.agentStep) {
    chosen = PRIMARY_MODEL;
  } else if ((input.toolCount ?? 0) > 0) {
    chosen = PRIMARY_MODEL;
  } else if ((input.text?.length ?? 0) < 80 && !input.toolCount) {
    chosen = FAST_MODEL;
  } else {
    chosen = PRIMARY_MODEL;
  }

  try { sessionStorage.setItem(SESSION_MODEL_KEY, chosen); } catch (_) {}
  return chosen;
}

/** Clear the session model lock (call on new chat / logout). */
export function clearModelLock() {
  try { sessionStorage.removeItem(SESSION_MODEL_KEY); } catch (_) {}
}

/**
 * callAI — sends a chat request to the SOS backend and returns the parsed response.
 *
 * @param {{
 *   messages: Array<{role: string, content: string}>,
 *   systemPrompt?: string,
 *   staticSystemPrompt?: string,
 *   dynamicContext?: string,
 *   tools?: unknown[],
 *   agentStep?: boolean,
 *   workspaceContext?: string,
 *   isContentGen?: boolean,
 *   maxTokens?: number,
 *   streaming?: boolean,
 *   imageBase64?: string,
 *   imageMimeType?: string,
 *   authToken?: string,
 * }} params
 * @returns {Promise<{content: string, actions: unknown[], clarification: unknown|null, model: string, usage: unknown}>}
 */
export async function callAI(params) {
  const {
    messages,
    systemPrompt,
    staticSystemPrompt,
    dynamicContext,
    agentStep = false,
    workspaceContext,
    isContentGen = false,
    maxTokens = 1024,
    streaming = false,
    imageBase64,
    imageMimeType,
    authToken,
  } = params;

  const latestText = messages?.findLast?.(m => m.role === "user")?.content ?? "";
  const toolCount = 0; // no client-side tool count inference needed
  const preferredModel = selectModel({ text: latestText, toolCount, agentStep });

  const body = {
    messages,
    systemPrompt,
    staticSystemPrompt,
    dynamicContext,
    workspaceContext,
    isContentGen,
    maxTokens,
    streaming,
    imageBase64,
    imageMimeType,
    preferredModel,
  };

  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
  };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  return retryAI(async () => {
    const res = await fetch(EDGE_FN_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = new Error(`AI request failed: ${res.status}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    return {
      content: data.content ?? "",
      actions: data.actions ?? [],
      clarification: data.clarification ?? null,
      clarifications: data.clarifications ?? [],
      model: data.model_used ?? preferredModel,
      usage: data.usage ?? null,
    };
  });
}
