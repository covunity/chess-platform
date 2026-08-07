-- ── Migration 094: Fix Security Definer View warning on puzzle_best_attempt ─
-- Re-creates public.puzzle_best_attempt with (security_invoker = true)
-- to enforce RLS of the querying user instead of view owner security definer context.

CREATE OR REPLACE VIEW public.puzzle_best_attempt WITH (security_invoker = true) AS
  SELECT
    user_id,
    lesson_id,
    MIN(wrong_attempts) AS wrong_attempts
  FROM public.puzzle_attempts
  WHERE gave_up = false
  GROUP BY user_id, lesson_id;

COMMENT ON VIEW public.puzzle_best_attempt IS
  'Personal best wrong-attempt count per (user_id, lesson_id) with security_invoker = true. '
  'Excludes give-up attempts so the badge reflects genuine solves only.';
