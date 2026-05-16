-- 0003_manual_entry.sql
-- Manual data entry support.
--
-- accounts: explicit current_balance + institution link + business flag + notes
-- holdings: denormalized fields so a holding can exist without an instruments row
-- transactions: direction + notes + recurring + optional holding link
-- isa_deposits: notes
--
-- After this migration loadSnapshot reads accounts.current_balance directly
-- rather than summing transactions. The migration backfills current_balance
-- from the sum of existing transactions so onboarding'd users see the same
-- numbers post-migration.

BEGIN;

-- ── accounts ──────────────────────────────────────────────────────────────
ALTER TABLE accounts
  ADD COLUMN current_balance numeric(20, 4) NOT NULL DEFAULT 0,
  ADD COLUMN institution_id  uuid REFERENCES institutions(id) ON DELETE SET NULL,
  ADD COLUMN is_business     boolean NOT NULL DEFAULT false,
  ADD COLUMN notes           text,
  ADD COLUMN source          varchar(40) NOT NULL DEFAULT 'manual';

-- Backfill current_balance from existing transaction sums so already-onboarded
-- users see the same numbers post-migration.
UPDATE accounts a
   SET current_balance = COALESCE(
     (SELECT SUM(amount) FROM transactions t WHERE t.account_id = a.id),
     0
   );

-- Flag business cash accounts (existing onboarding creates a 'business' type).
UPDATE accounts SET is_business = true WHERE type = 'business';

-- ── holdings ──────────────────────────────────────────────────────────────
-- Allow holdings without an instruments row; add denormalized fields for
-- manual entry. The unique constraint on (account_id, instrument_id) stays
-- as-is — NULL != NULL in unique indexes so multiple NULL-instrument rows
-- are already allowed.
ALTER TABLE holdings
  ALTER COLUMN instrument_id DROP NOT NULL,
  ADD COLUMN asset_name     varchar(200),
  ADD COLUMN ticker_local   varchar(40),
  ADD COLUMN asset_type     varchar(40),
  ADD COLUMN current_price  numeric(20, 4),
  ADD COLUMN risk_category  varchar(40),
  ADD COLUMN notes          text;

-- ── transactions ──────────────────────────────────────────────────────────
ALTER TABLE transactions
  ADD COLUMN direction varchar(20),
  ADD COLUMN notes     text,
  ADD COLUMN holding_id uuid REFERENCES holdings(id) ON DELETE SET NULL,
  ADD COLUMN recurring boolean NOT NULL DEFAULT false;

-- Best-effort backfill of direction from amount sign on existing rows.
UPDATE transactions
   SET direction = CASE
     WHEN amount > 0 THEN 'income'
     WHEN amount < 0 THEN 'expense'
     ELSE direction
   END
 WHERE direction IS NULL;

-- ── isa_deposits ──────────────────────────────────────────────────────────
ALTER TABLE isa_deposits ADD COLUMN notes text;

COMMIT;
