import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// PRD-0005 §5.2 — Edge Function called from Learner browser to obtain
// PayOS embedded checkout data for a pending order.
//
// Hardening (mirrors slice 1a's payos-webhook):
//   - POST only (405 otherwise)
//   - 64 KB body cap (413 otherwise)
//   - No payload logging on failure paths (PRD-0005 §7 risk row)
//   - Service role used only after we've authenticated the JWT caller —
//     the JWT is the authorisation surface; service role just lets us
//     read/write the orders row without dragging RLS in.
//
// Idempotency (issue #275): on first create we cache the full PayOS response
// (qrCode, account info, checkoutUrl, paymentLinkId) into the new
// `orders.payos_payment_payload jsonb` column. Subsequent calls for the
// same order — typically a Learner browser refresh — return the cached
// payload directly. No second PayOS API call, no DB write.
//
// Legacy orders created before migration 059 was deployed have a
// `payos_payment_link_id` set but a NULL payload. We don't attempt to
// recover those via a PayOS GET — the chosen trade-off is to surface
// `payment_legacy_no_cache` (HTTP 409); these orders self-resolve via the
// 24h expiry cron from migration 054.

export interface PayosCreateRequest {
  order_id?: unknown;
}

export interface PayosPaymentRequest {
  orderCode: number;
  amount: number;
  description: string;
  cancelUrl: string;
  returnUrl: string;
  expiredAt: number;
  signature: string;
}

const PAYOS_API_URL = "https://api-merchant.payos.vn/v2/payment-requests";

/**
 * Builds the canonical signed string per PayOS docs.
 *
 * Field order: amount, cancelUrl, description, orderCode, returnUrl —
 * concatenated as `key=value&key=value` (no URL encoding), HMAC-SHA256'd
 * with the checksum key.
 *
 * Verified against the PayOS official Node SDK
 * (https://github.com/payOSHQ/payos-node — `src/crypto/node-crypto.ts`,
 * `createSignatureOfPaymentRequest`): byte-for-byte identical
 * canonicalization. The fixture test in `index.test.ts` asserts a known
 * `(checksumKey, payload) → hmac` pair computed externally with openssl —
 * any drift from the PayOS canonicalization breaks CI before reaching
 * staging.
 */
export function buildPaymentSignaturePayload(p: {
  amount: number;
  cancelUrl: string;
  description: string;
  orderCode: number;
  returnUrl: string;
}): string {
  return `amount=${p.amount}&cancelUrl=${p.cancelUrl}&description=${p.description}` +
    `&orderCode=${p.orderCode}&returnUrl=${p.returnUrl}`;
}

export async function hmacSha256Hex(key: string, message: string): Promise<string> {
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

// PayOS API response shape we care about.
interface PayosResponseData {
  code?: string;
  desc?: string;
  data?: {
    qrCode?: string;
    accountNumber?: string;
    accountName?: string;
    bin?: string;
    amount?: number;
    description?: string;
    paymentLinkId?: string;
    checkoutUrl?: string;
  };
}

export type CreatePaymentResult =
  | {
    ok: true;
    qrCode: string;
    accountNumber: string;
    accountName: string;
    bin: string;
    amount: number;
    description: string;
    checkoutUrl: string;
    paymentLinkId: string;
  }
  | { ok: false; status: number; reason: string };

/**
 * Core happy-path: fetch order, assert ownership + status, call PayOS,
 * persist paymentLinkId, return embedded checkout data.
 */
export async function createPayosPayment(
  client: SupabaseClient,
  options: {
    callerId: string;
    orderId: string;
    appOrigin: string;
    clientId: string;
    apiKey: string;
    checksumKey: string;
    fetchFn?: typeof fetch;
    nowSeconds?: () => number;
  },
): Promise<CreatePaymentResult> {
  const fetchFn = options.fetchFn ?? fetch;
  const now = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  // 1. Load the order and check ownership + status.
  const { data: order, error: orderErr } = await client
    .from("orders")
    .select(
      "id, user_id, code, amount, status, payos_order_code, payos_payment_link_id, payos_payment_payload",
    )
    .eq("id", options.orderId)
    .maybeSingle();

  if (orderErr) {
    return { ok: false, status: 500, reason: "order_lookup_failed" };
  }
  if (!order) {
    return { ok: false, status: 404, reason: "order_not_found" };
  }
  if (order.user_id !== options.callerId) {
    return { ok: false, status: 403, reason: "not_order_owner" };
  }
  if (order.status !== "pending") {
    return { ok: false, status: 409, reason: "order_not_pending" };
  }
  if (order.payos_payment_link_id) {
    // Issue #275: idempotent path. If we cached the PayOS response on
    // first-create, replay it. This is what makes /checkout/:orderId
    // survive a browser refresh after the QR has been generated.
    const cached = order.payos_payment_payload as
      | {
        qrCode?: string;
        accountNumber?: string;
        accountName?: string;
        bin?: string;
        amount?: number;
        description?: string;
        checkoutUrl?: string;
        paymentLinkId?: string;
      }
      | null
      | undefined;
    if (
      cached &&
      typeof cached.qrCode === "string" &&
      typeof cached.accountNumber === "string" &&
      typeof cached.accountName === "string" &&
      typeof cached.bin === "string" &&
      typeof cached.paymentLinkId === "string"
    ) {
      return {
        ok: true,
        qrCode: cached.qrCode,
        accountNumber: cached.accountNumber,
        accountName: cached.accountName,
        bin: cached.bin,
        amount: cached.amount ?? order.amount,
        description: cached.description ?? order.code,
        checkoutUrl: cached.checkoutUrl ?? "",
        paymentLinkId: cached.paymentLinkId,
      };
    }
    // Legacy order from before mig 059: link_id present but no cached
    // payload. We can't reconstruct the QR string, so surface a distinct
    // reason. These orders self-resolve via the 24h expiry cron (mig 054).
    return { ok: false, status: 409, reason: "payment_legacy_no_cache" };
  }
  if (!order.payos_order_code) {
    return { ok: false, status: 500, reason: "missing_payos_order_code" };
  }

  // 2. Build the PayOS request.
  const cancelUrl = `${options.appOrigin}/checkout/${options.orderId}`;
  const returnUrl = cancelUrl;
  const expiredAt = now() + 86400; // 24h, matches mig 054 cron
  const description = order.code; // ORD-2026-XXXXXX is 14 chars — well under PayOS 25-char limit

  const signedPayload = buildPaymentSignaturePayload({
    amount: order.amount,
    cancelUrl,
    description,
    orderCode: order.payos_order_code,
    returnUrl,
  });
  const signature = await hmacSha256Hex(options.checksumKey, signedPayload);

  const body: PayosPaymentRequest = {
    orderCode: order.payos_order_code,
    amount: order.amount,
    description,
    cancelUrl,
    returnUrl,
    expiredAt,
    signature,
  };

  // 3. Call PayOS.
  let payosRes: Response;
  try {
    payosRes = await fetchFn(PAYOS_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-client-id": options.clientId,
        "x-api-key": options.apiKey,
      },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 502, reason: "payos_unreachable" };
  }

  if (!payosRes.ok) {
    return { ok: false, status: 502, reason: "payos_http_error" };
  }

  let payosJson: PayosResponseData;
  try {
    payosJson = await payosRes.json();
  } catch {
    return { ok: false, status: 502, reason: "payos_invalid_json" };
  }

  if (payosJson.code !== "00" || !payosJson.data) {
    return { ok: false, status: 502, reason: "payos_returned_error" };
  }

  const d = payosJson.data;
  if (!d.qrCode || !d.accountNumber || !d.accountName || !d.bin || !d.paymentLinkId) {
    return { ok: false, status: 502, reason: "payos_missing_fields" };
  }

  // 4. Persist the paymentLinkId and cache the full payload so subsequent
  // calls for this order (issue #275 — page refresh) hit the idempotent
  // branch above and don't re-call PayOS.
  const cachedPayload = {
    qrCode: d.qrCode,
    accountNumber: d.accountNumber,
    accountName: d.accountName,
    bin: d.bin,
    amount: d.amount ?? order.amount,
    description: d.description ?? description,
    checkoutUrl: d.checkoutUrl ?? "",
    paymentLinkId: d.paymentLinkId,
  };
  const { error: updateErr } = await client
    .from("orders")
    .update({
      payos_payment_link_id: d.paymentLinkId,
      payos_payment_payload: cachedPayload,
    })
    .eq("id", options.orderId);

  if (updateErr) {
    return { ok: false, status: 500, reason: "order_update_failed" };
  }

  return {
    ok: true,
    ...cachedPayload,
  };
}

// CORS headers — browsers send an OPTIONS preflight before the POST
// because this is a cross-origin fetch from the SPA. Echo back the
// minimum to let the actual POST proceed; the JWT check below is the
// real authn gate, so * for the origin is acceptable here.
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
    return new Response(null, {
      status: 405,
      headers: { ...CORS_HEADERS, allow: "POST" },
    });
  }

  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > 65536) {
    return new Response(null, { status: 413, headers: CORS_HEADERS });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const clientId = Deno.env.get("PAYOS_CLIENT_ID");
  const apiKey = Deno.env.get("PAYOS_API_KEY");
  const checksumKey = Deno.env.get("PAYOS_CHECKSUM_KEY");
  const appOrigin = Deno.env.get("APP_ORIGIN") ?? "";
  if (!supabaseUrl || !serviceRoleKey || !anonKey || !clientId || !apiKey || !checksumKey) {
    console.error("payos-create-payment: required env var missing");
    return new Response(null, { status: 500, headers: CORS_HEADERS });
  }

  // Authenticate the caller via the Authorization header. We use the anon key
  // client just to validate the JWT — service-role calls happen later.
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

  let body: PayosCreateRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 400, headers: CORS_HEADERS });
  }
  if (typeof body.order_id !== "string" || body.order_id.length === 0) {
    return new Response(null, { status: 400, headers: CORS_HEADERS });
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result = await createPayosPayment(serviceClient, {
    callerId,
    orderId: body.order_id,
    appOrigin,
    clientId,
    apiKey,
    checksumKey,
  });

  if (!result.ok) {
    // No payload echo on failure paths.
    console.error("payos-create-payment: failed", { reason: result.reason });
    return new Response(JSON.stringify({ error: result.reason }), {
      status: result.status,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      qrCode: result.qrCode,
      accountNumber: result.accountNumber,
      accountName: result.accountName,
      bin: result.bin,
      amount: result.amount,
      description: result.description,
      checkoutUrl: result.checkoutUrl,
    }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    },
  );
});
