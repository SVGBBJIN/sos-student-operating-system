-- pgvector + memory embeddings table.
-- Stores 1536-dim vectors from Gemini Embedding 2 (gemini-embedding-002).
-- Supports retrieval over: synthesized memories, events, tasks, notes, lessons.

create extension if not exists vector;

create table if not exists memory_embeddings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  source      text not null check (source in ('memory', 'event', 'task', 'note', 'lesson', 'block')),
  source_id   uuid not null,
  chunk_idx   int not null default 0,
  text        text not null,
  embedding   vector(1536) not null,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, source, source_id, chunk_idx)
);

create index if not exists memory_embeddings_user_source_idx
  on memory_embeddings (user_id, source);

create index if not exists memory_embeddings_metadata_idx
  on memory_embeddings using gin (metadata jsonb_path_ops);

-- IVF flat index for cosine similarity. `lists = 100` is a starting point for
-- ~10-100k rows per user; rebuild with a higher `lists` once the table grows.
create index if not exists memory_embeddings_embedding_idx
  on memory_embeddings using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- RPC: hybrid vector + metadata search. Returns the top match_count rows for
-- the given user, optionally filtered by source list and metadata predicate.
create or replace function match_memories(
  query_embedding   vector(1536),
  user_id_in        uuid,
  match_count       int default 8,
  source_filter     text[] default null,
  metadata_filter   jsonb default null
) returns table (
  id          uuid,
  source      text,
  source_id   uuid,
  text        text,
  similarity  float,
  metadata    jsonb
)
language sql
stable
as $$
  select
    me.id,
    me.source,
    me.source_id,
    me.text,
    1 - (me.embedding <=> query_embedding) as similarity,
    me.metadata
  from memory_embeddings me
  where me.user_id = user_id_in
    and (source_filter is null or me.source = any(source_filter))
    and (metadata_filter is null or me.metadata @> metadata_filter)
  order by me.embedding <=> query_embedding
  limit match_count;
$$;

-- RLS: only the owner can read/write their embeddings.
alter table memory_embeddings enable row level security;

create policy "memory_embeddings_owner_select"
  on memory_embeddings for select
  using (auth.uid() = user_id);

create policy "memory_embeddings_owner_insert"
  on memory_embeddings for insert
  with check (auth.uid() = user_id);

create policy "memory_embeddings_owner_update"
  on memory_embeddings for update
  using (auth.uid() = user_id);

create policy "memory_embeddings_owner_delete"
  on memory_embeddings for delete
  using (auth.uid() = user_id);
