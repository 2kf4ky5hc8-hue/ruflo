# Supabase workflow (migrations, no Studio clicking)

Schema changes are **migration files**, applied to **staging first**, then to
production only via the promotion runbook. The Supabase Studio SQL Editor is a
fallback for emergencies — **not** the normal deployment method (it stalls/renders
blank often and isn't repeatable).

## Migrations are the source of truth
All schema lives in version-controlled files:

```
atlas/supabase/schema.sql                      # full schema for a fresh project
atlas/supabase/migrations/0001_clients_properties.sql
atlas/supabase/migrations/0002_archive_only_hardening.sql
atlas/supabase/migrations/0003_drop_contribution_points.sql
```

Apply migrations **in numeric order**. Each is idempotent (safe to re-run).

## Reliable method: psql from the terminal (no Studio)
1. In Supabase → **Project Settings → Database → Connection string → URI**, copy
   the **staging** connection string (it contains the DB password).
2. Export it as an env var (never commit it):
   ```bash
   export STAGING_DB_URL='postgresql://postgres:[PASSWORD]@db.tffpiulparxnxgicdhbr.supabase.co:5432/postgres'
   ```
3. Sanity-check you're on staging (the ref **tffpiulparxnxgicdhbr** must be in the URL,
   and the production ref **svllpyrcxvxtwsqaippg** must NOT be):
   ```bash
   case "$STAGING_DB_URL" in
     *svllpyrcxvxtwsqaippg*) echo "❌ THIS IS PRODUCTION — STOP"; ;;
     *tffpiulparxnxgicdhbr*) echo "✅ staging";;
     *) echo "❓ unknown ref — stop and check";;
   esac
   ```
4. Apply the migrations in order:
   ```bash
   psql "$STAGING_DB_URL" -f atlas/supabase/migrations/0001_clients_properties.sql
   psql "$STAGING_DB_URL" -f atlas/supabase/migrations/0002_archive_only_hardening.sql
   psql "$STAGING_DB_URL" -f atlas/supabase/migrations/0003_drop_contribution_points.sql
   ```

## Alternative: Supabase CLI
```bash
# one-time
supabase login                       # uses a personal access token
cd atlas && supabase init            # generates supabase/config.toml if missing
supabase link --project-ref tffpiulparxnxgicdhbr   # STAGING ref

# apply
supabase db push
```
Note: for `supabase db push` the CLI expects migration filenames to start with a
version number (our `0001_`, `0002_`, `0003_` work as versions 1–3). If you adopt
the CLI long-term, consider renaming future migrations with timestamp prefixes
(`YYYYMMDDHHMMSS_name.sql`) as the CLI generates them.

## Environment variables (staging only)
| Var | Purpose | Notes |
|-----|---------|-------|
| `STAGING_DB_URL` | psql connection string for the **staging** DB | contains the DB password — **never commit**, never use the prod string here |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI auth (if using the CLI) | personal token; keep out of the repo |

The frontend only ever uses the **publishable/anon** key (in `.env.staging` /
`.env.production`). **The `service_role` key and the DB password must never appear
in frontend code or in any committed file.**

## Production
Never apply a migration to production except by following the promotion runbook in
`atlas/README.md` (back up / confirm PITR → run the committed migrations in order →
merge to `main` → confirm). The production DB ref is `svllpyrcxvxtwsqaippg`; treat
its connection string as off-limits for routine work.
