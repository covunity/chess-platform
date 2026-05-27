-- Course price limits: admin-configurable min/max price per course level.
CREATE TABLE public.course_price_limits (
  level      text    PRIMARY KEY,
  min_price  integer NOT NULL CHECK (min_price >= 0),
  max_price  integer NOT NULL CHECK (max_price > min_price),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Seed defaults (VND). Free courses (price = 0) are always allowed regardless of these limits.
INSERT INTO public.course_price_limits (level, min_price, max_price) VALUES
  ('beginner',      100000,   300000),
  ('intermediate',  300000,   600000),
  ('advanced',      600000,   900000),
  ('professional', 1000000, 5000000);

-- RLS: public SELECT (marketing info visible before sign-up), no direct writes.
ALTER TABLE public.course_price_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "course_price_limits_public_select"
  ON public.course_price_limits FOR SELECT USING (true);

-- Public RPC to read limits (anon + authenticated).
CREATE OR REPLACE FUNCTION public.get_course_price_limits()
RETURNS TABLE (level text, min_price integer, max_price integer)
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT level, min_price, max_price
  FROM   public.course_price_limits
  ORDER  BY CASE level
              WHEN 'beginner'     THEN 1
              WHEN 'intermediate' THEN 2
              WHEN 'advanced'     THEN 3
              WHEN 'professional' THEN 4
              ELSE 5
            END;
$$;

-- Admin-only RPC to update a limit row.
CREATE OR REPLACE FUNCTION public.admin_update_course_price_limit(
  p_level     text,
  p_min_price integer,
  p_max_price integer
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role FROM public.users WHERE id = auth.uid();
  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'permission_denied';
  END IF;

  IF p_min_price < 0 THEN
    RAISE EXCEPTION 'invalid_min_price';
  END IF;

  IF p_max_price <= p_min_price THEN
    RAISE EXCEPTION 'invalid_max_price';
  END IF;

  UPDATE public.course_price_limits
  SET    min_price = p_min_price,
         max_price = p_max_price,
         updated_at = now()
  WHERE  level = p_level;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'level_not_found';
  END IF;
END;
$$;

-- Trigger: validate course price against the configured range on INSERT / UPDATE.
-- Price = 0 (free) is always allowed. If no limit row exists for a level, it is also allowed.
CREATE OR REPLACE FUNCTION public.validate_course_price_against_limits()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_min integer;
  v_max integer;
BEGIN
  IF NEW.price = 0 THEN
    RETURN NEW;
  END IF;

  SELECT min_price, max_price INTO v_min, v_max
  FROM   public.course_price_limits
  WHERE  level = NEW.level::text;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF NEW.price < v_min OR NEW.price > v_max THEN
    RAISE EXCEPTION 'price_out_of_range'
      USING DETAIL = format(
        'Giá phải trong khoảng %s – %s cho cấp độ %s',
        v_min, v_max, NEW.level
      );
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER validate_course_price_limits_trigger
  BEFORE INSERT OR UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION public.validate_course_price_against_limits();
