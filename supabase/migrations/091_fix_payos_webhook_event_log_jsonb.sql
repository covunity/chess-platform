-- Fix PayOS webhook log storage so it behaves like a JSON array, not an array-of-jsonb column.
--
-- The older PayOS RPCs treated webhook_event_log as a JSON array of payload objects.
-- The column was still created as jsonb[] in migration 055, which makes the later
-- SQL expressions type-incompatible when combined with jsonb values. This migration
-- converts the column to jsonb and switches the RPCs to append via jsonb_build_array.

ALTER TABLE public.orders
  ALTER COLUMN webhook_event_log DROP DEFAULT;

ALTER TABLE public.orders
  ALTER COLUMN webhook_event_log TYPE jsonb
  USING CASE
    WHEN webhook_event_log IS NULL THEN '[]'::jsonb
    ELSE to_jsonb(webhook_event_log)
  END;

ALTER TABLE public.orders
  ALTER COLUMN webhook_event_log SET DEFAULT '[]'::jsonb;

ALTER TABLE public.orders
  ALTER COLUMN webhook_event_log SET NOT NULL;

COMMENT ON COLUMN public.orders.webhook_event_log IS
  'JSON array of PayOS webhook payloads captured by confirmation and cancellation flows.';

CREATE OR REPLACE FUNCTION public.confirm_order_via_payos(
  p_payos_order_code     bigint,
  p_payos_transaction_id text,
  p_payload              jsonb
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order        public.orders;
  v_existing     public.orders;
  v_rows_updated integer;
  v_warning      jsonb;
BEGIN
  UPDATE public.orders
  SET status               = 'active',
      paid_at              = now(),
      confirmed_at         = now(),
      payos_transaction_id = p_payos_transaction_id,
      webhook_event_log    = COALESCE(webhook_event_log, '[]'::jsonb)
        || jsonb_build_array(p_payload)
  WHERE id = (
    SELECT id FROM public.orders
    WHERE payos_order_code = p_payos_order_code
    FOR UPDATE
  )
    AND status                = 'pending'
    AND payos_transaction_id IS NULL
  RETURNING * INTO v_order;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated = 1 THEN
    INSERT INTO public.enrollments (course_id, user_id, order_id)
    VALUES (v_order.course_id, v_order.user_id, v_order.id)
    ON CONFLICT (course_id, user_id) DO NOTHING;
    RETURN v_order;
  END IF;

  SELECT * INTO v_existing
  FROM public.orders
  WHERE payos_order_code = p_payos_order_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found for payos_order_code: %', p_payos_order_code
      USING errcode = '22023';
  END IF;

  IF v_existing.payos_transaction_id IS NOT DISTINCT FROM p_payos_transaction_id THEN
    UPDATE public.orders
       SET webhook_event_log = COALESCE(webhook_event_log, '[]'::jsonb)
         || jsonb_build_array(p_payload)
     WHERE id = v_existing.id
     RETURNING * INTO v_existing;
    RETURN v_existing;
  END IF;

  IF v_existing.status = 'expired' THEN
    v_warning := jsonb_build_object(
      'warning',    'late_paid_after_expire',
      'expired_at', v_existing.expired_at
    );
    UPDATE public.orders
       SET status               = 'active',
           paid_at              = now(),
           confirmed_at         = now(),
           payos_transaction_id = p_payos_transaction_id,
           webhook_event_log    = COALESCE(webhook_event_log, '[]'::jsonb)
             || jsonb_build_array(p_payload, v_warning)
     WHERE id = v_existing.id
     RETURNING * INTO v_order;
    INSERT INTO public.enrollments (course_id, user_id, order_id)
    VALUES (v_order.course_id, v_order.user_id, v_order.id)
    ON CONFLICT (course_id, user_id) DO NOTHING;
    RETURN v_order;
  END IF;

  IF v_existing.status = 'cancelled' THEN
    UPDATE public.orders
       SET status               = 'refund_pending',
           payos_transaction_id = p_payos_transaction_id,
           refund_due_to        = jsonb_build_object(
             'payer_account', p_payload ->> 'counterAccountNumber',
             'payer_name',    p_payload ->> 'counterAccountName',
             'payer_bank',    p_payload ->> 'counterAccountBankName',
             'amount',        p_payload ->> 'amount',
             'paid_at',       to_jsonb(now())
           ),
           webhook_event_log    = COALESCE(webhook_event_log, '[]'::jsonb)
             || jsonb_build_array(p_payload)
     WHERE id = v_existing.id
     RETURNING * INTO v_order;
    RETURN v_order;
  END IF;

  IF v_existing.status IN ('refund_pending', 'refunded') THEN
    UPDATE public.orders
       SET webhook_event_log = COALESCE(webhook_event_log, '[]'::jsonb)
         || jsonb_build_array(p_payload)
     WHERE id = v_existing.id
     RETURNING * INTO v_existing;
    RETURN v_existing;
  END IF;

  IF v_existing.status = 'active' THEN
    RAISE EXCEPTION
      'payos_transaction_id_conflict: order=% existing=% incoming=%',
      v_existing.id, v_existing.payos_transaction_id, p_payos_transaction_id
      USING errcode = '23000';
  END IF;

  RAISE EXCEPTION 'unexpected_status_branch: status=%, txn=%',
                  v_existing.status, v_existing.payos_transaction_id
    USING errcode = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION public.log_payos_cancellation(
  p_payos_order_code bigint,
  p_payload          jsonb
)
RETURNS public.orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders;
BEGIN
  UPDATE public.orders
     SET webhook_event_log = COALESCE(webhook_event_log, '[]'::jsonb)
       || jsonb_build_array(p_payload)
   WHERE payos_order_code = p_payos_order_code
   RETURNING * INTO v_order;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found for payos_order_code: %', p_payos_order_code
      USING errcode = '22023';
  END IF;

  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_order_via_payos(bigint, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_order_via_payos(bigint, text, jsonb) TO service_role;

REVOKE ALL ON FUNCTION public.log_payos_cancellation(bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_payos_cancellation(bigint, jsonb) TO service_role;
