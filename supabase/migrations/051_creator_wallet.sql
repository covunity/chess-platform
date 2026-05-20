-- Migration 051: creator_wallet view + payouts table + orders.paid_out_in
-- Slice 6 of PRD-0005 (issue #254). Read-only Revenue tab data model.
-- Per PRD-0005 §5.1, §10 D5/D10:
--   - Hybrid wallet model: orders is single source of earnings; payouts is
--     a forward reference of admin cash-outs.
--   - No reversal columns (defer Phase 3 per D10).

-- ── 1. payouts table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payouts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id      uuid NOT NULL REFERENCES public.users(id),
  admin_id        uuid NOT NULL REFERENCES public.users(id),
  amount          integer NOT NULL CHECK (amount > 0),
  bank_code       text NOT NULL,
  bank_name       text NOT NULL,
  account_number  text NOT NULL,
  account_holder  text NOT NULL,
  order_ids       uuid[] NOT NULL,
  transferred_at  timestamptz NOT NULL DEFAULT now(),
  reference_note  text
);

CREATE INDEX IF NOT EXISTS payouts_creator_idx
  ON public.payouts (creator_id, transferred_at DESC);

ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

-- Creator reads own payouts; admin reads all. No INSERT/UPDATE policies —
-- all mutations go through SECURITY DEFINER RPCs (slice 7).
DROP POLICY IF EXISTS "Creators read own payouts" ON public.payouts;
CREATE POLICY "Creators read own payouts"
  ON public.payouts FOR SELECT
  USING (auth.uid() = creator_id);

DROP POLICY IF EXISTS "Admins read all payouts" ON public.payouts;
CREATE POLICY "Admins read all payouts"
  ON public.payouts FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'));

-- ── 2. orders.paid_out_in forward reference ──────────────────────────────────
-- NULL = order's creator_payout still counts toward pending_balance.
-- Set by mark_payout_complete RPC in slice 7.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS paid_out_in uuid REFERENCES public.payouts(id);

CREATE INDEX IF NOT EXISTS orders_paid_out_in_idx
  ON public.orders (paid_out_in)
  WHERE paid_out_in IS NOT NULL;

-- ── 2b. RLS policy: creator can read orders for their own courses ────────────
-- Mig 008 only allows the buyer (user_id) and admin to SELECT orders. Creators
-- need to read orders for their courses to see earnings on the Revenue tab.
DROP POLICY IF EXISTS "Creators read orders for own courses" ON public.orders;
CREATE POLICY "Creators read orders for own courses"
  ON public.orders FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.courses c
      WHERE c.id = orders.course_id AND c.creator_id = auth.uid()
    )
  );

-- ── 3. creator_wallet view ───────────────────────────────────────────────────
-- One row per creator. pending_balance excludes orders already covered by a
-- payout; total_paid_out covers orders that are. Both filter on status=active
-- so cancelled / pending orders never contribute.
--
-- security_invoker=true → view runs with the caller's RLS context. Together
-- with the RLS policy on `orders` (creator reads own course's orders) and the
-- payouts policy above, the result of "SELECT * FROM creator_wallet WHERE
-- creator_id = auth.uid()" naturally restricts to the caller's row.
CREATE OR REPLACE VIEW public.creator_wallet
WITH (security_invoker = true) AS
SELECT
  c.id AS creator_id,
  COALESCE(SUM(o.creator_payout) FILTER (
    WHERE o.status = 'active' AND o.paid_out_in IS NULL
  ), 0)::bigint AS pending_balance,
  COALESCE(SUM(o.creator_payout) FILTER (
    WHERE o.status = 'active' AND o.paid_out_in IS NOT NULL
  ), 0)::bigint AS total_paid_out,
  COALESCE(SUM(o.creator_payout) FILTER (WHERE o.status = 'active'), 0)::bigint
    AS lifetime_earnings
FROM public.users c
LEFT JOIN public.courses co ON co.creator_id = c.id
LEFT JOIN public.orders o ON o.course_id = co.id
WHERE c.role = 'creator'
GROUP BY c.id;

GRANT SELECT ON public.creator_wallet TO authenticated;
