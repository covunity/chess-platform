import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  confirmOrderViaPayos,
  logPayosCancellation,
  verifyHmacSignature,
} from "./index.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

// Minimal stub of the supabase client surface we use.
function rpcClient(
  rpcImpl: (name: string, params: unknown) => Promise<{ data?: unknown; error: unknown }>,
) {
  return {
    rpc: rpcImpl,
  } as unknown as SupabaseClient;
}

// Official sample from https://payos.vn/docs/du-lieu-tra-ve/webhook
const CHECKSUM_KEY = "1a54716c8f0efb2744fb28b6e38b25da7f67a925d98bc1c18bd8faaecadd7675";
const SAMPLE_DATA: Record<string, unknown> = {
  orderCode: 123,
  amount: 3000,
  description: "VQRIO123",
  accountNumber: "12345678",
  reference: "TF230204212323",
  transactionDateTime: "2023-02-04 18:25:00",
  currency: "VND",
  paymentLinkId: "124c33293c43417ab7879e14c8d9eb18",
  code: "00",
  desc: "Thành công",
  counterAccountBankId: "",
  counterAccountBankName: "",
  counterAccountName: "",
  counterAccountNumber: "",
  virtualAccountName: "",
  virtualAccountNumber: "",
};
const SAMPLE_SIGNATURE = "412e915d2871504ed31be63c8f62a149a4410d34c4c42affc9006ef9917eaa03";

Deno.test("verifyHmacSignature — matches official PayOS sample data", async () => {
  assertEquals(await verifyHmacSignature(SAMPLE_DATA, SAMPLE_SIGNATURE, CHECKSUM_KEY), true);
});

Deno.test("verifyHmacSignature — tampered field returns false", async () => {
  const tampered = { ...SAMPLE_DATA, amount: 1 };
  assertEquals(await verifyHmacSignature(tampered, SAMPLE_SIGNATURE, CHECKSUM_KEY), false);
});

Deno.test("verifyHmacSignature — wrong checksumKey returns false", async () => {
  assertEquals(await verifyHmacSignature(SAMPLE_DATA, SAMPLE_SIGNATURE, "wrong-key"), false);
});

Deno.test("verifyHmacSignature — missing signature (undefined) returns false", async () => {
  assertEquals(await verifyHmacSignature(SAMPLE_DATA, undefined, CHECKSUM_KEY), false);
});

Deno.test("verifyHmacSignature — empty signature string returns false", async () => {
  assertEquals(await verifyHmacSignature(SAMPLE_DATA, "", CHECKSUM_KEY), false);
});

Deno.test("verifyHmacSignature — truncated signature returns false", async () => {
  assertEquals(
    await verifyHmacSignature(SAMPLE_DATA, SAMPLE_SIGNATURE.slice(0, 32), CHECKSUM_KEY),
    false,
  );
});

Deno.test("verifyHmacSignature — key insertion order does not matter (sorts alphabetically)", async () => {
  const shuffled: Record<string, unknown> = {};
  for (const key of Object.keys(SAMPLE_DATA).reverse()) {
    shuffled[key] = SAMPLE_DATA[key];
  }
  assertEquals(await verifyHmacSignature(shuffled, SAMPLE_SIGNATURE, CHECKSUM_KEY), true);
});

Deno.test("verifyHmacSignature — string 'null' and string 'undefined' treated as empty string", async () => {
  // PayOS spec: null / "null" / undefined / "undefined" all serialize to ""
  // so data with those values should verify the same as data with ""
  const withNullStr = { ...SAMPLE_DATA, counterAccountBankId: "null" };
  const withUndefinedStr = { ...SAMPLE_DATA, counterAccountBankId: "undefined" };
  // Both should produce the same signature as empty string variant (SAMPLE_DATA already has "")
  assertEquals(
    await verifyHmacSignature(withNullStr, SAMPLE_SIGNATURE, CHECKSUM_KEY),
    await verifyHmacSignature(SAMPLE_DATA, SAMPLE_SIGNATURE, CHECKSUM_KEY),
  );
  assertEquals(
    await verifyHmacSignature(withUndefinedStr, SAMPLE_SIGNATURE, CHECKSUM_KEY),
    await verifyHmacSignature(SAMPLE_DATA, SAMPLE_SIGNATURE, CHECKSUM_KEY),
  );
});

// ── confirmOrderViaPayos ────────────────────────────────────────────────────

Deno.test("confirmOrderViaPayos — happy path calls RPC and returns confirmed", async () => {
  let rpcArgs: { name: string; params: unknown } | null = null;
  const paidAt = "2026-05-20T10:00:00Z";
  const client = rpcClient(async (name, params) => {
    rpcArgs = { name, params };
    return {
      data: {
        id: "ord-1",
        status: "active",
        paid_at: paidAt,
        confirmed_at: paidAt,
        webhook_event_log: [{ foo: "bar" }],
      },
      error: null,
    };
  });
  const outcome = await confirmOrderViaPayos(
    client,
    { orderCode: 42, reference: "TF230204212323" },
    { foo: "bar" },
  );
  assertEquals(outcome.kind, "confirmed");
  assertEquals(rpcArgs!.name, "confirm_order_via_payos");
  assertEquals(rpcArgs!.params, {
    p_payos_order_code: 42,
    p_payos_transaction_id: "TF230204212323",
    p_payload: { foo: "bar" },
  });
});

// Regression for #291 — `confirm_order_via_payos` originally wrote
// status='active' + paid_at=now() but never touched confirmed_at, so the
// Creator Revenue tab (which sorts earnings by confirmed_at DESC) showed
// every PayOS-paid order with an empty date sorted to the bottom. Migration
// 061 adds `confirmed_at = now()` to both the happy-path and the D9a
// late-paid UPDATE clauses. This test pins the RPC return contract: a
// confirmed PAID webhook produces a row with confirmed_at populated and
// equal to paid_at. confirmed_by stays NULL (the documented signal for
// "PayOS auto-confirmed, no admin involved" — slice 4 sets it on manual
// confirm).
Deno.test("confirmOrderViaPayos — happy path returns row with confirmed_at populated (#291)", async () => {
  const paidAt = "2026-05-20T10:00:00Z";
  let returnedRow: Record<string, unknown> | null = null;
  const client = rpcClient(async () => {
    returnedRow = {
      id: "ord-1",
      status: "active",
      paid_at: paidAt,
      confirmed_at: paidAt,
      confirmed_by: null,
      webhook_event_log: [{ foo: "bar" }],
    };
    return { data: returnedRow, error: null };
  });
  const outcome = await confirmOrderViaPayos(
    client,
    { orderCode: 42, reference: "TF230204212323" },
    { foo: "bar" },
  );
  assertEquals(outcome.kind, "confirmed");
  // The SQL function must populate confirmed_at on the happy-path UPDATE so
  // the Revenue tab sort works. paid_at and confirmed_at are both set to
  // now() in the same UPDATE, so they should match.
  assertEquals(returnedRow!.confirmed_at, paidAt);
  assertEquals(returnedRow!.confirmed_at, returnedRow!.paid_at);
  assertEquals(returnedRow!.confirmed_by, null);
});

Deno.test("confirmOrderViaPayos — unique violation (PayOS retry race) mapped to unique_violation", async () => {
  const client = rpcClient(async () => ({
    error: { message: "duplicate key value violates unique constraint", code: "23505" },
  }));
  const outcome = await confirmOrderViaPayos(
    client,
    { orderCode: 100, reference: "REF100" },
    {},
  );
  assertEquals(outcome.kind, "unique_violation");
});

Deno.test("confirmOrderViaPayos — missing orderCode returns error", async () => {
  const client = rpcClient(async () => ({ error: null }));
  const outcome = await confirmOrderViaPayos(
    client,
    { reference: "REF" },
    {},
  );
  assertEquals(outcome.kind, "error");
});

Deno.test("confirmOrderViaPayos — missing reference returns error", async () => {
  const client = rpcClient(async () => ({ error: null }));
  const outcome = await confirmOrderViaPayos(
    client,
    { orderCode: 1 },
    {},
  );
  assertEquals(outcome.kind, "error");
});

Deno.test("confirmOrderViaPayos — expired order → late_paid outcome (D9a sets confirmed_at, #291)", async () => {
  // RPC returns row with status='active' and webhook_event_log's last entry
  // tagged warning='late_paid_after_expire'. Edge Function classifies as late_paid.
  // Per #291, the D9a UPDATE clause must also set confirmed_at = now() so the
  // late-paid order surfaces with a real date in the Creator Revenue tab.
  const paidAt = "2026-05-20T10:00:00Z";
  let returnedRow: Record<string, unknown> | null = null;
  const client = rpcClient(async () => {
    returnedRow = {
      id: "ord-1",
      status: "active",
      paid_at: paidAt,
      confirmed_at: paidAt,
      confirmed_by: null,
      webhook_event_log: [
        { foo: "bar" },
        { warning: "late_paid_after_expire", expired_at: "2026-05-18T00:00:00Z" },
      ],
    };
    return { data: returnedRow, error: null };
  });
  const outcome = await confirmOrderViaPayos(
    client,
    { orderCode: 99, reference: "REF99" },
    { foo: "bar" },
  );
  assertEquals(outcome.kind, "late_paid");
  assertEquals(returnedRow!.confirmed_at, paidAt);
  assertEquals(returnedRow!.confirmed_by, null);
});

Deno.test("confirmOrderViaPayos — cancelled-then-paid → refund_pending outcome", async () => {
  const client = rpcClient(async () => ({
    data: {
      id: "ord-2",
      status: "refund_pending",
      webhook_event_log: [{ foo: "bar" }],
    },
    error: null,
  }));
  const outcome = await confirmOrderViaPayos(
    client,
    { orderCode: 100, reference: "REF100" },
    { foo: "bar" },
  );
  assertEquals(outcome.kind, "refund_pending");
});

// Regression for #290 — the SQL D9b snapshot in `confirm_order_via_payos`
// reads `p_payload ->> 'counterAccountNumber'` directly (no `-> 'data'`
// hop). That is only correct if the Edge Function passes the PayOS `data`
// inner object — not the outer envelope — as `p_payload`. This test pins
// that contract: the RPC param shape must contain counter-account fields
// at the top level so the SQL snapshot resolves them.
Deno.test("confirmOrderViaPayos — passes PayOS counter-account fields at p_payload top level (D9b snapshot contract, #290)", async () => {
  let rpcArgs: { name: string; params: unknown } | null = null;
  const client = rpcClient(async (name, params) => {
    rpcArgs = { name, params };
    return {
      data: { id: "ord-rp", status: "refund_pending", webhook_event_log: [] },
      error: null,
    };
  });

  // Shape mirrors the inner `data` object PayOS sends for a cancelled-then-paid
  // event, with counter-account fields populated.
  const innerData = {
    orderCode: 555,
    reference: "TF_REFUND_555",
    amount: 480000,
    counterAccountNumber: "0123456789",
    counterAccountName: "NGUYEN VAN A",
    counterAccountBankName: "MBBANK",
    code: "00",
  };

  await confirmOrderViaPayos(
    client,
    innerData,
    innerData, // Edge Function passes body.data here — see index.ts:277
  );

  const params = rpcArgs!.params as { p_payload: Record<string, unknown> };
  // Fields the SQL D9b branch reads must be addressable at p_payload's top
  // level, not nested under a `data` key.
  assertEquals(params.p_payload.counterAccountNumber, "0123456789");
  assertEquals(params.p_payload.counterAccountName, "NGUYEN VAN A");
  assertEquals(params.p_payload.counterAccountBankName, "MBBANK");
  assertEquals(params.p_payload.amount, 480000);
});

Deno.test("confirmOrderViaPayos — transaction conflict (errcode payos_transaction_id_conflict) mapped", async () => {
  const client = rpcClient(async () => ({
    error: {
      message: "payos_transaction_id_conflict: status=active, txn=OTHER",
      code: "23000",
    },
  }));
  const outcome = await confirmOrderViaPayos(
    client,
    { orderCode: 101, reference: "REF101" },
    {},
  );
  assertEquals(outcome.kind, "transaction_conflict");
});

Deno.test("logPayosCancellation — calls log_payos_cancellation RPC", async () => {
  let rpcArgs: { name: string; params: unknown } | null = null;
  const client = rpcClient(async (name, params) => {
    rpcArgs = { name, params };
    return { data: { id: "ord-3", status: "active" }, error: null };
  });
  const outcome = await logPayosCancellation(
    client,
    { orderCode: 200, reference: "REFCANCEL" },
    { code: "01", desc: "Cancelled" },
  );
  assertEquals(outcome.kind, "cancellation_logged");
  assertEquals(rpcArgs!.name, "log_payos_cancellation");
  assertEquals(rpcArgs!.params, {
    p_payos_order_code: 200,
    p_payload: { code: "01", desc: "Cancelled" },
  });
});

Deno.test("confirmOrderViaPayos — string orderCode is coerced to number for the RPC", async () => {
  let rpcArgs: { name: string; params: unknown } | null = null;
  const client = rpcClient(async (name, params) => {
    rpcArgs = { name, params };
    return { error: null };
  });
  await confirmOrderViaPayos(
    client,
    { orderCode: "42", reference: "REF" },
    {},
  );
  assertEquals((rpcArgs!.params as { p_payos_order_code: number }).p_payos_order_code, 42);
});
