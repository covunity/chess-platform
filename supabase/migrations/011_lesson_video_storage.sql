-- Slice 7: Lesson video storage — Supabase Storage bucket + RLS
-- See docs/adr/0001-video-storage-supabase.md.

-- ── Bucket ────────────────────────────────────────────────────────────────
--
-- Private bucket. 50 MB per-file cap matches Supabase free tier; allowed MIME
-- whitelisted to MP4-family only (decoded reliably by HTML5 <video> across
-- Safari/Chrome/Firefox without transcoding).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'lesson-videos',
  'lesson-videos',
  false,
  52428800,                       -- 50 MB
  ARRAY['video/mp4']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      public             = EXCLUDED.public;

-- ── RLS policies on storage.objects ───────────────────────────────────────
--
-- Object path convention: <auth.uid()>/<lesson_id>/<filename>. The first path
-- segment must equal the authenticated user's id, and the user must be a
-- creator or admin. No SELECT policy is created — playback always goes through
-- short-lived signed URLs generated server-side.

DROP POLICY IF EXISTS "Creators upload own lesson videos" ON storage.objects;
CREATE POLICY "Creators upload own lesson videos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'lesson-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('creator', 'admin')
    )
  );

DROP POLICY IF EXISTS "Creators update own lesson videos" ON storage.objects;
CREATE POLICY "Creators update own lesson videos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'lesson-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'lesson-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Creators delete own lesson videos" ON storage.objects;
CREATE POLICY "Creators delete own lesson videos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'lesson-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
