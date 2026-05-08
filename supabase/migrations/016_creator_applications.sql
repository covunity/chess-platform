-- Creator applications: learners submit a request to become a creator;
-- admins review the queue, approve (auto-promotes the user role to 'creator')
-- or reject with a reason. Per CLAUDE.md §4 the creator role is admin-assigned —
-- this table just gives that flow a UI instead of bare SQL.

create table public.creator_applications (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  status            text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected')),
  motivation        text not null,
  experience        text not null,
  sample_url        text,
  rejection_reason  text,
  created_at        timestamptz not null default now(),
  reviewed_at       timestamptz,
  reviewed_by       uuid references public.users(id) on delete set null
);

-- Only one pending application per user at a time. A new application can be
-- submitted after a previous one is rejected (status != 'pending').
create unique index creator_applications_one_pending_per_user
  on public.creator_applications (user_id)
  where status = 'pending';

create index creator_applications_status_idx
  on public.creator_applications (status, created_at desc);

alter table public.creator_applications enable row level security;

-- Applicants can read their own applications.
create policy "Applicants read own applications"
  on public.creator_applications for select
  using (auth.uid() = user_id);

-- Admins can read all applications.
create policy "Admins read all applications"
  on public.creator_applications for select
  using (
    exists (
      select 1 from public.users
      where id = auth.uid() and role = 'admin'
    )
  );

-- Authenticated learners can submit their own application.
create policy "Users insert own application"
  on public.creator_applications for insert
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and reviewed_at is null
    and reviewed_by is null
  );

-- Admins approve / reject via the RPC below; no direct UPDATE policy is
-- granted to keep the audit trail consistent (status change implies user role
-- promotion or rejection_reason). The RPC is SECURITY DEFINER and bypasses RLS.

-- ── RPC: approve a pending application ─────────────────────────────────────
create or replace function public.approve_creator_application(application_id uuid)
returns public.creator_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  app    public.creator_applications;
  caller uuid := auth.uid();
begin
  if not exists (select 1 from public.users where id = caller and role = 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into app from public.creator_applications
   where id = application_id
   for update;

  if not found then
    raise exception 'application not found' using errcode = 'P0002';
  end if;

  if app.status <> 'pending' then
    raise exception 'application already reviewed' using errcode = '22023';
  end if;

  update public.users
     set role = 'creator'
   where id = app.user_id and role = 'learner';

  update public.creator_applications
     set status = 'approved',
         reviewed_at = now(),
         reviewed_by = caller,
         rejection_reason = null
   where id = application_id
   returning * into app;

  return app;
end;
$$;

revoke all on function public.approve_creator_application(uuid) from public;
grant execute on function public.approve_creator_application(uuid) to authenticated;

-- ── RPC: reject a pending application ──────────────────────────────────────
create or replace function public.reject_creator_application(
  application_id uuid,
  reason         text
)
returns public.creator_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  app    public.creator_applications;
  caller uuid := auth.uid();
begin
  if not exists (select 1 from public.users where id = caller and role = 'admin') then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if reason is null or length(btrim(reason)) = 0 then
    raise exception 'rejection reason required' using errcode = '22023';
  end if;

  select * into app from public.creator_applications
   where id = application_id
   for update;

  if not found then
    raise exception 'application not found' using errcode = 'P0002';
  end if;

  if app.status <> 'pending' then
    raise exception 'application already reviewed' using errcode = '22023';
  end if;

  update public.creator_applications
     set status = 'rejected',
         reviewed_at = now(),
         reviewed_by = caller,
         rejection_reason = reason
   where id = application_id
   returning * into app;

  return app;
end;
$$;

revoke all on function public.reject_creator_application(uuid, text) from public;
grant execute on function public.reject_creator_application(uuid, text) to authenticated;
