-- Create users table mirroring Supabase Auth users
create table public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  name        text,
  avatar_url  text,
  role        text not null default 'learner' check (role in ('learner', 'coach', 'admin')),
  created_at  timestamptz not null default now()
);

-- Enable Row Level Security
alter table public.users enable row level security;

-- Users can read their own row
create policy "Users can view own profile"
  on public.users
  for select
  using (auth.uid() = id);

-- Users can update their own row
create policy "Users can update own profile"
  on public.users
  for update
  using (auth.uid() = id);

-- Admins can read all rows
create policy "Admins can view all profiles"
  on public.users
  for select
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- Trigger: auto-insert a users row when a new auth user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Seed one admin user (replace with real email before running in production)
-- This inserts directly and requires manual auth.users entry first.
-- Usage: run this after creating the admin account via Auth UI or API.
-- insert into public.users (id, email, name, role)
-- values ('<admin-uuid>', 'admin@gambitly.com', 'Admin', 'admin')
-- on conflict (id) do update set role = 'admin';
