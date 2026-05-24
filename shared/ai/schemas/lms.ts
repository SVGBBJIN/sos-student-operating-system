// Validation for events posted by the browser extension to /api/lms-event.
// Not an AI tool — but lives next to the action schemas so we have one place
// to look for "what shapes does the backend accept", and so the version is
// pinned in versions.ts like every other surface.

import { z } from "zod";

const evidenceKindEnum = z.enum([
  "text_indicator",
  "url_state",
  "submission_post",
  "upload",
  "grade_posted",
  "page_visit",
]);

const lmsEnum = z.enum(["classroom", "canvas"]);

// One piece of evidence from a content script. The extension is responsible
// for stripping anything that isn't structurally needed — see
// extension/content/shared/parse.js. `evidence_detail` is small, opaque, and
// stored verbatim for debugging (e.g. the URL pattern that matched).
export const LmsEventSchema = z.object({
  lms: lmsEnum,
  lms_course_id: z.string().max(200).optional(),
  lms_course_name: z.string().max(200).optional(),
  lms_assignment_id: z.string().min(1).max(200),
  lms_assignment_title: z.string().max(500).optional(),
  evidence_kind: evidenceKindEnum,
  evidence_detail: z.record(z.string(), z.unknown()).optional(),
  // ISO 8601. Optional — defaults to server now() if absent. Used for ordering
  // when several events arrive in the same batch.
  occurred_at: z.string().optional(),
});
export type LmsEventInput = z.infer<typeof LmsEventSchema>;

export const LmsEventBatchSchema = z.object({
  events: z.array(LmsEventSchema).min(1).max(50),
});

export function validateLmsEvents(
  raw: unknown
): { ok: true; events: LmsEventInput[] } | { ok: false; issues: z.ZodIssue[] } {
  // Accept either a bare array or { events: [...] } — the extension batches
  // with the wrapped form, manual curl tends to send a bare array.
  const candidate =
    Array.isArray(raw) ? { events: raw }
    : (raw && typeof raw === "object" && "events" in raw) ? raw
    : { events: [] };
  const parsed = LmsEventBatchSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues };
  return { ok: true, events: parsed.data.events };
}
