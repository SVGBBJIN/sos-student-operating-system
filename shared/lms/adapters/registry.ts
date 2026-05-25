// The one place that maps provider id → adapter. Adding a new pull LMS means
// dropping a file in this directory and adding a line here.
//
// Extension-scraped providers (Schoology) don't need an adapter entry — they
// POST scraped data directly to api/lms-ingest.

import type { LMSAdapter, PullAdapter } from "./types.js";
import { classroomAdapter } from "./classroom.js";

export const registry: Record<string, LMSAdapter> = {
  classroom: classroomAdapter,
};

export function getAdapter(providerId: string): LMSAdapter | null {
  return registry[providerId] ?? null;
}

export function getPullAdapter(providerId: string): PullAdapter | null {
  const a = registry[providerId];
  return a && a.mode === "pull" ? a : null;
}
