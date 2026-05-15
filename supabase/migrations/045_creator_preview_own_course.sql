-- Migration 045: Creator preview of own course
--
-- Lets a course creator preview their own course without being enrolled,
-- mirroring the existing 'admin' exception. Three changes:
--   1. get_video_playback_info — allow when caller is the course creator
--   2. bookmarks INSERT policy — allow on own course lessons
--   3. lesson_progress INSERT + UPDATE — allow on own course
--
-- Background: prior to this migration, RLS (migration 033) gated lesson
-- video URLs, bookmarks, and progress writes on (free_preview OR enrolled
-- OR admin). A creator visiting /learn/:id/:lid on their own un-enrolled
-- course would hit 403 on video signed URL fetch and on any progress /
-- bookmark write. This blocks the "preview as learner" UX shipped in
-- CourseDetailPage at the same time.

-- ── 1. get_video_playback_info ────────────────────────────────────────────────

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

  -- Access check: free_preview OR enrolled OR admin OR course creator
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
    OR (
      caller IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.courses
        WHERE id = v_lesson.course_id AND creator_id = caller
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

-- ── 2. bookmarks INSERT policy ────────────────────────────────────────────────

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
      OR EXISTS (
        SELECT 1 FROM public.lessons l
        JOIN public.chapters ch ON ch.id = l.chapter_id
        JOIN public.courses  co ON co.id = ch.course_id
        WHERE l.id = lesson_id AND co.creator_id = auth.uid()
      )
    )
  );

-- ── 3. lesson_progress INSERT + UPDATE policies ───────────────────────────────

DROP POLICY IF EXISTS "Enrollment-gated lesson_progress write"  ON public.lesson_progress;
DROP POLICY IF EXISTS "Enrollment-gated lesson_progress update" ON public.lesson_progress;

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
      OR EXISTS (
        SELECT 1 FROM public.courses co
        WHERE co.id = lesson_progress.course_id AND co.creator_id = auth.uid()
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
      OR EXISTS (
        SELECT 1 FROM public.courses co
        WHERE co.id = lesson_progress.course_id AND co.creator_id = auth.uid()
      )
    )
  );
