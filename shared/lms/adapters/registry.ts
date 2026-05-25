// The one place that maps provider id → adapter. Adding a new LMS means
// dropping a file in this directory and adding a line here.

import type { LMSAdapter, PullAdapter, PushAdapter } from "./types.js";
import { classroomAdapter } from "./classroom.js";
import { schoologyAdapter } from "./schoology.js";

export const registry: Record<string, LMSAdapter> = {
  classroom: classroomAdapter,
  schoology: schoologyAdapter,
};

export function getAdapter(providerId: string): LMSAdapter | null {
  return registry[providerId] ?? null;
}

export function getPullAdapter(providerId: string): PullAdapter | null {
  const a = registry[providerId];
  return a && a.mode === "pull" ? a : null;
}

export function getPushAdapter(providerId: string): PushAdapter | null {
  const a = registry[providerId];
  return a && a.mode === "push" ? a : null;
}
