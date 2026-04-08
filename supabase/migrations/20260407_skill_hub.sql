-- ─── Skill Hub Tables ────────────────────────────────────────────────────────
-- Run this migration in the Supabase SQL editor or via supabase db push.

-- ── skill_hub_sessions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS skill_hub_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users NOT NULL,
  mode            text NOT NULL CHECK (mode IN ('cause-effect','interpretation','study')),
  subject         text,
  linked_task_id  uuid,
  started_at      timestamptz DEFAULT now(),
  ended_at        timestamptz,
  score_correct   int DEFAULT 0,
  score_incorrect int DEFAULT 0,
  hints_used      int DEFAULT 0,
  struggled_topics text[] DEFAULT '{}',
  created_at      timestamptz DEFAULT now()
);

ALTER TABLE skill_hub_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own sessions"
  ON skill_hub_sessions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── lessons ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS lessons (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES auth.users NOT NULL,
  topic             text NOT NULL,
  subject           text,
  mode              text NOT NULL,
  screens           jsonb NOT NULL DEFAULT '[]',
  estimated_minutes int DEFAULT 3,
  status            text DEFAULT 'not_started'
                    CHECK (status IN ('not_started','in_progress','complete')),
  current_screen    int DEFAULT 0,
  score_correct     int DEFAULT 0,
  score_incorrect   int DEFAULT 0,
  source            text DEFAULT 'manual'
                    CHECK (source IN ('manual','struggle','upcoming_test')),
  completed_at      timestamptz,
  created_at        timestamptz DEFAULT now()
);

ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own lessons"
  ON lessons FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── trigger_dismissals ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trigger_dismissals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users NOT NULL,
  task_id      uuid NOT NULL,
  dismissed_at timestamptz DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

ALTER TABLE trigger_dismissals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own dismissals"
  ON trigger_dismissals FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Index for fast dismissal lookup
CREATE INDEX IF NOT EXISTS idx_trigger_dismissals_user_expires
  ON trigger_dismissals (user_id, expires_at);

-- Index for session history
CREATE INDEX IF NOT EXISTS idx_skill_hub_sessions_user_created
  ON skill_hub_sessions (user_id, created_at DESC);

-- Index for lesson lookup
CREATE INDEX IF NOT EXISTS idx_lessons_user_created
  ON lessons (user_id, created_at DESC);
