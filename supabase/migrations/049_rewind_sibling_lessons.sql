-- Migration 049: Rewind sibling lessons as separate rows.
--
-- Replaces the "Study ↔ Rewind toggle inside one lesson" model with a paired-
-- sibling model. When a creator ticks `has_rewind_mode=true` on a chess
-- lesson, a sibling lesson is auto-created in the same chapter, positioned
-- right after the source, that mirrors the source's content. The sibling
-- counts as its own lesson for tier-based limits.
--
-- Linkage: `lessons.rewind_source_id` is a nullable self-FK.
--   NULL          → normal lesson (source of a pair, OR plain solo lesson)
--   NOT NULL      → rewind sibling of the referenced source
--
-- A trigger keeps the sibling's content in sync whenever the source changes,
-- creates/deletes it when the flag flips, and ensures the sibling sits
-- immediately after the source on insert.

ALTER TABLE public.lessons
  ADD COLUMN IF NOT EXISTS rewind_source_id uuid
    REFERENCES public.lessons(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS lessons_rewind_source_idx
  ON public.lessons(rewind_source_id)
  WHERE rewind_source_id IS NOT NULL;

COMMENT ON COLUMN public.lessons.rewind_source_id IS
  'When NOT NULL, this lesson is the auto-managed Rewind sibling of the referenced lesson. '
  'Its content is kept in sync with the source by sync_rewind_sibling().';

-- ── Trigger ──────────────────────────────────────────────────────────────────
--
-- Maintains the sibling row in response to changes on a source lesson.
-- The trigger only acts on rows that are themselves sources
-- (rewind_source_id IS NULL); sibling rows are passive.

CREATE OR REPLACE FUNCTION public.sync_rewind_sibling()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  paired_id uuid;
  paired_title text;
  base_title  text;
  paired_old  public.lessons%ROWTYPE;
BEGIN
  -- Sibling rows are managed by this trigger; skip when one updates itself.
  IF NEW.rewind_source_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Recursive position-shift UPDATEs land back here. pg_trigger_depth() > 1
  -- means we're nested — bail without doing more work.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  SELECT id INTO paired_id
  FROM public.lessons
  WHERE rewind_source_id = NEW.id
  LIMIT 1;

  IF NEW.has_rewind_mode THEN
    -- Strip a trailing " (Rewind)" first so retitling the source to
    -- "X (Rewind)" doesn't snowball into "X (Rewind) (Rewind)".
    base_title := regexp_replace(NEW.title, ' \(Rewind\)$', '');
    paired_title := base_title || ' (Rewind)';
    IF paired_id IS NULL THEN
      -- Shift subsequent lessons down by 1 so the sibling can sit at
      -- source.position + 1. The recursive trigger invocation early-returns
      -- via pg_trigger_depth() above.
      UPDATE public.lessons
         SET position = position + 1
       WHERE chapter_id = NEW.chapter_id
         AND position > NEW.position;

      INSERT INTO public.lessons (
        chapter_id, title, type, position,
        free_preview, pgn_data, board_perspective,
        starting_fen, description, has_rewind_mode,
        rewind_source_id
      ) VALUES (
        NEW.chapter_id, paired_title, NEW.type, NEW.position + 1,
        false, NEW.pgn_data, NEW.board_perspective,
        NEW.starting_fen, NEW.description, false,
        NEW.id
      );
    ELSE
      -- Sync content into the existing sibling and keep it parked right after
      -- the source (handles reorder within the chapter AND chapter moves).
      SELECT * INTO paired_old FROM public.lessons WHERE id = paired_id;

      UPDATE public.lessons
         SET title             = paired_title,
             type              = NEW.type,
             pgn_data          = NEW.pgn_data,
             board_perspective = NEW.board_perspective,
             starting_fen      = NEW.starting_fen,
             description       = NEW.description,
             chapter_id        = NEW.chapter_id
       WHERE id = paired_id;

      -- Re-park the sibling at source.position + 1. We have to make room in
      -- the destination chapter and close the gap in the source chapter
      -- (if the move crossed chapters). Use a transient huge position to
      -- avoid colliding with the existing `position` of the sibling row.
      IF paired_old.chapter_id <> NEW.chapter_id
         OR paired_old.position <> NEW.position + 1 THEN
        UPDATE public.lessons
           SET position = position - 1
         WHERE chapter_id = paired_old.chapter_id
           AND position > paired_old.position;

        UPDATE public.lessons
           SET position = position + 1
         WHERE chapter_id = NEW.chapter_id
           AND position > NEW.position
           AND id <> paired_id;

        UPDATE public.lessons
           SET position = NEW.position + 1
         WHERE id = paired_id;
      END IF;
    END IF;
  ELSE
    -- Flag flipped off (or never on): drop the sibling if one exists.
    IF paired_id IS NOT NULL THEN
      DELETE FROM public.lessons WHERE id = paired_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- AFTER trigger so NEW.id is populated for INSERTs. `position` is in the
-- watch list so reordering the source within its chapter re-parks the
-- sibling; the pg_trigger_depth() > 1 guard inside the function prevents
-- the position-shift UPDATEs from infinitely re-firing the trigger.
DROP TRIGGER IF EXISTS sync_rewind_sibling_trg ON public.lessons;
CREATE TRIGGER sync_rewind_sibling_trg
AFTER INSERT OR UPDATE OF has_rewind_mode, pgn_data, board_perspective,
                          title, chapter_id, type, starting_fen, description,
                          position
ON public.lessons
FOR EACH ROW
EXECUTE FUNCTION public.sync_rewind_sibling();

-- ── Backfill ─────────────────────────────────────────────────────────────────
--
-- For every existing has_rewind_mode=true source that doesn't yet have a
-- sibling, create one. Position the sibling immediately after the source.

DO $$
DECLARE
  src public.lessons%ROWTYPE;
BEGIN
  FOR src IN
    SELECT * FROM public.lessons l
    WHERE l.has_rewind_mode = true
      AND l.rewind_source_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.lessons sib WHERE sib.rewind_source_id = l.id
      )
    ORDER BY l.chapter_id, l.position
  LOOP
    -- Shift subsequent lessons in the chapter
    UPDATE public.lessons
       SET position = position + 1
     WHERE chapter_id = src.chapter_id
       AND position > src.position;

    INSERT INTO public.lessons (
      chapter_id, title, type, position,
      free_preview, pgn_data, board_perspective,
      starting_fen, description, has_rewind_mode,
      rewind_source_id
    ) VALUES (
      src.chapter_id, src.title || ' (Rewind)', src.type, src.position + 1,
      false, src.pgn_data, src.board_perspective,
      src.starting_fen, src.description, false,
      src.id
    );
  END LOOP;
END $$;
