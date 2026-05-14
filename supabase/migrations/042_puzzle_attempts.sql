-- Migration 042: PRD-0004 Slice 2 — puzzle_attempts table (#189)
-- Records each puzzle completion with attempt count and duration.
-- PK allows multiple attempts per (user_id, lesson_id) distinguished by timestamp.

-- ── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE public.puzzle_attempts (
  user_id          uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  lesson_id        uuid        NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  wrong_attempts   int         NOT NULL DEFAULT 0 CHECK (wrong_attempts >= 0),
  duration_seconds int         NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  completed_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id, completed_at)
);

COMMENT ON TABLE public.puzzle_attempts IS
  'One row per puzzle completion attempt. Multiple rows allowed per (user_id, lesson_id) '
  'to track improvement over time. Use puzzle_best_attempt view for the personal best.';

-- ── Best-attempt view ─────────────────────────────────────────────────────────

CREATE VIEW public.puzzle_best_attempt AS
  SELECT
    user_id,
    lesson_id,
    MIN(wrong_attempts) AS wrong_attempts
  FROM public.puzzle_attempts
  GROUP BY user_id, lesson_id;

COMMENT ON VIEW public.puzzle_best_attempt IS
  'Personal best wrong-attempt count per (user_id, lesson_id).';

-- ── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.puzzle_attempts ENABLE ROW LEVEL SECURITY;

-- Learner can read their own attempts
CREATE POLICY "Learners can view own puzzle attempts"
  ON public.puzzle_attempts
  FOR SELECT
  USING (user_id = auth.uid());

-- Learner can insert their own attempts
CREATE POLICY "Learners can insert own puzzle attempts"
  ON public.puzzle_attempts
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Admin can read all attempts
CREATE POLICY "Admins can view all puzzle attempts"
  ON public.puzzle_attempts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
