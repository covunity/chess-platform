-- Add SELECT policy for thumbnails bucket.
-- Required for upsert operations: Supabase Storage checks if the object
-- already exists (SELECT) before deciding to INSERT or UPDATE.
-- The bucket is public so anyone can read via CDN URL, but authenticated
-- operations also need an explicit RLS SELECT policy.

DROP POLICY IF EXISTS "Public read thumbnails" ON storage.objects;
CREATE POLICY "Public read thumbnails"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'thumbnails');
