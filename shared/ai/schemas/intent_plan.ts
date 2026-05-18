// Schema for the intent_plan pipeline output tool: make_intent_plan.
// Returned by the 3-pass intent_plan pipeline and executed client-side
// as a batch of add_recurring_event + add_task actions.

import { z } from "zod";
import {
  dateString,
  optionalSubjectString,
  timeString,
  titleLikeString,
  zodToGeminiSchema,
} from "./_helpers.js";
import type { ToolDef } from "../providers/types.js";

const dayEnum = z.enum([
  "Monday", "Tuesday", "Wednesday", "Thursday",
  "Friday", "Saturday", "Sunday",
]);

const blockCategoryEnum = z.enum([
  "school", "swim", "debate", "free time", "sleep", "other",
]);

const RecurringBlockSpecSchema = z.object({
  activity: titleLikeString("activity"),
  days: z.array(dayEnum).min(1),
  start: timeString,
  end: timeString,
  start_date: dateString,
  end_date: dateString,
  category: blockCategoryEnum.optional(),
});

const MilestoneTaskSpecSchema = z.object({
  task_name: titleLikeString("task_name"),
  due_date: dateString,
  subject: optionalSubjectString,
  estimated_minutes: z.number().int().min(5).max(480).optional(),
});

export const MakeIntentPlanSchema = z.object({
  summary: z.string().min(1).max(800),
  recurring_blocks: z.array(RecurringBlockSpecSchema).min(0).max(8),
  milestone_tasks: z.array(MilestoneTaskSpecSchema).min(0).max(20),
  review_cadence: z.object({
    every_n_days: z.number().int().min(1).max(14),
    review_block: RecurringBlockSpecSchema.optional(),
    notes: z.string().max(500).optional(),
  }),
});

export type MakeIntentPlanInput = z.infer<typeof MakeIntentPlanSchema>;
export type RecurringBlockSpec = z.infer<typeof RecurringBlockSpecSchema>;
export type MilestoneTaskSpec = z.infer<typeof MilestoneTaskSpecSchema>;

const MAKE_INTENT_PLAN_DESCRIPTION =
  "Produce a structured intent plan: recurring study/work blocks, milestone tasks, and a review cadence. " +
  "All dates must be real YYYY-MM-DD values. All times must be HH:MM (24h). " +
  "recurring_blocks should map to the student's actual weekly schedule. " +
  "milestone_tasks are the key deliverables that mark progress toward the goal. " +
  "review_cadence describes how often to check in on progress.";

export function buildIntentPlanToolDefs(): ToolDef[] {
  return [
    {
      name: "make_intent_plan",
      description: MAKE_INTENT_PLAN_DESCRIPTION,
      parameters: zodToGeminiSchema(MakeIntentPlanSchema),
    },
  ];
}

export function validateIntentPlan(
  args: unknown
): { ok: true; data: MakeIntentPlanInput } | { ok: false; issues: import("zod").ZodIssue[] } {
  const parsed = MakeIntentPlanSchema.safeParse(args);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, issues: parsed.error.issues };
}
