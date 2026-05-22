import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// Slice 3 — Bunny Stream signed HLS playback (issue #264)
//
// Returns a signed HLS URL (and MP4 fallback) for a video lesson.
// verify_jwt=false in config.toml — the function authenticates callers
// itself (anon, enrolled learner, admin, or creator). Anonymous callers
// are allowed for free_preview lessons.
//
// Access matrix (mirrors src/lib/accessControl.ts canAccessLesson):
//   - lesson.free_preview = true → allow (even anonymous)
//   - uid + enrolled → allow
//   - uid + role = 'admin' → allow
//   - uid = course.creator_id → allow
//   - else → 403
//
// Token formula (Bunny signed URL):
//   expiresAt = Math.floor(Date.now() / 1000) + 4 * 3600
//   token = Base64URL(SHA256(BUNNY_API_KEY + "/" + videoGuid + "/" + expiresAt))
//   Note: plain SHA256 hash, not HMAC.

export interface GetVideoPlaybackOptions {
  lessonId: string | null | undefined
  callerId: string | null
  bunnyApiKey: string
  bunnyCdnHostname: string
}

export type GetVideoPlaybackResult =
  | { ok: true; hlsUrl: string; mp4FallbackUrl: string; embedUrl: string | null; expiresAt: number }
  | { ok: false; status: number; reason: string }

/**
 * Encode bytes as Base64URL (no padding).
 */
function toBase64Url(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) {
    binary += String.fromCharCode(b)
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

/**
 * Mint a Bunny signed URL token.
 * Formula: Base64URL(SHA256(apiKey + "/" + videoGuid + "/" + expiresAt))
 * SHA256 is a plain hash, not HMAC.
 */
export async function mintBunnyToken(
  apiKey: string,
  videoGuid: string,
  expiresAt: number,
): Promise<string> {
  const payload = `${apiKey}/${videoGuid}/${expiresAt}`
  const encoded = new TextEncoder().encode(payload)
  const hashBuf = await crypto.subtle.digest("SHA-256", encoded)
  return toBase64Url(new Uint8Array(hashBuf))
}

/**
 * Core logic — testable independently of the HTTP layer.
 */
export async function getVideoPlayback(
  client: SupabaseClient,
  opts: GetVideoPlaybackOptions,
): Promise<GetVideoPlaybackResult> {
  const { lessonId, callerId, bunnyApiKey, bunnyCdnHostname } = opts

  // Validate lessonId
  if (!lessonId || typeof lessonId !== "string" || lessonId.trim() === "") {
    return { ok: false, status: 400, reason: "missing_lesson_id" }
  }

  // Fetch lesson + course creator_id
  const { data: lesson, error: lessonErr } = await client
    .from("lessons")
    .select("id, free_preview, video_provider, video_provider_id, video_status, bunny_library_id, chapters!inner(course_id, courses!inner(creator_id))")
    .eq("id", lessonId)
    .maybeSingle()

  if (lessonErr) {
    return { ok: false, status: 500, reason: "lesson_lookup_failed" }
  }
  if (!lesson) {
    return { ok: false, status: 404, reason: "lesson_not_found" }
  }

  // Extract nested join data
  const chapterData = Array.isArray(lesson.chapters) ? lesson.chapters[0] : lesson.chapters
  const courseData = chapterData && Array.isArray(chapterData.courses)
    ? chapterData.courses[0]
    : chapterData?.courses
  const creatorId: string | null = courseData?.creator_id ?? null
  const courseId: string | null = chapterData?.course_id ?? null

  const freePreview = lesson.free_preview === true

  // ── Access matrix ─────────────────────────────────────────────────────────
  // 1. free_preview → allow anyone (including anonymous)
  if (freePreview) {
    // Fall through to mint token
  } else if (!callerId) {
    // Anonymous caller, non-free lesson
    return { ok: false, status: 403, reason: "unauthenticated" }
  } else {
    // Authenticated caller — check role, creator ownership, enrollment
    const { data: userData } = await client
      .from("users")
      .select("role")
      .eq("id", callerId)
      .maybeSingle()

    const role = (userData as { role?: string } | null)?.role ?? null

    // Admin → allow
    if (role === "admin") {
      // Fall through
    } else if (callerId === creatorId) {
      // Course creator → allow
      // Fall through
    } else {
      // Check enrollment
      const { data: enrollment } = await client
        .from("enrollments")
        .select("id")
        .eq("user_id", callerId)
        .eq("course_id", courseId)
        .maybeSingle()

      if (!enrollment) {
        return { ok: false, status: 403, reason: "not_enrolled" }
      }
    }
  }

  // ── Verify the lesson has a Bunny video ready ─────────────────────────────
  if (lesson.video_provider !== "bunny") {
    return { ok: false, status: 422, reason: "not_bunny_provider" }
  }
  if (lesson.video_status !== "ready") {
    return { ok: false, status: 422, reason: "video_not_ready" }
  }
  if (!lesson.video_provider_id) {
    return { ok: false, status: 422, reason: "missing_video_guid" }
  }

  const videoGuid = lesson.video_provider_id as string
  const expiresAt = Math.floor(Date.now() / 1000) + 4 * 3600
  const token = await mintBunnyToken(bunnyApiKey, videoGuid, expiresAt)

  const hlsUrl = `https://${bunnyCdnHostname}/${videoGuid}/playlist.m3u8?token=${token}&expires=${expiresAt}`
  const mp4FallbackUrl = `https://${bunnyCdnHostname}/${videoGuid}/play_720p.mp4?token=${token}&expires=${expiresAt}`

  const bunnyLibraryId = (lesson.bunny_library_id as string | null) ?? null
  const embedUrl = bunnyLibraryId
    ? `https://iframe.mediadelivery.net/embed/${bunnyLibraryId}/${videoGuid}?token=${token}&expires=${expiresAt}`
    : null

  return { ok: true, hlsUrl, mp4FallbackUrl, embedUrl, expiresAt }
}

// CORS headers
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== "POST") {
    return new Response(null, {
      status: 405,
      headers: { ...CORS_HEADERS, allow: "POST" },
    })
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")
  const bunnyApiKey = Deno.env.get("BUNNY_API_KEY")
  const bunnyCdnHostname = Deno.env.get("BUNNY_CDN_HOSTNAME")

  if (!supabaseUrl || !serviceRoleKey || !anonKey || !bunnyApiKey || !bunnyCdnHostname) {
    console.error("get-video-playback: required env var missing")
    return new Response(null, { status: 500, headers: CORS_HEADERS })
  }

  // Authenticate the caller — may be anonymous (anon JWT) or authenticated user JWT.
  // verify_jwt=false at gateway so anon key JWTs aren't rejected before reaching here.
  const authHeader = req.headers.get("authorization") ?? ""
  let callerId: string | null = null

  if (authHeader.startsWith("Bearer ")) {
    const jwt = authHeader.slice("Bearer ".length)
    // Try to resolve user from JWT — silently ignore errors (anon key JWT won't resolve a user)
    try {
      const authClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data: userData } = await authClient.auth.getUser(jwt)
      if (userData?.user?.id) {
        callerId = userData.user.id
      }
    } catch {
      // Anonymous or invalid JWT — callerId stays null
    }
  }

  let body: { lessonId?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(null, { status: 400, headers: CORS_HEADERS })
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const result = await getVideoPlayback(serviceClient, {
    lessonId: typeof body.lessonId === "string" ? body.lessonId : null,
    callerId,
    bunnyApiKey,
    bunnyCdnHostname,
  })

  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.reason }), {
      status: result.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    })
  }

  return new Response(
    JSON.stringify({
      hlsUrl: result.hlsUrl,
      mp4FallbackUrl: result.mp4FallbackUrl,
      embedUrl: result.embedUrl,
      expiresAt: result.expiresAt,
    }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    },
  )
})
