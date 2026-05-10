-- Migration 034: Per-creator saved tags
--
-- Stores the personal tag library for each creator, used by the tag dropdown
-- on the course-create / course-edit form. Decoupled from courses.tags so a
-- creator can save a tag without yet using it on any course.

CREATE TABLE IF NOT EXISTS public.creator_tags (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id  uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tag_name    text        NOT NULL CHECK (char_length(tag_name) BETWEEN 1 AND 50),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creator_id, tag_name)
);

CREATE INDEX IF NOT EXISTS creator_tags_creator_id_idx
  ON public.creator_tags (creator_id);

ALTER TABLE public.creator_tags ENABLE ROW LEVEL SECURITY;

-- Creators read their own tags
DROP POLICY IF EXISTS "Creators view own tags" ON public.creator_tags;
CREATE POLICY "Creators view own tags"
  ON public.creator_tags FOR SELECT
  USING (creator_id = auth.uid());

-- Creators insert their own tags; only creator/admin roles allowed
DROP POLICY IF EXISTS "Creators insert own tags" ON public.creator_tags;
CREATE POLICY "Creators insert own tags"
  ON public.creator_tags FOR INSERT
  WITH CHECK (
    creator_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('creator', 'admin')
    )
  );

-- Creators delete their own tags
DROP POLICY IF EXISTS "Creators delete own tags" ON public.creator_tags;
CREATE POLICY "Creators delete own tags"
  ON public.creator_tags FOR DELETE
  USING (creator_id = auth.uid());
