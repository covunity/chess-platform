-- Migration 048: user bio (max 60 chars).
--
-- A short freeform self-description shown in the comment / review name card
-- popup. Length-capped at 60 chars at the DB level so the popup layout stays
-- predictable; the editor (`ProfilePage`) enforces the same cap client-side
-- with a live char counter for UX.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS bio text
    CONSTRAINT users_bio_length CHECK (bio IS NULL OR char_length(bio) <= 60);

COMMENT ON COLUMN public.users.bio IS
  'Short user bio (≤ 60 chars). NULL = not set. Surfaced on the comment + review name-card popup.';
