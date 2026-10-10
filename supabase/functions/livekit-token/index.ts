import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { AccessToken } from "npm:livekit-server-sdk@^2";

export interface LivekitTokenRequest {
  roomId?: unknown;
  userId?: unknown;
  role?: unknown;
  name?: unknown;
}

export type ClassroomRole = "teacher" | "assistant" | "student";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

export interface ClassroomAccessValidationResult {
  valid: boolean;
  role: ClassroomRole;
  participantName: string;
  reason?: string;
  livekitRoomName?: string;
  sessionTitle?: string;
}

export interface LivekitTokenDependencies {
  authClient?: SupabaseClient;
  serviceClient?: SupabaseClient;
  env?: Record<string, string | undefined>;
}

/**
 * Isolated classroom access & role validation helper.
 * Validates whether the authenticated user has access to this classroom room
 * and determines their authorized role ('teacher', 'assistant', or 'student').
 *
 * This function isolates database/authorization lookups so that if classroom
 * tables are added or modified in the future, the LiveKit token issuance flow
 * remains unchanged.
 */
export async function validateClassroomAccess(
  supabaseClient: SupabaseClient,
  roomId: string,
  userId: string,
  requestedRole?: string,
  fallbackUser?: { email?: string; user_metadata?: Record<string, unknown>; app_metadata?: Record<string, unknown> }
): Promise<ClassroomAccessValidationResult> {
  if (!roomId || typeof roomId !== "string" || roomId.trim() === "") {
    return { valid: false, role: "student", participantName: "", reason: "invalid_room_id" };
  }

  // Check course room enrollment & access via RPC
  const { data: accessData, error: rpcError } = await supabaseClient.rpc("check_live_classroom_access", {
    p_room_id: roomId,
    p_user_id: userId,
  });

  // Fail-closed: RPC error or null data must immediately deny access
  if (rpcError || !accessData) {
    return {
      valid: false,
      role: "student",
      participantName: "",
      reason: "access_check_failed",
    };
  }

  // Reject unknown / unresolved rooms (must be a valid live_session or legacy course room)
  const isSession = Boolean(accessData.is_session);
  const isCourseRoom = Boolean(accessData.is_course_room);
  if (!isSession && !isCourseRoom) {
    return {
      valid: false,
      role: "student",
      participantName: "",
      reason: accessData.reason || "room_not_found",
    };
  }

  // Enforce classroom authorization
  if (!accessData.allowed) {
    return {
      valid: false,
      role: "student",
      participantName: "",
      reason: accessData.reason || "not_enrolled",
    };
  }

  // Look up user profile from the database
  const { data: userProfile } = await supabaseClient
    .from("users")
    .select("id, name, email, role")
    .eq("id", userId)
    .maybeSingle();

  // If not in public.users, use authenticated user metadata from auth.users (fallback)
  const userEmail = userProfile?.email || fallbackUser?.email || "";
  const userRole = userProfile?.role || (fallbackUser?.app_metadata?.role as string) || "student";
  const displayName =
    userProfile?.name ||
    (fallbackUser?.user_metadata?.name as string) ||
    userEmail.split("@")[0] ||
    "User";

  // System roles: creator and admin can host as 'teacher'
  const isPlatformHost = userRole === "creator" || userRole === "admin";

  // Authoritative role resolution strictly derived from database accessData
  let assignedRole: ClassroomRole;
  if (accessData.role === "teacher" || accessData.role === "assistant" || accessData.role === "student") {
    assignedRole = accessData.role as ClassroomRole;
  } else if (!accessData.is_session && isCourseRoom) {
    // Legacy course room fallback without explicit role in accessData
    if (accessData.is_creator || isPlatformHost) {
      assignedRole = "teacher";
    } else {
      assignedRole = "student";
    }
  } else {
    // Fail-closed on invalid or unresolved classroom role
    return {
      valid: false,
      role: "student",
      participantName: "",
      reason: "invalid_role_resolution",
    };
  }

  // Only permit roomId fallback when explicitly confirmed as a valid legacy course room
  const resolvedRoomName =
    typeof accessData.livekit_room_name === "string" && accessData.livekit_room_name.trim()
      ? accessData.livekit_room_name.trim()
      : isCourseRoom
        ? roomId
        : undefined;

  if (!resolvedRoomName) {
    return {
      valid: false,
      role: "student",
      participantName: "",
      reason: "access_check_failed",
    };
  }

  return {
    valid: true,
    role: assignedRole,
    participantName: displayName,
    livekitRoomName: resolvedRoomName,
    sessionTitle: (accessData.session_title as string) || undefined,
  };
}

/** Optional helper to load local .env for development if not injected by Supabase CLI */
async function loadLocalEnvFallback() {
  if (typeof Deno === "undefined" || !Deno.readTextFile) return;
  const possiblePaths = [
    new URL("../.env", import.meta.url).pathname,
    new URL("./.env", import.meta.url).pathname,
  ];

  for (const path of possiblePaths) {
    try {
      const content = await Deno.readTextFile(path);
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
          if (!Deno.env.get(key) && val) {
            Deno.env.set(key, val);
          }
        }
      }
    } catch {
      // In production or when local .env is absent, ignore silently
    }
  }
}

export async function handleLivekitTokenRequest(
  req: Request,
  deps: LivekitTokenDependencies = {}
): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method Not Allowed" }),
      { status: 405, headers: { ...CORS_HEADERS, "Content-Type": "application/json", allow: "POST" } }
    );
  }

  await loadLocalEnvFallback();

  const getEnv = (key: string): string | undefined => {
    if (deps.env && key in deps.env) {
      return deps.env[key];
    }
    return typeof Deno !== "undefined" && Deno.env ? Deno.env.get(key) : undefined;
  };

  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = getEnv("SUPABASE_ANON_KEY");
  const livekitApiKey = getEnv("LIVEKIT_API_KEY");
  const livekitApiSecret = getEnv("LIVEKIT_API_SECRET");
  const livekitUrl = getEnv("LIVEKIT_URL");

  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    console.error("livekit-token: Supabase configuration missing");
    return new Response(
      JSON.stringify({ error: "Server misconfigured" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  if (!livekitApiKey || !livekitApiSecret || !livekitUrl) {
    console.error("livekit-token: LiveKit credentials missing in environment");
    return new Response(
      JSON.stringify({ error: "LiveKit server credentials not configured" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // 1. Authenticate caller via JWT
  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or malformed Authorization header" }),
      { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
  const jwt = authHeader.slice("Bearer ".length).trim();

  const authClient =
    deps.authClient ??
    createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

  const { data: userData, error: userErr } = await authClient.auth.getUser(jwt);
  if (userErr || !userData?.user) {
    return new Response(
      JSON.stringify({ error: "Invalid authentication token" }),
      { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  const authenticatedUserId = userData.user.id;

  // 2. Parse request body
  let body: LivekitTokenRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Malformed JSON body" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  const { roomId, userId, role: requestedRole, name: requestedName } = body;

  if (typeof roomId !== "string" || !roomId.trim()) {
    return new Response(
      JSON.stringify({ error: "roomId is required and must be a string" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  if (typeof userId !== "string" || !userId.trim()) {
    return new Response(
      JSON.stringify({ error: "userId is required and must be a string" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // 3. Verify userId matches authenticated user
  if (userId !== authenticatedUserId) {
    return new Response(
      JSON.stringify({ error: "Forbidden: Request userId does not match authenticated session" }),
      { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  // 4. Validate classroom session and role authorization using service role client
  const serviceClient =
    deps.serviceClient ??
    createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

  const accessCheck = await validateClassroomAccess(
    serviceClient,
    roomId,
    authenticatedUserId,
    typeof requestedRole === "string" ? requestedRole : undefined,
    userData.user
  );

  if (!accessCheck.valid) {
    return new Response(
      JSON.stringify({ error: accessCheck.reason || "Access denied to classroom", reason: accessCheck.reason }),
      { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  const participantName =
    typeof requestedName === "string" && requestedName.trim()
      ? requestedName.trim()
      : accessCheck.participantName;

  // 5. Construct LiveKit Access Token
  // LiveKit participant identity MUST strictly equal the authenticated Supabase user ID.
  const at = new AccessToken(
    livekitApiKey,
    livekitApiSecret,
    {
      identity: authenticatedUserId,
      name: participantName,
      ttl: "2h", // Reasonable short TTL (2 hours)
      metadata: JSON.stringify({
        role: accessCheck.role,
        userId: authenticatedUserId,
      }),
    }
  );

  // 6. Add VideoGrant
  // All participants (teacher, assistant, and student) must be capable of publishing
  // audio/video when the classroom UI permits it (client UI manages active mic/cam).
  at.addGrant({
    roomJoin: true,
    room: accessCheck.livekitRoomName,
    canSubscribe: true,
    canPublishData: true,
    canPublish: true,
  });

  const token = await at.toJwt();

  return new Response(
    JSON.stringify({
      token,
      serverUrl: livekitUrl,
      role: accessCheck.role,
      identity: authenticatedUserId,
      roomName: accessCheck.livekitRoomName,
      sessionTitle: accessCheck.sessionTitle,
    }),
    {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
    }
  );
}

serve(handleLivekitTokenRequest);
