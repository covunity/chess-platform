-- Voucher deletion is no longer permitted. Admins deactivate vouchers instead
-- (deactivate_voucher RPC). Hard-deleting vouchers would break the audit trail
-- in voucher_usages. This migration drops the delete_voucher function entirely
-- so the operation cannot be triggered via direct API calls either.
DROP FUNCTION IF EXISTS public.delete_voucher(uuid);
