-- Migration 018: Account tiers lookup table
-- See docs/adr/0002-enterprise-account-tiers.md, PRD-0001

CREATE TABLE IF NOT EXISTS public.account_tiers (
  code                    text PRIMARY KEY,
  name_vi                 text NOT NULL,
  platform_fee_pct        numeric(5, 2) NOT NULL CHECK (platform_fee_pct >= 0 AND platform_fee_pct <= 100),
  max_chapters_per_course int NOT NULL CHECK (max_chapters_per_course > 0),
  is_enterprise           boolean NOT NULL DEFAULT false,
  requires_approval       boolean NOT NULL DEFAULT true,
  display_order           int NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- Seed 4 initial tiers.
-- TODO: Confirm fee % and chapter limits with BizDev before public launch.
INSERT INTO public.account_tiers (code, name_vi, platform_fee_pct, max_chapters_per_course, is_enterprise, requires_approval, display_order)
VALUES
  ('individual',       'Cá nhân',            20.00, 10, false, true, 1),
  ('business',         'Doanh nghiệp',        15.00, 30, true,  true, 2),
  ('athlete',          'Vận động viên',       10.00, 15, true,  true, 3),
  ('training_center',  'Trung tâm đào tạo',   10.00, 50, true,  true, 4)
ON CONFLICT (code) DO NOTHING;

-- RLS: public SELECT (anon can load tier list on /become-creator).
-- INSERT / UPDATE / DELETE restricted to admin role via separate policy.
ALTER TABLE public.account_tiers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "account_tiers_select_public" ON public.account_tiers;
CREATE POLICY "account_tiers_select_public"
  ON public.account_tiers
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "account_tiers_write_admin" ON public.account_tiers;
CREATE POLICY "account_tiers_write_admin"
  ON public.account_tiers
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid() AND users.role = 'admin'
    )
  );
