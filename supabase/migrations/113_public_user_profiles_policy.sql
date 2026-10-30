-- Migration 113: Allow public read of user profiles so learners and visitors
-- can view course creators, review authors, and comment authors.

DROP POLICY IF EXISTS "Users can view own profile" ON public.users;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.users;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.users;

-- Allow reading public profiles for everyone (anon and authenticated)
CREATE POLICY "Public profiles are viewable by everyone"
  ON public.users
  FOR SELECT
  USING (true);

-- Ensure anon and authenticated have SELECT privilege on public.users
GRANT SELECT ON public.users TO anon, authenticated;

-- Keep sensitive internal override columns restricted from client roles
REVOKE SELECT (platform_fee_pct_override) ON public.users FROM anon, authenticated;
REVOKE SELECT (max_lessons_per_course_override) ON public.users FROM anon, authenticated;
