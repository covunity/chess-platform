import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  buildPaymentSignaturePayload,
  createPayosPayment,
  hmacSha256Hex,
} from "./index.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const PENDING_ORDER = {
  id: "ord-1",
  user_id: "user-1",
  code: "ORD-2026-000042",
  amount: 480000,
  status: "pending",
  payos_order_code: 42,
  payos_payment_link_id: null,
};

interface OrderRow {
  id: string;
  user_id: string;
  code: string;
  amount: number;
  status: string;
  payos_order_code: number | null;
  payos_payment_link_id: string | null;
  payos_payment_payload?: Record<string, unknown> | null;
}

function fakeClient(opts: {
  order?: OrderRow | null;
  orderErr?: { message: string } | null;
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
          return Promise.resolve({ data: opts.order ?? null, error: opts.orderErr ?? null });
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

const PAYOS_HAPPY_RESPONSE = {
  code: "00",
  desc: "success",
  data: {
    qrCode: "QR_PAYLOAD",
    accountNumber: "0123456789",
    accountName: "CTY ABC",
    bin: "970422",
    amount: 480000,
    description: "ORD-2026-000042",
    paymentLinkId: "linkid-1",
    checkoutUrl: "https://pay.payos.vn/web/linkid-1",
  },
};

function happyFetch(): typeof fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify(PAYOS_HAPPY_RESPONSE), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
}

const BASE_OPTS = {
  callerId: "user-1",
  orderId: "ord-1",
  appOrigin: "https://app.test",
  clientId: "cid",
  apiKey: "apikey",
  checksumKey: "checksum",
  nowSeconds: () => 1_700_000_000,
};

Deno.test("buildPaymentSignaturePayload — fields concatenated in PayOS-documented order", () => {
  assertEquals(
    buildPaymentSignaturePayload({
      amount: 100,
      cancelUrl: "https://x/c",
      description: "ORD-2026-000001",
      orderCode: 1,
      returnUrl: "https://x/r",
    }),
    "amount=100&cancelUrl=https://x/c&description=ORD-2026-000001&orderCode=1&returnUrl=https://x/r",
  );
});

Deno.test("hmacSha256Hex — produces 64-char lowercase hex", async () => {
  const out = await hmacSha256Hex("key", "message");
  assertEquals(out.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(out), true);
});

// Regression fixture for issue #273. The HMAC below was computed
// externally via:
//
//   echo -n 'amount=100000&cancelUrl=https://example.com/cancel&description=TEST&orderCode=123&returnUrl=https://example.com/return' \
//     | openssl dgst -sha256 -hmac 'test_checksum_key' -r
//
// If this assertion ever fails, either the canonicalization in
// buildPaymentSignaturePayload drifted from the PayOS official Node SDK
// (src/crypto/node-crypto.ts → createSignatureOfPaymentRequest), or the
// HMAC implementation regressed. Both are payment-critical — investigate
// before deploying.
Deno.test("createPayosPayment signature — fixture matches PayOS official SDK", async () => {
  const payload = buildPaymentSignaturePayload({
    amount: 100000,
    cancelUrl: "https://example.com/cancel",
    description: "TEST",
    orderCode: 123,
    returnUrl: "https://example.com/return",
  });
  assertEquals(
    payload,
    "amount=100000&cancelUrl=https://example.com/cancel&description=TEST&orderCode=123&returnUrl=https://example.com/return",
  );
  const sig = await hmacSha256Hex("test_checksum_key", payload);
  assertEquals(
    sig,
    "2c5f2c8f053937cc478fe8ef3bc4cff6d6997a85b0695f702c1efbed276cc12b",
  );
});

Deno.test("createPayosPayment — happy path returns QR + persists paymentLinkId", async () => {
  const { client, updates } = fakeClient({ order: PENDING_ORDER });
  const result = await createPayosPayment(client, { ...BASE_OPTS, fetchFn: happyFetch() });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.qrCode, "QR_PAYLOAD");
    assertEquals(result.checkoutUrl, "https://pay.payos.vn/web/linkid-1");
  }
  assertEquals(updates.length, 1);
  assertEquals(updates[0].payos_payment_link_id, "linkid-1");
});

Deno.test("createPayosPayment — order not found → 404", async () => {
  const { client } = fakeClient({ order: null });
  const result = await createPayosPayment(client, { ...BASE_OPTS, fetchFn: happyFetch() });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 404);
    assertEquals(result.reason, "order_not_found");
  }
});

Deno.test("createPayosPayment — caller is not owner → 403", async () => {
  const { client } = fakeClient({
    order: { ...PENDING_ORDER, user_id: "someone-else" },
  });
  const result = await createPayosPayment(client, { ...BASE_OPTS, fetchFn: happyFetch() });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 403);
    assertEquals(result.reason, "not_order_owner");
  }
});

Deno.test("createPayosPayment — order already active → 409", async () => {
  const { client } = fakeClient({
    order: { ...PENDING_ORDER, status: "active" },
  });
  const result = await createPayosPayment(client, { ...BASE_OPTS, fetchFn: happyFetch() });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 409);
    assertEquals(result.reason, "order_not_pending");
  }
});

Deno.test("createPayosPayment — payos returns non-00 code → 502", async () => {
  const { client } = fakeClient({ order: PENDING_ORDER });
  const failingFetch: typeof fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ code: "99", desc: "fail" }), { status: 200 }),
    );
  const result = await createPayosPayment(client, { ...BASE_OPTS, fetchFn: failingFetch });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 502);
    assertEquals(result.reason, "payos_returned_error");
  }
});

Deno.test("createPayosPayment — payos fetch throws → 502 unreachable", async () => {
  const { client } = fakeClient({ order: PENDING_ORDER });
  const throwingFetch: typeof fetch = () => Promise.reject(new Error("network down"));
  const result = await createPayosPayment(client, { ...BASE_OPTS, fetchFn: throwingFetch });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.reason, "payos_unreachable");
  }
});

// Issue #275: legacy orders that pre-date the payment-payload cache column
// (link_id set, but payload column NULL) cannot be served idempotently — we
// don't have the QR/bank info anywhere to return. We surface a distinct
// reason so the FE doesn't show a generic error. These orders self-resolve
// once the 24h expiry cron from mig 054 runs.
Deno.test("createPayosPayment — legacy order with link_id but no cached payload → 409", async () => {
  const { client } = fakeClient({
    order: {
      ...PENDING_ORDER,
      payos_payment_link_id: "existing-link",
      payos_payment_payload: null,
    },
  });
  const result = await createPayosPayment(client, { ...BASE_OPTS, fetchFn: happyFetch() });
  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.status, 409);
    assertEquals(result.reason, "payment_legacy_no_cache");
  }
});

// Issue #275: when a payment was already created on a previous mount, the
// cached payload is returned verbatim — no PayOS API call, no DB write.
// This makes the Edge Function idempotent on page refresh.
Deno.test("createPayosPayment — link_id + cached payload → returns cached payload, no PayOS call", async () => {
  const cached = {
    qrCode: "CACHED_QR",
    accountNumber: "9876543210",
    accountName: "CTY XYZ",
    bin: "970422",
    amount: 480000,
    description: "ORD-2026-000042",
    checkoutUrl: "https://pay.payos.vn/web/linkid-1",
    paymentLinkId: "linkid-1",
  };
  const { client, updates } = fakeClient({
    order: {
      ...PENDING_ORDER,
      payos_payment_link_id: "linkid-1",
      payos_payment_payload: cached,
    },
  });
  let fetchCalls = 0;
  const trackingFetch: typeof fetch = () => {
    fetchCalls += 1;
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  const result = await createPayosPayment(client, { ...BASE_OPTS, fetchFn: trackingFetch });
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.qrCode, "CACHED_QR");
    assertEquals(result.accountNumber, "9876543210");
    assertEquals(result.paymentLinkId, "linkid-1");
    assertEquals(result.checkoutUrl, "https://pay.payos.vn/web/linkid-1");
  }
  assertEquals(fetchCalls, 0, "PayOS API must not be called when payload is cached");
  assertEquals(updates.length, 0, "Idempotent path must not write to the DB");
});

// Issue #275: first-create still works the same — PayOS POST + DB update —
// and additionally caches the full payload onto `payos_payment_payload` so
// the next call hits the idempotent branch above.
Deno.test("createPayosPayment — first-create persists payos_payment_payload alongside link_id", async () => {
  const { client, updates } = fakeClient({ order: PENDING_ORDER });
  const result = await createPayosPayment(client, { ...BASE_OPTS, fetchFn: happyFetch() });
  assertEquals(result.ok, true);
  assertEquals(updates.length, 1);
  assertEquals(updates[0].payos_payment_link_id, "linkid-1");
  const payload = updates[0].payos_payment_payload as Record<string, unknown> | undefined;
  if (!payload) throw new Error("expected payos_payment_payload patch");
  assertEquals(payload.qrCode, "QR_PAYLOAD");
  assertEquals(payload.accountNumber, "0123456789");
  assertEquals(payload.bin, "970422");
  assertEquals(payload.paymentLinkId, "linkid-1");
});
