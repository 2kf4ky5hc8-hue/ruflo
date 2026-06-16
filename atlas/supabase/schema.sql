-- =============================================================================
-- Atlas Core v1 — Cubitt Wren
-- Supabase / Postgres schema: profiles, jobs, assignments, contributions, activity
-- Permissions are enforced in the database via Row Level Security (RLS).
--
-- How to apply: paste this whole file into the Supabase SQL Editor and run it.
-- It is idempotent — safe to run again after edits.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "pgcrypto";  -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('admin','manager','staff','viewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type job_stage as enum
    ('lead','quoted','accepted','live','snagging','awaiting_payment','complete');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_status as enum
    ('none','deposit_due','deposit_paid','part_paid','paid','overdue');
exception when duplicate_object then null; end $$;

do $$ begin
  create type assignment_role as enum ('manager','team_member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type contribution_type as enum (
    'lead_in','phone_call','survey_quote','follow_up',
    'project_management','variations','payment_collection','aftercare_snags','other'
  );
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- profiles  (one row per user, mirrors auth.users)
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  role        user_role not null default 'staff',
  active      boolean   not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Auto-create a profile whenever a new auth user is created.
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public, auth
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ----------------------------------------------------------------------------
-- Permission helpers (SECURITY DEFINER so they bypass RLS and never recurse)
-- ----------------------------------------------------------------------------
create or replace function auth_role()
returns user_role language sql stable security definer set search_path = public
as $$ select role from public.profiles where id = auth.uid(); $$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false); $$;

create or replace function is_manager_or_admin()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select role in ('admin','manager') from public.profiles where id = auth.uid()), false); $$;

create or replace function can_create_jobs()
returns boolean language sql stable security definer set search_path = public
as $$ select coalesce((select role in ('admin','manager','staff') from public.profiles where id = auth.uid()), false); $$;

-- ----------------------------------------------------------------------------
-- jobs  (the cards)
-- ----------------------------------------------------------------------------
create table if not exists jobs (
  id                 uuid primary key default gen_random_uuid(),
  job_name           text not null,
  client_name        text,
  site_address       text,
  stage              job_stage not null default 'lead',
  assigned_manager   uuid references profiles(id) on delete set null,
  lead_source        text,
  estimated_value    numeric(12,2),
  amount_outstanding numeric(12,2),
  payment_status     payment_status not null default 'none',
  next_action        text,
  next_action_due    date,
  notes              text,
  -- Xero placeholders (no integration in v1, just reference fields)
  xero_contact_ref   text,
  xero_invoice_ref   text,
  -- Archive (we never hard-delete jobs)
  archived           boolean not null default false,
  archived_at        timestamptz,
  archived_by        uuid references profiles(id) on delete set null,
  -- Ordering within a column (reserved for future fine-grained ordering)
  position           double precision not null default 0,
  -- Audit
  created_by         uuid references profiles(id) on delete set null default auth.uid(),
  updated_by         uuid references profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists jobs_stage_idx            on jobs (stage) where archived = false;
create index if not exists jobs_assigned_manager_idx on jobs (assigned_manager);
create index if not exists jobs_archived_idx          on jobs (archived);
create index if not exists jobs_created_by_idx        on jobs (created_by);

-- ----------------------------------------------------------------------------
-- job_assignments  (team members on a job, many-to-many)
-- ----------------------------------------------------------------------------
create table if not exists job_assignments (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references jobs(id) on delete cascade,
  user_id     uuid not null references profiles(id) on delete cascade,
  role        assignment_role not null default 'team_member',
  assigned_by uuid references profiles(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (job_id, user_id)
);

create index if not exists job_assignments_job_idx  on job_assignments (job_id);
create index if not exists job_assignments_user_idx on job_assignments (user_id);

-- ----------------------------------------------------------------------------
-- job_contributions  (the commission / contribution ledger)
-- ----------------------------------------------------------------------------
create table if not exists job_contributions (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null references jobs(id) on delete cascade,
  user_id           uuid not null references profiles(id) on delete restrict,
  contribution_type contribution_type not null,
  description       text,
  weight            numeric(6,2),  -- optional commission weight / points / %
  occurred_at       timestamptz not null default now(),
  added_by          uuid references profiles(id) on delete set null default auth.uid(),
  created_at        timestamptz not null default now()
);

create index if not exists job_contributions_job_idx  on job_contributions (job_id);
create index if not exists job_contributions_user_idx on job_contributions (user_id);

-- ----------------------------------------------------------------------------
-- job_activity  (append-only audit log, written by triggers)
-- ----------------------------------------------------------------------------
create table if not exists job_activity (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references jobs(id) on delete cascade,
  actor      uuid references profiles(id) on delete set null default auth.uid(),
  action     text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);

create index if not exists job_activity_job_idx on job_activity (job_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Visibility helper: who can see a given job?
-- (defined after the tables it references)
-- ----------------------------------------------------------------------------
create or replace function can_see_job(j uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select
    is_manager_or_admin()
    or exists (
      select 1 from jobs x
      where x.id = j and (x.assigned_manager = auth.uid() or x.created_by = auth.uid())
    )
    or exists (select 1 from job_assignments a where a.job_id = j and a.user_id = auth.uid())
    or exists (select 1 from job_contributions c where c.job_id = j and c.user_id = auth.uid());
$$;

-- ----------------------------------------------------------------------------
-- Triggers: audit fields + archive metadata + activity log + role guard
-- ----------------------------------------------------------------------------

-- jobs: keep updated_at/updated_by + archive metadata correct on every update.
create or replace function jobs_set_updated()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if new.archived = true and (old.archived is distinct from true) then
    new.archived_at := now();
    new.archived_by := auth.uid();
  elsif new.archived = false then
    new.archived_at := null;
    new.archived_by := null;
  end if;
  return new;
end; $$;

drop trigger if exists jobs_before_update on jobs;
create trigger jobs_before_update
  before update on jobs
  for each row execute function jobs_set_updated();

-- jobs: log create / stage change / archive into job_activity.
create or replace function jobs_log_activity()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    insert into job_activity (job_id, actor, action, detail)
    values (new.id, auth.uid(), 'created', jsonb_build_object('stage', new.stage));
    return new;
  elsif (tg_op = 'UPDATE') then
    if new.stage is distinct from old.stage then
      insert into job_activity (job_id, actor, action, detail)
      values (new.id, auth.uid(), 'stage_changed',
              jsonb_build_object('from', old.stage, 'to', new.stage));
    end if;
    if new.archived is distinct from old.archived then
      insert into job_activity (job_id, actor, action, detail)
      values (new.id, auth.uid(),
              case when new.archived then 'archived' else 'unarchived' end, '{}'::jsonb);
    end if;
    return new;
  end if;
  return null;
end; $$;

drop trigger if exists jobs_activity_insert on jobs;
create trigger jobs_activity_insert
  after insert on jobs
  for each row execute function jobs_log_activity();

drop trigger if exists jobs_activity_update on jobs;
create trigger jobs_activity_update
  after update on jobs
  for each row execute function jobs_log_activity();

-- profiles: only admins may change role or active status.
-- The guard applies to changes made *through the app* (a logged-in user).
-- Direct SQL (SQL Editor / service role) has no auth.uid() and is trusted,
-- so it is allowed — this is how the first admin is bootstrapped.
create or replace function profiles_guard_role()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null and not is_admin() then
    if new.role is distinct from old.role then
      raise exception 'Only admins can change user roles';
    end if;
    if new.active is distinct from old.active then
      raise exception 'Only admins can change active status';
    end if;
  end if;
  return new;
end; $$;

drop trigger if exists profiles_before_update on profiles;
create trigger profiles_before_update
  before update on profiles
  for each row execute function profiles_guard_role();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table profiles          enable row level security;
alter table jobs              enable row level security;
alter table job_assignments   enable row level security;
alter table job_contributions enable row level security;
alter table job_activity      enable row level security;

-- profiles: everyone signed in can read the team directory (needed for names
-- and assignment pickers). Users may edit their own row; admins edit anyone.
drop policy if exists profiles_select       on profiles;
drop policy if exists profiles_update_self  on profiles;
drop policy if exists profiles_admin_insert on profiles;
drop policy if exists profiles_admin_delete on profiles;

create policy profiles_select on profiles
  for select to authenticated using (true);
create policy profiles_update_self on profiles
  for update to authenticated
  using (id = auth.uid() or is_admin())
  with check (id = auth.uid() or is_admin());
create policy profiles_admin_insert on profiles
  for insert to authenticated with check (is_admin());
create policy profiles_admin_delete on profiles
  for delete to authenticated using (is_admin());

-- jobs: managers/admins see everything; staff/viewers see only their own work.
drop policy if exists jobs_select on jobs;
drop policy if exists jobs_insert on jobs;
drop policy if exists jobs_update on jobs;
drop policy if exists jobs_delete on jobs;

create policy jobs_select on jobs
  for select to authenticated using (can_see_job(id));
create policy jobs_insert on jobs
  for insert to authenticated
  with check (can_create_jobs() and created_by = auth.uid());
create policy jobs_update on jobs
  for update to authenticated
  using (is_manager_or_admin() or (auth_role() = 'staff' and can_see_job(id)))
  with check (is_manager_or_admin() or (auth_role() = 'staff' and can_see_job(id)));
-- No app-level deletes — jobs are archived. Admins may delete for cleanup only.
create policy jobs_delete on jobs
  for delete to authenticated using (is_admin());

-- job_assignments: visible with the job; only managers/admins manage them.
drop policy if exists job_assignments_select on job_assignments;
drop policy if exists job_assignments_insert on job_assignments;
drop policy if exists job_assignments_update on job_assignments;
drop policy if exists job_assignments_delete on job_assignments;

create policy job_assignments_select on job_assignments
  for select to authenticated using (can_see_job(job_id));
create policy job_assignments_insert on job_assignments
  for insert to authenticated with check (is_manager_or_admin());
create policy job_assignments_update on job_assignments
  for update to authenticated using (is_manager_or_admin()) with check (is_manager_or_admin());
create policy job_assignments_delete on job_assignments
  for delete to authenticated using (is_manager_or_admin());

-- job_contributions: visible with the job; non-viewers who can see a job may
-- add entries; you may edit/remove your own, managers/admins any.
drop policy if exists job_contributions_select on job_contributions;
drop policy if exists job_contributions_insert on job_contributions;
drop policy if exists job_contributions_update on job_contributions;
drop policy if exists job_contributions_delete on job_contributions;

create policy job_contributions_select on job_contributions
  for select to authenticated using (can_see_job(job_id));
create policy job_contributions_insert on job_contributions
  for insert to authenticated
  with check (can_see_job(job_id) and auth_role() <> 'viewer' and added_by = auth.uid());
create policy job_contributions_update on job_contributions
  for update to authenticated
  using (is_manager_or_admin() or added_by = auth.uid())
  with check (is_manager_or_admin() or added_by = auth.uid());
create policy job_contributions_delete on job_contributions
  for delete to authenticated using (is_manager_or_admin() or added_by = auth.uid());

-- job_activity: read-only for clients (written only by triggers).
drop policy if exists job_activity_select on job_activity;
create policy job_activity_select on job_activity
  for select to authenticated using (can_see_job(job_id));

-- ----------------------------------------------------------------------------
-- Realtime: broadcast changes so the board updates live for all users.
-- ----------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table jobs;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table job_assignments;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table job_contributions;
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- Grants (RLS still governs which rows each user can touch)
-- ----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to anon, authenticated;
