-- Migration 024: Drop direct INSERT policy on account_applications (issue #100).
-- The "Users insert own application" policy from migration 016 allows authenticated
-- users to INSERT directly, bypassing submit_account_application RPC and its
-- tier-specific validation (E-19). Revoke it; the SECURITY DEFINER RPC is the only
-- allowed insertion path.

DROP POLICY IF EXISTS "Users insert own application" ON public.account_applications;
