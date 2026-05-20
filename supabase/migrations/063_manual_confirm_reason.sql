-- Fix #293 — Manual-confirm reason is thrown away, no DB audit trail
--
-- ── What was wrong ────────────────────────────────────────────────────────
-- The "Xác nhận thủ công" dialog in the AdminOrdersPage "Cần can thiệp" tab
-- (AdminOrdersPage.tsx:223, ~417-441) required the admin to type a non-empty
-- reason before submitting. That reason was then `console.info(...)`-logged
-- in the browser and discarded — the underlying `confirm_order` RPC
-- (migration 031) accepted only `p_order_id` and had no column to store it.
-- Manual confirmations (the riskiest payment state transition, used when the
-- PayOS webhook failed but a bank statement shows the transfer arrived) had
-- zero DB-level audit beyond `confirmed_by` + `confirmed_at`.
--
-- ── What this migration changes ───────────────────────────────────────────
-- 1. Adds `orders.manual_confirm_reason text` (nullable). A dedicated column
--    rather than a generic `notes jsonb` because the audit scope is narrow
--    and explicit semantics > jsonb extraction noise. Filterable / indexable
--    if we later need an "all manually-confirmed orders" report.
--
-- 2. Redefines `confirm_order(p_order_id uuid, p_reason text)` (signature
--    change from migration 031: now takes a second required `p_reason` arg).
--    The function body is otherwise byte-identical to mig 031 plus:
--      - Validates `length(btrim(coalesce(p_reason, ''))) > 0` up front,
--        raising 'reason_required' errcode 22023 if empty / null / whitespace.
--      - The UPDATE sets `manual_confirm_reason = btrim(p_reason)` alongside
--        `confirmed_at` + `confirmed_by`.
--    Idempotent return on already-active rows is preserved (admin double-
--    click safety) — but on the active branch we do NOT overwrite an
--    existing reason since the audit row is already locked in.
--
-- ── Signature change vs. callers ──────────────────────────────────────────
-- `confirm_order` is the admin-only "mark a manual transfer as paid" path.
-- The PayOS webhook does NOT call this — it uses `confirm_order_via_payos`
-- (migration 055/056). The only internal callers are:
--   - src/lib/orderApi.ts confirmOrder() — updated to pass reason.
--   - src/pages/admin/AdminOrdersPage.tsx — manual-confirm dialog + pending-
--     tab quick-confirm both updated to pass a non-empty reason string.
-- No external clients hit this RPC (RLS-gated to admin), so the breaking
-- signature change is safe.
--
-- ── Why drop + recreate ───────────────────────────────────────────────────
-- Postgres treats `(uuid)` and `(uuid, text)` as distinct overloads. A bare
-- CREATE OR REPLACE would leave the old single-arg version around, letting
-- stale clients call it. DROP the old signature first so there is exactly
-- one `confirm_order` callable.

-- ── 1. Add the audit column ──────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS manual_confirm_reason text;

COMMENT ON COLUMN public.orders.manual_confirm_reason IS
  'Non-empty reason captured by AdminOrdersPage when an admin manually confirms '
  'an order (e.g. PayOS webhook missing but bank statement OK). Set in the same '
  'transaction as confirmed_at/by. NULL for orders never touched by confirm_order.';

-- ── 2. Drop the old single-arg overload so we keep one signature ─────────
DROP FUNCTION IF EXISTS public.confirm_order(uuid);

-- ── 3. Redefine confirm_order with the new signature ─────────────────────
CREATE OR REPLACE FUNCTION public.confirm_order(
  p_order_id uuid,
  p_reason   text
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller     uuid := auth.uid();
  v_order    public.orders;
  v_reason   text;
BEGIN
  -- Admin guard. We check this before reason validation so an unauthorised
  -- caller cannot probe reason-shape behaviour.
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- Reason validation (#293). Empty / null / whitespace-only is rejected so
  -- the audit trail is always meaningful when a row reaches the UPDATE.
  v_reason := btrim(coalesce(p_reason, ''));
  IF length(v_reason) = 0 THEN
    RAISE EXCEPTION 'reason_required' USING errcode = '22023';
  END IF;
  IF length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason too long (max 500 chars)' USING errcode = '22023';
  END IF;

  -- Lock the order row to serialise concurrent confirm/cancel clicks.
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found: %', p_order_id USING errcode = '22023';
  END IF;

  IF v_order.status = 'active' THEN
    -- Idempotent return — no-op so admin double-clicks are safe. We do NOT
    -- overwrite the existing manual_confirm_reason since the original audit
    -- row is locked in.
    RETURN v_order;
  END IF;

  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'order_already_cancelled' USING errcode = '22023';
  END IF;

  -- pending → active. Persist the trimmed reason alongside confirmed_at/by
  -- so every manually-confirmed order has a complete audit triple
  -- (who, when, why).
  UPDATE public.orders
  SET status                  = 'active',
      confirmed_at            = now(),
      confirmed_by            = caller,
      manual_confirm_reason   = v_reason
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- Create enrollment in the same transaction. ON CONFLICT covers the rare
  -- case where a free-course path (RPC create_order_with_fee_snapshot)
  -- already inserted the row.
  INSERT INTO public.enrollments (course_id, user_id, order_id)
  VALUES (v_order.course_id, v_order.user_id, v_order.id)
  ON CONFLICT (course_id, user_id) DO NOTHING;

  RETURN v_order;
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_order(uuid, text) TO authenticated;
