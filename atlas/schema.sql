-- Atlas Board v1 schema
-- Run this once in the Supabase SQL Editor for a fresh project.

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text default '',
  assigned_to text default '',
  stage text not null default 'Lead',
  next_action text default '',
  amount_outstanding numeric default 0,
  payment_status text default 'Not invoiced',
  invoice_ref text default '',
  notes text default '',
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text default ''
);

-- Safe to re-run: adds the money-snapshot columns to an existing table.
alter table jobs add column if not exists payment_status text default 'Not invoiced';
alter table jobs add column if not exists invoice_ref text default '';

alter table jobs enable row level security;

drop policy if exists "team access" on jobs;
create policy "team access" on jobs
  for all to authenticated
  using (true) with check (true);

alter publication supabase_realtime add table jobs;
