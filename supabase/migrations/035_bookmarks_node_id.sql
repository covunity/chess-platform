-- Migration 035: bookmarks.node_id + played_plies (Slice 4 — #167)
-- node_id: PgnNode id for O(1) tree-aware restore.
-- played_plies: legacy fallback for rows where node_id is stale or missing.

ALTER TABLE public.bookmarks
  ADD COLUMN IF NOT EXISTS node_id text;

COMMENT ON COLUMN public.bookmarks.node_id IS
  'PgnNode id (V-16: sha256(parentId+/+from+to+promotion) prefix). NULL for pre-PRD-0003 linear bookmarks; backfilled by deploy script when possible.';

ALTER TABLE public.bookmarks
  ADD COLUMN IF NOT EXISTS played_plies integer;

COMMENT ON COLUMN public.bookmarks.played_plies IS
  'Depth from root along the path-from-root at the time of bookmarking. Written by the player for back-compat; used as legacy fallback when node_id is NULL or stale.';
