-- Internal adaptive calendar: persisted suggestions from
-- shared/scheduling/adaptive-calendar.ts. This runs regardless of whether the
-- user-facing calendar panel is toggled on (see the `calendarEnabled` client
-- setting) — the calendar becomes an optional VIEW, but the underlying
-- scheduling engine that feeds the priority engine and plan pipeline never
-- turns off.

create table if not exists public.adaptive_calendar_adjustments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  block_id        uuid not null,
  current_start   text not null,
  suggested_start text,
  confidence      numeric not null default 0,
  reason          text,
  status          text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  created_at      timestamptz not null default now()
);

create index if not exists adaptive_calendar_adjustments_user_idx
  on public.adaptive_calendar_adjustments(user_id, created_at desc);
create index if not exists adaptive_calendar_adjustments_block_idx
  on public.adaptive_calendar_adjustments(block_id);

alter table public.adaptive_calendar_adjustments enable row level security;
create policy "adaptive_calendar_adjustments_owner" on public.adaptive_calendar_adjustments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
