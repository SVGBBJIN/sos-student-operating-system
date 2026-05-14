// Tiered Gemini routing. The only place in the codebase that references model strings.
//
// Tier 0 → Gemini Embedding 2 (semantic search, memory, clustering)
// Tier 1 → Gemini 3 Flash (chat, action routing, classification, summarization)
//          In-tier fallback: Gemini 2.5 Flash
// Tier 2 → Gemini 2.5 Pro (planning, deep reasoning, multi-step studio, grounded search)
//          Tier-downgrade fallback: Gemini 3 Flash
//
// Intents map to a Tier. The router never picks a provider — provider selection
// is a separate concern (today: always "gemini"). This keeps fallback to
// alternative providers a small, contained change in the future.

import type { ProviderName } from "./providers/index.js";

export type Tier = "embed" | "flash" | "pro";

export type Intent =
  | "chat"
  | "action_routing"
  | "studio"
  | "planning"
  | "proofread_classify"
  | "proofread_specialist"
  | "search_lesson"
  | "search_reference"
  | "voice"
  | "embed"
  | "summarize"
  | "rerank";

const TIER_BY_INTENT: Record<Intent, Tier> = {
  chat: "flash",
  action_routing: "flash",
  studio: "pro",
  planning: "pro",
  proofread_classify: "flash",
  proofread_specialist: "pro",
  search_lesson: "pro",
  search_reference: "pro",
  voice: "flash",
  embed: "embed",
  summarize: "flash",
  rerank: "flash",
};

const MODEL_BY_TIER: Record<Tier, string> = {
  embed: "gemini-embedding-002",
  flash: "gemini-3-flash",
  pro: "gemini-2.5-pro",
};

const FALLBACK_BY_TIER: Record<Tier, string | null> = {
  embed: null,
  flash: "gemini-2.5-flash",
  pro: "gemini-3-flash",
};

export interface Route {
  intent: Intent;
  tier: Tier;
  model: string;
  fallbackModel: string | null;
  provider: ProviderName;
}

export function route(intent: Intent, tierOverride?: Tier, providerOverride?: ProviderName): Route {
  const tier = tierOverride ?? TIER_BY_INTENT[intent];
  return {
    intent,
    tier,
    model: MODEL_BY_TIER[tier],
    fallbackModel: FALLBACK_BY_TIER[tier],
    provider: providerOverride ?? "gemini",
  };
}

export function modelForTier(tier: Tier): string {
  return MODEL_BY_TIER[tier];
}

export function fallbackForTier(tier: Tier): string | null {
  return FALLBACK_BY_TIER[tier];
}
