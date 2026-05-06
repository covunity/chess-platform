-- Order status enum
create type public.order_status as enum ('pending', 'active', 'cancelled');

-- Orders table
create table public.orders (
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

-- Enrollments table
create table public.enrollments (
  id          uuid        primary key default gen_random_uuid(),
  course_id   uuid        not null references public.courses(id) on delete cascade,
  user_id     uuid        not null references public.users(id) on delete cascade,
  order_id    uuid        not null references public.orders(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  unique(course_id, user_id)
);

-- Lesson progress table (tracks last-viewed lesson per course per user)
create table public.lesson_progress (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references public.users(id) on delete cascade,
  course_id  uuid        not null references public.courses(id) on delete cascade,
  lesson_id  uuid        not null references public.lessons(id) on delete cascade,
  completed  boolean     not null default false,
  viewed_at  timestamptz not null default now(),
  unique(user_id, lesson_id)
);

-- ── RLS ────────────────────────────────────────────────────────────────────

alter table public.orders      enable row level security;
alter table public.enrollments enable row level security;
alter table public.lesson_progress enable row level security;

-- Orders: users can read their own orders; admins can read all
create policy "Users can view own orders"
  on public.orders for select
  using (user_id = auth.uid());

create policy "Admins can view all orders"
  on public.orders for select
  using (exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

create policy "System can insert orders"
  on public.orders for insert
  with check (user_id = auth.uid());

create policy "Admins can update orders"
  on public.orders for update
  using (exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

-- Enrollments: users can read their own enrollments
create policy "Users can view own enrollments"
  on public.enrollments for select
  using (user_id = auth.uid());

create policy "Admins can view all enrollments"
  on public.enrollments for select
  using (exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

create policy "System can insert enrollments"
  on public.enrollments for insert
  with check (user_id = auth.uid());

-- Lesson progress: users manage their own progress
create policy "Users can manage own lesson progress"
  on public.lesson_progress for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Published courses: anyone can see enrollments count
create policy "Anyone can view published course enrollments count"
  on public.enrollments for select
  using (
    exists (
      select 1 from public.courses
      where id = course_id and status = 'published'
    )
  );

-- Auto-update updated_at on orders
create trigger orders_updated_at
  before update on public.orders
  for each row execute procedure public.set_updated_at();
