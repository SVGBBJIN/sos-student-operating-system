// Provider registry. Two providers today:
//   - gemini: embeddings + cross-provider chat fallback + image-vision fallback
//   - groq:   chat (gpt-oss-20b/120b) + vision (llama-4-scout)
//
// Each provider reads its own API key from env via getEnv(); callers pass a
// provider name only. The cache prevents recreating provider instances on hot
// paths — keyed by name + key-prefix so a key rotation invalidates cleanly.

import { GeminiProvider } from "./gemini.js";
import { GroqProvider } from "./groq.js";
import { getEnv } from "../../env.js";
import type { LlmProvider } from "./types.js";

export type ProviderName = "gemini" | "groq";

const cache = new Map<string, LlmProvider>();

function envKeyFor(name: ProviderName): string {
  return name === "groq" ? "GROQ_API_KEY" : "GEMINI_API_KEY";
}

export function getProvider(name: ProviderName, apiKeyOverride?: string): LlmProvider {
  const apiKey = apiKeyOverride ?? getEnv(envKeyFor(name));
  if (!apiKey) {
    throw new Error(`${envKeyFor(name)} is not configured`);
  }
  const cacheKey = `${name}:${apiKey.slice(0, 8)}`;
  const existing = cache.get(cacheKey);
  if (existing) return existing;
  let p: LlmProvider;
  switch (name) {
    case "gemini":
      p = new GeminiProvider(apiKey);
      break;
    case "groq":
      p = new GroqProvider(apiKey);
      break;
    default:
      throw new Error(`Unknown provider: ${name as string}`);
  }
  cache.set(cacheKey, p);
  return p;
}

export type { LlmProvider } from "./types.js";
