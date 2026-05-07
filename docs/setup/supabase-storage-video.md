# Supabase Storage — Lesson video setup

> Phase 1 video pipeline. Phase 2 will move to Cloudflare Stream — see
> `docs/adr/0001-video-storage-supabase.md`.

## What this gives you

- A private Supabase Storage bucket named `lesson-videos`.
- TUS resumable uploads from the browser, authenticated with the user's Supabase JWT.
- 4-hour signed URLs for playback.
- A provider-neutral DB schema on `public.lessons`.

## One-time setup

### 1. Apply the migrations

```bash
supabase db reset            # local
# or, against a remote project:
supabase db push
```

This runs:

- `011_lesson_video_storage.sql` — creates the `lesson-videos` bucket
  (private, 50 MB cap, MP4-only) and the storage RLS policies.
- `012_lesson_video_fields.sql` — adds `video_provider`, `video_provider_id`,
  `video_status`, `video_filename`, `video_size_bytes`, `video_mime`,
  `video_error` to `public.lessons`.

> The migration uses `INSERT … ON CONFLICT DO UPDATE` so it's safe to re-run.

### 2. Verify in the Supabase dashboard

- **Storage → Buckets** — `lesson-videos` exists, *Public* off, file size limit
  50 MB, allowed MIME types `video/mp4`.
- **Database → Tables → lessons** — the new video columns exist.
- **Authentication → Policies → storage.objects** — three policies named
  *Creators upload/update/delete own lesson videos*.

### 3. Environment variables

Already covered by the existing `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY`. Add one new optional variable:

```bash
VITE_VIDEO_PROVIDER=supabase
```

When you migrate to Cloudflare Stream, change this to `cloudflare`.

## How it works at runtime

1. The creator opens the lesson editor and switches to the *Video* tab.
2. They drop in or pick an MP4. `validateVideoFile` checks MIME + size on the
   client.
3. `supabaseProvider.upload` uses `tus-js-client` against
   `${SUPABASE_URL}/storage/v1/upload/resumable`. The user's JWT is the
   `Authorization` header; Supabase RLS on `storage.objects` ensures the path
   prefix matches the user's id and the user is a creator/admin.
4. On success, `setLessonVideo` writes
   `video_provider='supabase'`, `video_provider_id=<object path>`,
   `video_status='ready'`, plus filename, size, mime, and duration.
5. Playback (Slice 14): the player calls
   `getProvider(lesson.video_provider).getPlaybackInfo(lesson.video_provider_id)`,
   which yields a 4-hour MP4 signed URL. `VideoView` renders it in an HTML5
   `<video>`.

## Operational notes

### Egress watch

Free tier ships **5 GB/month**. One 50 MB lesson watched 100 times exhausts
that. Watch *Settings → Usage* in the Supabase dashboard. When egress crosses
~50% of the plan limit twice in a row, plan the migration to Cloudflare
Stream (or front Storage with a CDN).

### Compression guidance for creators

Phase 1 has no server-side transcoding. Recommend creators encode at:
- Container: MP4
- Video: H.264, 720p, ~1500 kbps, 30 fps
- Audio: AAC, 128 kbps stereo

A 10-minute lesson at those settings lands around 100 MB — still over the
50 MB cap, so creators may need to drop to 540p or use `ffmpeg` with
`-crf 28` for shorter clips.

### Cleaning up orphaned files

If a creator cancels mid-upload, the in-flight chunks are abandoned but
Supabase reaps them automatically after ~24 hours. If a lesson row is deleted
without first calling `clearLessonVideo`, the storage object is orphaned —
sweep periodically with:

```sql
SELECT name FROM storage.objects
 WHERE bucket_id = 'lesson-videos'
   AND name NOT IN (
     SELECT video_provider_id FROM public.lessons
      WHERE video_provider = 'supabase' AND video_provider_id IS NOT NULL
   );
```

## When to upgrade to Cloudflare Stream

Triggers (any of):
1. Going public — auto-pause and 5 GB egress are no longer acceptable.
2. Egress > 50% of the plan quota two months in a row.
3. Average upload size approaches 50 MB and creators complain about
   pre-upload compression.

The migration steps will be:
1. Implement `cloudflareProvider.ts`.
2. Add Edge Functions for direct upload URL + signed playback JWT.
3. `npm install hls.js`.
4. Set `VITE_VIDEO_PROVIDER=cloudflare`.
5. Existing Supabase-stored lessons keep working because rows store
   `video_provider='supabase'`.
