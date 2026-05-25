-- Server-side submission tracking sync.
--
-- Complements the browser-extension evidence pipeline (20260524_lms_submissions.sql)
-- with active sync against LMS APIs (pull mode) and extension-scraped ingest
-- (extension mode via api/lms-ingest). Both paths write to the same `submissions`
-- table and auto-close any linked open task.
--
-- Tables:
--   lms_providers      — catalog of supported LMSs; rows pre-seeded
--   user_integrations  — per-user OAuth tokens
--   tracked_courses    — courses the user wants synced
--   submissions        — normalized submission records (raw payload preserved)

create table if not exists lms_providers (
  id            text primary key,
  display_name  text not null,
  mode          text not null check (mode in ('pull','extension')),
  auth_type     text not null check (auth_type in ('oauth2','none')),
  enabled       boolean not null default true,
  setup_notes   text,
  created_at    timestamptz not null default now()
);

alter table lms_providers enable row level security;
drop policy if exists "lms_providers_world_select" on lms_providers;
create policy "lms_providers_world_select" on lms_providers
  for select using (true);

create table if not exists user_integrations (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  provider_id       text not null references lms_providers(id),
  access_token      text,
  refresh_token     text,
  token_expires_at  timestamptz,
  external_user_id  text,
  status            text not null default 'active'
                    check (status in ('active','pending','revoked','error')),
  last_sync_at      timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, provider_id)
);

alter table user_integrations enable row level security;
drop policy if exists "user_integrations_owner_select" on user_integrations;
drop policy if exists "user_integrations_owner_insert" on user_integrations;
drop policy if exists "user_integrations_owner_update" on user_integrations;
drop policy if exists "user_integrations_owner_delete" on user_integrations;
create policy "user_integrations_owner_select" on user_integrations
  for select using (auth.uid() = user_id);
create policy "user_integrations_owner_insert" on user_integrations
  for insert with check (auth.uid() = user_id);
create policy "user_integrations_owner_update" on user_integrations
  for update using (auth.uid() = user_id);
create policy "user_integrations_owner_delete" on user_integrations
  for delete using (auth.uid() = user_id);

create table if not exists tracked_courses (
  id                  uuid primary key default gen_random_uuid(),
  integration_id      uuid not null references user_integrations(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  external_course_id  text not null,
  course_name         text,
  enabled             boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (integration_id, external_course_id)
);

create index if not exists tracked_courses_enabled_idx
  on tracked_courses (integration_id) where enabled;

alter table tracked_courses enable row level security;
drop policy if exists "tracked_courses_owner_select" on tracked_courses;
drop policy if exists "tracked_courses_owner_insert" on tracked_courses;
drop policy if exists "tracked_courses_owner_update" on tracked_courses;
drop policy if exists "tracked_courses_owner_delete" on tracked_courses;
create policy "tracked_courses_owner_select" on tracked_courses
  for select using (auth.uid() = user_id);
create policy "tracked_courses_owner_insert" on tracked_courses
  for insert with check (auth.uid() = user_id);
create policy "tracked_courses_owner_update" on tracked_courses
  for update using (auth.uid() = user_id);
create policy "tracked_courses_owner_delete" on tracked_courses
  for delete using (auth.uid() = user_id);

create table if not exists submissions (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  integration_id          uuid not null references user_integrations(id) on delete cascade,
  provider_id             text not null references lms_providers(id),
  external_course_id      text not null,
  external_assignment_id  text not null,
  external_submission_id  text not null,
  assignment_title        text,
  state                   text check (state in ('submitted','graded','returned','missing','draft')),
  submitted_at            timestamptz,
  graded_at               timestamptz,
  grade                   numeric,
  url                     text,
  task_id                 uuid references tasks(id) on delete set null,
  raw_payload             jsonb not null,
  source                  text not null check (source in ('pull','extension')),
  fetched_at              timestamptz not null default now(),
  unique (user_id, provider_id, external_submission_id)
);

create index if not exists submissions_user_fetched_idx
  on submissions (user_id, fetched_at desc);
create index if not exists submissions_user_assignment_idx
  on submissions (user_id, external_assignment_id);

alter table submissions enable row level security;
drop policy if exists "submissions_owner_select" on submissions;
drop policy if exists "submissions_owner_insert" on submissions;
drop policy if exists "submissions_owner_update" on submissions;
create policy "submissions_owner_select" on submissions
  for select using (auth.uid() = user_id);
create policy "submissions_owner_insert" on submissions
  for insert with check (auth.uid() = user_id);
create policy "submissions_owner_update" on submissions
  for update using (auth.uid() = user_id);

-- Seed providers. Schoology is extension mode (no API key or admin needed) but
-- starts disabled until the browser extension is available.
insert into lms_providers (id, display_name, mode, auth_type, enabled, setup_notes) values
  ('classroom', 'Google Classroom', 'pull',      'oauth2', true,  null),
  ('schoology', 'Schoology',        'extension', 'none',   false, null)
on conflict (id) do nothing;
