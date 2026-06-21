// Zod schemas for the Hint & Work-Check tools.
//
// Two surfaces, one system:
//   make_clue       — the forward "clue": one hint tuned to get the student to a
//                     checkable attempt, NOT to solve the problem.
//   make_work_check — the backward "check": evaluates the student's own work and
//                     surfaces the weakest joints as cards. Never rewrites it
//                     (except the grammar lane), never predicts a grade.
//
// The shapes here are intentionally permissive on counts — the deterministic
// rules in shared/coaching/workcheck.ts do the final shaping (≤5 cards, ≤3
// gaps, coverage clamp, confidence gating) so the invariants hold no matter
// what the model returns.

import { z } from "zod";
import type { ToolDef } from "../providers/types.js";
import { zodToGeminiSchema } from "./_helpers.js";

const contentTypeEnum = z.enum(["procedure", "fact", "argument"]);

// ── The clue (forward) ───────────────────────────────────────────────────────
export const MakeClueSchema = z.object({
  type: z.literal("make_clue"),
  content_type: contentTypeEnum,
  // One clue. "Enough to attempt", not "enough to solve".
  clue: z.string().min(1).max(1200),
  // "Still stuck" never yields a second clue — it routes the student to put down
  // an attempt and run the check. This is that routing line.
  next_if_stuck: z.string().min(1).max(400),
  // For facts: the check pairs the answer with a comprehension question. The
  // clue may seed that adjacent-understanding angle.
  comprehension_angle: z.string().max(400).optional(),
  // Deep fallback — offered ONLY when the clue produced no attempt at all: a
  // parallel problem with different numbers/setup to re-derive. The original
  // answer is never auto-revealed.
  deep_fallback: z
    .object({
      parallel_problem: z.string().min(1).max(1200),
    })
    .optional(),
});
export type MakeClueInput = z.infer<typeof MakeClueSchema>;

// ── The check (backward) ─────────────────────────────────────────────────────
const checkCardSchema = z.object({
  // Strengths first by convention; ordering is re-enforced downstream.
  kind: z.enum(["strength", "gap"]),
  // structural = binary, safe to check off (thesis present? correct step?).
  // qualitative = never a checkbox; delivered as a question.
  criterion_kind: z.enum(["structural", "qualitative"]).optional(),
  // grammar/flow is the ONLY lane allowed to just-fix; everything else points.
  lane: z.enum(["content", "grammar"]).optional(),
  // Strength: what's working. Gap: an interrogative pointing at the weak joint
  // (or a direct fix in the grammar lane). Never rewrites the student's prose.
  text: z.string().min(1).max(800),
  // Only meaningful for structural criteria — feeds the coverage count.
  addressed: z.boolean().optional(),
  // Confidence-gate: below threshold the gap is hedged as a question.
  confidence: z.number().min(0).max(1).optional(),
  // Unverifiable-from-text criterion the student must confirm ("your teacher
  // checks this"). Never feeds the coverage count.
  self_attest: z.boolean().optional(),
});

export const MakeWorkCheckSchema = z.object({
  type: z.literal("make_work_check"),
  content_type: contentTypeEnum,
  // Up to 8 raw; the normalizer trims to ≤5 (≤3 gaps), strengths first.
  cards: z.array(checkCardSchema).min(1).max(8),
  // The model's count of text-verifiable structural criteria it checked. Clamped
  // to ≤5 downstream. Never a score, never a grade.
  coverage_total: z.number().int().min(1).max(5).optional(),
  // Where the rubric came from. A pasted rubric/prompt OVERRIDES internal
  // criteria (paste wins, doesn't just append).
  rubric_source: z.enum(["pasted", "internal"]),
  // True when no rubric was present — the UI gently nudges the student to paste.
  needs_rubric_nudge: z.boolean().optional(),
  // The class of error (e.g. "sign error in the algebra step", "claim not tied
  // to evidence") — never a confident assertion that a specific line is wrong.
  error_class: z.string().max(300).optional(),
  // At the terminal/final stage only: a missing structural element surfaced once
  // as a gentle question ("no conclusion yet — on purpose?").
  unwritten_note: z.string().max(300).optional(),
});
export type MakeWorkCheckInput = z.infer<typeof MakeWorkCheckSchema>;

export const COACHING_SCHEMAS = {
  make_clue: MakeClueSchema,
  make_work_check: MakeWorkCheckSchema,
} as const;

export type CoachingToolName = keyof typeof COACHING_SCHEMAS;

const COACHING_DESCRIPTIONS: Record<CoachingToolName, string> = {
  make_clue:
    "Give ONE forward clue that gets the student to a checkable attempt — never " +
    "enough to solve it for them. Route by content_type: procedures → point at " +
    "the method/first move; facts → nudge toward recall plus the adjacent idea; " +
    "arguments → point at the move the claim needs. next_if_stuck must NOT be a " +
    "second clue — it routes them to put down an attempt and run the check. Only " +
    "fill deep_fallback (a parallel problem) when the student produced no attempt " +
    "at all. Draw on general method, not the student's saved notes.",
  make_work_check:
    "Evaluate the student's OWN work against a common-sense rubric for that " +
    "content_type and surface only the highest-leverage spots as cards: " +
    "strengths first, then at most 3 gaps, never padded to a quota. A pasted " +
    "rubric/prompt OVERRIDES your internal criteria. Mark structural criteria " +
    "(thesis present? correct step?) as addressed true/false; deliver qualitative " +
    "ones ('compelling?') as questions, never checkboxes. Argument gaps are " +
    "interrogative — point at the weak joint, don't prescribe the fix. Grammar/" +
    "flow is the only lane allowed to just-fix. State the CLASS of error, not a " +
    "confident claim that a specific line is wrong; hedge low-confidence gaps as " +
    "questions. Never rewrite the prose, never predict or imply a grade.",
};

export function buildCoachingToolDefs(): ToolDef[] {
  return (Object.keys(COACHING_SCHEMAS) as CoachingToolName[]).map((name) => ({
    name,
    description: COACHING_DESCRIPTIONS[name],
    parameters: zodToGeminiSchema(COACHING_SCHEMAS[name]),
  }));
}

export function validateCoaching(name: string, args: unknown):
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; issues: z.ZodIssue[] } {
  const schema = COACHING_SCHEMAS[name as CoachingToolName];
  if (!schema) return { ok: false, issues: [{ code: z.ZodIssueCode.custom, path: [], message: `Unknown coaching tool: ${name}` }] };
  const parsed = schema.safeParse(args);
  if (parsed.success) return { ok: true, data: parsed.data as Record<string, unknown> };
  return { ok: false, issues: parsed.error.issues };
}
