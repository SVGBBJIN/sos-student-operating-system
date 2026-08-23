-- Student context sources: Canvas (full course depth), linked attachments, and
-- external calendars.
--
-- Until now the LMS layer only modelled *submissions* — the evidence that a
-- student finished something. This migration adds the other half: the course
-- material itself (syllabus, announcements, modules, quizzes, discussions,
-- pages), the documents those materials link to, and structured calendar
-- events from outside the LMS.
--
-- Depends on 20260527_lms_sync.sql (lms_providers/user_integrations/
-- tracked_courses) and 20260514_add_pgvector.sql (memory_embeddings).

-- ── 1. Providers that authenticate with a user-pasted token ──────────────────
-- Canvas OAuth2 requires a developer key issued by the school's Canvas admin,
-- which a student can't obtain on their own. Canvas *does* let any user mint a
-- personal access token from Settings → New Access Token, so that's the path we
-- support. Those providers also need the school's own Canvas hostname.

ALTER TABLE public.lms_providers
  DROP CONSTRAINT IF EXISTS lms_providers_auth_type_check;
ALTER TABLE public.lms_providers
  ADD CONSTRAINT lms_providers_auth_type_check
  CHECK (auth_type IN ('oauth2', 'token', 'none'));

ALTER TABLE public.lms_providers
  ADD COLUMN IF NOT EXISTS requires_instance_url boolean NOT NULL DEFAULT false;

ALTER TABLE public.user_integrations
  ADD COLUMN IF NOT EXISTS instance_url text NULL,
  ADD COLUMN IF NOT EXISTS settings     jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── 2. Course content items ─────────────────────────────────────────────────
-- One row per addressable piece of course material. `body_text` is always
-- plain text (HTML stripped at ingest) so it can be embedded directly.
-- `content_hash` lets a re-sync skip unchanged rows without re-embedding.

CREATE TABLE IF NOT EXISTS public.lms_content_items (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  integration_id      uuid not null references public.user_integrations(id) on delete cascade,
  provider_id         text not null references public.lms_providers(id),
  external_course_id  text not null,
  external_id         text not null,
  kind                text not null check (kind in (
                        'syllabus', 'announcement', 'module', 'module_item',
                        'page', 'quiz', 'discussion', 'assignment',
                        'calendar_event', 'lti_link', 'file'
                      )),
  title               text,
  body_text           text,
  url                 text,
  course_name         text,
  due_at              timestamptz,
  posted_at           timestamptz,
  content_hash        text,
  raw_payload         jsonb not null default '{}'::jsonb,
  fetched_at          timestamptz not null default now(),
  unique (user_id, provider_id, kind, external_id)
);

CREATE INDEX IF NOT EXISTS lms_content_items_user_course_idx
  ON public.lms_content_items (user_id, external_course_id);
CREATE INDEX IF NOT EXISTS lms_content_items_user_due_idx
  ON public.lms_content_items (user_id, due_at) WHERE due_at IS NOT NULL;

ALTER TABLE public.lms_content_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lms_content_items_owner_select" ON public.lms_content_items;
DROP POLICY IF EXISTS "lms_content_items_owner_insert" ON public.lms_content_items;
DROP POLICY IF EXISTS "lms_content_items_owner_update" ON public.lms_content_items;
DROP POLICY IF EXISTS "lms_content_items_owner_delete" ON public.lms_content_items;
CREATE POLICY "lms_content_items_owner_select" ON public.lms_content_items
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "lms_content_items_owner_insert" ON public.lms_content_items
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "lms_content_items_owner_update" ON public.lms_content_items
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "lms_content_items_owner_delete" ON public.lms_content_items
  FOR DELETE USING (auth.uid() = user_id);

-- ── 3. Attachments (one hop from a content item) ────────────────────────────
-- Deliberately one hop only: we follow links found *in* a content item's body
-- or file list, and never follow links found inside an attachment. That bounds
-- the crawl to material a teacher actually attached.
--
-- `status` tracks extraction rather than fetching: 'extracted' means body_text
-- is populated, 'unsupported' means we recognised the type but can't read it
-- (e.g. a scanned PDF with no text layer), 'failed' means fetch/parse errored.

CREATE TABLE IF NOT EXISTS public.lms_attachments (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  content_item_id  uuid references public.lms_content_items(id) on delete cascade,
  provider_id      text,
  source_url       text not null,
  url_hash         text not null,
  title            text,
  mime_type        text,
  byte_size        integer,
  body_text        text,
  status           text not null default 'pending'
                   check (status in ('pending', 'extracted', 'unsupported', 'failed')),
  error            text,
  content_hash     text,
  fetched_at       timestamptz,
  created_at       timestamptz not null default now(),
  unique (user_id, url_hash)
);

CREATE INDEX IF NOT EXISTS lms_attachments_user_status_idx
  ON public.lms_attachments (user_id, status);
CREATE INDEX IF NOT EXISTS lms_attachments_item_idx
  ON public.lms_attachments (content_item_id);

ALTER TABLE public.lms_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "lms_attachments_owner_select" ON public.lms_attachments;
DROP POLICY IF EXISTS "lms_attachments_owner_insert" ON public.lms_attachments;
DROP POLICY IF EXISTS "lms_attachments_owner_update" ON public.lms_attachments;
DROP POLICY IF EXISTS "lms_attachments_owner_delete" ON public.lms_attachments;
CREATE POLICY "lms_attachments_owner_select" ON public.lms_attachments
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "lms_attachments_owner_insert" ON public.lms_attachments
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "lms_attachments_owner_update" ON public.lms_attachments
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "lms_attachments_owner_delete" ON public.lms_attachments
  FOR DELETE USING (auth.uid() = user_id);

-- ── 4. External calendar provenance on events ───────────────────────────────
-- Lets a re-sync update the event it created last time instead of duplicating
-- it, and lets the UI badge an event as mirrored rather than student-authored.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS external_source text NULL,
  ADD COLUMN IF NOT EXISTS external_id     text NULL,
  ADD COLUMN IF NOT EXISTS external_url    text NULL,
  ADD COLUMN IF NOT EXISTS synced_at       timestamptz NULL;

-- Partial unique index: only mirrored events participate, so student-authored
-- rows (both columns null) are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS events_external_ref_idx
  ON public.events (user_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;

-- ── 5. Widen the embedding source enum ──────────────────────────────────────
-- New sources flow through the existing retrieve()/match_memories path with no
-- change to RAG itself.

ALTER TABLE public.memory_embeddings
  DROP CONSTRAINT IF EXISTS memory_embeddings_source_check;
ALTER TABLE public.memory_embeddings
  ADD CONSTRAINT memory_embeddings_source_check
  CHECK (source IN (
    'memory', 'event', 'task', 'note', 'lesson', 'block',
    'flashcard_deck', 'study_plan', 'lms_content', 'attachment'
  ));

-- ── 6. Seed the new providers ───────────────────────────────────────────────
INSERT INTO public.lms_providers
  (id, display_name, mode, auth_type, enabled, requires_instance_url, setup_notes)
VALUES
  ('canvas', 'Canvas', 'pull', 'token', true, true,
   'In Canvas go to Account → Settings → Approved Integrations → + New Access Token, then paste the token and your school''s Canvas web address.'),
  ('gcal', 'Google Calendar', 'pull', 'oauth2', true, false,
   'Read-only. Mirrors events from the calendars you pick into your SOS schedule.')
ON CONFLICT (id) DO UPDATE SET
  display_name          = excluded.display_name,
  mode                  = excluded.mode,
  auth_type             = excluded.auth_type,
  requires_instance_url = excluded.requires_instance_url,
  setup_notes           = excluded.setup_notes;
