-- Migration 041: PRD-0004 Slice 2 — resume position (#189)
-- Stores the last tree node visited by a learner so the player can
-- resume at the correct position when the lesson is re-opened.

ALTER TABLE public.lesson_progress
  ADD COLUMN IF NOT EXISTS last_viewed_node_id text NULL;

COMMENT ON COLUMN public.lesson_progress.last_viewed_node_id IS
  'Node ID (V-16 hash) of the last position visited by the learner. '
  'NULL for lessons opened before this migration. On re-open the player '
  'seeds currentNodeId to this value; stale IDs fall through to root.';
