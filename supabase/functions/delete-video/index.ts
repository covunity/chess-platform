import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// POST /functions/v1/delete-video  (verify_jwt = true, default)
//
// Body: { lessonId: string }
//
// Auth: caller must be the course's creator OR have role = 'admin'.
//       Looks up lessons → chapters → courses.creator_id.
//
// Flow:
//   1. Load lesson row; 404 if not found.
//   2. Check caller is creator/admin; 403 otherwise.
//   3. If video_provider = 'bunny': call Bunny DELETE /library/{bunny_library_id}/videos/{video_provider_id}.
//      Bunny 404 is treated as success (idempotent). Other Bunny errors propagate (don't null columns).
//   4. Null out all video columns on the lessons row.
//   5. Return 204.

export interface DeleteVideoRequest {
  lessonId?: unknown;
}

export type DeleteVideoResult =
  | { ok: true }
  | { ok: false; status: number; reason: string };

export async function deleteVideo(
  client: SupabaseClient,
  options: {
    callerId: string;
    callerRole: string;
    lessonId: string;
    bunnyApiKey: string;
    fetchFn?: typeof fetch;
  },
): Promise<DeleteVideoResult> {
  const fetchFn = options.fetchFn ?? fetch;

  // 1. Load the lesson row with join to get creator_id.
  const { data: lesson, error: lessonErr } = await client
    .from("lessons")
    .select(
      "id, video_provider, video_provider_id, bunny_library_id, chapters!inner(course_id, courses!inner(creator_id))",
    )
    .eq("id", options.lessonId)
    .maybeSingle();

  if (lessonErr) {
    return { ok: false, status: 500, reason: "lesson_lookup_failed" };
  }
  if (!lesson) {
    return { ok: false, status: 404, reason: "lesson_not_found" };
  }

  // 2. Check authorization: admin bypasses creator check.
  const isAdmin = options.callerRole === "admin";

  if (!isAdmin) {
    const chapter = Array.isArray(lesson.chapters)
      ? lesson.chapters[0]
      : lesson.chapters;
    const course = chapter
      ? Array.isArray(chapter.courses)
        ? chapter.courses[0]
        : chapter.courses
      : null;
    const creatorId = course?.creator_id;

    if (!creatorId || creatorId !== options.callerId) {
      return { ok: false, status: 403, reason: "not_authorized" };
    }
  }

  // 3. If provider is 'bunny', call Bunny DELETE API.
  if (lesson.video_provider === "bunny" && lesson.video_provider_id && lesson.bunny_library_id) {
    let bunnyRes: Response;
    try {
      bunnyRes = await fetchFn(
        `https://video.bunnycdn.com/library/${lesson.bunny_library_id}/videos/${lesson.video_provider_id}`,
        {
          method: "DELETE",
          headers: {
            AccessKey: options.bunnyApiKey,
          },
        },
      );
    } catch {
      return { ok: false, status: 502, reason: "bunny_unreachable" };
    }

    // 404 from Bunny is idempotent — video already gone, continue to null columns.
    if (!bunnyRes.ok && bunnyRes.status !== 404) {
      return { ok: false, status: 502, reason: "bunny_delete_failed" };
    }
  }

  // 4. Null out all video columns on the lessons row.
  const { error: updateErr } = await client
    .from("lessons")
    .update({
      video_provider: null,
      video_provider_id: null,
      bunny_library_id: null,
      video_thumbnail_url: null,
      video_status: "idle",
      video_filename: null,
      video_size_bytes: null,
      duration_seconds: null,
      video_error: null,
    })
    .eq("id", options.lessonId);

  if (updateErr) {
    return { ok: false, status: 500, reason: "lesson_update_failed" };
  }

  return { ok: true };
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(null, { status: 405, headers: { ...CORS_HEADERS, allow: "POST" } });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const bunnyApiKey = Deno.env.get("BUNNY_API_KEY");

  if (!supabaseUrl || !serviceRoleKey || !anonKey || !bunnyApiKey) {
    console.error("delete-video: required env var missing");
    return new Response(null, { status: 500, headers: CORS_HEADERS });
  }

  // Authenticate caller via JWT (supabase gateway enforces verify_jwt=true).
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(null, { status: 401, headers: CORS_HEADERS });
  }
  const jwt = authHeader.slice("Bearer ".length);

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await authClient.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return new Response(null, { status: 401, headers: CORS_HEADERS });
  }
  const callerId = userData.user.id;
  const callerRole = (userData.user.app_metadata?.role ?? "learner") as string;

  // Parse body.
  let body: DeleteVideoRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 400, headers: CORS_HEADERS });
  }

  if (typeof body.lessonId !== "string" || !body.lessonId) {
    return new Response(null, { status: 400, headers: CORS_HEADERS });
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result = await deleteVideo(serviceClient, {
    callerId,
    callerRole,
    lessonId: body.lessonId as string,
    bunnyApiKey,
  });

  if (!result.ok) {
    console.error("delete-video: failed", { reason: result.reason });
    return new Response(JSON.stringify({ error: result.reason }), {
      status: result.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return new Response(null, { status: 204, headers: CORS_HEADERS });
});
