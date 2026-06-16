# Atlas Core v1 — Cubitt Wren

A simple, shared, multi-user operations command board. It replaces the makeshift
Trello workflow: track jobs from **Lead → Complete**, assign people, record next
actions, track outstanding money simply, and keep a contribution ledger so
commission can be worked out fairly later.

Built to be **small and reliable**, not clever. Supabase is the backend; the
frontend is a plain React single-page app.

## Stack

- **Frontend:** Vite + React + TypeScript (no SSR, no server to run)
- **Backend:** Supabase — Postgres, Auth, Realtime
- **Permissions:** Postgres Row Level Security (RLS) — enforced in the database
- **Hosting:** Cloudflare Pages (frontend) + Supabase (backend)

## Roles

| Role | Can see | Can do |
|------|---------|--------|
| **admin** | everything | everything + manage users/roles |
| **manager** | everything | create/edit/archive all jobs, manage assignments |
| **staff** | only jobs they created / are assigned to / contributed to | create + edit their own jobs, add contributions |
| **viewer** | only permitted jobs | read-only |

Permissions are real: they are enforced by RLS in Postgres, not just hidden in
the UI.

## Stages

Lead · Quoted · Accepted / Deposit Due · Live · Snagging · Awaiting Payment · Complete

Archiving is separate from stage — any job can be **archived** (hidden from the
board) without losing its stage. Jobs are never hard-deleted from the app.

---

## Setup

### 1. Create the Supabase project
1. Create a project at https://supabase.com.
2. Open **SQL Editor** and run `supabase/schema.sql` (paste the whole file).
3. In **Authentication > Providers**, ensure **Email** is enabled.
   Turn **off** "Allow new users to sign up" — this is an invite-only internal app.

### 2. Add users (invite-only)
For v1, the admin creates users in the Supabase dashboard:
**Authentication > Users > Add user** → set their email + a temporary password
and tick "Auto Confirm User". Share the temp password; they can change it via
**Forgot password** on the login screen.

Then run `supabase/seed.sql` (edit the emails first) to set roles, or change a
role any time in the SQL editor:
```sql
update profiles set role = 'manager' where email = 'name@cubittwren.co.uk';
```
> Note: a self-service "Team" admin screen inside Atlas is planned for v2. In v1,
> roles are managed here in SQL / the dashboard.

### 3. Configure the frontend
```bash
cd atlas
cp .env.example .env
# edit .env with your project's values from Supabase > Project Settings > API
npm install
npm run dev
```
`.env` needs only the **public** values:
```
VITE_SUPABASE_URL=https://YOUR-PROJECT-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```
Never put the `service_role` key or database password in the frontend.

---

## Deploy (Cloudflare Pages)

1. Connect this repo in the Cloudflare Pages dashboard.
2. Build settings:
   - **Root directory:** `atlas`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
3. Add environment variables `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Deploy. Add your custom domain when ready.

In Supabase **Authentication > URL Configuration**, set the **Site URL** to your
deployed URL so password-reset links return to the app.

---

## What's in v1 (and what's not)

**In:** login, shared board, add/edit jobs, move stages (dropdown + drag-and-drop),
assign manager + team, next actions, simple outstanding/payment fields,
contribution ledger, auto activity log, archive-not-delete, role-based visibility,
live updates, mobile + desktop.

**Deliberately excluded (parked for v2):** Trello sync, Xero sync / invoicing,
file/photo uploads, dashboards/reporting, AI, a commission *calculation* engine,
a payments table UI, email/push reminders, offline/local-first, in-app user admin.

The schema already includes Xero reference fields and is shaped so payments and
commission rules can be added later without a rewrite.
