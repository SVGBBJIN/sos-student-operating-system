-- Study packs: a single object that bundles the generated study artifacts
-- (flashcards + quiz + summary) for one topic, linked to the calendar event
-- and/or tasks it serves. Mirrors the study_plans pattern.

create table if not exists study_packs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  title            text not null,
  subject          text,
  topic            text,
  status           text not null default 'ready',   -- generating|ready|needs_review|mastered|archived
  source_kind      text not null default 'manual',  -- manual|import|event
  artifacts        jsonb not null default '[]',     -- [{kind:'flashcards'|'quiz'|'summary', data}]
  linked_event_id  uuid references events(id) on delete set null,
  mastery          numeric,                          -- 0..1, null until first quiz attempt
  last_reviewed_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index study_packs_user_idx on study_packs(user_id, created_at desc);
create index study_packs_event_idx on study_packs(linked_event_id) where linked_event_id is not null;

alter table study_packs enable row level security;
create policy "study_packs_owner" on study_packs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Link tasks to the study pack they belong to (the source assignment, and any
-- future remediation tasks).
alter table tasks
  add column if not exists study_pack_id uuid references study_packs(id) on delete set null;

create index tasks_study_pack_idx on tasks(study_pack_id) where study_pack_id is not null;
