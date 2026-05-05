/**
 * aiClient — client-side abstraction over the SOS backend AI endpoint.
 *
 * Model is chosen per-user via the ModelSelect dropdown and persisted in
 * localStorage. The selected model is forwarded as `preferredModel`; the
 * backend validates it against the allowed set and falls back to MODEL_DEEP
 * if unrecognised.
 */

import { EDGE_FN_URL, SUPABASE_ANON_KEY } from "./supabase.js";
import { retryAI } from "./retryAI.js";

const MODEL_KEY = "sos_preferred_model";
export const MODEL_DEEP = "openai/gpt-oss-120b";
export const MODEL_FAST = "openai/gpt-oss-20b";

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
