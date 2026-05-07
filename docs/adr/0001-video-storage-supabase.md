# ADR-0001 — Video storage: Supabase Storage in Phase 1, Cloudflare Stream in Phase 2

- **Status:** Accepted
- **Date:** 2026-05-07
- **Slice:** 7 — Creator video upload (Issue #8)

## Context

CLAUDE.md §2 originally chose **Cloudflare Stream** for course videos. Cloudflare Stream
provides HLS adaptive bitrate, transcoding, and signed playback out of the box, but
charges a flat ~$5/month minimum. Phase 1 is an MVP with no revenue yet, so any fixed
cost is friction.

We need a way to ship the video upload feature for Issue #8 without monthly fees,
while keeping the door open to migrate to Cloudflare Stream once the platform launches
and adaptive bitrate / transcoding becomes worth the money.

## Decision

For Phase 1 we ship video upload using **Supabase Storage** (which we already use for
DB + Auth) and **HTML5 `<video>` progressive playback**. We design the code with a
`VideoProvider` adapter so that switching to Cloudflare Stream in Phase 2 only requires
filling in one provider implementation and flipping an environment variable.

Concretely:

- Bucket: `lesson-videos` (private). RLS lets only creators/admins write to their own
  prefix (`<userId>/<lessonId>/...`). Reads happen exclusively through 4-hour signed
  URLs created server-side via `supabase.storage.from(...).createSignedUrl`.
- Upload: `tus-js-client` against Supabase Storage's `/storage/v1/upload/resumable`
  endpoint, authenticated with the user's JWT.
- Format constraints (Phase 1): MP4 (H.264 + AAC) only; max 50 MB per file.
- Database columns are provider-neutral: `video_provider` (`'supabase' | 'cloudflare'`)
  and `video_provider_id` (object path *or* Cloudflare UID). The `video_status` enum
  includes `processing` from day one even though Supabase never produces it, so the
  state machine doesn't need to change when Cloudflare arrives.
- Player UI is wrapped in a `VideoView` component that branches on `format: 'mp4' |
  'hls'` and lazy-imports `hls.js` only if HLS is needed — so Phase 1 doesn't ship the
  hls.js bundle.

## Consequences

### Positive
- $0 fixed cost in Phase 1; everything runs inside the existing Supabase free tier.
- One vendor for DB, Auth, and Storage — fewer secrets, fewer dashboards.
- Provider abstraction means the migration to Cloudflare in Phase 2 is ~1–2 days of
  work, mostly inside `cloudflareProvider.ts` plus two Edge Functions.
- Existing videos uploaded under `provider='supabase'` keep working forever even after
  new uploads switch to Cloudflare; both providers can coexist.

### Negative / risks
- **No HLS adaptive bitrate.** Learners on slow networks will buffer 720p video. We
  mitigate by capping uploads at 50 MB and asking creators to encode at ~1500 kbps.
- **No transcoding.** Files are served as-is, so we restrict the input format to MP4
  H.264/AAC; MOV/AVI uploads are rejected client- and server-side to avoid Safari
  playback failures.
- **50 MB per-file limit on Supabase free tier.** Issue #8 originally specified 2 GB.
  We update Issue #8's acceptance criteria to 50 MB for Phase 1 — see §14 of the
  Slice 7 plan. Going to 2 GB requires Supabase Pro ($25/month), which is more
  expensive than Cloudflare Stream ($5), so it's not worth it.
- **5 GB egress/month on free tier.** A single 50 MB video viewed 100 times exhausts
  it. We must monitor Supabase usage and plan to upgrade (or front Storage with a CDN)
  before public launch.
- **Supabase free tier auto-pauses inactive projects after ~1 week.** This is fine for
  development but unacceptable for production. Any production launch will require
  Supabase Pro regardless of which video provider we use.

## Trigger to revisit

Switch to Cloudflare Stream when **any** of these is true:

1. We're going to public launch (need always-on infra; egress/buffering becomes a real
   user-facing problem).
2. Egress on Supabase exceeds 50% of the plan's quota for two consecutive months.
3. Average upload size approaches the per-file limit and creators start complaining
   about pre-upload compression.

## Implementation references

- Slice 7 plan: `~/.claude/plans/d-a-v-o-github-issue-jazzy-thunder.md`
- Provider abstraction: `src/lib/video/`
- Bucket + RLS: `supabase/migrations/011_lesson_video_storage.sql`
- Schema: `supabase/migrations/012_lesson_video_fields.sql`
- Setup doc: `docs/setup/supabase-storage-video.md`

## Updates to CLAUDE.md

- §2 row "Video": `Supabase Storage (MP4 progressive, signed URLs, 50 MB max). Provider-pluggable; Phase 2 will switch to Cloudflare Stream for HLS adaptive.`
- §9 rewritten to describe the Supabase Storage TUS flow and the provider adapter.
- §13 row "Scalability" notes the 5 GB/month egress ceiling on the free tier.
