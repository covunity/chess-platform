-- Migration 072 — Fix ambiguous column reference in list_campaigns_with_orders_count.
--
-- ## Why
--
-- Migration 071 introduced `list_campaigns_with_orders_count` with
-- `RETURNS TABLE (id uuid, name text, …)`. In PL/pgSQL, the columns of
-- a `RETURNS TABLE` clause become OUT parameters that live in the same
-- namespace as table columns in the function body. Inside the COALESCE
-- subquery `WHERE o.campaign_id = c.id`, PostgreSQL sees `id` as both
-- the OUT parameter and `campaigns.id`, and chokes with errcode 42702:
--
--   `column reference "id" is ambiguous — It could refer to either a
--    PL/pgSQL variable or a table column.`
--
-- ## What
--
-- Re-create the function with `#variable_conflict use_column` so the
-- planner consistently resolves bare identifiers (and qualified ones
-- that match an OUT param name) to the table column. Body is otherwise
-- byte-identical to migration 071.
--
-- Idempotent (`CREATE OR REPLACE FUNCTION`); GRANT preserved.

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
#variable_conflict use_column
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
     WHERE (p_search IS NULL OR c.name ILIKE '%' || p_search || '%')
       AND (p_status IS NULL
            OR (p_status = 'active'   AND c.is_active = true)
            OR (p_status = 'inactive' AND c.is_active = false))
     ORDER BY c.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.list_campaigns_with_orders_count(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.list_campaigns_with_orders_count(text, text) TO authenticated;
