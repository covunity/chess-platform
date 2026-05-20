-- Slice 5 of PRD-0005 — admin refund queue: mark refunded
--
-- Closes the loop on `refund_pending` orders created by slice 3
-- (migration 056, D9b: cancelled-then-paid). Admin transfers funds back
-- out-of-band via personal banking app, then calls this RPC with the bank
-- transaction reference to flip the order to the terminal `refunded` state.
--
-- NAPAS instant transfers cannot be programmatically reversed (PRD-0005 §3,
-- D9b), so this RPC is the system of record for refund completion. The
-- `refund_reference` text is the txn ref from the admin's banking app and
-- becomes the audit trail.
--
-- Reference: PRD-0005 §4 P5, §5.7, §10 D9b; issue #259.
--
-- Idempotent: CREATE OR REPLACE FUNCTION — safe to re-run.

create or replace function public.mark_order_refunded(
  p_order_id          uuid,
  p_refund_reference  text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_role text;
  v_order       public.orders;
  v_ref         text;
begin
  -- Admin-only gate. SECURITY DEFINER runs as the function owner, so we
  -- must explicitly assert the caller's role via auth.uid().
  select role into v_caller_role
  from public.users
  where id = auth.uid();

  if v_caller_role is distinct from 'admin' then
    raise exception 'only admins can mark orders refunded'
      using errcode = '42501';
  end if;

  -- Validate reference is non-empty after trim. errcode 22023 mirrors
  -- the validation pattern used elsewhere in this codebase.
  v_ref := nullif(trim(coalesce(p_refund_reference, '')), '');
  if v_ref is null then
    raise exception 'refund_reference is required'
      using errcode = '22023';
  end if;

  -- Lock the row to prevent concurrent flips.
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'order not found: %', p_order_id
      using errcode = '22023';
  end if;

  -- State assertion: only refund_pending → refunded is allowed.
  if v_order.status is distinct from 'refund_pending' then
    raise exception 'order not in refund_pending status (current: %)', v_order.status
      using errcode = '22023';
  end if;

  update public.orders
     set status           = 'refunded',
         refunded_at      = now(),
         refunded_by      = auth.uid(),
         refund_reference = v_ref
   where id = p_order_id
   returning * into v_order;

  return v_order;
end;
$$;

revoke all on function public.mark_order_refunded(uuid, text) from public;
grant execute on function public.mark_order_refunded(uuid, text) to authenticated;

comment on function public.mark_order_refunded(uuid, text) is
  'Admin-only: flips a refund_pending order to refunded after the admin has '
  'completed the out-of-band bank transfer. Requires a non-empty bank '
  'transaction reference. PRD-0005 §5.7, issue #259.';
