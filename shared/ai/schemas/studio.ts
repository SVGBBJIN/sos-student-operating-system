// Zod schemas for the Studio content-generation tools.

import { z } from "zod";
import type { ToolDef } from "../providers/types.js";
import {
  blockCategoryEnum,
  dateString,
  dayEnum,
  optionalSubjectString,
  timeString,
  titleLikeString,
  zodToGeminiSchema,
} from "./_helpers.js";

export const CreateFlashcardsSchema = z.object({
  type: z.literal("create_flashcards"),
  title: z.string().min(1).max(200).optional(),
  summary: z.string().max(2000).optional(),
  cards: z.array(z.object({
    q: z.string().min(1).max(500),
    a: z.string().min(1).max(2000),
  })).min(1).max(40),
});

export const CreateQuizSchema = z.object({
  type: z.literal("create_quiz"),
  title: z.string().min(1).max(200).optional(),
  summary: z.string().max(2000).optional(),
  questions: z.array(z.object({
    q: z.string().min(1).max(500),
    choices: z.array(z.string()).min(2).max(8),
    answer: z.string().min(1).max(500),
    explanation: z.string().max(2000).optional(),
  })).min(1).max(30),
});

export const CreateOutlineSchema = z.object({
  type: z.literal("create_outline"),
  title: z.string().min(1).max(200),
  sections: z.array(z.object({
    heading: z.string().min(1).max(200),
    points: z.array(z.string().min(1).max(500)).min(1),
  })).min(1).max(20),
});

export const CreateSummarySchema = z.object({
  type: z.literal("create_summary"),
  title: z.string().min(1).max(200).optional(),
  bullets: z.array(z.string().min(1).max(500)).min(1).max(20),
});

export const CreateProjectBreakdownSchema = z.object({
  type: z.literal("create_project_breakdown"),
  title: z.string().min(1).max(200),
  phases: z.array(z.object({
    phase: z.string().min(1).max(200),
    deadline: z.string().max(50).optional(),
    tasks: z.array(z.string().min(1).max(500)).min(1),
  })).min(1).max(12),
});

export const MakePlanStepSchema = z.object({
  title: z.string().min(1).max(200),
  // Two calendar categories. "block" = a time commitment that visually appears
  // on the calendar (study sessions, breaks, meals, exercise, gaming, review,
  // and timed exams) — give it date + time (+ end_time). "deadline" = a hard
  // due item with no fixed time (essays, problem sets) — give it date only.
  kind: z.enum(["block", "deadline"]).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  end_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  estimated_minutes: z.number().positive().max(720).optional(),
});

export const RecurringBlockSpecSchema = z.object({
  activity: titleLikeString("activity"),
  days: z.array(dayEnum).min(1),
  start: timeString,
  end: timeString,
  start_date: dateString,
  end_date: dateString,
  category: blockCategoryEnum.optional(),
});

export const MilestoneTaskSpecSchema = z.object({
  task_name: titleLikeString("task_name"),
  due_date: dateString,
  subject: optionalSubjectString,
  estimated_minutes: z.number().int().min(5).max(480).optional(),
});

// batch_actions items mirror the add_task/add_event/add_block action shapes
// (see actions.ts) but are validated independently here rather than reusing
// those schemas directly — they're nested payload objects inside one
// make_plan tool call, not separate tool calls routed through the "action"
// toolset's validator. Reuses the same titleLikeString/optionalSubjectString
// guards as actions.ts so placeholder/instruction-as-title/generic-subject
// values are caught here too, not just on direct add_task/add_event/add_block
// calls.
export const PlanBatchActionSchema = z.object({
  type: z.enum(["add_task", "add_event", "add_block"]),
  title: titleLikeString("title").optional(),
  task_name: titleLikeString("task_name").optional(),
  activity: titleLikeString("activity").optional(),
  date: dateString.optional(),
  due_date: dateString.optional(),
  time: timeString.optional(),
  start: timeString.optional(),
  end: timeString.optional(),
  end_time: timeString.optional(),
  subject: optionalSubjectString,
  category: blockCategoryEnum.optional(),
  estimated_minutes: z.number().int().min(5).max(480).optional(),
  confidence: z.number().min(0).max(1).optional(),
  status: z.enum(["tentative", "confirmed"]).optional(),
  commitment: z.enum(["tentative", "confirmed"]).optional(),
});

// Unified plan output. A single make_plan tool call whose buckets are filled
// according to input_kind: an explicit multi-step request fills `steps`; a
// goal/intent fills `recurring_blocks` + `milestone_tasks` + `review_cadence`;
// a loose brain-dump fills `batch_actions`. Buckets not relevant to the input
// are left empty — renderers branch on which arrays are non-empty rather than
// trusting input_kind strictly, since the model can miscategorize.
export const MakePlanSchema = z.object({
  type: z.literal("make_plan"),
  input_kind: z.enum(["explicit_request", "goal", "brain_dump"]).optional(),
  title: z.string().max(200).optional(),
  summary: z.string().max(2000).optional(),
  steps: z.array(MakePlanStepSchema).max(40).optional().default([]),
  recurring_blocks: z.array(RecurringBlockSpecSchema).max(8).optional().default([]),
  milestone_tasks: z.array(MilestoneTaskSpecSchema).max(20).optional().default([]),
  review_cadence: z.object({
    every_n_days: z.number().int().min(1).max(14),
    review_block: RecurringBlockSpecSchema.optional(),
    notes: z.string().max(500).optional(),
  }).optional(),
  // Capped at 25, not the ~60 a truly enormous dump could contain: the draft/
  // refine passes budget maxOutputTokens: 3000 for the whole make_plan call,
  // which can't reliably fit much more than this many fully-populated items
  // without risking truncated/invalid JSON.
  batch_actions: z.array(PlanBatchActionSchema).max(25).optional().default([]),
}).refine(
  (d) => d.steps.length > 0 || d.recurring_blocks.length > 0 || d.milestone_tasks.length > 0 || d.batch_actions.length > 0,
  { message: "plan must contain at least one step, recurring block, milestone, or extracted item" }
);

export const STUDIO_SCHEMAS = {
  create_flashcards: CreateFlashcardsSchema,
  create_quiz: CreateQuizSchema,
  create_outline: CreateOutlineSchema,
  create_summary: CreateSummarySchema,
  create_project_breakdown: CreateProjectBreakdownSchema,
  make_plan: MakePlanSchema,
} as const;

export type StudioToolName = keyof typeof STUDIO_SCHEMAS;

const STUDIO_DESCRIPTIONS: Record<StudioToolName, string> = {
  create_flashcards: "Create flashcards (question/answer pairs) for study.",
  create_quiz: "Create a multiple-choice quiz with answer key.",
  create_outline: "Create a topic outline with sections and bullet points.",
  create_summary: "Create a concise bullet-point summary.",
  create_project_breakdown: "Break a project into phases with concrete tasks.",
  make_plan: "Create a plan. First decide the input_kind: (1) 'explicit_request' — the student asked for a concrete multi-step plan → fill `steps` (each is 'block': study/work/break/meal/exercise/gaming/review/timed-exam, with date+time+end_time so it shows on the calendar; or 'deadline': a hard due item like an essay, with just a date). (2) 'goal' — the student stated a broader goal or intent ('survive finals week', 'get better at Spanish') → fill `recurring_blocks` (2-5 realistic weekly blocks) + `milestone_tasks` (5-12 concrete deliverables) + `review_cadence`. (3) 'brain_dump' — the student dumped a messy list of tasks/events/things they need to do → fill `batch_actions`, one entry per item, using exact phrasing for titles; mark any item whose date/time was inferred rather than stated with `status:'tentative'`/`commitment:'tentative'` and `confidence` below 0.7, verbatim items get confidence >= 0.85. Only fill the bucket(s) matching the input — leave the others empty.",
};

export function buildStudioToolDefs(): ToolDef[] {
  return (Object.keys(STUDIO_SCHEMAS) as StudioToolName[]).map((name) => ({
    name,
    description: STUDIO_DESCRIPTIONS[name],
    parameters: zodToGeminiSchema(STUDIO_SCHEMAS[name]),
  }));
}

export function validateStudio(name: string, args: unknown):
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; issues: z.ZodIssue[] } {
  const schema = STUDIO_SCHEMAS[name as StudioToolName];
  if (!schema) return { ok: false, issues: [{ code: z.ZodIssueCode.custom, path: [], message: `Unknown studio tool: ${name}` }] };
  const parsed = schema.safeParse(args);
  if (parsed.success) return { ok: true, data: parsed.data as Record<string, unknown> };
  return { ok: false, issues: parsed.error.issues };
}

// Dedicated single-tool toolset for the plan pipeline. Plan drafts used to run
// on the 6-tool "studio" toolset (create_flashcards/create_quiz/etc. all
// alongside make_plan) with toolChoice:"required" — with only one tool in
// play the risk is nil, but with six the model can pick a studio content tool
// instead of make_plan, and the pipeline's fallback (`resp.actions[0]`) would
// silently treat that as the plan proposal. A one-tool toolset makes mis-pick
// impossible.
export function buildPlanToolDefs(): ToolDef[] {
  return [{ name: "make_plan", description: STUDIO_DESCRIPTIONS.make_plan, parameters: zodToGeminiSchema(MakePlanSchema) }];
}

export function validatePlan(name: string, args: unknown):
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; issues: z.ZodIssue[] } {
  if (name !== "make_plan") return { ok: false, issues: [{ code: z.ZodIssueCode.custom, path: [], message: `Unknown plan tool: ${name}` }] };
  const parsed = MakePlanSchema.safeParse(args);
  if (parsed.success) return { ok: true, data: parsed.data as Record<string, unknown> };
  return { ok: false, issues: parsed.error.issues };
}
