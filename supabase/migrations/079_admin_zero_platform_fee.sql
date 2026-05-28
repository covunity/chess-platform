-- Migration 079: admin role pays zero platform fee
-- When a user with role='admin' sells a course, they keep 100% of revenue.
-- The learner journey, price, and payment flow are unchanged — only the
-- fee snapshot resolves to 0 for admins, so orders book full price as
-- creator_payout and zero platform_fee.
--
-- Role check happens at the resolver level (resolve_platform_fee_pct), so
-- it cascades through create_order_with_fee_snapshot → orders snapshot →
-- creator_wallet view → payout RPCs → admin analytics (which read the same
-- orders.platform_fee_amount / creator_payout_amount columns) without
-- further edits.
--
-- Role wins over both account_tiers.platform_fee_pct and the manual
-- users.platform_fee_pct_override (an admin can never be charged a fee,
-- even if dirty data sets an override). admin_set_creator_fee_override
-- already rejects non-creator targets (mig 039 line 173), and
-- admin_list_creator_fees already filters role='creator' (mig 039 line 266),
-- so admins remain invisible in the override admin UI.

-- ── 1. Resolver: admin role short-circuits to 0 ─────────────────────────────
CREATE OR REPLACE FUNCTION public.resolve_platform_fee_pct(p_user_id uuid)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE
    WHEN u.role = 'admin' THEN 0::numeric
    ELSE COALESCE(
      u.platform_fee_pct_override,
      at.platform_fee_pct,
      20  -- legacy global default
    )
  END
  FROM public.users u
  LEFT JOIN public.account_tiers at ON at.code = u.account_tier_id
  WHERE u.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.resolve_platform_fee_pct(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_platform_fee_pct(uuid) TO authenticated;

-- ── 2. Defensive cleanup: clear any stale override on admin users ───────────
-- Admin role wins regardless, but keep the column tidy so admin UIs and
-- audits don't show a non-zero override that would never take effect.
UPDATE public.users
   SET platform_fee_pct_override = NULL
 WHERE role = 'admin'
   AND platform_fee_pct_override IS NOT NULL;

-- ── 3. Backfill existing orders where creator is currently admin ────────────
-- Project is pre-launch with no real orders to preserve. Rewriting the
-- snapshot here keeps creator_wallet, payouts, and AdminOrdersPage display
-- consistent with the new rule from the very first order onward.
UPDATE public.orders o
   SET platform_fee_pct       = 0,
       platform_fee_amount    = 0,
       creator_payout_amount  = o.amount,
       creator_payout         = o.amount
  FROM public.courses c
  JOIN public.users u ON u.id = c.creator_id
 WHERE o.course_id = c.id
   AND u.role = 'admin'
   AND (o.platform_fee_amount > 0 OR o.creator_payout_amount <> o.amount);

-- ── 4. Refresh today's analytics_snapshots so AdminAnalyticsPage reflects ───
-- the new rule immediately (instead of waiting for the 00:05 ICT cron).
-- compute_analytics_snapshot reads SUM(platform_fee_amount) etc. from orders;
-- thanks to step 3 above, it now sees the corrected per-row snapshots.
-- The function's admin gate is bypassed when auth.uid() is NULL (migration /
-- system context), and the upsert on (snapshot_date, time_range, category)
-- makes this safe to re-run.
SELECT public.compute_analytics_snapshot(true);
