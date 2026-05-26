-- Migration 080: Hero section config — admin-editable landing page content.
-- Adds an anon-readable RLS policy for hero_* keys, seeds empty rows (empty
-- string = use i18n default), and provides an admin-only RPC to update them.

-- ── 1. Anon read policy for hero config ────────────────────────────────────
-- The landing page is public; hero content must load without auth.
-- The existing "Authenticated can read config" policy covers logged-in users.
DROP POLICY IF EXISTS "Anon can read hero config" ON public.config;
CREATE POLICY "Anon can read hero config"
  ON public.config
  FOR SELECT
  USING (key LIKE 'hero_%');

-- ── 2. Seed hero config keys (empty = use i18n default) ───────────────────
INSERT INTO public.config (key, value, description) VALUES
  ('hero_eyebrow',           '', 'Hero eyebrow text (empty = use i18n default)'),
  ('hero_headline1',         '', 'Hero headline line 1'),
  ('hero_headline2',         '', 'Hero headline line 2 (italic accent)'),
  ('hero_subparagraph',      '', 'Hero subparagraph description'),
  ('hero_cta1',              '', 'Hero CTA button text'),
  ('hero_trust',             '', 'Hero trust text below CTA'),
  ('hero_annotation_author', '', 'Floating annotation card author name'),
  ('hero_annotation',        '', 'Floating annotation card text'),
  ('hero_bookmark',          '', 'Floating bookmark card text'),
  ('hero_image_url',         '', 'Right-side image URL (empty = show default chess board)')
ON CONFLICT (key) DO NOTHING;

-- ── 3. RPC: update_hero_config ─────────────────────────────────────────────
-- Admin-only. Empty string is a valid value meaning "use i18n default".
CREATE OR REPLACE FUNCTION public.update_hero_config(
  p_eyebrow           text,
  p_headline1         text,
  p_headline2         text,
  p_subparagraph      text,
  p_cta1              text,
  p_trust             text,
  p_annotation_author text,
  p_annotation        text,
  p_bookmark          text,
  p_image_url         text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = caller AND role = 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING errcode = '42501';
  END IF;

  INSERT INTO public.config (key, value) VALUES
    ('hero_eyebrow',           COALESCE(p_eyebrow, '')),
    ('hero_headline1',         COALESCE(p_headline1, '')),
    ('hero_headline2',         COALESCE(p_headline2, '')),
    ('hero_subparagraph',      COALESCE(p_subparagraph, '')),
    ('hero_cta1',              COALESCE(p_cta1, '')),
    ('hero_trust',             COALESCE(p_trust, '')),
    ('hero_annotation_author', COALESCE(p_annotation_author, '')),
    ('hero_annotation',        COALESCE(p_annotation, '')),
    ('hero_bookmark',          COALESCE(p_bookmark, '')),
    ('hero_image_url',         COALESCE(p_image_url, ''))
  ON CONFLICT (key) DO UPDATE SET
    value      = EXCLUDED.value,
    updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_hero_config(text, text, text, text, text, text, text, text, text, text) TO authenticated;
