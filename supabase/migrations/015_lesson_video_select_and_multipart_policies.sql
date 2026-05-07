-- Slice 7 follow-up: missing RLS pieces that block tus-js-client uploads to
-- the private `lesson-videos` bucket.
--
-- Two separate gaps:
--
-- 1. SELECT on storage.objects.
--    Supabase Storage uses tus-js-client with `x-upsert: true`, which the
--    server translates to `INSERT ... ON CONFLICT (name, bucket_id) DO UPDATE`.
--    Postgres needs to be able to SEE any conflicting row (via RLS SELECT) for
--    the upsert path; without a SELECT policy the operation fails with
--    "new row violates row-level security policy" — same root cause as the
--    thumbnails bucket fix in migration 014.
--    Unlike thumbnails (public bucket), this bucket is private, so the
--    SELECT policy is scoped to the uploader's own folder. Playback for
--    learners still goes through short-lived signed URLs (which bypass RLS).
--
-- 2. ALL on storage.s3_multipart_uploads + storage.s3_multipart_uploads_parts.
--    Resumable uploads land first in `s3_multipart_uploads` (session row) and
--    `s3_multipart_uploads_parts` (per-chunk rows) under the user's JWT
--    context, before the final commit into `storage.objects`. Both tables have
--    RLS enabled by default with no policies — denying every insert. The
--    error surfaces as the same generic 403, which is what made this hard to
--    diagnose. Scope mirrors the storage.objects policies (bucket + first
--    path segment = auth.uid()), with the role check on the multipart-uploads
--    INSERT to gate session creation to creators/admins.

-- ── storage.objects: add SELECT policy ───────────────────────────────────
DROP POLICY IF EXISTS "Creators read own lesson videos" ON storage.objects;
CREATE POLICY "Creators read own lesson videos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'lesson-videos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ── storage.s3_multipart_uploads ─────────────────────────────────────────
DROP POLICY IF EXISTS "Creators manage own multipart uploads" ON storage.s3_multipart_uploads;
CREATE POLICY "Creators manage own multipart uploads"
  ON storage.s3_multipart_uploads
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'lesson-videos'
    AND (storage.foldername(key))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'lesson-videos'
    AND (storage.foldername(key))[1] = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('creator', 'admin')
    )
  );

-- ── storage.s3_multipart_uploads_parts ───────────────────────────────────
DROP POLICY IF EXISTS "Creators manage own multipart upload parts" ON storage.s3_multipart_uploads_parts;
CREATE POLICY "Creators manage own multipart upload parts"
  ON storage.s3_multipart_uploads_parts
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'lesson-videos'
    AND (storage.foldername(key))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'lesson-videos'
    AND (storage.foldername(key))[1] = auth.uid()::text
  );
