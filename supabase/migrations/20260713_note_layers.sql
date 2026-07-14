-- Multi-layer notes: a note becomes a container of layers instead of one text
-- body. Each layer is one imported artifact — freeform text, an imported
-- flashcard set, or an audio/video/image attachment — so mixed-media study
-- material for one note lives in one place. Replaces the standalone
-- flashcard_decks feature (cut alongside studio/grades/study-sets): flashcards
-- are now a layer type scoped to a note rather than a separate top-level
-- object.

create table if not exists public.note_layers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  note_id     uuid not null references public.notes(id) on delete cascade,
  layer_type  text not null check (layer_type in ('text', 'flashcards', 'audio', 'video', 'image')),
  position    int not null default 0,
  -- text layer body, or a caption for media layers
  content     text,
  -- flashcards layer: [{q: string, a: string}]
  cards       jsonb,
  -- audio/video/image layer: storage URL the client already uploaded to
  media_url   text,
  created_at  timestamptz not null default now()
);

create index if not exists note_layers_note_idx on public.note_layers(note_id, position);
create index if not exists note_layers_user_idx on public.note_layers(user_id, created_at desc);

alter table public.note_layers enable row level security;
create policy "note_layers_owner" on public.note_layers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
