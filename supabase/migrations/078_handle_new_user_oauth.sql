-- Extend handle_new_user to support OAuth providers (Google, Facebook).
-- Supabase normalizes provider metadata so `raw_user_meta_data` carries
-- `name` / `full_name` and `avatar_url` for OAuth signups. Email/password
-- signups continue to send `name` via the JS client `options.data`.
--
-- When Supabase "Allow linking the same email across providers" is enabled,
-- linking an OAuth identity to an existing email account does NOT fire
-- `on_auth_user_created` (same auth.users row). The ON CONFLICT clause is a
-- belt-and-suspenders guard for any future flow that re-inserts the same id.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_name text;
  v_avatar text;
begin
  v_name := nullif(meta ->> 'name', '');
  if v_name is null then
    v_name := nullif(meta ->> 'full_name', '');
  end if;
  if v_name is null and new.email is not null then
    v_name := split_part(new.email, '@', 1);
  end if;

  v_avatar := nullif(meta ->> 'avatar_url', '');
  if v_avatar is null then
    v_avatar := nullif(meta ->> 'picture', '');
  end if;

  insert into public.users (id, email, name, avatar_url)
  values (new.id, new.email, v_name, v_avatar)
  on conflict (id) do nothing;

  return new;
end;
$$;
