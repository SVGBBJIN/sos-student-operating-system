-- Study plans: persist intent-plan proposals so they can be recalled,
-- tracked for progress, and revised via the AI pipeline.

create table if not exists study_plans (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  title               text not null,
  status              text not null default 'active',   -- 'active' | 'archived'
  plan_json           jsonb not null,                   -- full MakeIntentPlanInput payload
  total_tasks         int not null default 0,
  applied_at          timestamptz,
  review_cadence_days int,
  created_at          timestamptz not null default now()
);

create index study_plans_user_idx on study_plans(user_id, created_at desc);

alter table study_plans enable row level security;
create policy "study_plans_owner" on study_plans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Link tasks back to the plan that generated them for progress tracking.
alter table tasks
  add column if not exists study_plan_id uuid references study_plans(id) on delete set null;

create index tasks_study_plan_idx on tasks(study_plan_id) where study_plan_id is not null;
