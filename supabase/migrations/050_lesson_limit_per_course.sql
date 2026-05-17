-- Migration 050: max_lessons_per_course (tier default + per-creator override).
--
-- Mirrors the existing platform-fee architecture:
--   * Tier-level default on `account_tiers.max_lessons_per_course` (#018-style)
--   * Per-creator override on `users.max_lessons_per_course_override` (#039-style)
--   * `resolve_max_lessons_per_course(user_id)` returns override → tier → fallback
--   * BEFORE INSERT trigger on `lessons` enforces the cap (#020/#025-style, with
--     FOR UPDATE on the course row to serialize concurrent inserts)
--   * Admin RPCs for set/clear override; `admin_update_account_tier` extended
--   * `admin_list_creator_fees` extended to surface lesson-limit fields too,
--     since the admin UI overlays both knobs on the same row.
--
-- Counting note: every row in `lessons` for the course counts, including
-- auto-managed Rewind siblings (`rewind_source_id IS NOT NULL`). This matches
-- product intent — enabling Rewind on a source lesson consumes 2 lesson slots.

-- ── 1. Tier column with placeholder defaults (BizDev to tune later) ──────────
ALTER TABLE public.account_tiers
  ADD COLUMN IF NOT EXISTS max_lessons_per_course int;

UPDATE public.account_tiers SET max_lessons_per_course = 30  WHERE code = 'individual'       AND max_lessons_per_course IS NULL;
UPDATE public.account_tiers SET max_lessons_per_course = 150 WHERE code = 'business'         AND max_lessons_per_course IS NULL;
UPDATE public.account_tiers SET max_lessons_per_course = 75  WHERE code = 'athlete'          AND max_lessons_per_course IS NULL;
UPDATE public.account_tiers SET max_lessons_per_course = 300 WHERE code = 'training_center'  AND max_lessons_per_course IS NULL;

ALTER TABLE public.account_tiers
  ALTER COLUMN max_lessons_per_course SET NOT NULL,
  ALTER COLUMN max_lessons_per_course SET DEFAULT 30,
  ADD CONSTRAINT account_tiers_max_lessons_chk
    CHECK (max_lessons_per_course >= 1 AND max_lessons_per_course <= 10000);

COMMENT ON COLUMN public.account_tiers.max_lessons_per_course IS
  'Default cap on lessons per course for creators in this tier. '
  'Can be overridden per-creator via users.max_lessons_per_course_override.';

-- ── 2. Per-creator override column on users ─────────────────────────────────
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS max_lessons_per_course_override int
    CHECK (
      max_lessons_per_course_override IS NULL
      OR (max_lessons_per_course_override >= 1 AND max_lessons_per_course_override <= 10000)
    );

COMMENT ON COLUMN public.users.max_lessons_per_course_override IS
  'Per-creator lesson-cap override. When set, replaces account_tiers.max_lessons_per_course '
  'for this user. NULL → fallback to tier value. Mutations affect future inserts only.';

-- Hide the column from non-admin clients (same pattern as platform_fee_pct_override).
REVOKE SELECT (max_lessons_per_course_override) ON public.users FROM authenticated;
REVOKE UPDATE (max_lessons_per_course_override) ON public.users FROM authenticated;

-- ── 3. Resolver function (override → tier → 30 fallback) ────────────────────
CREATE OR REPLACE FUNCTION public.resolve_max_lessons_per_course(p_user_id uuid)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE(
    u.max_lessons_per_course_override,
    at.max_lessons_per_course,
    30
  )
  FROM public.users u
  LEFT JOIN public.account_tiers at ON at.code = u.account_tier_id
  WHERE u.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.resolve_max_lessons_per_course(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_max_lessons_per_course(uuid) TO authenticated;

-- ── 4. Enforcement trigger (BEFORE INSERT on lessons) ───────────────────────
CREATE OR REPLACE FUNCTION public.enforce_lesson_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_id     uuid;
  v_creator_id    uuid;
  v_max_lessons   int;
  v_current_count int;
BEGIN
  -- Resolve course from the chapter the new lesson belongs to.
  SELECT ch.course_id INTO v_course_id
  FROM public.chapters ch
  WHERE ch.id = NEW.chapter_id;

  IF v_course_id IS NULL THEN
    -- FK on chapter_id will fail anyway; let it surface there.
    RETURN NEW;
  END IF;

  -- Serialize concurrent lesson inserts in the same course by locking the
  -- course row (same trick as #025 for chapters).
  PERFORM 1 FROM public.courses WHERE id = v_course_id FOR UPDATE;

  SELECT creator_id INTO v_creator_id
  FROM public.courses
  WHERE id = v_course_id;

  v_max_lessons := public.resolve_max_lessons_per_course(v_creator_id);

  SELECT count(*) INTO v_current_count
  FROM public.lessons l
  JOIN public.chapters ch ON ch.id = l.chapter_id
  WHERE ch.course_id = v_course_id;

  IF v_current_count >= v_max_lessons THEN
    RAISE EXCEPTION 'lesson_limit_exceeded: current=%, max=%',
      v_current_count, v_max_lessons
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_lesson_limit_trigger ON public.lessons;
CREATE TRIGGER enforce_lesson_limit_trigger
  BEFORE INSERT ON public.lessons
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_lesson_limit();

-- ── 5. Extend admin_update_account_tier to include the lesson cap ───────────
-- Drop the old 3-arg signature; admin UI will send all 3 knobs in one call.
DROP FUNCTION IF EXISTS public.admin_update_account_tier(text, numeric, integer);

CREATE OR REPLACE FUNCTION public.admin_update_account_tier(
  p_code                    text,
  p_platform_fee_pct        numeric,
  p_max_chapters_per_course integer,
  p_max_lessons_per_course  integer
)
RETURNS public.account_tiers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  target public.account_tiers;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_platform_fee_pct IS NULL OR p_platform_fee_pct < 0 OR p_platform_fee_pct > 100 THEN
    RAISE EXCEPTION 'platform_fee_pct must be between 0 and 100' USING errcode = '22023';
  END IF;

  IF p_max_chapters_per_course IS NULL OR p_max_chapters_per_course < 1 OR p_max_chapters_per_course > 1000 THEN
    RAISE EXCEPTION 'max_chapters_per_course must be between 1 and 1000' USING errcode = '22023';
  END IF;

  IF p_max_lessons_per_course IS NULL OR p_max_lessons_per_course < 1 OR p_max_lessons_per_course > 10000 THEN
    RAISE EXCEPTION 'max_lessons_per_course must be between 1 and 10000' USING errcode = '22023';
  END IF;

  SELECT * INTO target FROM public.account_tiers WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tier not found: %', p_code USING errcode = 'P0002';
  END IF;

  UPDATE public.account_tiers
     SET platform_fee_pct        = p_platform_fee_pct,
         max_chapters_per_course = p_max_chapters_per_course,
         max_lessons_per_course  = p_max_lessons_per_course
   WHERE code = p_code
   RETURNING * INTO target;

  RETURN target;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_account_tier(text, numeric, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_update_account_tier(text, numeric, integer, integer) TO authenticated;

-- ── 6. Admin RPC: set per-creator lesson-limit override ─────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_creator_lesson_limit_override(
  p_user_id uuid,
  p_max     integer
)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  target public.users;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  IF p_max IS NULL OR p_max < 1 OR p_max > 10000 THEN
    RAISE EXCEPTION 'override must be between 1 and 10000' USING errcode = '22023';
  END IF;

  SELECT * INTO target FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found' USING errcode = 'P0002';
  END IF;
  IF target.role <> 'creator' THEN
    RAISE EXCEPTION 'target user is not a creator' USING errcode = '22023';
  END IF;

  UPDATE public.users
     SET max_lessons_per_course_override = p_max
   WHERE id = p_user_id
   RETURNING * INTO target;

  RETURN target;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_creator_lesson_limit_override(uuid, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_set_creator_lesson_limit_override(uuid, integer) TO authenticated;

-- ── 7. Admin RPC: clear per-creator lesson-limit override ───────────────────
CREATE OR REPLACE FUNCTION public.admin_clear_creator_lesson_limit_override(p_user_id uuid)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  target public.users;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  UPDATE public.users
     SET max_lessons_per_course_override = NULL
   WHERE id = p_user_id
   RETURNING * INTO target;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user not found' USING errcode = 'P0002';
  END IF;

  RETURN target;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_clear_creator_lesson_limit_override(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_clear_creator_lesson_limit_override(uuid) TO authenticated;

-- ── 8. Extend admin_list_creator_fees with lesson-limit fields ──────────────
-- Replace the existing 4-arg version. Same signature for filters; result row
-- gains tier_max_lessons, max_lessons_per_course_override, effective_max_lessons.
-- The `p_overrides_only` flag now matches creators with EITHER override set.
DROP FUNCTION IF EXISTS public.admin_list_creator_fees(text, boolean, integer, integer);

CREATE OR REPLACE FUNCTION public.admin_list_creator_fees(
  p_search         text    DEFAULT NULL,
  p_overrides_only boolean DEFAULT FALSE,
  p_limit          integer DEFAULT 50,
  p_offset         integer DEFAULT 0
)
RETURNS TABLE (
  user_id                          uuid,
  name                             text,
  email                            text,
  account_tier_id                  text,
  tier_name_vi                     text,
  tier_fee_pct                     numeric,
  platform_fee_pct_override        numeric,
  effective_fee_pct                numeric,
  tier_max_lessons                 integer,
  max_lessons_per_course_override  integer,
  effective_max_lessons            integer,
  total_count                      bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_search text := nullif(trim(coalesce(p_search, '')), '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN QUERY
  WITH filtered AS (
    SELECT u.id,
           u.name,
           u.email,
           u.account_tier_id,
           at.name_vi                                                       AS tier_name_vi,
           at.platform_fee_pct                                              AS tier_fee_pct,
           u.platform_fee_pct_override,
           COALESCE(u.platform_fee_pct_override, at.platform_fee_pct, 20)   AS effective_fee_pct,
           at.max_lessons_per_course                                        AS tier_max_lessons,
           u.max_lessons_per_course_override,
           COALESCE(u.max_lessons_per_course_override, at.max_lessons_per_course, 30) AS effective_max_lessons
      FROM public.users u
      LEFT JOIN public.account_tiers at ON at.code = u.account_tier_id
     WHERE u.role = 'creator'
       AND (v_search IS NULL
            OR u.email ILIKE '%' || v_search || '%'
            OR coalesce(u.name, '') ILIKE '%' || v_search || '%')
       AND (NOT p_overrides_only
            OR u.platform_fee_pct_override IS NOT NULL
            OR u.max_lessons_per_course_override IS NOT NULL)
  ),
  counted AS (SELECT count(*) AS total_count FROM filtered)
  SELECT f.id,
         f.name,
         f.email,
         f.account_tier_id,
         f.tier_name_vi,
         f.tier_fee_pct,
         f.platform_fee_pct_override,
         f.effective_fee_pct,
         f.tier_max_lessons,
         f.max_lessons_per_course_override,
         f.effective_max_lessons,
         c.total_count
    FROM filtered f
    CROSS JOIN counted c
   ORDER BY f.email ASC
   LIMIT  greatest(p_limit, 1)
   OFFSET greatest(p_offset, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_creator_fees(text, boolean, integer, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_creator_fees(text, boolean, integer, integer) TO authenticated;
