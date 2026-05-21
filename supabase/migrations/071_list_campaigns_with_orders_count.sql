-- Migration 071 — Admin campaigns list: include orders_count column (#320).
--
-- ## Why
--
-- The `/admin/campaigns` table renders a `Số đơn` (orders) column per
-- PRD-0006 §5.6, but the row template in `AdminCampaignsPage.tsx` hardcoded
-- `<td>0</td>` because no query supplied the value. Migration 064 only ships
-- a plain `SELECT * FROM campaigns` path via the client's `from('campaigns')`
-- call. Computing the count per-row from the JS client would mean N+1 round
-- trips, so we add a dedicated server-side aggregate RPC.
--
-- ## What
--
-- Adds `public.list_campaigns_with_orders_count(p_status text, p_search text)`
-- returning every column of `campaigns` plus a `bigint orders_count`. The
-- count is filtered to revenue-bearing statuses only — `active`,
-- `refund_pending`, and `refunded` — matching the acceptance criteria of
-- issue #320 (orders that contributed to revenue, or pending refund
-- settlement). `pending`, `cancelled`, and `expired` orders are excluded
-- because they never produced revenue.
--
-- Filters mirror the previous client-side ones:
--   * `p_status = 'active'`   → only `is_active = true`
--   * `p_status = 'inactive'` → only `is_active = false`
--   * `p_status` NULL or anything else → all rows
--   * `p_search` non-NULL → ILIKE on `name`
--
-- Sort: `created_at DESC` — same as the legacy client-side query.
--
-- ## Auth
--
-- `SECURITY DEFINER` + an explicit admin-role gate. RLS on `campaigns`
-- already restricts the broader admin policy, but defining the gate inside
-- the function keeps the RPC self-contained and prevents accidental
-- exposure if RLS is ever loosened on the table.

CREATE OR REPLACE FUNCTION public.list_campaigns_with_orders_count(
  p_status text DEFAULT NULL,
  p_search text DEFAULT NULL
)
RETURNS TABLE (
  id                   uuid,
  name                 text,
  description          text,
  discount_type        text,
  discount_value       integer,
  max_discount_amount  integer,
  applicable_courses   jsonb,
  starts_at            timestamptz,
  ends_at              timestamptz,
  is_active            boolean,
  created_by           uuid,
  created_at           timestamptz,
  updated_at           timestamptz,
  orders_count         bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN QUERY
    SELECT
      c.id,
      c.name,
      c.description,
      c.discount_type,
      c.discount_value,
      c.max_discount_amount,
      c.applicable_courses,
      c.starts_at,
      c.ends_at,
      c.is_active,
      c.created_by,
      c.created_at,
      c.updated_at,
      COALESCE((
        SELECT count(*)
          FROM public.orders o
         WHERE o.campaign_id = c.id
           AND o.status IN ('active', 'refund_pending', 'refunded')
      ), 0) AS orders_count
      FROM public.campaigns c
     WHERE (p_status IS NULL
            OR (p_status = 'active'   AND c.is_active = true)
            OR (p_status = 'inactive' AND c.is_active = false))
       AND (p_search IS NULL OR c.name ILIKE '%' || p_search || '%')
     ORDER BY c.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_campaigns_with_orders_count(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.list_campaigns_with_orders_count(text, text) TO authenticated;
