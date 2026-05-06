-- Slice 10: Course detail page — new fields for rich detail view

-- New fields on courses
ALTER TABLE public.courses
  ADD COLUMN IF NOT EXISTS what_you_learn  text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS prerequisites   text,
  ADD COLUMN IF NOT EXISTS original_price  integer     CHECK (original_price >= 0),
  ADD COLUMN IF NOT EXISTS promo_ends_at   timestamptz;

-- Duration on lessons
ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS duration_seconds integer NOT NULL DEFAULT 0
    CHECK (duration_seconds >= 0);

-- ── Enrollments ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.enrollments (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid        NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, user_id)
);

ALTER TABLE public.enrollments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own enrollments"
  ON public.enrollments FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "System can insert enrollments"
  ON public.enrollments FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- ── Reviews ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.reviews (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    uuid        NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  reviewer_id  uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  rating       smallint    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title        text,
  body         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, reviewer_id)
);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- Reviews are publicly readable
CREATE POLICY "Reviews are publicly readable"
  ON public.reviews FOR SELECT
  USING (true);

-- Enrolled learners can write reviews
CREATE POLICY "Enrolled learners can write reviews"
  ON public.reviews FOR INSERT
  WITH CHECK (
    reviewer_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.enrollments
      WHERE course_id = reviews.course_id AND user_id = auth.uid()
    )
  );

-- ── RLS: public read for published courses, chapters, lessons ─────────────────

-- Allow anyone to read published courses (course detail page is public)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'courses' AND policyname = 'Published courses are publicly readable'
  ) THEN
    CREATE POLICY "Published courses are publicly readable"
      ON public.courses FOR SELECT
      USING (status = 'published');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'chapters' AND policyname = 'Chapters of published courses are publicly readable'
  ) THEN
    CREATE POLICY "Chapters of published courses are publicly readable"
      ON public.chapters FOR SELECT
      USING (
        EXISTS (
          SELECT 1 FROM public.courses
          WHERE id = course_id AND status = 'published'
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'lessons' AND policyname = 'Lessons of published courses are publicly readable'
  ) THEN
    CREATE POLICY "Lessons of published courses are publicly readable"
      ON public.lessons FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.chapters ch
          JOIN public.courses co ON co.id = ch.course_id
          WHERE ch.id = chapter_id AND co.status = 'published'
        )
      );
  END IF;
END $$;
