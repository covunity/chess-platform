-- Thumbnail storage bucket for course cover images.
-- Public bucket — URLs are embedded directly in course cards and detail pages.
-- Path convention: <course_id>/cover.<ext>

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'thumbnails',
  'thumbnails',
  true,
  5242880,                              -- 5 MB
  ARRAY['image/jpeg', 'image/png']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types,
      public             = EXCLUDED.public;

-- ── RLS policies ──────────────────────────────────────────────────────────

-- Creators and admins can upload thumbnails.
DROP POLICY IF EXISTS "Creators upload course thumbnails" ON storage.objects;
CREATE POLICY "Creators upload course thumbnails"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'thumbnails'
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('creator', 'admin')
    )
  );

-- Creators and admins can replace an existing thumbnail.
DROP POLICY IF EXISTS "Creators update course thumbnails" ON storage.objects;
CREATE POLICY "Creators update course thumbnails"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING  (bucket_id = 'thumbnails')
  WITH CHECK (
    bucket_id = 'thumbnails'
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('creator', 'admin')
    )
  );

-- Creators and admins can delete thumbnails.
DROP POLICY IF EXISTS "Creators delete course thumbnails" ON storage.objects;
CREATE POLICY "Creators delete course thumbnails"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'thumbnails'
    AND EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role IN ('creator', 'admin')
    )
  );
