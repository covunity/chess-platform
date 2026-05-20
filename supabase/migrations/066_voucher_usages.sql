-- Migration 066 — Slice 3a of PRD-0006: voucher_usages audit table.
--
-- One row per (voucher, order) pair recording when a learner redeemed a
-- voucher and how much they saved. The `UNIQUE (voucher_id, order_id)`
-- constraint enforces "at most one usage per order" — a learner cannot
-- double-redeem on the same order. The `(voucher_id, user_id)` index makes
-- per-user-limit lookups (slice 3b) O(log n) without scanning the table.
--
-- RLS is intentionally split: learners may SELECT their OWN rows (so the
-- /account/orders page can show "you used X voucher"), and admin gets full
-- read for the /admin/vouchers drawer.
--
-- INSERTs land via the slice 3b `create_order_with_fee_snapshot` RPC under
-- SECURITY DEFINER — there is no client-side write policy on purpose.

CREATE TABLE IF NOT EXISTS public.voucher_usages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id       uuid NOT NULL REFERENCES public.vouchers(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  order_id         uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  discount_amount  integer NOT NULL CHECK (discount_amount > 0),
  used_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (voucher_id, order_id)
);

COMMENT ON TABLE public.voucher_usages IS
  'Audit row per voucher redemption (PRD-0006). Written by '
  'create_order_with_fee_snapshot in slice 3b. ON DELETE CASCADE on every FK '
  'so removing a voucher / user / order cleans up its usages automatically.';

CREATE INDEX IF NOT EXISTS idx_voucher_usages_voucher_user
  ON public.voucher_usages (voucher_id, user_id);

ALTER TABLE public.voucher_usages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS voucher_usages_select_own ON public.voucher_usages;
CREATE POLICY voucher_usages_select_own ON public.voucher_usages
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
  );
