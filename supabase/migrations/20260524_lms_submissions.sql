-- Dynamic submission tracking. Browser extension parses Google Classroom and
-- Canvas pages locally and posts structured evidence here; the backend confidence
-- engine replays evidence per assignment and flips matching tasks to done when
-- the score crosses 85.
--
-- Three pieces:
--   1. lms_submission_events — append-only evidence log
--   2. tasks columns — completion_source, completion_confidence, lms_assignment_ref
--   3. unique-ish dedupe + lookup indexes

create table if not exists lms_submission_events (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  task_id               uuid references tasks(id) on delete set null,
  lms                   text not null check (lms in ('classroom', 'canvas')),
  lms_course_id         text,
  lms_assignment_id     text not null,
  lms_assignment_title  text,
  evidence_kind         text not null check (evidence_kind in (
    'text_indicator', 'url_state', 'submission_post', 'upload', 'grade_posted', 'page_visit'
  )),
  evidence_weight       int  not null,
  evidence_detail       jsonb not null default '{}',
  confidence_after      int  not null,
  occurred_at           timestamptz not null default now()
);

-- Per-user lookup by assignment for replay scoring.
create index if not exists lms_events_user_assignment_idx
  on lms_submission_events (user_id, lms, lms_assignment_id, occurred_at);

-- Soft dedupe: same evidence kind for the same assignment in the same second
-- (rapid MutationObserver fires) collapses into one row.
create unique index if not exists lms_events_dedupe_idx
  on lms_submission_events (
    user_id, lms, lms_assignment_id, evidence_kind, date_trunc('second', occurred_at)
  );

alter table lms_submission_events enable row level security;

create policy "lms_events_owner_select" on lms_submission_events
  for select using (auth.uid() = user_id);
create policy "lms_events_owner_insert" on lms_submission_events
  for insert with check (auth.uid() = user_id);

-- Tasks: where did the completion come from, how confident were we, and which
-- LMS assignment is this task bound to (for re-matching after a rename).
alter table tasks
  add column if not exists completion_source     text,
  add column if not exists completion_confidence int,
  add column if not exists lms_assignment_ref    jsonb;

alter table tasks
  drop constraint if exists tasks_completion_source_check;
alter table tasks
  add  constraint tasks_completion_source_check
    check (completion_source is null or completion_source in ('manual', 'ai', 'lms'));

-- Keep the open-task scan the matcher does cheap.
create index if not exists tasks_user_open_idx
  on tasks (user_id) where status <> 'done';
