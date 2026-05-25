// Schema versions per surface. Bump when the shape of an action/payload changes
// in a non-backward-compatible way so the client can refuse stale responses.

export const SCHEMA_VERSIONS = {
  action_tools: "v7-2026-05",
  studio_tools: "v3-2026-05",
  planning: "v2-2026-05",
  proofread: "v2-2026-05",
  intent_plan: "v1-2026-05",
  study_pack: "v1-2026-05",
  reference_search: "v1-2026-05",
  lesson_search: "v1-2026-05",
  lms_event: "v1-2026-05",
} as const;

export type SchemaSurface = keyof typeof SCHEMA_VERSIONS;
