// Zod schemas for the Studio content-generation tools.

import { z } from "zod";
import type { ToolDef } from "../providers/types.js";
import { zodToGeminiSchema } from "./_helpers.js";

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

export const MakePlanSchema = z.object({
  type: z.literal("make_plan"),
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).optional(),
  steps: z.array(MakePlanStepSchema).min(1).max(40),
});

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
  make_plan: "Create an actionable multi-step plan. Each step is either a 'block' (study/work/break/meal/exercise/gaming/review session, or a timed exam — set kind='block' with date, time, and end_time so it shows on the calendar) or a 'deadline' (a hard due item like an essay or problem set — set kind='deadline' with a date). Default ambiguous steps to 'block' with a sensible time so the week visibly fills in.",
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
