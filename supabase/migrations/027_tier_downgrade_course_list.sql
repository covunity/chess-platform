-- Patch change_user_account_tier and approve_account_application to include
-- the list of violating courses (id, title, chapter_count) in RAISE EXCEPTION
-- DETAIL as JSON, so the UI can display course names in the error toast (#102).

-- ── 1. change_user_account_tier ──────────────────────────────────────────────
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
  caller        uuid := auth.uid();
  tier_row      public.account_tiers;
  target        public.users;
  viol_courses  jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT * INTO tier_row FROM public.account_tiers WHERE code = new_tier;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid tier code: %', new_tier USING errcode = '22023';
  END IF;

  SELECT * INTO target FROM public.users WHERE id = target_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found' USING errcode = 'P0002';
  END IF;

  IF target.role = 'admin' THEN
    RAISE EXCEPTION 'cannot change tier for admin user' USING errcode = '22023';
  END IF;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',            c.id::text,
      'title',         c.title,
      'chapter_count', (SELECT COUNT(*) FROM chapters ch WHERE ch.course_id = c.id)
    )
  ) INTO viol_courses
  FROM courses c
  WHERE c.creator_id = target_user_id
    AND (SELECT COUNT(*) FROM chapters ch WHERE ch.course_id = c.id) > tier_row.max_chapters_per_course;

  IF viol_courses IS NOT NULL THEN
    RAISE EXCEPTION 'tier_downgrade_violates_chapter_limit'
      USING errcode = '22023',
            detail  = jsonb_build_object('violating_courses', viol_courses)::text;
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

-- ── 2. approve_account_application ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_account_application(app_id uuid)
RETURNS public.account_applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  app          public.account_applications;
  caller       uuid := auth.uid();
  target       public.users;
  new_tier     public.account_tiers;
  viol_courses jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  SELECT * INTO app FROM public.account_applications
   WHERE id = app_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'application not found' USING errcode = 'P0002';
  END IF;

  IF app.status <> 'pending' THEN
    RAISE EXCEPTION 'application already reviewed' USING errcode = '22023';
  END IF;

  SELECT * INTO target FROM public.users WHERE id = app.user_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found' USING errcode = 'P0002';
  END IF;

  IF target.role = 'admin' THEN
    RAISE EXCEPTION 'cannot approve application for admin user' USING errcode = '22023';
  END IF;

  SELECT * INTO new_tier FROM public.account_tiers WHERE code = app.requested_tier_code;

  SELECT jsonb_agg(
    jsonb_build_object(
      'id',            c.id::text,
      'title',         c.title,
      'chapter_count', (SELECT COUNT(*) FROM chapters ch WHERE ch.course_id = c.id)
    )
  ) INTO viol_courses
  FROM courses c
  WHERE c.creator_id = target.id
    AND (SELECT COUNT(*) FROM chapters ch WHERE ch.course_id = c.id) > new_tier.max_chapters_per_course;

  IF viol_courses IS NOT NULL THEN
    RAISE EXCEPTION 'tier_downgrade_violates_chapter_limit'
      USING errcode = '22023',
            detail  = jsonb_build_object('violating_courses', viol_courses)::text;
  END IF;

  IF target.role = 'learner' THEN
    UPDATE public.users
       SET role            = 'creator',
           account_tier_id = app.requested_tier_code
     WHERE id = target.id;
  ELSE
    UPDATE public.users
       SET account_tier_id = app.requested_tier_code
     WHERE id = target.id;
  END IF;

  UPDATE public.account_applications
     SET status      = 'approved',
         reviewed_at = now(),
         reviewed_by = caller
   WHERE id = app_id
   RETURNING * INTO app;

  RETURN app;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_account_application(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_account_application(uuid) TO authenticated;
