// Provider registry. Single entry today (Gemini); the seam exists so additional
// providers can be added without touching callsites.

import { GeminiProvider } from "./gemini.js";
import type { LlmProvider } from "./types.js";

export type ProviderName = "gemini";

const cache = new Map<string, LlmProvider>();

export function getProvider(name: ProviderName, apiKey: string): LlmProvider {
  const key = `${name}:${apiKey.slice(0, 8)}`;
  const existing = cache.get(key);
  if (existing) return existing;
  let p: LlmProvider;
  switch (name) {
    case "gemini":
      p = new GeminiProvider(apiKey);
      break;
    default:
      throw new Error(`Unknown provider: ${name as string}`);
  }
  cache.set(key, p);
  return p;
}

export type { LlmProvider } from "./types.js";
