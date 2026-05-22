import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  createVideoUpload,
  computeTusSignature,
  sha256Hex,
} from "./index.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ── Fake Supabase client ───────────────────────────────────────────────────

interface LessonRow {
  id: string;
  chapters: {
    course_id: string;
    courses: { creator_id: string };
  };
}

function fakeClient(opts: {
  lesson?: LessonRow | null;
  lessonErr?: { message: string } | null;
  updateErr?: { message: string } | null;
  configMaxBytes?: number | null;
}): {
  client: SupabaseClient;
  updates: Array<Record<string, unknown>>;
} {
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      if (table === "config") {
        return {
          select() { return this; },
          eq() { return this; },
          single() {
            return Promise.resolve({
              data: opts.configMaxBytes != null
                ? { value_int: opts.configMaxBytes }
                : null,
              error: null,
            });
          },
        };
      }
      if (table === "lessons") {
        return {
          select() { return this; },
          eq() { return this; },
          maybeSingle() {
            return Promise.resolve({
              data: opts.lesson ?? null,
              error: opts.lessonErr ?? null,
            });
          },
          update(patch: Record<string, unknown>) {
            updates.push(patch);
            return {
              eq() {
                return Promise.resolve({ error: opts.updateErr ?? null });
              },
            };
          },
        };
      }
      return {};
    },
  } as unknown as SupabaseClient;
  return { client, updates };
}

// Happy-path Bunny API fetch: returns { guid: "video-guid-1" }
function happyBunnyFetch(): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ guid: "video-guid-1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
}

const LESSON_ROW: LessonRow = {
  id: "lesson-1",
  chapters: {
    course_id: "course-1",
    courses: { creator_id: "creator-1" },
  },
};

const BASE_OPTS = {
  callerId: "creator-1",
  callerRole: "creator",
  lessonId: "lesson-1",
  filename: "lecture.mp4",
  sizeBytes: 100_000_000, // 100 MB
  maxBytes: 1_073_741_824, // 1 GB
  bunnyLibraryId: 42,
  bunnyApiKey: "bunny-api-key",
  fetchFn: happyBunnyFetch(),
  nowSeconds: () => 1_700_000_000,
};

// ── sha256Hex ─────────────────────────────────────────────────────────────

Deno.test("sha256Hex — produces 64-char lowercase hex", async () => {
  const out = await sha256Hex("hello world");
  assertEquals(out.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(out), true);
});

Deno.test("sha256Hex — deterministic for same input", async () => {
  const a = await sha256Hex("test-input");
  const b = await sha256Hex("test-input");
  assertEquals(a, b);
});

Deno.test("sha256Hex — different inputs produce different hashes", async () => {
  const a = await sha256Hex("input-a");
  const b = await sha256Hex("input-b");
  assertEquals(a !== b, true);
});

// ── computeTusSignature ───────────────────────────────────────────────────

Deno.test("computeTusSignature — matches expected Bunny formula SHA256(libId+apiKey+expiry+guid)", async () => {
  // Expected: SHA256("42" + "key" + "1700003600" + "guid-abc")
  const expected = await sha256Hex("42key1700003600guid-abc");
  const result = await computeTusSignature(42, "key", 1700003600, "guid-abc");
  assertEquals(result, expected);
});

// ── createVideoUpload ─────────────────────────────────────────────────────

Deno.test("createVideoUpload — happy path returns TUS credentials", async () => {
  const { client, updates } = fakeClient({ lesson: LESSON_ROW });

  const result = await createVideoUpload(client, BASE_OPTS);

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.uploadEndpoint, "https://video.bunnycdn.com/tusupload");
    assertEquals(result.videoGuid, "video-guid-1");
    assertEquals(result.libraryId, 42);
    assertEquals(result.authorizationExpire, 1_700_003_600);
    // Signature must be a 64-char hex
    assertEquals(result.authorizationSignature.length, 64);
    assertEquals(/^[0-9a-f]{64}$/.test(result.authorizationSignature), true);
  }
  // Lessons row must have been updated
  assertEquals(updates.length, 1);
  assertEquals(updates[0].video_provider, "bunny");
  assertEquals(updates[0].video_provider_id, "video-guid-1");
  assertEquals(updates[0].video_status, "uploading");
  assertEquals(updates[0].video_mime, "video/mp4");
  assertEquals(updates[0].bunny_library_id, 42);
});

Deno.test("createVideoUpload — sizeBytes exceeds maxBytes → 413 file_too_large", async () => {
  const { client } = fakeClient({ lesson: LESSON_ROW });

  const result = await createVideoUpload(client, {
    ...BASE_OPTS,
    sizeBytes: 2_000_000_000, // 2 GB
    maxBytes: 1_073_741_824, // 1 GB
  });

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 413);
    assertEquals(result.reason, "file_too_large");
  }
});

Deno.test("createVideoUpload — creator does not own lesson → 403 not_authorized", async () => {
  const { client } = fakeClient({
    lesson: {
      ...LESSON_ROW,
      chapters: {
        course_id: "course-1",
        courses: { creator_id: "other-creator" }, // different owner
      },
    },
  });

  const result = await createVideoUpload(client, {
    ...BASE_OPTS,
    callerId: "creator-1", // not the owner
    callerRole: "creator",
  });

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 403);
    assertEquals(result.reason, "not_authorized");
  }
});

Deno.test("createVideoUpload — lesson not found → 403 not_authorized", async () => {
  const { client } = fakeClient({ lesson: null });

  const result = await createVideoUpload(client, {
    ...BASE_OPTS,
    callerRole: "creator",
  });

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 403);
    assertEquals(result.reason, "not_authorized");
  }
});

Deno.test("createVideoUpload — admin can upload to any lesson", async () => {
  // Admin should bypass the creator ownership check.
  // We simulate admin by setting callerRole='admin' with no matching lesson.
  const { client, updates } = fakeClient({
    lesson: null, // would fail for creator, but admin skips ownership check
  });

  const result = await createVideoUpload(client, {
    ...BASE_OPTS,
    callerId: "admin-user",
    callerRole: "admin",
  });

  // Admin should proceed to Bunny call and lesson update (no ownership check).
  assertEquals(result.ok, true);
  assertEquals(updates.length, 1);
});

Deno.test("createVideoUpload — Bunny API unreachable → 502 bunny_unreachable", async () => {
  const { client } = fakeClient({ lesson: LESSON_ROW });

  const throwingFetch: typeof fetch = () =>
    Promise.reject(new Error("network error"));

  const result = await createVideoUpload(client, {
    ...BASE_OPTS,
    fetchFn: throwingFetch,
  });

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 502);
    assertEquals(result.reason, "bunny_unreachable");
  }
});

Deno.test("createVideoUpload — Bunny API returns non-200 → 502 bunny_create_failed", async () => {
  const { client } = fakeClient({ lesson: LESSON_ROW });

  const failingFetch: typeof fetch = () =>
    Promise.resolve(new Response(null, { status: 401 }));

  const result = await createVideoUpload(client, {
    ...BASE_OPTS,
    fetchFn: failingFetch,
  });

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 502);
    assertEquals(result.reason, "bunny_create_failed");
  }
});

Deno.test("createVideoUpload — Bunny returns JSON without guid → 502 bunny_missing_guid", async () => {
  const { client } = fakeClient({ lesson: LESSON_ROW });

  const noGuidFetch: typeof fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ status: "created" }), { status: 200 }),
    );

  const result = await createVideoUpload(client, {
    ...BASE_OPTS,
    fetchFn: noGuidFetch,
  });

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 502);
    assertEquals(result.reason, "bunny_missing_guid");
  }
});

Deno.test("createVideoUpload — lesson DB update fails → 500 lesson_update_failed", async () => {
  const { client } = fakeClient({
    lesson: LESSON_ROW,
    updateErr: { message: "DB error" },
  });

  const result = await createVideoUpload(client, BASE_OPTS);

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 500);
    assertEquals(result.reason, "lesson_update_failed");
  }
});

Deno.test("createVideoUpload — TUS signature expires at now+3600", async () => {
  const { client } = fakeClient({ lesson: LESSON_ROW });

  const result = await createVideoUpload(client, {
    ...BASE_OPTS,
    nowSeconds: () => 2_000_000_000,
  });

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.authorizationExpire, 2_000_003_600);
  }
});

Deno.test("createVideoUpload — updates lessons with filename and size_bytes", async () => {
  const { client, updates } = fakeClient({ lesson: LESSON_ROW });

  await createVideoUpload(client, {
    ...BASE_OPTS,
    filename: "my-lecture.mp4",
    sizeBytes: 50_000_000,
  });

  assertEquals(updates[0].video_filename, "my-lecture.mp4");
  assertEquals(updates[0].video_size_bytes, 50_000_000);
});
