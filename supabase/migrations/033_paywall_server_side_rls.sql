-- Migration 033: Server-side paywall enforcement (Issue #150)
--
-- Replaces the overly permissive "publicly readable" lessons policy with a
-- restrictive one (free_preview OR enrolled OR admin). Adds two SECURITY
-- DEFINER RPCs:
--   • get_course_lesson_list  — returns listing-safe fields for the course
--     detail page (bypasses the restrictive RLS, used by getCourseDetail).
--   • get_video_playback_info — checks enrollment before returning the storage
--     path needed to generate a signed URL.
--
-- Also creates the bookmarks table (no prior migration) with enrollment-gated
-- INSERT policy, and tightens lesson_progress INSERT/UPDATE to require
-- enrollment on non-free-preview lessons.

-- ── 1. Bookmarks table ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.bookmarks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES public.users(id)   ON DELETE CASCADE,
  lesson_id    uuid        NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  pgn_snapshot text        NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, lesson_id)
);

ALTER TABLE public.bookmarks ENABLE ROW LEVEL SECURITY;

-- Users can read their own bookmarks
DROP POLICY IF EXISTS "Users can view own bookmarks" ON public.bookmarks;
CREATE POLICY "Users can view own bookmarks"
  ON public.bookmarks FOR SELECT
  USING (user_id = auth.uid());

-- Users can delete their own bookmarks
DROP POLICY IF EXISTS "Users can delete own bookmarks" ON public.bookmarks;
CREATE POLICY "Users can delete own bookmarks"
  ON public.bookmarks FOR DELETE
  USING (user_id = auth.uid());

-- Enrollment-gated INSERT: only for free-preview lessons, enrolled users, or admins
DROP POLICY IF EXISTS "Enrollment-gated bookmark insert" ON public.bookmarks;
CREATE POLICY "Enrollment-gated bookmark insert"
  ON public.bookmarks FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.lessons l
        WHERE l.id = lesson_id AND l.free_preview = true
      )
      OR EXISTS (
        SELECT 1 FROM public.enrollments e
        JOIN public.lessons l  ON l.id = lesson_id
        JOIN public.chapters ch ON ch.id = l.chapter_id
        WHERE e.user_id = auth.uid() AND e.course_id = ch.course_id
      )
      OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid() AND u.role = 'admin'
      )
    )
  );

-- ── 2. Restrict lessons SELECT to enrollment / free-preview / admin ───────────

DROP POLICY IF EXISTS "Lessons of published courses are publicly readable" ON public.lessons;

CREATE POLICY "Lesson access: free preview, enrolled, or admin"
  ON public.lessons FOR SELECT
  USING (
    free_preview = true
    OR EXISTS (
      SELECT 1 FROM public.enrollments e
      JOIN public.chapters ch ON ch.id = chapter_id
      WHERE e.user_id = auth.uid() AND e.course_id = ch.course_id
    )
    OR EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role = 'admin'
    )
  );

-- ── 3. Tighten lesson_progress INSERT / UPDATE ────────────────────────────────

DROP POLICY IF EXISTS "Users can manage own lesson progress" ON public.lesson_progress;

-- Allow SELECT of own progress without enrollment check (needed for progress display)
CREATE POLICY "Users can view own lesson_progress"
  ON public.lesson_progress FOR SELECT
  USING (user_id = auth.uid());

-- Enrollment-gated writes
CREATE POLICY "Enrollment-gated lesson_progress write"
  ON public.lesson_progress FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.lessons l
        WHERE l.id = lesson_id AND l.free_preview = true
      )
      OR EXISTS (
        SELECT 1 FROM public.enrollments e
        WHERE e.user_id = auth.uid() AND e.course_id = lesson_progress.course_id
      )
      OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid() AND u.role = 'admin'
      )
    )
  );

CREATE POLICY "Enrollment-gated lesson_progress update"
  ON public.lesson_progress FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (
      EXISTS (
        SELECT 1 FROM public.lessons l
        WHERE l.id = lesson_id AND l.free_preview = true
      )
      OR EXISTS (
        SELECT 1 FROM public.enrollments e
        WHERE e.user_id = auth.uid() AND e.course_id = lesson_progress.course_id
      )
      OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid() AND u.role = 'admin'
      )
    )
  );

-- ── 4. get_course_lesson_list — listing-safe bypass for getCourseDetail ───────

CREATE OR REPLACE FUNCTION public.get_course_lesson_list(p_course_id uuid)
RETURNS TABLE(
  id               uuid,
  chapter_id       uuid,
  title            text,
  type             text,
  "position"       int,
  free_preview     boolean,
  duration_seconds int
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id,
         l.chapter_id,
         l.title,
         l.type::text,
         l.position,
         l.free_preview,
         COALESCE(l.duration_seconds, 0)
  FROM   public.lessons l
  JOIN   public.chapters ch ON ch.id = l.chapter_id
  WHERE  ch.course_id = p_course_id
  ORDER  BY l.position;
$$;

-- ── 5. get_video_playback_info — server-side enrollment check for video ───────

CREATE OR REPLACE FUNCTION public.get_video_playback_info(p_lesson_id uuid)
RETURNS TABLE(video_provider text, video_provider_id text, video_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller     uuid := auth.uid();
  v_lesson   RECORD;
BEGIN
  SELECT l.free_preview,
         l.video_provider,
         l.video_provider_id,
         l.video_status,
         ch.course_id
  INTO   v_lesson
  FROM   public.lessons l
  JOIN   public.chapters ch ON ch.id = l.chapter_id
  WHERE  l.id = p_lesson_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lesson not found: %', p_lesson_id USING errcode = '22023';
  END IF;

  -- Access check: free_preview OR enrolled OR admin
  IF NOT (
    v_lesson.free_preview = true
    OR (
      caller IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.enrollments
        WHERE user_id = caller AND course_id = v_lesson.course_id
      )
    )
    OR (
      caller IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.users
        WHERE id = caller AND role = 'admin'
      )
    )
  ) THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  RETURN QUERY
    SELECT v_lesson.video_provider::text,
           v_lesson.video_provider_id::text,
           v_lesson.video_status::text;
END;
$$;
