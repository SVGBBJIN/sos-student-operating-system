-- Behavioral telemetry: one row per task/event state transition.
-- Provides the signal foundation for the priority engine and future
-- smart scheduling features (recovery, friction detection, etc.).

create type task_event_type as enum
  ('status_change', 'postpone', 'abandon', 'retry', 'complete', 'create', 'delete');

create table if not exists task_events (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  task_id      uuid references tasks(id) on delete cascade,
  event_id     uuid references events(id) on delete cascade,
  event_type   task_event_type not null,
  from_status  text,
  to_status    text,
  occurred_at  timestamptz not null default now(),
  metadata     jsonb not null default '{}',
  -- exactly one of task_id or event_id must be set
  check ((task_id is not null) <> (event_id is not null))
);

create index task_events_user_time_idx on task_events(user_id, occurred_at desc);
create index task_events_user_type_idx on task_events(user_id, event_type);
create index task_events_task_idx      on task_events(task_id) where task_id is not null;

alter table task_events enable row level security;
create policy "task_events_owner_select" on task_events
  for select using (auth.uid() = user_id);
create policy "task_events_owner_insert" on task_events
  for insert with check (auth.uid() = user_id);

-- Hot behavioral signals denormalized onto tasks to avoid per-turn GROUP-BY.
alter table tasks
  add column if not exists completed_at      timestamptz,
  add column if not exists postpone_count    int not null default 0,
  add column if not exists last_attempted_at timestamptz;

-- Fix: analytics_events is referenced in src/lib/analytics.js but was never
-- included in any migration. The schema must match what analytics.js expects.
create table if not exists analytics_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  event_type  text not null,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists idx_analytics_user on analytics_events(user_id);
create index if not exists idx_analytics_type on analytics_events(event_type);

alter table analytics_events enable row level security;
create policy "analytics_events_owner_insert" on analytics_events
  for insert with check (auth.uid() = user_id);
