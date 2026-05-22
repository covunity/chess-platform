import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// POST /functions/v1/bunny-webhook  (--no-verify-jwt)
//
// Bunny Stream sends this webhook when a video changes status.
// Body: { VideoGuid: string, Status: number, ... }
//
// Status codes from Bunny CDN:
//   0 = Created
//   1 = Uploaded
//   2 = Processing
//   3 = Transcoding finished (ready)
//   4 = Resolution finished
//   5 = Error
//   6 = Upload failed
//
// Per spec:
//   Status=4 → video_status='processing'
//   Status=3 → fetch Bunny metadata → video_status='ready', duration_seconds, video_thumbnail_url
//   Status=5 → video_status='error', video_error='Bunny encoding failed'
//
// Security: HMAC-SHA256(key=BUNNY_WEBHOOK_SECRET, message=rawBody) verified against
// the `bunny-signature` request header.
//
// Always returns 200 after valid signature (even for unknown status codes).
// Bunny retries on non-200 responses.

export interface BunnyWebhookPayload {
  VideoGuid?: unknown;
  Status?: unknown;
  [key: string]: unknown;
}

export type WebhookOutcome =
  | { kind: "processing" }
  | { kind: "ready"; durationSeconds: number | null; thumbnailUrl: string | null }
  | { kind: "error" }
  | { kind: "noop" }
  | { kind: "db_error"; message: string };

/** Verify Bunny webhook signature: HMAC-SHA256(key, message) in hex. */
export async function verifyBunnySignature(
  secret: string,
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  if (!signature) return false;

  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(rawBody));
  const computed = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (computed.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Process a verified Bunny webhook payload and update the lessons table.
 */
export async function handleBunnyWebhook(
  client: SupabaseClient,
  payload: BunnyWebhookPayload,
  options: {
    bunnyLibraryId: number;
    bunnyApiKey: string;
    fetchFn?: typeof fetch;
  },
): Promise<WebhookOutcome> {
  const fetchFn = options.fetchFn ?? fetch;

  const videoGuid = typeof payload.VideoGuid === "string" ? payload.VideoGuid : null;
  const status = typeof payload.Status === "number" ? payload.Status : null;

  if (!videoGuid || status === null) {
    return { kind: "noop" };
  }

  if (status === 4) {
    // Resolution finished — mark as 'processing' (transcoding still running)
    const { error } = await client
      .from("lessons")
      .update({ video_status: "processing" })
      .eq("video_provider", "bunny")
      .eq("video_provider_id", videoGuid);

    if (error) {
      return { kind: "db_error", message: error.message ?? "update failed" };
    }
    return { kind: "processing" };
  }

  if (status === 3) {
    // Transcoding finished — fetch metadata from Bunny and mark ready.
    let metaRes: Response;
    try {
      metaRes = await fetchFn(
        `https://video.bunnycdn.com/library/${options.bunnyLibraryId}/videos/${videoGuid}`,
        {
          headers: { AccessKey: options.bunnyApiKey },
        },
      );
    } catch {
      // If we can't fetch metadata, still mark ready without duration/thumbnail.
      const { error } = await client
        .from("lessons")
        .update({ video_status: "ready" })
        .eq("video_provider", "bunny")
        .eq("video_provider_id", videoGuid);

      if (error) {
        return { kind: "db_error", message: error.message ?? "update failed" };
      }
      return { kind: "ready", durationSeconds: null, thumbnailUrl: null };
    }

    let durationSeconds: number | null = null;
    let thumbnailUrl: string | null = null;

    if (metaRes.ok) {
      try {
        const meta = await metaRes.json() as {
          length?: number;
          thumbnailFileName?: string;
        };
        if (typeof meta.length === "number") {
          durationSeconds = meta.length;
        }
        if (typeof meta.thumbnailFileName === "string" && meta.thumbnailFileName) {
          thumbnailUrl =
            `https://vz-${options.bunnyLibraryId}.b-cdn.net/${videoGuid}/${meta.thumbnailFileName}`;
        }
      } catch {
        // ignore JSON parse errors
      }
    }

    const { error } = await client
      .from("lessons")
      .update({
        video_status: "ready",
        ...(durationSeconds !== null ? { duration_seconds: durationSeconds } : {}),
        ...(thumbnailUrl !== null ? { video_thumbnail_url: thumbnailUrl } : {}),
      })
      .eq("video_provider", "bunny")
      .eq("video_provider_id", videoGuid);

    if (error) {
      return { kind: "db_error", message: error.message ?? "update failed" };
    }
    return { kind: "ready", durationSeconds, thumbnailUrl };
  }

  if (status === 5 || status === 6) {
    // Encoding error or upload failure.
    const { error } = await client
      .from("lessons")
      .update({
        video_status: "error",
        video_error: "Bunny encoding failed",
      })
      .eq("video_provider", "bunny")
      .eq("video_provider_id", videoGuid);

    if (error) {
      return { kind: "db_error", message: error.message ?? "update failed" };
    }
    return { kind: "error" };
  }

  // Unknown or unhandled status — ignore gracefully.
  return { kind: "noop" };
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  }

  const webhookSecret = Deno.env.get("BUNNY_WEBHOOK_SECRET");
  if (!webhookSecret) {
    console.error("bunny-webhook: BUNNY_WEBHOOK_SECRET env var missing");
    return new Response(null, { status: 500 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const bunnyApiKey = Deno.env.get("BUNNY_API_KEY");
  const bunnyLibraryIdStr = Deno.env.get("BUNNY_LIBRARY_ID");

  if (!supabaseUrl || !serviceRoleKey || !bunnyApiKey || !bunnyLibraryIdStr) {
    console.error("bunny-webhook: required env var missing");
    return new Response(null, { status: 500 });
  }

  const bunnyLibraryId = parseInt(bunnyLibraryIdStr, 10);
  if (!Number.isFinite(bunnyLibraryId)) {
    console.error("bunny-webhook: BUNNY_LIBRARY_ID is not valid");
    return new Response(null, { status: 500 });
  }

  // Read raw body for signature verification.
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return new Response(null, { status: 400 });
  }

  const signature = req.headers.get("bunny-signature");
  const valid = await verifyBunnySignature(webhookSecret, rawBody, signature);
  if (!valid) {
    console.error("bunny-webhook: invalid signature");
    return new Response(null, { status: 403 });
  }

  let payload: BunnyWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(null, { status: 400 });
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const outcome = await handleBunnyWebhook(client, payload, {
    bunnyLibraryId,
    bunnyApiKey,
  });

  if (outcome.kind === "db_error") {
    console.error("bunny-webhook: DB update failed", { message: outcome.message });
  } else {
    console.info("bunny-webhook: processed", { kind: outcome.kind });
  }

  // Always return 200 after signature verification. Bunny retries on non-200.
  return new Response(null, { status: 200 });
});
