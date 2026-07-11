// Re-exports the unified make_plan schema from studio.ts and provides the IO
// shape for the plan pipeline so callers don't have to reach into multiple
// modules. make_plan now covers explicit multi-step requests, goal-driven
// routines, and brain-dump extraction in one schema — see studio.ts.

export {
  MakePlanSchema,
  MakePlanStepSchema,
  RecurringBlockSpecSchema,
  MilestoneTaskSpecSchema,
  PlanBatchActionSchema,
} from "./studio.js";

import { z } from "zod";

export const PlanningCritiqueSchema = z.object({
  critique: z.string().min(1).max(2000),
});

export type PlanningCritique = z.infer<typeof PlanningCritiqueSchema>;
