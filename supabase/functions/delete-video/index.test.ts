import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { deleteVideo } from "./index.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// ── Test data ─────────────────────────────────────────────────────────────────

const CREATOR_ID = "creator-user-1";
const OTHER_CREATOR_ID = "creator-user-2";
const ADMIN_ID = "admin-user-1";
const LESSON_ID = "lesson-id-42";
const LIBRARY_ID = 99;
const PROVIDER_ID = "video-guid-abc";

/** A full lesson row as returned from the DB join (bunny provider). */
const BUNNY_LESSON = {
  id: LESSON_ID,
  video_provider: "bunny",
  video_provider_id: PROVIDER_ID,
  bunny_library_id: LIBRARY_ID,
  chapters: {
    course_id: "course-1",
    courses: {
      creator_id: CREATOR_ID,
    },
  },
};

/** A lesson row with supabase provider. */
const SUPABASE_LESSON = {
  ...BUNNY_LESSON,
  video_provider: "supabase",
  video_provider_id: "storage-path",
  bunny_library_id: null,
};

/** Expected null-out patch applied to the DB after deletion. */
const NULL_OUT_PATCH = {
  video_provider: null,
  video_provider_id: null,
  bunny_library_id: null,
  video_thumbnail_url: null,
  video_status: "idle",
  video_filename: null,
  video_size_bytes: null,
  duration_seconds: null,
  video_error: null,
};

// ── Fake client builder ────────────────────────────────────────────────────────

function fakeClient(opts: {
  lesson?: typeof BUNNY_LESSON | null;
  lessonErr?: { message: string } | null;
  updateErr?: { message: string } | null;
}): { client: SupabaseClient; updates: Array<Record<string, unknown>> } {
  const updates: Array<Record<string, unknown>> = [];

  const client = {
    from(_table: string) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
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
    },
  } as unknown as SupabaseClient;

  return { client, updates };
}

// ── Fake fetch helpers ────────────────────────────────────────────────────────

function bunnyOkFetch(): typeof fetch {
  return () =>
    Promise.resolve(new Response(null, { status: 200 }));
}

function bunnyNotFoundFetch(): typeof fetch {
  return () =>
    Promise.resolve(new Response(null, { status: 404 }));
}

function bunnyErrorFetch(status = 500): typeof fetch {
  return () =>
    Promise.resolve(new Response(null, { status }));
}

// Track Bunny API call count
function trackingFetch(status = 200): { fetchFn: typeof fetch; calls: number[] } {
  const calls: number[] = [];
  const fetchFn: typeof fetch = () => {
    const res = new Response(null, { status });
    calls.push(status);
    return Promise.resolve(res);
  };
  return { fetchFn, calls };
}

const BASE_OPTS = {
  callerId: CREATOR_ID,
  callerRole: "creator",
  lessonId: LESSON_ID,
  bunnyApiKey: "bunny-secret-key",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

// Behavior 1: Non-owner, non-admin caller → 403, no Bunny API call, no DB mutation
Deno.test("deleteVideo — non-owner non-admin caller → 403, no Bunny call, no DB mutation", async () => {
  const { client, updates } = fakeClient({ lesson: BUNNY_LESSON });
  const { fetchFn, calls } = trackingFetch();

  const result = await deleteVideo(client, {
    ...BASE_OPTS,
    callerId: "some-other-user",
    callerRole: "learner",
    fetchFn,
  });

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 403);
    assertEquals(result.reason, "not_authorized");
  }
  assertEquals(calls.length, 0, "No Bunny API call should be made");
  assertEquals(updates.length, 0, "No DB mutation should happen");
});

// Behavior 2: Admin caller on another creator's lesson → allowed (204)
Deno.test("deleteVideo — admin caller on another creator's lesson → allowed, columns nulled", async () => {
  const { client, updates } = fakeClient({ lesson: BUNNY_LESSON });

  const result = await deleteVideo(client, {
    ...BASE_OPTS,
    callerId: ADMIN_ID,
    callerRole: "admin",
    fetchFn: bunnyOkFetch(),
  });

  assertEquals(result.ok, true);
  assertEquals(updates.length, 1);
  assertEquals(updates[0], NULL_OUT_PATCH);
});

// Behavior 3: Owner caller on bunny lesson → calls Bunny DELETE, nulls columns
Deno.test("deleteVideo — owner on bunny lesson → calls Bunny DELETE then nulls columns", async () => {
  const { client, updates } = fakeClient({ lesson: BUNNY_LESSON });
  let bunnyCalled = false;
  let bunnyUrl = "";
  const fetchFn: typeof fetch = (input) => {
    bunnyCalled = true;
    bunnyUrl = typeof input === "string" ? input : (input as Request).url;
    return Promise.resolve(new Response(null, { status: 200 }));
  };

  const result = await deleteVideo(client, {
    ...BASE_OPTS,
    fetchFn,
  });

  assertEquals(result.ok, true);
  assertEquals(bunnyCalled, true, "Bunny DELETE should be called");
  assertEquals(
    bunnyUrl,
    `https://video.bunnycdn.com/library/${LIBRARY_ID}/videos/${PROVIDER_ID}`,
  );
  assertEquals(updates.length, 1);
  assertEquals(updates[0], NULL_OUT_PATCH);
});

// Behavior 4: Owner caller on supabase provider → does NOT call Bunny, still nulls columns
Deno.test("deleteVideo — owner on supabase lesson → no Bunny call, columns still nulled", async () => {
  const { client, updates } = fakeClient({ lesson: SUPABASE_LESSON });
  const { fetchFn, calls } = trackingFetch();

  const result = await deleteVideo(client, {
    ...BASE_OPTS,
    fetchFn,
  });

  assertEquals(result.ok, true);
  assertEquals(calls.length, 0, "Bunny should NOT be called for supabase provider");
  assertEquals(updates.length, 1);
  assertEquals(updates[0], NULL_OUT_PATCH);
});

// Behavior 5: Bunny DELETE returns 404 → treats as success (idempotent), nulls columns
Deno.test("deleteVideo — Bunny DELETE returns 404 → idempotent success, columns nulled", async () => {
  const { client, updates } = fakeClient({ lesson: BUNNY_LESSON });

  const result = await deleteVideo(client, {
    ...BASE_OPTS,
    fetchFn: bunnyNotFoundFetch(),
  });

  assertEquals(result.ok, true);
  assertEquals(updates.length, 1);
  assertEquals(updates[0], NULL_OUT_PATCH);
});

// Behavior 6: Bunny DELETE returns 500 → propagates error, don't null columns
Deno.test("deleteVideo — Bunny DELETE returns 500 → propagates error, no DB mutation", async () => {
  const { client, updates } = fakeClient({ lesson: BUNNY_LESSON });

  const result = await deleteVideo(client, {
    ...BASE_OPTS,
    fetchFn: bunnyErrorFetch(500),
  });

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 502);
    assertEquals(result.reason, "bunny_delete_failed");
  }
  assertEquals(updates.length, 0, "DB must not be mutated on Bunny error");
});

// Behavior 7: lesson not found → 404
Deno.test("deleteVideo — lesson not found → 404", async () => {
  const { client } = fakeClient({ lesson: null });

  const result = await deleteVideo(client, {
    ...BASE_OPTS,
    fetchFn: bunnyOkFetch(),
  });

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 404);
    assertEquals(result.reason, "lesson_not_found");
  }
});

// Behavior 8: DB null-out fails → propagates error
Deno.test("deleteVideo — DB null-out fails → propagates error", async () => {
  const { client } = fakeClient({
    lesson: BUNNY_LESSON,
    updateErr: { message: "db write error" },
  });

  const result = await deleteVideo(client, {
    ...BASE_OPTS,
    fetchFn: bunnyOkFetch(),
  });

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 500);
    assertEquals(result.reason, "lesson_update_failed");
  }
});
