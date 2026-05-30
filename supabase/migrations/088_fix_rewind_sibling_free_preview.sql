-- ── Migration 088: Fix is_free_preview typo in manage_rewind_siblings ────────
-- The INSERT in migration 087 used is_free_preview instead of free_preview.

CREATE OR REPLACE FUNCTION public.manage_rewind_siblings(
  p_source_id   uuid,
  p_branch_pgns text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_source  lessons%ROWTYPE;
  v_old_n   int;
  v_new_n   int;
  i         int;
BEGIN
  -- Load source lesson
  SELECT * INTO v_source FROM lessons WHERE id = p_source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lesson_not_found';
  END IF;

  -- Auth: caller must be the creator of this lesson's course, or admin
  IF NOT EXISTS (
    SELECT 1
    FROM lessons l
    JOIN chapters ch ON ch.id = l.chapter_id
    JOIN courses  c  ON c.id  = ch.course_id
    JOIN users    u  ON u.id  = v_caller
    WHERE l.id = p_source_id
      AND (c.creator_id = v_caller OR u.role = 'admin')
  ) THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;

  -- Count existing siblings for this source
  SELECT count(*) INTO v_old_n FROM lessons WHERE rewind_source_id = p_source_id;
  v_new_n := coalesce(array_length(p_branch_pgns, 1), 0);

  -- Delete all existing siblings
  DELETE FROM lessons WHERE rewind_source_id = p_source_id;

  -- Net position shift for lessons that follow the source in this chapter
  IF v_new_n != v_old_n THEN
    UPDATE lessons
    SET position = position + (v_new_n - v_old_n)
    WHERE chapter_id = v_source.chapter_id
      AND position > v_source.position
      AND (rewind_source_id IS NULL OR rewind_source_id != p_source_id);
  END IF;

  -- Rewind OFF: just clear the flag and return
  IF v_new_n = 0 THEN
    UPDATE lessons SET has_rewind_mode = false WHERE id = p_source_id;
    RETURN;
  END IF;

  -- Insert N sibling rows immediately after the source
  FOR i IN 1..v_new_n LOOP
    INSERT INTO lessons (
      chapter_id,
      title,
      type,
      pgn_data,
      board_perspective,
      starting_fen,
      description,
      position,
      rewind_source_id,
      has_rewind_mode,
      free_preview
    ) VALUES (
      v_source.chapter_id,
      v_source.title || CASE WHEN v_new_n > 1
                             THEN ' (Rewind ' || i || ')'
                             ELSE ' (Rewind)'
                        END,
      v_source.type,
      p_branch_pgns[i],
      v_source.board_perspective,
      v_source.starting_fen,
      v_source.description,
      v_source.position + i,
      p_source_id,
      false,
      v_source.free_preview
    );
  END LOOP;

  -- Mark source as rewind-enabled
  UPDATE lessons SET has_rewind_mode = true WHERE id = p_source_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.manage_rewind_siblings(uuid, text[]) TO authenticated;
