-- Ruflo Wealth OS — initial schema (v0.1.0)
-- Money stored as numeric(20,4) in the account's currency. Never floats.
-- All timestamps timezone-aware in UTC.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ───── Identity ───────────────────────────────────────────────────────────

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           varchar(320) UNIQUE NOT NULL,
  name            varchar(200) NOT NULL,
  base_currency   varchar(3) NOT NULL DEFAULT 'GBP',
  tax_residency   varchar(2) NOT NULL DEFAULT 'GB',
  risk_profile    varchar(20) NOT NULL DEFAULT 'balanced',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE TABLE sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  varchar(128) UNIQUE NOT NULL,
  expires_at  timestamptz NOT NULL,
  ip          inet,
  user_agent  text,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id, expires_at);

CREATE TABLE audit_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  actor        varchar(80) NOT NULL,
  action       varchar(80) NOT NULL,
  entity_type  varchar(80) NOT NULL,
  entity_id    uuid,
  before       jsonb,
  after        jsonb,
  ip           inet,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_entity_idx    ON audit_events(entity_type, entity_id);
CREATE INDEX audit_user_time_idx ON audit_events(user_id, created_at);

-- ───── Accounts & connections ─────────────────────────────────────────────

CREATE TABLE institutions (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name     varchar(200) NOT NULL,
  country  varchar(2) NOT NULL DEFAULT 'GB',
  type     varchar(30) NOT NULL
);

CREATE TABLE connections (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  institution_id           uuid REFERENCES institutions(id) ON DELETE SET NULL,
  provider                 varchar(40) NOT NULL,
  provider_account_id      varchar(200),
  scope                    varchar(40) NOT NULL DEFAULT 'read',
  status                   varchar(20) NOT NULL DEFAULT 'active',
  consent_expires_at       timestamptz,
  last_synced_at           timestamptz,
  refresh_token_encrypted  text,
  created_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX connections_user_idx ON connections(user_id, status);

CREATE TABLE accounts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connection_id           uuid REFERENCES connections(id) ON DELETE SET NULL,
  type                    varchar(30) NOT NULL,
  subtype                 varchar(40),
  name                    varchar(200) NOT NULL,
  currency                varchar(3) NOT NULL DEFAULT 'GBP',
  iban_masked             varchar(40),
  sortcode_masked         varchar(12),
  account_number_masked   varchar(20),
  is_isa                  boolean NOT NULL DEFAULT false,
  isa_type                varchar(30),
  opened_at               timestamptz,
  closed_at               timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accounts_user_type_idx ON accounts(user_id, type);

CREATE TABLE categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       varchar(120) NOT NULL,
  kind       varchar(20) NOT NULL,
  parent_id  uuid
);
CREATE INDEX categories_user_kind_idx ON categories(user_id, kind);

CREATE TABLE category_rules (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pattern      text NOT NULL,
  field        varchar(40) NOT NULL DEFAULT 'description_clean',
  category_id  uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  priority     integer NOT NULL DEFAULT 100,
  active       boolean NOT NULL DEFAULT true
);

CREATE TABLE transactions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  posted_at           timestamptz NOT NULL,
  value_date          timestamptz,
  amount              numeric(20,4) NOT NULL,
  currency            varchar(3) NOT NULL,
  fx_rate             numeric(20,10),
  counterparty        varchar(200),
  description_raw     text,
  description_clean   text,
  category_id         uuid REFERENCES categories(id) ON DELETE SET NULL,
  is_transfer         boolean NOT NULL DEFAULT false,
  transfer_pair_id    uuid,
  source              varchar(40) NOT NULL DEFAULT 'manual',
  source_ref          varchar(200),
  confidence_score    numeric(5,4),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tx_account_time_idx ON transactions(account_id, posted_at DESC);
CREATE INDEX tx_pair_idx         ON transactions(transfer_pair_id);

-- ───── Instruments, holdings, market data ─────────────────────────────────

CREATE TABLE instruments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  isin            varchar(12) UNIQUE,
  ticker          varchar(20),
  mic             varchar(10),
  name            varchar(300) NOT NULL,
  asset_class     varchar(30) NOT NULL,
  sector          varchar(80),
  country         varchar(2),
  currency        varchar(3) NOT NULL,
  listing_status  varchar(20) NOT NULL DEFAULT 'active'
);
CREATE INDEX instruments_ticker_idx ON instruments(ticker, mic);

CREATE TABLE holdings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instrument_id  uuid NOT NULL REFERENCES instruments(id),
  quantity       numeric(28,8) NOT NULL,
  avg_cost       numeric(20,4),
  currency       varchar(3) NOT NULL,
  as_of          timestamptz NOT NULL,
  source         varchar(40) NOT NULL DEFAULT 'manual',
  UNIQUE (account_id, instrument_id)
);

CREATE TABLE lots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holding_id    uuid NOT NULL REFERENCES holdings(id) ON DELETE CASCADE,
  acquired_at   timestamptz NOT NULL,
  quantity      numeric(28,8) NOT NULL,
  price         numeric(20,4) NOT NULL,
  fees          numeric(20,4) NOT NULL DEFAULT 0,
  fx_rate       numeric(20,10)
);

CREATE TABLE corporate_actions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id  uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  type           varchar(30) NOT NULL,
  ex_date        timestamptz,
  record_date    timestamptz,
  pay_date       timestamptz,
  details        jsonb NOT NULL
);

CREATE TABLE prices (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id  uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  ts             timestamptz NOT NULL,
  open           numeric(20,4),
  high           numeric(20,4),
  low            numeric(20,4),
  close          numeric(20,4) NOT NULL,
  volume         numeric(28,4),
  source         varchar(40) NOT NULL,
  UNIQUE (instrument_id, ts, source)
);

CREATE TABLE fundamentals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id  uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  as_of          timestamptz NOT NULL,
  metric         varchar(60) NOT NULL,
  value          numeric(28,6),
  source         varchar(40) NOT NULL
);
CREATE INDEX fundamentals_instr_metric_idx ON fundamentals(instrument_id, metric, as_of);

-- ───── ISA tracking ───────────────────────────────────────────────────────

CREATE TABLE isa_years (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tax_year     integer NOT NULL,
  allowance    numeric(20,4) NOT NULL,
  deposited    numeric(20,4) NOT NULL DEFAULT 0,
  remaining    numeric(20,4) NOT NULL,
  computed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, tax_year)
);

CREATE TABLE isa_deposits (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id             uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deposited_at           timestamptz NOT NULL,
  amount                 numeric(20,4) NOT NULL,
  tax_year               integer NOT NULL,
  source_transaction_id  uuid REFERENCES transactions(id) ON DELETE SET NULL
);
CREATE INDEX isa_deposits_user_year_idx ON isa_deposits(user_id, tax_year);

-- ───── Business ───────────────────────────────────────────────────────────

CREATE TABLE businesses (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                     varchar(200) NOT NULL,
  companies_house_number   varchar(10),
  vat_number               varchar(20),
  year_end                 varchar(5),
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE business_metrics (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id              uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  as_of                    timestamptz NOT NULL,
  mrr                      numeric(20,4),
  runway_months            numeric(8,2),
  cash                     numeric(20,4),
  liabilities              numeric(20,4),
  directors_loan_balance   numeric(20,4),
  tax_reserve              numeric(20,4),
  dividend_paid_ytd        numeric(20,4),
  salary_paid_ytd          numeric(20,4)
);
CREATE INDEX biz_metrics_time_idx ON business_metrics(business_id, as_of);

-- ───── Risk, allocation, opportunities, research, approvals ──────────────

CREATE TABLE risk_profiles (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name                          varchar(40) NOT NULL,
  max_single_position_pct       numeric(6,4) NOT NULL,
  max_speculative_pct           numeric(6,4) NOT NULL,
  max_sector_pct                numeric(6,4) NOT NULL,
  max_country_pct               numeric(6,4) NOT NULL,
  max_currency_pct              numeric(6,4) NOT NULL,
  max_daily_loss_pct            numeric(6,4) NOT NULL,
  max_weekly_loss_pct           numeric(6,4) NOT NULL,
  max_monthly_loss_pct          numeric(6,4) NOT NULL,
  leverage_allowed              boolean NOT NULL DEFAULT false,
  options_allowed               boolean NOT NULL DEFAULT false,
  crypto_cap_pct                numeric(6,4) NOT NULL DEFAULT 0,
  cash_floor_months             numeric(5,2) NOT NULL,
  cooling_off_minutes           integer NOT NULL,
  sleep_mode_start              varchar(5) NOT NULL,
  sleep_mode_end                varchar(5) NOT NULL,
  new_instrument_size_cap_pct   numeric(6,4) NOT NULL,
  liquidity_min_adv_gbp         numeric(20,4) NOT NULL,
  paper_trade_days              integer NOT NULL DEFAULT 30,
  active                        boolean NOT NULL DEFAULT true,
  created_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE risk_breaches (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule         varchar(80) NOT NULL,
  severity     varchar(20) NOT NULL,
  detail       jsonb NOT NULL,
  detected_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
CREATE INDEX risk_breaches_user_open_idx ON risk_breaches(user_id, resolved_at);

CREATE TABLE allocation_rules (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name     varchar(60) NOT NULL,
  preset   varchar(30) NOT NULL,
  weights  jsonb NOT NULL,
  active   boolean NOT NULL DEFAULT true
);

CREATE TABLE spare_cash_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  detected_at         timestamptz NOT NULL DEFAULT now(),
  amount              numeric(20,4) NOT NULL,
  recommended_split   jsonb NOT NULL,
  decided_at          timestamptz,
  accepted            boolean
);

CREATE TABLE opportunities (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind               varchar(30) NOT NULL,
  title              varchar(240) NOT NULL,
  asset_ref          varchar(200),
  summary            text,
  upside_pct         numeric(6,4),
  risk_score         integer NOT NULL,
  liquidity_score    integer,
  complexity_score   integer,
  capital_required   numeric(20,4),
  tax_impact         jsonb,
  confidence         numeric(6,4),
  worst_case_pct     numeric(6,4),
  fit_score          numeric(6,4),
  sources            jsonb,
  expires_at         timestamptz,
  status             varchar(20) NOT NULL DEFAULT 'new',
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX opp_user_status_fit_idx ON opportunities(user_id, status, fit_score DESC);

CREATE TABLE research_notes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument_id       uuid NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  generated_at        timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1,
  business_model      text,
  revenue_model       text,
  valuation           jsonb,
  growth              jsonb,
  balance_sheet       jsonb,
  risks               jsonb,
  bull_case           text,
  bear_case           text,
  base_case           text,
  ratios              jsonb,
  news                jsonb,
  sentiment           jsonb,
  insider             jsonb,
  isa_eligible        boolean,
  suggested_size_pct  numeric(6,4),
  suggested_action    varchar(20) NOT NULL,
  citations           jsonb NOT NULL
);
CREATE INDEX research_user_instr_idx ON research_notes(user_id, instrument_id, generated_at DESC);

CREATE TABLE proposed_actions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent           varchar(60) NOT NULL,
  kind            varchar(40) NOT NULL,
  payload         jsonb NOT NULL,
  reason          text NOT NULL,
  upside          text,
  downside        text,
  risk_score      integer NOT NULL,
  confidence      numeric(6,4) NOT NULL,
  amount_at_risk  numeric(20,4),
  alternatives    jsonb,
  expires_at      timestamptz,
  status          varchar(20) NOT NULL DEFAULT 'pending',
  decided_at      timestamptz,
  decided_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  decision_note   text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX proposed_user_pending_idx ON proposed_actions(user_id, status, expires_at);

CREATE TABLE goals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            varchar(160) NOT NULL,
  target_amount   numeric(20,4) NOT NULL,
  target_date     timestamptz,
  category        varchar(40) NOT NULL,
  priority        integer NOT NULL DEFAULT 100,
  current_amount  numeric(20,4) NOT NULL DEFAULT 0,
  projection      jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          varchar(40) NOT NULL,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  period_start  timestamptz,
  period_end    timestamptz,
  content       jsonb NOT NULL,
  sent_at       timestamptz
);
CREATE INDEX reports_user_kind_time_idx ON reports(user_id, kind, generated_at DESC);

CREATE TABLE agent_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent       varchar(60) NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  status      varchar(20) NOT NULL DEFAULT 'running',
  input       jsonb,
  output      jsonb,
  tokens_in   integer,
  tokens_out  integer,
  cost_usd    numeric(10,6),
  error       text
);
CREATE INDEX agent_runs_user_agent_time_idx ON agent_runs(user_id, agent, started_at DESC);
