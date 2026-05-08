/**
 * aiClient — client-side abstraction over the SOS backend AI endpoint.
 *
 * Model identity is the single source of truth in `shared/ai/chat-core.js`.
 * If the user previously stored a preference in localStorage we honor it,
 * otherwise we forward MODEL_DEEP. The backend validates and falls back
 * to MODEL_DEEP if unrecognised, then auto-fails-over to MODEL_FAST inside
 * callGroq if the heavy model is unreachable.
 */

import { EDGE_FN_URL, SUPABASE_ANON_KEY } from "./supabase.js";
import { retryAI } from "./retryAI.js";
import { MODEL_DEEP, MODEL_FAST } from "../../shared/ai/chat-core.js";

const MODEL_KEY = "sos_preferred_model";
export { MODEL_DEEP, MODEL_FAST };

export function getPreferredModel() {
  try {
    return localStorage.getItem(MODEL_KEY) || MODEL_DEEP;
  } catch (_) {
    return MODEL_DEEP;
  }
}

export function setPreferredModel(model) {
  try { localStorage.setItem(MODEL_KEY, model); } catch (_) {}
}

/** @deprecated kept for back-compat. Returns the user's preferred model. */
export function selectModel() { return getPreferredModel(); }
export function clearModelLock() {
  try { localStorage.removeItem(MODEL_KEY); } catch (_) {}
}

export async function callAI(params) {
  const {
    messages,
    systemPrompt,
    staticSystemPrompt,
    dynamicContext,
    workspaceContext,
    isContentGen = false,
    maxTokens = 1024,
    imageBase64,
    imageMimeType,
    authToken,
    preferredModel,
  } = params;

  const model = preferredModel || getPreferredModel();

  const body = {
    messages,
    systemPrompt,
    staticSystemPrompt,
    dynamicContext,
    workspaceContext,
    isContentGen,
    maxTokens,
    imageBase64,
    imageMimeType,
    preferredModel: model,
  };

  const headers = {
    "Content-Type": "application/json",
    apikey: SUPABASE_ANON_KEY,
  };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  return retryAI(async () => {
    const res = await fetch(EDGE_FN_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const bodyText = await res.text().catch(() => "");
      const err = new Error(`AI request failed: ${res.status}${bodyText ? ` — ${bodyText.slice(0, 300)}` : ""}`);
      err.status = res.status;
      err.body = bodyText;
      throw err;
    }
    const data = await res.json();
    const hasActions = Array.isArray(data.actions) && data.actions.length > 0;
    const hasClarifications = Boolean(data.clarification)
      || (Array.isArray(data.clarifications) && data.clarifications.length > 0);
    const hasContent = typeof data.content === "string" && data.content.trim().length > 0;
    if (!hasContent && !hasActions && !hasClarifications) {
      const err = new Error("AI service unavailable: backend returned an empty response");
      err.status = 503;
      throw err;
    }
    return {
      content: data.content ?? "",
      actions: data.actions ?? [],
      clarification: data.clarification ?? null,
      clarifications: data.clarifications ?? [],
      model: data.model_used ?? model,
      usage: data.usage ?? null,
      throttled: data.throttled ?? false,
    };
  });
}
