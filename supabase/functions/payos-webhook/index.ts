import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// Mirrors the official PayOS JS sample exactly:
// 1. Sort data keys alphabetically
// 2. Filter out undefined values
// 3. Arrays → JSON.stringify after sorting objects inside each element
// 4. null / undefined / "null" / "undefined" → empty string ""
// 5. HMAC-SHA256 the resulting "key=value&key=value" string with PAYOS_CHECKSUM_KEY
// 6. signature lives in the JSON body (not a header)
// PayOS authenticates the callback by signing the body — no auth headers are sent.

function sortObjDataByKey(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = obj[key];
      return acc;
    }, {});
}

function convertObjToQueryStr(obj: Record<string, unknown>): string {
  return Object.keys(obj)
    .filter((key) => obj[key] !== undefined)
    .map((key) => {
      let value = obj[key];
      if (Array.isArray(value)) {
        value = JSON.stringify(
          (value as Record<string, unknown>[]).map((item) => sortObjDataByKey(item)),
        );
      }
      if ([null, undefined, "undefined", "null"].includes(value as string | null | undefined)) {
        value = "";
      }
      return `${key}=${value}`;
    })
    .join("&");
}

export async function verifyHmacSignature(
  data: Record<string, unknown>,
  signature: string | undefined,
  checksumKey: string,
): Promise<boolean> {
  if (!signature) return false;

  const queryStr = convertObjToQueryStr(sortObjDataByKey(data));

  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(checksumKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(queryStr));
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

interface PayosWebhookData {
  orderCode?: unknown;
  reference?: unknown;
  [key: string]: unknown;
}

// Outcome of confirming a verified webhook against the DB. Always 200 to
// PayOS; the distinction is only for logging and tests.
//
// Slice 3 (PRD-0005 §5.4, decisions D9a/b/c) extends slice 1b's single
// pending→active branch with:
//   - `late_paid`           — D9a, expired → active (warning logged)
//   - `refund_pending`      — D9b, cancelled → refund_pending (no enrollment)
//   - `noop`                — already active / refund_pending / refunded
//   - `transaction_conflict`— different txn_id on already-active order (rare)
//   - `cancellation_logged` — D9c, PayOS CANCELLED event for an active order
export type ConfirmOutcome =
  | { kind: "confirmed" }
  | { kind: "late_paid" }
  | { kind: "refund_pending" }
  | { kind: "noop" }
  | { kind: "idempotent_replay" }
  | { kind: "unique_violation" }
  | { kind: "transaction_conflict" }
  | { kind: "cancellation_logged" }
  | { kind: "error"; message: string };

/**
 * Calls `confirm_order_via_payos` RPC and classifies the outcome from the
 * returned order row. The RPC handles all status branches itself (slice 3);
 * the Edge Function only inspects the result for logging purposes.
 *
 * Branching is derived from the returned row:
 *   - status='active'         and last log entry tagged late_paid_after_expire → late_paid
 *   - status='active'         otherwise                                        → confirmed
 *   - status='refund_pending'                                                  → refund_pending
 *   - status='refunded'                                                        → noop (terminal)
 *
 * Errors:
 *   - 23505 (unique violation)            → unique_violation
 *   - payos_transaction_id_conflict       → transaction_conflict
 *   - anything else                       → error (log + 200, admin fallback)
 */
export async function confirmOrderViaPayos(
  client: SupabaseClient,
  data: PayosWebhookData,
  rawPayload: unknown,
): Promise<ConfirmOutcome> {
  const orderCode = typeof data.orderCode === "number"
    ? data.orderCode
    : typeof data.orderCode === "string"
    ? Number(data.orderCode)
    : NaN;
  const reference = typeof data.reference === "string" ? data.reference : "";

  if (!Number.isFinite(orderCode) || !reference) {
    return { kind: "error", message: "missing orderCode or reference" };
  }

  const { data: rpcData, error } = await client.rpc("confirm_order_via_payos", {
    p_payos_order_code: orderCode,
    p_payos_transaction_id: reference,
    p_payload: rawPayload,
  });

  if (error) {
    console.error("[DEBUG] Chi tiết lỗi từ Postgres:", JSON.stringify(error, null, 2));
    const message = (error as { message?: string }).message ?? "";
    const code = (error as { code?: string }).code ?? "";
    if (code === "23505" || /unique/i.test(message)) {
      return { kind: "unique_violation" };
    }
    if (
      code === "23000" ||
      message.includes("payos_transaction_id_conflict")
    ) {
      return { kind: "transaction_conflict" };
    }
    return { kind: "error", message };
  }

  // Classify by returned row. PostgREST returns the single-row SETOF result
  // either as the row directly or wrapped in an array depending on the call.
  const row = (Array.isArray(rpcData) ? rpcData[0] : rpcData) as
    | { status?: string; webhook_event_log?: unknown[] }
    | null
    | undefined;
  const status = row?.status;
  if (status === "refund_pending") return { kind: "refund_pending" };
  if (status === "refunded") return { kind: "noop" };
  if (status === "active") {
    // Distinguish late_paid (expired→active, RPC appended a synthetic warning
    // entry after the payload) from a normal confirmed transition by inspecting
    // the last webhook_event_log entry.
    const log = Array.isArray(row?.webhook_event_log) ? row!.webhook_event_log : [];
    const last = log[log.length - 1] as { warning?: string } | undefined;
    if (last && last.warning === "late_paid_after_expire") {
      return { kind: "late_paid" };
    }
    return { kind: "confirmed" };
  }
  // Defensive: any other status is an unexpected RPC return; surface as noop
  // so the Edge Function logs and PayOS does not retry.
  return { kind: "noop" };
}

/**
 * Calls `log_payos_cancellation` RPC for PayOS CANCELLED events on an active
 * order (PRD-0005 D9c). The RPC only appends to webhook_event_log; it does
 * NOT revoke enrollment. Admin investigates manually.
 */
export async function logPayosCancellation(
  client: SupabaseClient,
  data: PayosWebhookData,
  rawPayload: unknown,
): Promise<ConfirmOutcome> {
  const orderCode = typeof data.orderCode === "number"
    ? data.orderCode
    : typeof data.orderCode === "string"
    ? Number(data.orderCode)
    : NaN;
  if (!Number.isFinite(orderCode)) {
    return { kind: "error", message: "missing orderCode" };
  }
  const { error } = await client.rpc("log_payos_cancellation", {
    p_payos_order_code: orderCode,
    p_payload: rawPayload,
  });
  if (error) {
    return { kind: "error", message: (error as { message?: string }).message ?? "" };
  }
  return { kind: "cancellation_logged" };
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(null, { status: 405, headers: { allow: "POST" } });
  }

  const checksumKey = Deno.env.get("PAYOS_CHECKSUM_KEY");
  if (!checksumKey) {
    console.error("payos-webhook: PAYOS_CHECKSUM_KEY env var missing");
    return new Response(null, { status: 500 });
  }

  // PayOS webhook payloads are well under 10 KB in practice (sample is ~500 B).
  // Cap at 64 KB to prevent memory exhaustion from a malicious caller.
  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > 65536) {
    return new Response(null, { status: 413 });
  }

  let body: { data?: unknown; signature?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(null, { status: 400 });
  }

  // data must be a plain object (not array, not null)
  if (
    !body.data ||
    typeof body.data !== "object" ||
    Array.isArray(body.data)
  ) {
    return new Response(null, { status: 400 });
  }

  // signature must be a hex string of expected length (HMAC-SHA256 hex = 64 chars)
  if (typeof body.signature !== "string" || body.signature.length !== 64) {
    return new Response(null, { status: 401 });
  }

  const valid = await verifyHmacSignature(
    body.data as Record<string, unknown>,
    body.signature,
    checksumKey,
  );
  if (!valid) {
    // Do not echo attacker-supplied signature into logs.
    console.error("payos-webhook: signature mismatch");
    return new Response(null, { status: 401 });
  }

  // Persist via confirm_order_via_payos RPC. The RPC's atomic UPDATE +
  // UNIQUE constraint on payos_transaction_id is the canonical replay
  // defence — PayOS does not include timestamp/nonce in the signed payload,
  // so a captured webhook can otherwise be re-delivered indefinitely.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "payos-webhook: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env missing",
    );
    return new Response(null, { status: 500 });
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Dispatch on PayOS event code. "00" = paid (success); any other code is
  // treated as a cancellation event per PRD-0005 D9c (the webhook is only
  // delivered for terminal payment events — PAID or CANCELLED). For CANCELLED
  // on an active order we log + return 200, no enrollment revoke (D9c).
  const payosData = body.data as PayosWebhookData;
  const payosCode = typeof payosData.code === "string" ? payosData.code : "";
  const outcome = payosCode === "00"
    ? await confirmOrderViaPayos(client, payosData, body.data)
    : await logPayosCancellation(client, payosData, body.data);

  // Always return 200 once the signature is valid. PayOS retries are
  // pointless for any outcome we can recognise:
  //   - confirmed:           happy path (pending → active)
  //   - late_paid:           D9a, expired → active, admin alert via log warning
  //   - refund_pending:      D9b, cancelled → refund_pending, manual refund
  //   - noop:                already active / refund_pending / refunded
  //   - cancellation_logged: D9c, PayOS CANCELLED event recorded
  //   - idempotent_replay:   PayOS retry of a previously-confirmed webhook
  //   - unique_violation:    two-layer race guard fired, duplicate handled
  //   - transaction_conflict:active order, different txn — admin investigates
  //   - error:               log and swallow; admin emergency-confirm fallback
  if (outcome.kind === "error") {
    // Do not echo the payload — PRD-0005 §7 risk row.
    console.error("payos-webhook: rpc error", {
      kind: outcome.kind,
      message: outcome.message,
    });
  } else if (outcome.kind === "late_paid") {
    console.warn("payos-webhook: late paid (expired → active) — D9a");
  } else if (outcome.kind === "refund_pending") {
    console.warn("payos-webhook: cancelled-then-paid → refund_pending — D9b");
  } else if (outcome.kind === "transaction_conflict") {
    console.error(
      "payos-webhook: transaction_id conflict on active order — admin review",
    );
  } else if (outcome.kind === "cancellation_logged") {
    console.info("payos-webhook: cancellation event logged — D9c");
  } else if (outcome.kind === "unique_violation") {
    console.info("payos-webhook: unique violation — duplicate already handled");
  }

  return new Response(null, { status: 200 });
});
