import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Issue #319 — voucher_usages writes 1₫ instead of 0₫ on free-path stacking.
//
// Migration 066 created voucher_usages with a `discount_amount integer NOT NULL
// CHECK (discount_amount > 0)` inline constraint. Migration 068's
// create_order_with_fee_snapshot RPC works around the constraint by writing
// `GREATEST(v_voucher_discount, 1)` — which floors a legitimate 0₫ free-path
// redemption to 1₫ and corrupts marketing analytics.
//
// Migration 070 fixes this by:
//   1. DROP CONSTRAINT IF EXISTS voucher_usages_discount_amount_check
//      (the auto-generated name PG assigns to an inline column CHECK)
//   2. ADD CONSTRAINT voucher_usages_discount_amount_check
//      CHECK (discount_amount >= 0)
//   3. CREATE OR REPLACE FUNCTION create_order_with_fee_snapshot — same body
//      as 068, but the voucher_usages INSERT uses `v_voucher_discount`
//      directly instead of `GREATEST(v_voucher_discount, 1)`.
//   4. Backfill UPDATE rows that were free-path artifacts (1₫ on free orders)
//      back to 0₫ — scoped via orders.voucher_discount_amount = 0 so real 1₫
//      redemptions are left alone.

const MIGRATIONS_DIR = join(__dirname, "../../../supabase/migrations");

function readMigration(name: string): string {
  const path = join(MIGRATIONS_DIR, name);
  if (!existsSync(path)) throw new Error(`Migration not found: ${name}`);
  return readFileSync(path, "utf-8");
}

// Strip `--` line comments so negative-pattern assertions don't false-match on
// the migration's own explanatory text (which legitimately references the old
// `GREATEST(...)` workaround and `> 0` constraint).
function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("Migration 070 — voucher_usages_zero_discount_fix", () => {
  let sql: string;
  beforeAll(() => {
    sql = readMigration("070_voucher_usages_zero_discount_fix.sql");
  });

  it("drops the legacy CHECK (discount_amount > 0) constraint by its PG auto-name", () => {
    expect(sql).toMatch(
      /DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+voucher_usages_discount_amount_check/i,
    );
  });

  it("adds a new CHECK (discount_amount >= 0) constraint allowing legitimate 0₫", () => {
    // The replacement constraint must use >= 0, not > 0.
    expect(sql).toMatch(
      /ADD\s+CONSTRAINT\s+voucher_usages_discount_amount_check\s+CHECK\s*\(\s*discount_amount\s*>=\s*0\s*\)/i,
    );
    // And the file must NOT re-introduce the broken `> 0` check in actual SQL
    // (comments are fine — they may explain the historical bug).
    expect(stripSqlComments(sql)).not.toMatch(
      /CHECK\s*\(\s*discount_amount\s*>\s*0\s*\)/,
    );
  });

  it("re-creates create_order_with_fee_snapshot via CREATE OR REPLACE", () => {
    expect(sql).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.create_order_with_fee_snapshot/i,
    );
  });

  it("no longer floors voucher discount with GREATEST(v_voucher_discount, 1)", () => {
    // The whole point of 070: the GREATEST workaround is gone from real SQL
    // (comments may still mention the historical workaround).
    expect(stripSqlComments(sql)).not.toMatch(
      /GREATEST\s*\(\s*v_voucher_discount\s*,\s*1\s*\)/,
    );
  });

  it("inserts v_voucher_discount directly into voucher_usages.discount_amount", () => {
    // Sanity: the INSERT into voucher_usages must still pass v_voucher_discount.
    // We don't pin the exact whitespace — just that the unwrapped variable is
    // used in the same INSERT statement as voucher_usages.
    expect(sql).toMatch(
      /INSERT\s+INTO\s+public\.voucher_usages[\s\S]*?VALUES[\s\S]*?v_voucher_discount/i,
    );
  });

  it("backfills 1₫ free-path artifacts to 0₫ scoped via orders.voucher_discount_amount = 0", () => {
    // Backfill must only touch rows that are free-path artifacts. Real 1₫
    // redemptions have orders.voucher_discount_amount = 1, so the subquery
    // filters them out.
    expect(sql).toMatch(
      /UPDATE\s+(public\.)?voucher_usages\s+SET\s+discount_amount\s*=\s*0[\s\S]*?WHERE\s+discount_amount\s*=\s*1[\s\S]*?orders[\s\S]*?voucher_discount_amount\s*=\s*0/i,
    );
  });

  it("keeps SECURITY DEFINER + search_path on the recreated RPC (no regression)", () => {
    expect(sql).toMatch(/SECURITY\s+DEFINER/i);
    expect(sql).toMatch(/SET\s+search_path\s*=\s*public/i);
  });

  it("is idempotent — uses IF EXISTS for the constraint drop and CREATE OR REPLACE for the RPC", () => {
    expect(sql).toMatch(/IF\s+EXISTS/i);
    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE/i);
  });

  it("preserves free-path branch (v_final_price = 0 → status=active + enrollment INSERT)", () => {
    // Smoke test that the RPC re-creation didn't accidentally drop the D-05
    // free-path enrollment side-effect.
    expect(sql).toMatch(
      /INSERT\s+INTO\s+public\.enrollments\s*\(\s*course_id,\s*user_id,\s*order_id\s*\)/i,
    );
    expect(sql).toMatch(/v_order_status\s*:=\s*'active'/i);
  });

  it("still gates voucher_usages INSERT on v_voucher_id IS NOT NULL (quota policy unchanged)", () => {
    // PRD-0006 §11 V-D5: free-path with a voucher must STILL record the
    // redemption (quota is a marketing cap, not an accounting amount). So the
    // gate stays `IF v_voucher_id IS NOT NULL` — not `v_voucher_discount > 0`.
    expect(sql).toMatch(/IF\s+v_voucher_id\s+IS\s+NOT\s+NULL/i);
  });
});

// ── createOrder client wrapper — sanity that JS-side contract is unchanged ──
//
// The JS wrapper passes p_voucher_code through unchanged and returns the
// inserted order. Issue #319 is a SQL-only fix: no client signature changes.
// We just re-assert that a free-path call still resolves without throwing —
// the actual `voucher_usages.discount_amount = 0` write happens inside the
// RPC (covered by the migration-content tests above + e2e migration apply).

import { describe as describe2, it as it2, expect as expect2, vi as vi2 } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createOrder } from "../../lib/orderApi";

describe2("createOrder — free-path stacking (issue #319)", () => {
  it2("returns a free-path order (amount=0, voucher_discount_amount=0) without exception", async () => {
    // Server-side, post-migration-070, a campaign that discounts to 0 then a
    // voucher applied gives voucher_discount_amount = 0 on both the order and
    // the audit row. The JS wrapper just forwards the order back.
    const freePathOrder = {
      id: "ord-free",
      course_id: "c-free",
      user_id: "u-1",
      status: "active" as const,
      amount: 0,
      code: "ORD-2026-000999",
      notes: null,
      platform_fee_pct: 0,
      platform_fee_amount: 0,
      creator_payout_amount: 0,
      creator_payout: 0,
      account_tier_code: "individual" as const,
      confirmed_at: null,
      confirmed_by: null,
      cancelled_at: null,
      cancelled_by: null,
      cancelled_reason: null,
      manual_confirm_reason: null,
      original_price: 480_000,
      campaign_id: "cmp-100",
      campaign_discount_amount: 480_000,
      voucher_id: "v-stack",
      voucher_code: "STACK10",
      voucher_discount_amount: 0,
      created_at: "2026-05-21T00:00:00Z",
      updated_at: "2026-05-21T00:00:00Z",
    };
    const rpc = vi2.fn().mockResolvedValue({ data: freePathOrder, error: null });
    const client = { rpc } as unknown as SupabaseClient;

    const { order, error } = await createOrder(client, "c-free", "STACK10");
    expect2(error).toBeNull();
    expect2(order?.amount).toBe(0);
    expect2(order?.voucher_discount_amount).toBe(0);
    // RPC should NOT throw or surface a CHECK-violation errcode — migration
    // 070 relaxed the constraint to (>= 0).
    expect2(rpc).toHaveBeenCalledWith("create_order_with_fee_snapshot", {
      p_course_id: "c-free",
      p_voucher_code: "STACK10",
    });
  });
});
