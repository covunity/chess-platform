-- Slice 1: Bunny Stream scaffold — DB additions only; no behaviour change.
-- See docs/adr/0007-bunny-stream.md, issue #261.

-- ── 1. Add 'bunny' to provider enum ─────────────────────────────────────────
-- ADD VALUE is not transactional in Postgres; must run outside a BEGIN block.
-- Using IF NOT EXISTS so re-runs on an existing dev DB are safe.
ALTER TYPE public.video_provider ADD VALUE IF NOT EXISTS 'bunny';

-- ── 2. New lesson columns for Bunny ─────────────────────────────────────────
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS bunny_library_id     text,
  ADD COLUMN IF NOT EXISTS video_thumbnail_url  text;

-- ── 3. value_int column on config (integer runtime values) ───────────────────
ALTER TABLE public.config
  ADD COLUMN IF NOT EXISTS value_int bigint;

-- ── 4. Seed upload-cap config row ────────────────────────────────────────────
-- 1 073 741 824 bytes = 1 GiB — the Bunny Stream per-upload cap.
-- value (text) mirrors value_int to satisfy the existing NOT NULL constraint.
INSERT INTO public.config (key, value, value_int, description)
VALUES (
  'video_max_upload_bytes',
  '1073741824',
  1073741824,
  'Maximum video upload size in bytes. Read by validateVideoFile at editor mount.'
)
ON CONFLICT (key) DO NOTHING;
