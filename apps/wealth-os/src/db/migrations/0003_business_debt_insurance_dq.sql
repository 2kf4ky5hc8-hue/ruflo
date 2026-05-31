-- Ruflo Wealth OS — business obligations, debt detail, insurance, data quality
-- Adoption of external-review recommendations §10: business-owner cashflow
-- engine, debt triage, protection/insurance tracking, data quality layer.

-- ───── Risk profiles: new conditional fields (review §2) ────────────────

ALTER TABLE risk_profiles
  ADD COLUMN max_single_position_small_portfolio_pct  numeric(6,4),
  ADD COLUMN max_speculative_until_buffer_healthy_pct numeric(6,4),
  ADD COLUMN business_reserve_floor_months            numeric(5,2)
    NOT NULL DEFAULT 3,
  ADD COLUMN crypto_requires_buffer                   boolean NOT NULL DEFAULT true,
  ADD COLUMN crypto_requires_no_toxic_debt            boolean NOT NULL DEFAULT true;


-- ───── Accounts: flexible-ISA flag ───────────────────────────────────────

ALTER TABLE accounts
  ADD COLUMN is_flexible             boolean NOT NULL DEFAULT false,
  ADD COLUMN reconciliation_status   varchar(20) NOT NULL DEFAULT 'unreconciled',
  ADD COLUMN last_verified_at        timestamptz,
  ADD COLUMN confidence_score        numeric(5,4);

-- ───── Holdings: data quality ────────────────────────────────────────────

ALTER TABLE holdings
  ADD COLUMN reconciliation_status   varchar(20) NOT NULL DEFAULT 'unreconciled',
  ADD COLUMN last_verified_at        timestamptz,
  ADD COLUMN confidence_score        numeric(5,4);

-- ───── Transactions: data quality ────────────────────────────────────────

ALTER TABLE transactions
  ADD COLUMN reconciliation_status   varchar(20) NOT NULL DEFAULT 'unreconciled',
  ADD COLUMN last_verified_at        timestamptz;

-- ───── Business obligations ─────────────────────────────────────────────
-- Tax (VAT/PAYE/corp tax), payroll, rent, supplier commitments, software etc.
-- The business cashflow agent uses sum(unpaid) as the "do not extract" floor.

CREATE TABLE business_obligations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  kind              varchar(40) NOT NULL,
    -- 'vat' | 'paye' | 'corp_tax' | 'corp_tax_reserve' | 'payroll'
    -- 'rent' | 'supplier' | 'software' | 'loan_repayment' | 'other'
  description       text,
  amount_gbp        numeric(20,4) NOT NULL,
  due_at            timestamptz,
  recurring         varchar(20) NOT NULL DEFAULT 'one_off',
    -- 'one_off' | 'monthly' | 'quarterly' | 'annual'
  paid_at           timestamptz,
  source            varchar(40) NOT NULL DEFAULT 'manual',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX business_obligations_business_due_idx
  ON business_obligations(business_id, due_at) WHERE paid_at IS NULL;

-- ───── Debt items ───────────────────────────────────────────────────────
-- Per-debt detail so the engine can do APR-aware triage rather than treating
-- a single "Total debt" account as one undifferentiated number.

CREATE TABLE debt_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                varchar(160) NOT NULL,
  kind                varchar(40) NOT NULL,
    -- 'mortgage' | 'credit_card' | 'personal_loan' | 'student_loan'
    -- 'car_finance' | 'bnpl' | 'hmrc_arrears' | 'director_loan' | 'other'
  balance_gbp         numeric(20,4) NOT NULL,
  apr_pct             numeric(6,4) NOT NULL DEFAULT 0,
  minimum_payment_gbp numeric(20,4),
  secured             boolean NOT NULL DEFAULT false,
  term_months         integer,
  tax_deductible      boolean NOT NULL DEFAULT false,
  source              varchar(40) NOT NULL DEFAULT 'manual',
  last_verified_at    timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX debt_items_user_apr_idx ON debt_items(user_id, apr_pct DESC);

-- ───── Insurance / protection policies ───────────────────────────────────
-- "Not sexy, very wealth-preserving." Tracks the cover that protects the
-- compounding plan from a single bad year.

CREATE TABLE insurance_policies (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind                  varchar(40) NOT NULL,
    -- 'life' | 'income_protection' | 'critical_illness'
    -- 'private_medical' | 'home_contents' | 'home_buildings'
    -- 'travel' | 'business_liability' | 'employers_liability'
    -- 'key_person' | 'professional_indemnity' | 'will' | 'lpa'
  provider              varchar(200),
  cover_amount_gbp      numeric(20,4),
  monthly_premium_gbp   numeric(20,4),
  start_date            date,
  renewal_date          date,
  beneficiary           text,
  notes                 text,
  status                varchar(20) NOT NULL DEFAULT 'active',
    -- 'active' | 'lapsed' | 'pending' | 'cancelled'
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX insurance_policies_user_kind_idx ON insurance_policies(user_id, kind);

-- ───── Fee schedules ─────────────────────────────────────────────────────
-- Cost-drag input for projections. Per platform / account / fund.

CREATE TABLE fee_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id      uuid REFERENCES accounts(id) ON DELETE CASCADE,
  instrument_id   uuid REFERENCES instruments(id) ON DELETE CASCADE,
  kind            varchar(40) NOT NULL,
    -- 'platform_fee_pct' | 'platform_fee_flat'
    -- 'fund_ocf_pct'
    -- 'dealing_fee_flat'
    -- 'fx_spread_pct'
    -- 'stamp_duty_pct'
    -- 'exit_fee_flat'
  rate            numeric(8,6) NOT NULL,
  cap_gbp         numeric(20,4),
  applies_to      varchar(40),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fee_schedules_user_account_idx ON fee_schedules(user_id, account_id);
