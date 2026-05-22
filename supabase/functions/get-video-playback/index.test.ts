// TDD: Slice 3 — Bunny Stream signed HLS playback edge function (issue #264)
//
// Tests all 8 access matrix cases + error paths.
// Core logic is exported as `getVideoPlayback(client, opts)` for unit testing.

import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { getVideoPlayback, mintBunnyToken } from "./index.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ── Helpers ───────────────────────────────────────────────────────────────────

const BUNNY_API_KEY = "test-bunny-api-key"
const BUNNY_CDN_HOSTNAME = "cdn.test.b-cdn.net"

const BASE_LESSON = {
  id: "lesson-1",
  free_preview: false,
  video_provider: "bunny",
  video_provider_id: "video-guid-abc",
  video_status: "ready",
  bunny_library_id: "667376",
  chapters: [{
    course_id: "course-1",
    courses: [{
      creator_id: "creator-1",
    }],
  }],
}

const BASE_OPTS = {
  lessonId: "lesson-1",
  callerId: null as string | null,
  bunnyApiKey: BUNNY_API_KEY,
  bunnyCdnHostname: BUNNY_CDN_HOSTNAME,
}

type FakeClientOpts = {
  lesson?: typeof BASE_LESSON | null
  lessonErr?: { message: string } | null
  userRole?: string | null
  userErr?: { message: string } | null
  enrolled?: boolean
  enrollmentErr?: { message: string } | null
}

function fakeClient(opts: FakeClientOpts): SupabaseClient {
  return {
    from(table: string) {
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        maybeSingle() {
          if (table === "lessons") {
            return Promise.resolve({
              data: opts.lesson !== undefined ? opts.lesson : BASE_LESSON,
              error: opts.lessonErr ?? null,
            })
          }
          if (table === "users") {
            const role = opts.userRole ?? null
            return Promise.resolve({
              data: role !== null ? { role } : null,
              error: opts.userErr ?? null,
            })
          }
          if (table === "enrollments") {
            return Promise.resolve({
              data: opts.enrolled ? { id: "enroll-1" } : null,
              error: opts.enrollmentErr ?? null,
            })
          }
          return Promise.resolve({ data: null, error: null })
        },
      }
    },
  } as unknown as SupabaseClient
}

// ── mintBunnyToken ────────────────────────────────────────────────────────────

Deno.test("mintBunnyToken — returns non-empty Base64URL string", async () => {
  const token = await mintBunnyToken("api-key", "video-guid", 1800000000)
  // Base64URL: only alphanumeric, -, _, no padding
  assertEquals(/^[A-Za-z0-9\-_]+$/.test(token), true)
  assertEquals(token.length > 0, true)
})

// ── Access matrix: 8 cases ────────────────────────────────────────────────────

// Case 1: Anonymous + free_preview → allow (200)
Deno.test("getVideoPlayback — anonymous + free_preview lesson → 200", async () => {
  const client = fakeClient({
    lesson: { ...BASE_LESSON, free_preview: true },
  })
  const result = await getVideoPlayback(client, { ...BASE_OPTS, callerId: null })
  assertEquals(result.ok, true)
  if (result.ok) {
    assertEquals(result.hlsUrl.includes("playlist.m3u8"), true)
    assertEquals(result.hlsUrl.includes("video-guid-abc"), true)
    assertEquals(result.hlsUrl.includes(BUNNY_CDN_HOSTNAME), true)
    assertEquals(typeof result.expiresAt, "number")
  }
})

// Case 2: Anonymous + paid (non-free) lesson → 403
Deno.test("getVideoPlayback — anonymous + paid lesson → 403", async () => {
  const client = fakeClient({
    lesson: { ...BASE_LESSON, free_preview: false },
  })
  const result = await getVideoPlayback(client, { ...BASE_OPTS, callerId: null })
  assertEquals(result.ok, false)
  if (!result.ok) {
    assertEquals(result.status, 403)
    assertEquals(result.reason, "unauthenticated")
  }
})

// Case 3: Enrolled learner + paid lesson → allow
Deno.test("getVideoPlayback — enrolled learner + paid lesson → 200", async () => {
  const client = fakeClient({
    lesson: { ...BASE_LESSON, free_preview: false },
    userRole: "learner",
    enrolled: true,
  })
  const result = await getVideoPlayback(client, {
    ...BASE_OPTS,
    callerId: "learner-uid",
  })
  assertEquals(result.ok, true)
  if (result.ok) {
    assertEquals(result.hlsUrl.includes("playlist.m3u8"), true)
  }
})

// Case 4: Non-enrolled learner + paid lesson → 403
Deno.test("getVideoPlayback — non-enrolled learner + paid lesson → 403", async () => {
  const client = fakeClient({
    lesson: { ...BASE_LESSON, free_preview: false },
    userRole: "learner",
    enrolled: false,
  })
  const result = await getVideoPlayback(client, {
    ...BASE_OPTS,
    callerId: "learner-uid",
  })
  assertEquals(result.ok, false)
  if (!result.ok) {
    assertEquals(result.status, 403)
    assertEquals(result.reason, "not_enrolled")
  }
})

// Case 5: Admin + any lesson → allow
Deno.test("getVideoPlayback — admin + any lesson → 200", async () => {
  const client = fakeClient({
    lesson: { ...BASE_LESSON, free_preview: false },
    userRole: "admin",
    enrolled: false, // not enrolled — still allowed via admin role
  })
  const result = await getVideoPlayback(client, {
    ...BASE_OPTS,
    callerId: "admin-uid",
  })
  assertEquals(result.ok, true)
})

// Case 6: Creator (owner) + own lesson → allow
Deno.test("getVideoPlayback — creator (owner) + own lesson → 200", async () => {
  const client = fakeClient({
    lesson: { ...BASE_LESSON, free_preview: false },
    userRole: "creator",
    enrolled: false,
  })
  const result = await getVideoPlayback(client, {
    ...BASE_OPTS,
    callerId: "creator-1", // matches lesson.chapters[0].courses[0].creator_id
  })
  assertEquals(result.ok, true)
})

// Case 7: Non-owner creator + paid lesson → 403
Deno.test("getVideoPlayback — non-owner creator + paid lesson → 403", async () => {
  const client = fakeClient({
    lesson: { ...BASE_LESSON, free_preview: false },
    userRole: "creator",
    enrolled: false,
  })
  const result = await getVideoPlayback(client, {
    ...BASE_OPTS,
    callerId: "another-creator-uid", // NOT the owner
  })
  assertEquals(result.ok, false)
  if (!result.ok) {
    assertEquals(result.status, 403)
    assertEquals(result.reason, "not_enrolled")
  }
})

// Case 8: Enrolled learner + free_preview lesson → allow (double-check)
Deno.test("getVideoPlayback — enrolled learner + free_preview lesson → 200", async () => {
  const client = fakeClient({
    lesson: { ...BASE_LESSON, free_preview: true },
    userRole: "learner",
    enrolled: true,
  })
  const result = await getVideoPlayback(client, {
    ...BASE_OPTS,
    callerId: "learner-uid",
  })
  assertEquals(result.ok, true)
  if (result.ok) {
    assertEquals(result.hlsUrl.includes("playlist.m3u8"), true)
  }
})

// ── Error paths ───────────────────────────────────────────────────────────────

// Lesson not found → 404
Deno.test("getVideoPlayback — lesson not found → 404", async () => {
  const client = fakeClient({ lesson: null })
  const result = await getVideoPlayback(client, { ...BASE_OPTS, callerId: "uid" })
  assertEquals(result.ok, false)
  if (!result.ok) {
    assertEquals(result.status, 404)
    assertEquals(result.reason, "lesson_not_found")
  }
})

// Missing/bad lessonId → 400
Deno.test("getVideoPlayback — missing lessonId → 400", async () => {
  const client = fakeClient({})
  const result = await getVideoPlayback(client, { ...BASE_OPTS, lessonId: null })
  assertEquals(result.ok, false)
  if (!result.ok) {
    assertEquals(result.status, 400)
    assertEquals(result.reason, "missing_lesson_id")
  }
})

Deno.test("getVideoPlayback — empty string lessonId → 400", async () => {
  const client = fakeClient({})
  const result = await getVideoPlayback(client, { ...BASE_OPTS, lessonId: "" })
  assertEquals(result.ok, false)
  if (!result.ok) {
    assertEquals(result.status, 400)
  }
})

// ── URL shape ─────────────────────────────────────────────────────────────────

Deno.test("getVideoPlayback — response contains hlsUrl, mp4FallbackUrl, expiresAt", async () => {
  const client = fakeClient({
    lesson: { ...BASE_LESSON, free_preview: true },
  })
  const result = await getVideoPlayback(client, { ...BASE_OPTS, callerId: null })
  assertEquals(result.ok, true)
  if (result.ok) {
    // HLS URL shape
    assertEquals(
      result.hlsUrl.startsWith(`https://${BUNNY_CDN_HOSTNAME}/video-guid-abc/playlist.m3u8`),
      true,
    )
    // MP4 fallback URL shape
    assertEquals(
      result.mp4FallbackUrl.startsWith(`https://${BUNNY_CDN_HOSTNAME}/video-guid-abc/play_720p.mp4`),
      true,
    )
    // Both contain token + expires query params
    assertEquals(result.hlsUrl.includes("token="), true)
    assertEquals(result.hlsUrl.includes("expires="), true)
    // expiresAt is roughly 4h from now (within a 10s window)
    const now = Math.floor(Date.now() / 1000)
    assertEquals(result.expiresAt >= now + 4 * 3600 - 10, true)
    assertEquals(result.expiresAt <= now + 4 * 3600 + 10, true)
  }
})

// ── embedUrl ──────────────────────────────────────────────────────────────────

Deno.test("getVideoPlayback — bunny_library_id set → embedUrl is present with correct shape", async () => {
  const client = fakeClient({
    lesson: { ...BASE_LESSON, free_preview: true, bunny_library_id: "667376" },
  })
  const result = await getVideoPlayback(client, { ...BASE_OPTS, callerId: null })
  assertEquals(result.ok, true)
  if (result.ok) {
    assertEquals(typeof result.embedUrl, "string")
    assertEquals(
      (result.embedUrl as string).startsWith("https://iframe.mediadelivery.net/embed/667376/video-guid-abc"),
      true,
    )
    assertEquals((result.embedUrl as string).includes("token="), true)
    assertEquals((result.embedUrl as string).includes("expires="), true)
  }
})

Deno.test("getVideoPlayback — bunny_library_id null → embedUrl is null", async () => {
  const client = fakeClient({
    lesson: { ...BASE_LESSON, free_preview: true, bunny_library_id: null },
  })
  const result = await getVideoPlayback(client, { ...BASE_OPTS, callerId: null })
  assertEquals(result.ok, true)
  if (result.ok) {
    assertEquals(result.embedUrl, null)
  }
})
