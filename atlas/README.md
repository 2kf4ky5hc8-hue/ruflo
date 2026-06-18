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

## Data safety & operations

Atlas holds live business data. The guiding rule: **nothing important disappears —
it gets archived or logged.** These rules are not optional.

### 1. Archive-only principle
- Business records must **never be hard-deleted through Atlas**.
- Jobs, clients, properties, contributions, files and variations are **archived**
  (an `archived` flag), not deleted. Archiving hides a record; it stays in the database.
- **Activity logs are permanent** — they are append-only history and are never deleted.

### 2. SQL Editor rule
- The Supabase **SQL Editor is for schema setup, migrations, and emergency admin only.**
- **Nobody uses the SQL Editor to delete business data.**
- Row Level Security (RLS) protects the app and normal signed-in users, but the
  **SQL Editor (runs as superuser) and the `service_role` key bypass RLS entirely.**
  The deny-delete policies cannot stop a human running destructive SQL by hand —
  the discipline above plus backups/PITR are the real safeguard.

### 3. Staging-first rule
- New features and migrations go to **staging before production**.
- Staging uses a **separate Supabase project** and a **separate Cloudflare Pages
  deployment** from production.
- **Staging must never point at production data.** (Staging builds with
  `npm run build:staging` / `.env.staging`; production builds with `npm run build`
  / `.env.production`.)

### 4. Migration discipline
- Every schema change is committed as a **numbered migration file** in
  `atlas/supabase/migrations/` (e.g. `0001_…`, `0002_…`).
- **Run migrations on staging first.**
- Only run the **same committed migration** on production after staging has passed
  testing. Do not hand-edit production schema ad hoc.

### 5. Backup before production
- Before any production migration, **take or confirm a Supabase backup / PITR
  position** (Database → Backups).
- **Storage files need their own backup process** once added — Supabase database
  backups do **not** cover Storage objects.

### 6. Promotion runbook (staging → production)
1. Test the change thoroughly on **staging**.
2. **Back up** the production Supabase (snapshot + confirm PITR).
3. Run the **committed migration file(s)** on production, in order.
4. Merge the approved code to **`main`** (production auto-deploys).
5. **Confirm production works** (board, clients/properties, an RLS spot-check).
6. **If anything breaks:** roll back the Cloudflare deployment to the last good
   build (or the `atlas-core-v1-stable` release), and restore the database from
   the backup / PITR.

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
