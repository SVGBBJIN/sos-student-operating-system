// Lightweight telemetry surface. Two concerns:
//   - in-process counters for token usage and per-tier latency
//   - structured event emission to stdout (consumed by Vercel/Supabase log pipes
//     and forwarded to the prompt_telemetry_logs table)

import { getEnv } from "../env.js";
import type { Intent, Tier } from "./router.js";
import type { TokenUsage } from "./providers/types.js";

// Token pricing (USD per 1k tokens) — keep in lockstep with provider docs.
// Numbers here are estimates used by eval:cost; production accounting still
// reads the actual billing dashboard.
const PRICING = {
  "gemini-3-flash":      { in: 0.00010, out: 0.00040 },
  "gemini-2.5-flash":    { in: 0.00007, out: 0.00030 },
  "gemini-2.5-pro":      { in: 0.00125, out: 0.00500 },
  "gemini-embedding-002":{ in: 0.00001, out: 0 },
} as const;

type PricingKey = keyof typeof PRICING;

export interface RequestTelemetry {
  request_id: string;
  user_id?: string | null;
  intent: Intent;
  tier: Tier;
  model: string;
  fallback_used: boolean;
  attempt_count: number;
  llm_ms: number;
  total_ms: number;
  prompt_tokens?: number;
  output_tokens?: number;
  cached_tokens?: number;
  thinking_tokens?: number;
  prompt_version?: string | null;
  workspace_context?: string | null;
  status: "success" | "error";
  cause_code?: string;
  error?: string;
}

export function estimateCost(model: string, usage: TokenUsage): number {
  const p = PRICING[model as PricingKey];
  if (!p) return 0;
  const inTokens = usage.prompt_tokens ?? 0;
  const outTokens = usage.output_tokens ?? 0;
  return (inTokens / 1000) * p.in + (outTokens / 1000) * p.out;
}

export function emitEvent(event: RequestTelemetry & { cost_usd?: number }): void {
  const enriched = {
    ...event,
    cost_usd: estimateCost(event.model, {
      prompt_tokens: event.prompt_tokens,
      output_tokens: event.output_tokens,
    }),
  };
  // Newline-delimited JSON so log shippers can parse without context.
  console.log("ai_request_event", JSON.stringify(enriched));
}

export async function persistTelemetry(event: RequestTelemetry): Promise<void> {
  emitEvent(event);
  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return;
  try {
    await fetch(`${supabaseUrl}/rest/v1/prompt_telemetry_logs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        request_id: event.request_id,
        user_id: event.user_id ?? null,
        prompt_version: event.prompt_version ?? null,
        workspace_context: event.workspace_context ?? null,
        is_content_gen: event.intent === "studio" || event.intent === "planning",
        latency_ms: event.total_ms,
        ok: event.status === "success",
        error: event.error ?? null,
        created_at: new Date().toISOString(),
      }),
    });
  } catch {
    // Fire-and-forget; never fail a request because telemetry storage stuttered.
  }
}
