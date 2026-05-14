/**
 * aiClient — client-side abstraction over the SOS backend AI endpoint.
 *
 * In the Gemini-native architecture the server picks the tier (Flash/Pro) based
 * on intent. The client previously forwarded MODEL_DEEP/MODEL_FAST; that's gone.
 * `getPreferredModel`/`setPreferredModel` are kept as no-op stubs so existing
 * call sites keep compiling — they return tier hints ("flash" | "pro") that the
 * server may honor as a `tierOverride`.
 */

import { EDGE_FN_URL, SUPABASE_ANON_KEY } from "./supabase.js";
import { retryAI } from "./retryAI.js";

const MODEL_KEY = "sos_preferred_tier";

// Back-compat stubs. The client used to expose model strings; the new system
// uses tier hints. These exports keep import sites green while the codebase
// finishes migrating to tier-based routing.
export const MODEL_DEEP = "pro";
export const MODEL_FAST = "flash";

export function getPreferredModel() {
  try { return localStorage.getItem(MODEL_KEY) || MODEL_DEEP; }
  catch (_) { return MODEL_DEEP; }
}

export function setPreferredModel(tier) {
  try { localStorage.setItem(MODEL_KEY, tier); } catch (_) {}
}

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

  const tier = preferredModel || getPreferredModel();

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
    tierOverride: tier === MODEL_DEEP || tier === MODEL_FAST ? tier : undefined,
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
      model: data.model_used ?? null,
      usage: data.usage ?? null,
      throttled: data.throttled ?? false,
    };
  });
}
