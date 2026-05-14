-- Migration 044: PRD-0004 Slice 9c — gave_up column on puzzle_attempts (#202)
-- Tracks whether the learner used "Xem đáp án" to view the solution.
-- A gave_up attempt is intentionally excluded from the personal-best view so
-- it is never displayed as the player's best achievement.

ALTER TABLE public.puzzle_attempts
  ADD COLUMN gave_up boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.puzzle_attempts.gave_up IS
  'True when the learner clicked "Xem đáp án" during this attempt. '
  'These attempts are excluded from puzzle_best_attempt.';

-- ── Rebuild best-attempt view to exclude gave_up rows ─────────────────────────

DROP VIEW IF EXISTS public.puzzle_best_attempt;

CREATE VIEW public.puzzle_best_attempt AS
  SELECT
    user_id,
    lesson_id,
    MIN(wrong_attempts) AS wrong_attempts
  FROM public.puzzle_attempts
  WHERE gave_up = false
  GROUP BY user_id, lesson_id;

COMMENT ON VIEW public.puzzle_best_attempt IS
  'Personal best wrong-attempt count per (user_id, lesson_id). '
  'Excludes give-up attempts so the badge reflects genuine solves only.';
