// Schema versions per surface. Bump when the shape of an action/payload changes
// in a non-backward-compatible way so the client can refuse stale responses.

export const SCHEMA_VERSIONS = {
  action_tools: "v7-2026-05",
  // Bumped: make_plan is now the unified superset schema (steps + recurring_blocks
  // + milestone_tasks + review_cadence + batch_actions), replacing the separate
  // planning/intent_plan pipelines.
  studio_tools: "v5-2026-07",
  coaching: "v2-2026-07",
  reference_search: "v1-2026-05",
  lesson_search: "v1-2026-05",
  lms_event: "v1-2026-05",
} as const;

export type SchemaSurface = keyof typeof SCHEMA_VERSIONS;
