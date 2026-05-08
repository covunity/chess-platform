-- Admin-only RPC to change a user's account tier with downgrade-violation guard.
-- Raises tier_downgrade_violates_chapter_limit if any of the user's existing
-- courses would exceed the new tier's max_chapters_per_course limit (E-11).

CREATE OR REPLACE FUNCTION public.change_user_account_tier(
  target_user_id uuid,
  new_tier       text
)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller     uuid := auth.uid();
  tier_row   public.account_tiers;
  target     public.users;
  viol_count int;
BEGIN
  -- Admin guard
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  -- Validate tier code
  SELECT * INTO tier_row FROM public.account_tiers WHERE code = new_tier;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid tier code: %', new_tier USING errcode = '22023';
  END IF;

  -- Lock target user (E-10: cannot change tier for admin)
  SELECT * INTO target FROM public.users WHERE id = target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found' USING errcode = 'P0002';
  END IF;

  IF target.role = 'admin' THEN
    RAISE EXCEPTION 'cannot change tier for admin user' USING errcode = '22023';
  END IF;

  -- Downgrade violation check (E-11)
  SELECT COUNT(*) INTO viol_count
    FROM public.courses c
   WHERE c.creator_id = target_user_id
     AND (
       SELECT COUNT(*) FROM public.chapters ch WHERE ch.course_id = c.id
     ) > tier_row.max_chapters_per_course;

  IF viol_count > 0 THEN
    RAISE EXCEPTION 'tier_downgrade_violates_chapter_limit'
      USING errcode = '22023',
            detail  = format('%s course(s) exceed the new tier chapter limit of %s',
                             viol_count, tier_row.max_chapters_per_course);
  END IF;

  UPDATE public.users
     SET account_tier_id = new_tier
   WHERE id = target_user_id
   RETURNING * INTO target;

  RETURN target;
END;
$$;

REVOKE ALL ON FUNCTION public.change_user_account_tier(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.change_user_account_tier(uuid, text) TO authenticated;
