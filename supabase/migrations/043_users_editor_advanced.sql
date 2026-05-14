-- Migration 043: PRD-0004 Slice 2 — editor_advanced toggle (#189)
-- Per-user flag that unlocks the advanced PGN tab in the lesson editor.
-- Defaults to false so the default UX stays board-only (Slice 5a).

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS editor_advanced boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.users.editor_advanced IS
  'When true, shows the advanced PGN tab alongside the board authoring surface '
  'in LessonEditor. Set by the user via Profile settings. Defaults to false '
  '(board-only authoring per PRD-0004 Slice 11).';
