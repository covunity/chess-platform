import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  verifyBunnySignature,
  handleBunnyWebhook,
} from "./index.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ── Fake Supabase client ───────────────────────────────────────────────────

function fakeClient(opts: {
  updateErr?: { message: string } | null;
}): {
  client: SupabaseClient;
  updates: Array<{ table: string; patch: Record<string, unknown>; filters: Record<string, unknown> }>;
} {
  const updates: Array<{
    table: string;
    patch: Record<string, unknown>;
    filters: Record<string, unknown>;
  }> = [];

  const client = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      return {
        update(patch: Record<string, unknown>) {
          return {
            eq(col: string, val: unknown) {
              filters[col] = val;
              // Check if we have both eq filters
              const eqFilters = { ...filters };
              return {
                eq(col2: string, val2: unknown) {
                  eqFilters[col2] = val2;
                  updates.push({ table, patch, filters: eqFilters });
                  return Promise.resolve({ error: opts.updateErr ?? null });
                },
              };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, updates };
}

// ── HMAC helper for tests ─────────────────────────────────────────────────

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const TEST_SECRET = "webhook-secret-key-123";
const TEST_BODY = JSON.stringify({ VideoGuid: "guid-test", Status: 4 });

const BASE_OPTS = {
  bunnyLibraryId: 42,
  bunnyApiKey: "bunny-api-key",
};

// ── verifyBunnySignature ──────────────────────────────────────────────────

Deno.test("verifyBunnySignature — valid HMAC-SHA256 signature passes", async () => {
  const sig = await hmacSha256Hex(TEST_SECRET, TEST_BODY);
  const result = await verifyBunnySignature(TEST_SECRET, TEST_BODY, sig);
  assertEquals(result, true);
});

Deno.test("verifyBunnySignature — wrong secret fails", async () => {
  const sig = await hmacSha256Hex("wrong-secret", TEST_BODY);
  const result = await verifyBunnySignature(TEST_SECRET, TEST_BODY, sig);
  assertEquals(result, false);
});

Deno.test("verifyBunnySignature — tampered body fails", async () => {
  const sig = await hmacSha256Hex(TEST_SECRET, TEST_BODY);
  const result = await verifyBunnySignature(TEST_SECRET, "tampered body", sig);
  assertEquals(result, false);
});

Deno.test("verifyBunnySignature — null signature fails", async () => {
  const result = await verifyBunnySignature(TEST_SECRET, TEST_BODY, null);
  assertEquals(result, false);
});

Deno.test("verifyBunnySignature — empty signature fails", async () => {
  const result = await verifyBunnySignature(TEST_SECRET, TEST_BODY, "");
  assertEquals(result, false);
});

// ── handleBunnyWebhook — Status=4 (processing) ───────────────────────────

Deno.test("handleBunnyWebhook — Status=4 sets video_status='processing'", async () => {
  const { client, updates } = fakeClient({});

  const outcome = await handleBunnyWebhook(
    client,
    { VideoGuid: "guid-abc", Status: 4 },
    BASE_OPTS,
  );

  assertEquals(outcome.kind, "processing");
  assertEquals(updates.length, 1);
  assertEquals(updates[0].patch.video_status, "processing");
  assertEquals(updates[0].filters["video_provider"], "bunny");
  assertEquals(updates[0].filters["video_provider_id"], "guid-abc");
});

// ── handleBunnyWebhook — Status=3 (ready) ────────────────────────────────

Deno.test("handleBunnyWebhook — Status=3 fetches metadata and sets video_status='ready'", async () => {
  const { client, updates } = fakeClient({});

  const metaFetch: typeof fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          guid: "guid-abc",
          length: 185,
          thumbnailFileName: "thumbnail.jpg",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

  const outcome = await handleBunnyWebhook(
    client,
    { VideoGuid: "guid-abc", Status: 3 },
    { ...BASE_OPTS, fetchFn: metaFetch },
  );

  assertEquals(outcome.kind, "ready");
  if (outcome.kind === "ready") {
    assertEquals(outcome.durationSeconds, 185);
    assertEquals(
      outcome.thumbnailUrl,
      "https://vz-42.b-cdn.net/guid-abc/thumbnail.jpg",
    );
  }
  assertEquals(updates.length, 1);
  assertEquals(updates[0].patch.video_status, "ready");
  assertEquals(updates[0].patch.duration_seconds, 185);
  assertEquals(
    updates[0].patch.video_thumbnail_url,
    "https://vz-42.b-cdn.net/guid-abc/thumbnail.jpg",
  );
});

Deno.test("handleBunnyWebhook — Status=3 without thumbnailFileName sets status='ready' without thumbnail", async () => {
  const { client, updates } = fakeClient({});

  const metaFetch: typeof fetch = () =>
    Promise.resolve(
      new Response(
        JSON.stringify({ guid: "guid-abc", length: 120 }),
        { status: 200 },
      ),
    );

  const outcome = await handleBunnyWebhook(
    client,
    { VideoGuid: "guid-abc", Status: 3 },
    { ...BASE_OPTS, fetchFn: metaFetch },
  );

  assertEquals(outcome.kind, "ready");
  if (outcome.kind === "ready") {
    assertEquals(outcome.durationSeconds, 120);
    assertEquals(outcome.thumbnailUrl, null);
  }
  assertEquals(updates[0].patch.video_status, "ready");
  assertEquals(updates[0].patch.duration_seconds, 120);
  assertEquals("video_thumbnail_url" in updates[0].patch, false);
});

Deno.test("handleBunnyWebhook — Status=3 Bunny metadata fetch fails → still sets ready without metadata", async () => {
  const { client, updates } = fakeClient({});

  const throwingFetch: typeof fetch = () =>
    Promise.reject(new Error("network error"));

  const outcome = await handleBunnyWebhook(
    client,
    { VideoGuid: "guid-abc", Status: 3 },
    { ...BASE_OPTS, fetchFn: throwingFetch },
  );

  assertEquals(outcome.kind, "ready");
  if (outcome.kind === "ready") {
    assertEquals(outcome.durationSeconds, null);
    assertEquals(outcome.thumbnailUrl, null);
  }
  assertEquals(updates[0].patch.video_status, "ready");
});

// ── handleBunnyWebhook — Status=5 (error) ────────────────────────────────

Deno.test("handleBunnyWebhook — Status=5 sets video_status='error'", async () => {
  const { client, updates } = fakeClient({});

  const outcome = await handleBunnyWebhook(
    client,
    { VideoGuid: "guid-err", Status: 5 },
    BASE_OPTS,
  );

  assertEquals(outcome.kind, "error");
  assertEquals(updates.length, 1);
  assertEquals(updates[0].patch.video_status, "error");
  assertEquals(updates[0].patch.video_error, "Bunny encoding failed");
  assertEquals(updates[0].filters["video_provider"], "bunny");
  assertEquals(updates[0].filters["video_provider_id"], "guid-err");
});

// ── handleBunnyWebhook — unknown status ──────────────────────────────────

Deno.test("handleBunnyWebhook — unknown status returns noop without DB write", async () => {
  const { client, updates } = fakeClient({});

  const outcome = await handleBunnyWebhook(
    client,
    { VideoGuid: "guid-abc", Status: 99 },
    BASE_OPTS,
  );

  assertEquals(outcome.kind, "noop");
  assertEquals(updates.length, 0);
});

Deno.test("handleBunnyWebhook — missing VideoGuid returns noop", async () => {
  const { client, updates } = fakeClient({});

  const outcome = await handleBunnyWebhook(
    client,
    { Status: 4 },
    BASE_OPTS,
  );

  assertEquals(outcome.kind, "noop");
  assertEquals(updates.length, 0);
});

Deno.test("handleBunnyWebhook — DB update error returns db_error", async () => {
  const { client } = fakeClient({
    updateErr: { message: "DB connection failed" },
  });

  const outcome = await handleBunnyWebhook(
    client,
    { VideoGuid: "guid-abc", Status: 4 },
    BASE_OPTS,
  );

  assertEquals(outcome.kind, "db_error");
  if (outcome.kind === "db_error") {
    assertEquals(outcome.message, "DB connection failed");
  }
});

Deno.test("handleBunnyWebhook — matches by video_provider='bunny' AND video_provider_id=VideoGuid", async () => {
  const { client, updates } = fakeClient({});

  await handleBunnyWebhook(
    client,
    { VideoGuid: "specific-guid", Status: 5 },
    BASE_OPTS,
  );

  assertEquals(updates[0].filters["video_provider"], "bunny");
  assertEquals(updates[0].filters["video_provider_id"], "specific-guid");
});
