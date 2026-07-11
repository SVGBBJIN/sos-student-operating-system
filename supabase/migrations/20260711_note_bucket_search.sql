-- Note bucket + search: replace the CHAT_SAVE_PREFIX naming convention with a
-- real `type` column on notes, and widen the memory_embeddings source enum so
-- flashcard decks and study plans can be indexed for semantic search
-- alongside notes/tasks/events/blocks/lessons.
--
-- Depends on 20260514_add_pgvector.sql (memory_embeddings) and
-- 20260508_notes_hierarchy.sql (notes.parent_id/is_folder) having already run.

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'note';

ALTER TABLE public.notes
  DROP CONSTRAINT IF EXISTS notes_type_check;
ALTER TABLE public.notes
  ADD CONSTRAINT notes_type_check CHECK (type IN ('note', 'saved_chat'));

-- One-time backfill: rows created under the old naming convention.
UPDATE public.notes
  SET type = 'saved_chat'
  WHERE type = 'note' AND name LIKE '[chat-save]%';

CREATE INDEX IF NOT EXISTS notes_user_type_idx ON public.notes (user_id, type);

ALTER TABLE public.memory_embeddings
  DROP CONSTRAINT IF EXISTS memory_embeddings_source_check;
ALTER TABLE public.memory_embeddings
  ADD CONSTRAINT memory_embeddings_source_check
  CHECK (source IN ('memory', 'event', 'task', 'note', 'lesson', 'block', 'flashcard_deck', 'study_plan'));
