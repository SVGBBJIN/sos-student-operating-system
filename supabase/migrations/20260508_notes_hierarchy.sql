-- Add hierarchy + folder support to notes so projects and notes share one tree.
--
-- A row with `is_folder = true` is a folder ("project"). A row with
-- `is_folder = false` is a leaf note (current default behavior). Both can
-- live at the root (parent_id IS NULL) or inside another folder.
--
-- This migration is purely additive — existing rows become root-level notes
-- with no parent and is_folder = false.

ALTER TABLE public.notes
  ADD COLUMN IF NOT EXISTS parent_id   uuid REFERENCES public.notes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_folder   boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS notes_user_parent_idx
  ON public.notes (user_id, parent_id);

CREATE INDEX IF NOT EXISTS notes_user_folder_idx
  ON public.notes (user_id, is_folder)
  WHERE is_folder = true;
