// Re-exports the make_plan schema from studio.ts and provides the IO shape for
// the planning pipeline so callers don't have to reach into multiple modules.

export { MakePlanSchema, MakePlanStepSchema } from "./studio.js";

import { z } from "zod";

export const PlanningCritiqueSchema = z.object({
  critique: z.string().min(1).max(2000),
});

export type PlanningCritique = z.infer<typeof PlanningCritiqueSchema>;
