CREATE TABLE IF NOT EXISTS grades (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject     TEXT        NOT NULL,
  assignment  TEXT        NOT NULL,
  grade       NUMERIC(5,2) NOT NULL CHECK (grade >= 0 AND grade <= 100),
  grade_type  TEXT        NOT NULL DEFAULT 'other'
                          CHECK (grade_type IN ('exam','quiz','homework','project','other')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE grades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users own their grades"
  ON grades FOR ALL
  USING (auth.uid() = user_id);

CREATE INDEX grades_user_subject_idx ON grades(user_id, subject);
CREATE INDEX grades_user_created_idx ON grades(user_id, created_at);
