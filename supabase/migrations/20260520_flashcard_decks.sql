-- Flashcard decks: persist AI-generated and manually created flashcard decks.

create table if not exists flashcard_decks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null,
  summary     text,
  cards       jsonb not null default '[]',   -- [{q: string, a: string}]
  source      text not null default 'manual', -- 'ai' | 'manual'
  card_count  int not null default 0,
  created_at  timestamptz not null default now()
);

create index flashcard_decks_user_idx on flashcard_decks(user_id, created_at desc);

alter table flashcard_decks enable row level security;
create policy "flashcard_decks_owner" on flashcard_decks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
