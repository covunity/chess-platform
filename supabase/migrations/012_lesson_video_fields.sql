-- Slice 7: Lesson video fields on public.lessons
-- See docs/adr/0001-video-storage-supabase.md.
--
-- Columns are provider-neutral so we can switch to Cloudflare Stream later
-- without a schema change: existing 'supabase' rows keep working alongside new
-- 'cloudflare' rows. The 'processing' status is reserved for Cloudflare's
-- async encoding step; Supabase uploads transition straight from 'uploading'
-- to 'ready'.

DO $$ BEGIN
  CREATE TYPE public.video_status AS ENUM (
    'idle',
    'uploading',
    'processing',
    'ready',
    'error'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.video_provider AS ENUM ('supabase', 'cloudflare');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS video_provider    public.video_provider,
  ADD COLUMN IF NOT EXISTS video_provider_id text,
  ADD COLUMN IF NOT EXISTS video_status      public.video_status NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS video_filename    text,
  ADD COLUMN IF NOT EXISTS video_size_bytes  bigint CHECK (video_size_bytes IS NULL OR video_size_bytes >= 0),
  ADD COLUMN IF NOT EXISTS video_mime        text,
  ADD COLUMN IF NOT EXISTS video_error       text;

CREATE INDEX IF NOT EXISTS idx_lessons_video_provider_id
  ON public.lessons(video_provider, video_provider_id)
  WHERE video_provider_id IS NOT NULL;
