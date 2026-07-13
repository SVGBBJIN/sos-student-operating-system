// Tiered routing. The only place in the codebase that references model strings.
//
// Tier 0 (embed) → Gemini Embedding 2 (semantic search, memory, clustering).
//                  Stays on Gemini; Groq does not offer hosted embeddings.
// Tier 1 (flash) → Groq GPT-OSS-20B (chat, action routing, classification,
//                  summarization). Cross-provider fallback: Gemini 2.5 Flash.
// Tier 2 (pro)   → Groq GPT-OSS-120B (plan, work_check, deep reasoning).
//                  Cross-provider fallback: Gemini 2.5 Pro.
//
// Intents map to a Tier; per-tier provider selection lives in PROVIDER_BY_TIER.
// The router does not pick a model for the vision path (image-bearing chat) —
// that override lives in chat-core.ts where request payload is visible.
//
// Voice transcription is no longer a chat intent; it routes directly to the
// dedicated voice helper (shared/ai/voice.ts → Groq Whisper).

import { getEnv } from "../env.js";
import type { ProviderName } from "./providers/index.js";

export type Tier = "embed" | "flash" | "pro";

export type Intent =
  | "chat"
  | "action_routing"
  | "plan"
  | "clue"
  | "work_check"
  | "embed";

const TIER_BY_INTENT: Record<Intent, Tier> = {
  chat: "flash",
  action_routing: "flash",
  // Unified plan pipeline (explicit request / goal / brain-dump). Runs on Pro
  // uniformly — brain-dump-shaped inputs used to run cheaper on Flash via
  // action_routing; revisit with a lightweight pre-classifier if cost/latency
  // regresses now that they share this intent.
  plan: "pro",
  // The forward clue is a light, single-shot hint — Flash is plenty. The
  // backward check is the deep-reasoning surface (localizing the broken step /
  // weak claim against a rubric) — it needs Pro.
  clue: "flash",
  work_check: "pro",
  embed: "embed",
};

const MODEL_BY_TIER: Record<Tier, string> = {
  embed: "gemini-embedding-002",
  flash: "openai/gpt-oss-20b",
  pro: "openai/gpt-oss-120b",
};

// Two embedding models share the work so we double the request budget (the
// scarce resource: 100 RPM / 1k RPD per model, vs. abundant 30K TPM).
//   - primary   → the persisted RAG/memory store. Its vectors must all live in
//                 one model's space, so retrieval + upserts stay pinned here.
//   - secondary → ephemeral, self-contained similarity (e.g. name grounding,
//                 which embeds both sides in the same request and never compares
//                 against the persisted store). Free to use the other model, so
//                 it never spends the primary's budget.
const EMBED_MODELS = {
  primary: "gemini-embedding-002",
  secondary: "gemini-embedding-001",
} as const;

export type EmbedRole = keyof typeof EMBED_MODELS;

export function embedModel(role: EmbedRole = "primary"): string {
  return EMBED_MODELS[role];
}

// Cross-provider fallback: when the Groq primary fails, fall back to the
// equivalent Gemini model. Embed has no fallback (single provider).
const FALLBACK_BY_TIER: Record<Tier, string | null> = {
  embed: null,
  flash: "gemini-2.5-flash",
  pro: "gemini-2.5-pro",
};

const PROVIDER_BY_TIER: Record<Tier, ProviderName> = {
  embed: "gemini",
  flash: "groq",
  pro: "groq",
};

const FALLBACK_PROVIDER_BY_TIER: Record<Tier, ProviderName | null> = {
  embed: null,
  flash: "gemini",
  pro: "gemini",
};

// Emergency rollback lever: when AI_PROVIDER_OVERRIDE === "gemini", route
// everything (except embed, which is already Gemini) to Gemini and disable the
// cross-provider fallback hop. Toggled via env var, no redeploy needed.
function applyOverride(): { provider: Record<Tier, ProviderName>; fallback: Record<Tier, ProviderName | null>; model: Record<Tier, string>; fallbackModel: Record<Tier, string | null> } {
  if (getEnv("AI_PROVIDER_OVERRIDE") === "gemini") {
    // Rollback: route everything to Gemini, restore the original intra-Gemini
    // model fallback (pro → 2.5-flash, flash → 2.5-flash).
    return {
      provider: { embed: "gemini", flash: "gemini", pro: "gemini" },
      fallback: { embed: null, flash: "gemini", pro: "gemini" },
      model:    { embed: "gemini-embedding-002", flash: "gemini-2.5-flash", pro: "gemini-2.5-pro" },
      fallbackModel: { embed: null, flash: "gemini-2.5-flash", pro: "gemini-2.5-flash" },
    };
  }
  return {
    provider: PROVIDER_BY_TIER,
    fallback: FALLBACK_PROVIDER_BY_TIER,
    model: MODEL_BY_TIER,
    fallbackModel: FALLBACK_BY_TIER,
  };
}

export interface Route {
  intent: Intent;
  tier: Tier;
  model: string;
  fallbackModel: string | null;
  provider: ProviderName;
  fallbackProvider: ProviderName | null;
}

export function route(intent: Intent, tierOverride?: Tier, providerOverride?: ProviderName): Route {
  const tier = tierOverride ?? TIER_BY_INTENT[intent];
  const cfg = applyOverride();
  return {
    intent,
    tier,
    model: cfg.model[tier],
    fallbackModel: cfg.fallbackModel[tier],
    provider: providerOverride ?? cfg.provider[tier],
    fallbackProvider: providerOverride ? null : cfg.fallback[tier],
  };
}
