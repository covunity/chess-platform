-- Migration 046: PRD-0004 Slice 12 — rename is_view_only → has_rewind_mode (#226)
--
-- The original flag locked a chess lesson into viewer (←/→) mode. The new
-- design keeps the same column but flips its meaning: when set, the lesson
-- offers learners TWO modes (Study with ←/→ + notes by default, plus a
-- Rewind toggle that resets to root and lets them play through from memory).
-- Existing values are preserved as-is — lessons currently marked view-only
-- now get the optional Rewind toggle, which is a strict superset of the old
-- read-only behaviour.

ALTER TABLE public.lessons
  RENAME COLUMN is_view_only TO has_rewind_mode;

COMMENT ON COLUMN public.lessons.has_rewind_mode IS
  'When true, learners see two modes on this chess lesson: Study (←/→ + notes, default) '
  'and Rewind (interactive self-play). When false, only the current interactive guided '
  'lesson mode is shown. Only meaningful for type=''chess''; ignored for type=''puzzle''.';
