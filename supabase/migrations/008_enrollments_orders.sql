-- Slice 9: Orders, enrollments, lesson_progress
--
-- Migration 007 already creates a minimal `enrollments` table (without
-- order_id / enrolled_at). Make this migration idempotent so a fresh `db push`
-- (which applies 007 first) can still complete cleanly: tables use
-- IF NOT EXISTS, missing columns are added, and policies are dropped before
-- being recreated.

-- Order status enum
do $$ begin
  create type public.order_status as enum ('pending', 'active', 'cancelled');
exception when duplicate_object then null; end $$;

-- Orders table
create table if not exists public.orders (
  id          uuid        primary key default gen_random_uuid(),
  course_id   uuid        not null references public.courses(id) on delete cascade,
  user_id     uuid        not null references public.users(id) on delete cascade,
  status      public.order_status not null default 'pending',
  amount      integer     not null default 0 check (amount >= 0),
  code        text        not null unique,
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Enrollments table — may already exist from migration 007 (smaller schema).
-- Create if missing, then add columns 007 didn't include. order_id is left
-- nullable to keep this idempotent across both creation paths.
create table if not exists public.enrollments (
  id          uuid        primary key default gen_random_uuid(),
  course_id   uuid        not null references public.courses(id) on delete cascade,
  user_id     uuid        not null references public.users(id) on delete cascade,
  order_id    uuid        references public.orders(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  unique(course_id, user_id)
);

alter table public.enrollments
  add column if not exists order_id    uuid references public.orders(id) on delete cascade;

alter table public.enrollments
  add column if not exists enrolled_at timestamptz not null default now();

-- Lesson progress table (tracks last-viewed lesson per course per user)
create table if not exists public.lesson_progress (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.users(id) on delete cascade,
  course_id  uuid        not null references public.courses(id) on delete cascade,
  lesson_id  uuid        not null references public.lessons(id) on delete cascade,
  completed  boolean     not null default false,
  viewed_at  timestamptz not null default now(),
  unique(user_id, lesson_id)
);

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table public.orders          enable row level security;
alter table public.enrollments     enable row level security;
alter table public.lesson_progress enable row level security;

-- Orders: users can read their own orders; admins can read all
drop policy if exists "Users can view own orders" on public.orders;
create policy "Users can view own orders"
  on public.orders for select
  using (user_id = auth.uid());

drop policy if exists "Admins can view all orders" on public.orders;
create policy "Admins can view all orders"
  on public.orders for select
  using (exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

drop policy if exists "System can insert orders" on public.orders;
create policy "System can insert orders"
  on public.orders for insert
  with check (user_id = auth.uid());

drop policy if exists "Admins can update orders" on public.orders;
create policy "Admins can update orders"
  on public.orders for update
  using (exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

-- Enrollments
drop policy if exists "Users can view own enrollments" on public.enrollments;
create policy "Users can view own enrollments"
  on public.enrollments for select
  using (user_id = auth.uid());

drop policy if exists "Admins can view all enrollments" on public.enrollments;
create policy "Admins can view all enrollments"
  on public.enrollments for select
  using (exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

drop policy if exists "System can insert enrollments" on public.enrollments;
create policy "System can insert enrollments"
  on public.enrollments for insert
  with check (user_id = auth.uid());

drop policy if exists "Anyone can view published course enrollments count" on public.enrollments;
create policy "Anyone can view published course enrollments count"
  on public.enrollments for select
  using (
    exists (
      select 1 from public.courses
      where id = course_id and status = 'published'
    )
  );

-- Lesson progress: users manage their own progress
drop policy if exists "Users can manage own lesson progress" on public.lesson_progress;
create policy "Users can manage own lesson progress"
  on public.lesson_progress for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Auto-update updated_at on orders
drop trigger if exists orders_updated_at on public.orders;
create trigger orders_updated_at
  before update on public.orders
  for each row execute procedure public.set_updated_at();
