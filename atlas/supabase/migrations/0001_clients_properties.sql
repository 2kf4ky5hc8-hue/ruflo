-- =============================================================================
-- Atlas Core — Migration 0001: clients & properties
-- Adds the Client -> Property -> Job hierarchy.
--
-- SAFETY:
--   * Apply on STAGING first, then (after a backup + approval) on production.
--   * Additive only — does NOT alter existing jobs policies or data.
--   * jobs.client_id / jobs.property_id are NULLABLE, so existing jobs keep working.
--   * Archive-only (no hard deletes from the app).
--   * Idempotent — safe to re-run.
--
-- Rollback (manual, if ever needed):
--   drop table if exists properties cascade;
--   drop table if exists clients cascade;
--   alter table jobs drop column if exists client_id;
--   alter table jobs drop column if exists property_id;
--   drop function if exists can_see_client(uuid);
--   drop function if exists can_see_property(uuid);
-- =============================================================================

-- ----------------------------------------------------------------------------
-- clients
-- ----------------------------------------------------------------------------
create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text,
  phone       text,
  notes       text,
  archived    boolean not null default false,
  archived_at timestamptz,
  archived_by uuid references profiles(id) on delete set null,
  created_by  uuid references profiles(id) on delete set null default auth.uid(),
  updated_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists clients_archived_idx   on clients (archived);
create index if not exists clients_created_by_idx  on clients (created_by);

-- ----------------------------------------------------------------------------
-- properties (belong to a client)
-- ----------------------------------------------------------------------------
create table if not exists properties (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references clients(id) on delete restrict,
  label         text,          -- e.g. "Elgin Avenue flat"
  address_line1 text,
  address_line2 text,
  town          text,
  postcode      text,
  notes         text,
  archived      boolean not null default false,
  archived_at   timestamptz,
  archived_by   uuid references profiles(id) on delete set null,
  created_by    uuid references profiles(id) on delete set null default auth.uid(),
  updated_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists properties_client_idx   on properties (client_id);
create index if not exists properties_archived_idx  on properties (archived);

-- ----------------------------------------------------------------------------
-- jobs: nullable links to client + property (existing jobs unaffected)
-- ----------------------------------------------------------------------------
alter table jobs add column if not exists client_id   uuid references clients(id) on delete set null;
alter table jobs add column if not exists property_id uuid references properties(id) on delete set null;
create index if not exists jobs_client_idx   on jobs (client_id);
create index if not exists jobs_property_idx on jobs (property_id);

-- ----------------------------------------------------------------------------
-- Visibility helpers (SECURITY DEFINER — bypass RLS, no recursion).
-- Strict: a client/property is visible to staff/viewers only when they created
-- it OR can see a job linked to it. No accidental exposure of unrelated records.
-- ----------------------------------------------------------------------------
create or replace function can_see_client(c uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select
    is_manager_or_admin()
    or exists (select 1 from clients x where x.id = c and x.created_by = auth.uid())
    or exists (select 1 from jobs j where j.client_id = c and can_see_job(j.id));
$$;

create or replace function can_see_property(p uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select
    is_manager_or_admin()
    or exists (select 1 from properties x where x.id = p and x.created_by = auth.uid())
    or exists (select 1 from jobs j where j.property_id = p and can_see_job(j.id));
$$;

-- ----------------------------------------------------------------------------
-- Audit + archive-metadata trigger (shared by clients & properties)
-- ----------------------------------------------------------------------------
create or replace function set_audit_archive()
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

drop trigger if exists clients_before_update on clients;
create trigger clients_before_update
  before update on clients
  for each row execute function set_audit_archive();

drop trigger if exists properties_before_update on properties;
create trigger properties_before_update
  before update on properties
  for each row execute function set_audit_archive();

-- ----------------------------------------------------------------------------
-- Row Level Security
--   admins/managers: see + manage everything
--   staff: create (own), see/edit only what they created or are linked to via jobs
--   viewers: read-only on what they're permitted to see
-- ----------------------------------------------------------------------------
alter table clients    enable row level security;
alter table properties enable row level security;

drop policy if exists clients_select on clients;
drop policy if exists clients_insert on clients;
drop policy if exists clients_update on clients;
drop policy if exists clients_delete on clients;

create policy clients_select on clients
  for select to authenticated using (can_see_client(id));
create policy clients_insert on clients
  for insert to authenticated
  with check (can_create_jobs() and created_by = auth.uid());
create policy clients_update on clients
  for update to authenticated
  using (is_manager_or_admin() or (auth_role() = 'staff' and can_see_client(id)))
  with check (is_manager_or_admin() or (auth_role() = 'staff' and can_see_client(id)));
create policy clients_delete on clients
  for delete to authenticated using (is_admin());

drop policy if exists properties_select on properties;
drop policy if exists properties_insert on properties;
drop policy if exists properties_update on properties;
drop policy if exists properties_delete on properties;

create policy properties_select on properties
  for select to authenticated using (can_see_property(id));
create policy properties_insert on properties
  for insert to authenticated
  with check (can_create_jobs() and created_by = auth.uid() and can_see_client(client_id));
create policy properties_update on properties
  for update to authenticated
  using (is_manager_or_admin() or (auth_role() = 'staff' and can_see_property(id)))
  with check (is_manager_or_admin() or (auth_role() = 'staff' and can_see_property(id)));
create policy properties_delete on properties
  for delete to authenticated using (is_admin());

-- ----------------------------------------------------------------------------
-- Grants (RLS still governs rows). New objects need explicit grants.
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on clients, properties to authenticated;
grant execute on function can_see_client(uuid)   to anon, authenticated;
grant execute on function can_see_property(uuid) to anon, authenticated;
grant execute on function set_audit_archive()    to anon, authenticated;
