-- Study attempts: an append-only log of every study-pack quiz attempt, so the
-- adaptive layer can see per-topic performance trends (not just the latest
-- score, which lives on study_packs.mastery).

create table if not exists study_attempts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  study_pack_id uuid references study_packs(id) on delete set null,
  topic         text,
  subject       text,
  correct       int not null default 0,
  total         int not null default 0,
  mastery       numeric not null default 0,   -- correct/total, 0..1
  attempted_at  timestamptz not null default now()
);

create index study_attempts_user_topic_idx on study_attempts(user_id, topic, attempted_at desc);
create index study_attempts_user_recent_idx on study_attempts(user_id, attempted_at desc);

alter table study_attempts enable row level security;
create policy "study_attempts_owner" on study_attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
