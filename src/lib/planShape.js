// make_plan is the unified plan schema — a response can (in principle) have
// more than one bucket populated if the model miscategorizes. This is the
// single place that decides which bucket wins, so every consumer (App.jsx's
// dispatch/apply/format paths, ContentTypeRouter) treats the same plan object
// the same way instead of re-deriving the check with its own priority order.
export function classifyPlanShape(plan) {
  if (!plan) return 'empty';
  if ((plan.batch_actions?.length || 0) > 0) return 'batch';
  if ((plan.recurring_blocks?.length || 0) > 0 || (plan.milestone_tasks?.length || 0) > 0) return 'routine';
  if ((plan.steps?.length || 0) > 0) return 'steps';
  return 'empty';
}
