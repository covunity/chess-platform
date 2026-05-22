import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// POST /functions/v1/create-video  (verify_jwt = true)
//
// Body: { lessonId: string, filename: string, sizeBytes: number }
//
// Auth: caller must be a `creator` that owns the course containing `lessonId`,
//       or have role = 'admin'. JWT is validated by Supabase (verify_jwt=true).
//
// Flow:
//   1. Read video_max_upload_bytes from config; reject 413 if sizeBytes exceeds it.
//   2. Verify the caller is creator/admin for this lesson's course.
//   3. Call Bunny POST /library/{id}/videos to register the video; get videoGuid.
//   4. Compute TUS auth signature (SHA-256) and expiry.
//   5. Update the lessons row with Bunny metadata and status='uploading'.
//   6. Return TUS upload credentials to the client.

export interface CreateVideoRequest {
  lessonId?: unknown;
  filename?: unknown;
  sizeBytes?: unknown;
}

export interface CreateVideoResult {
  ok: true;
  uploadEndpoint: string;
  videoGuid: string;
  libraryId: number;
  authorizationSignature: string;
  authorizationExpire: number;
}

export interface CreateVideoError {
  ok: false;
  status: number;
  reason: string;
}

/** SHA-256 hex of a string message. */
export async function sha256Hex(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", encoder.encode(message));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compute Bunny TUS authorization signature.
 * authorizationSignature = SHA256(libraryId + apiKey + expiration + videoGuid)
 */
export async function computeTusSignature(
  libraryId: number,
  apiKey: string,
  expiration: number,
  videoGuid: string,
): Promise<string> {
  return sha256Hex(`${libraryId}${apiKey}${expiration}${videoGuid}`);
}

export async function createVideoUpload(
  serviceClient: SupabaseClient,
  options: {
    callerId: string;
    callerRole: string;
    lessonId: string;
    filename: string;
    sizeBytes: number;
    maxBytes: number;
    bunnyLibraryId: number;
    bunnyApiKey: string;
    fetchFn?: typeof fetch;
    nowSeconds?: () => number;
  },
): Promise<CreateVideoResult | CreateVideoError> {
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  // 1. Validate file size.
  if (options.sizeBytes > options.maxBytes) {
    return { ok: false, status: 413, reason: "file_too_large" };
  }

  // 2. Check caller is creator/admin with access to this lesson.
  const isAdmin = options.callerRole === "admin";

  if (!isAdmin) {
    // Creator must own the course that contains this lesson.
    const { data: lesson, error: lessonErr } = await serviceClient
      .from("lessons")
      .select("id, chapters!inner(course_id, courses!inner(creator_id))")
      .eq("id", options.lessonId)
      .maybeSingle();

    if (lessonErr || !lesson) {
      return { ok: false, status: 403, reason: "not_authorized" };
    }

    // Traverse the join: lesson -> chapters -> courses
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

  // 3. Create video record in Bunny.
  let bunnyRes: Response;
  try {
    bunnyRes = await fetchFn(
      `https://video.bunnycdn.com/library/${options.bunnyLibraryId}/videos`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          AccessKey: options.bunnyApiKey,
        },
        body: JSON.stringify({ title: options.filename }),
      },
    );
  } catch {
    return { ok: false, status: 502, reason: "bunny_unreachable" };
  }

  if (!bunnyRes.ok) {
    return { ok: false, status: 502, reason: "bunny_create_failed" };
  }

  let bunnyData: { guid?: string };
  try {
    bunnyData = await bunnyRes.json();
  } catch {
    return { ok: false, status: 502, reason: "bunny_invalid_json" };
  }

  const videoGuid = bunnyData.guid;
  if (!videoGuid) {
    return { ok: false, status: 502, reason: "bunny_missing_guid" };
  }

  // 4. Compute TUS auth signature.
  const authorizationExpire = now() + 3600;
  const authorizationSignature = await computeTusSignature(
    options.bunnyLibraryId,
    options.bunnyApiKey,
    authorizationExpire,
    videoGuid,
  );

  // 5. Update the lessons row.
  const { error: updateErr } = await serviceClient
    .from("lessons")
    .update({
      video_provider: "bunny",
      video_provider_id: videoGuid,
      bunny_library_id: options.bunnyLibraryId,
      video_status: "uploading",
      video_filename: options.filename,
      video_size_bytes: options.sizeBytes,
      video_mime: "video/mp4",
    })
    .eq("id", options.lessonId);

  if (updateErr) {
    return { ok: false, status: 500, reason: "lesson_update_failed" };
  }

  // 6. Return TUS credentials.
  return {
    ok: true,
    uploadEndpoint: "https://video.bunnycdn.com/tusupload",
    videoGuid,
    libraryId: options.bunnyLibraryId,
    authorizationSignature,
    authorizationExpire,
  };
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
  const bunnyLibraryIdStr = Deno.env.get("BUNNY_LIBRARY_ID");

  if (!supabaseUrl || !serviceRoleKey || !anonKey || !bunnyApiKey || !bunnyLibraryIdStr) {
    console.error("create-video: required env var missing");
    return new Response(null, { status: 500, headers: CORS_HEADERS });
  }

  const bunnyLibraryId = parseInt(bunnyLibraryIdStr, 10);
  if (!Number.isFinite(bunnyLibraryId)) {
    console.error("create-video: BUNNY_LIBRARY_ID is not a valid integer");
    return new Response(null, { status: 500, headers: CORS_HEADERS });
  }

  // Authenticate caller via JWT (supabase enforces verify_jwt=true for this function).
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
  let body: CreateVideoRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 400, headers: CORS_HEADERS });
  }

  if (
    typeof body.lessonId !== "string" || !body.lessonId ||
    typeof body.filename !== "string" || !body.filename ||
    typeof body.sizeBytes !== "number" || !Number.isFinite(body.sizeBytes)
  ) {
    return new Response(null, { status: 400, headers: CORS_HEADERS });
  }

  // Fetch upload size cap from config.
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const FALLBACK_BYTES = 1073741824; // 1 GB
  let maxBytes = FALLBACK_BYTES;
  try {
    const { data: configRow } = await serviceClient
      .from("config")
      .select("value_int")
      .eq("key", "video_max_upload_bytes")
      .single();
    if (configRow?.value_int && configRow.value_int > 0) {
      maxBytes = configRow.value_int;
    }
  } catch {
    // silently use fallback
  }

  const result = await createVideoUpload(serviceClient, {
    callerId,
    callerRole,
    lessonId: body.lessonId as string,
    filename: body.filename as string,
    sizeBytes: body.sizeBytes as number,
    maxBytes,
    bunnyLibraryId,
    bunnyApiKey,
  });

  if (!result.ok) {
    console.error("create-video: failed", { reason: result.reason });
    return new Response(JSON.stringify({ error: result.reason }), {
      status: result.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      uploadEndpoint: result.uploadEndpoint,
      videoGuid: result.videoGuid,
      libraryId: result.libraryId,
      authorizationSignature: result.authorizationSignature,
      authorizationExpire: result.authorizationExpire,
    }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    },
  );
});
