-- Ruflo Wealth OS — paper portfolio + decision journal (Epic 14)
-- Simulated execution so the user can run the system on real numbers and
-- watch decisions play out before a single pound moves. Never touches a broker.

CREATE TABLE paper_positions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  proposed_action_id    uuid REFERENCES proposed_actions(id) ON DELETE SET NULL,
  instrument_ref        varchar(200) NOT NULL,   -- ticker / ISIN / fund name
  instrument_name       varchar(300),
  asset_class           varchar(30) NOT NULL,
  wrapper               varchar(40) NOT NULL,     -- isa | gia | crypto_exchange ...
  quantity              numeric(28,8) NOT NULL,
  avg_fill_price        numeric(20,4) NOT NULL,
  fees_gbp              numeric(20,4) NOT NULL DEFAULT 0,
  opened_at             timestamptz NOT NULL DEFAULT now(),
  closed_at             timestamptz,
  status                varchar(20) NOT NULL DEFAULT 'open',  -- open | closed
  -- Decision journal fields (PP-1404)
  reason_code           varchar(40) NOT NULL DEFAULT 'other',
    -- valuation | quality | growth | income | rebalance | tax | cashflow
    -- | concentration | diversification | opportunity | other
  thesis                text,
  -- Benchmark captured at open (PP-1405): what the default plan would have earned.
  benchmark_return_pct  numeric(6,4),
  default_plan_delta_pct numeric(6,4),
  -- Mark-to-market (PP-1403)
  mark_price            numeric(20,4),
  marked_at             timestamptz,
  realised_pnl_gbp      numeric(20,4),
  -- Scheduled review checkpoints
  review_30d_done       boolean NOT NULL DEFAULT false,
  review_90d_done       boolean NOT NULL DEFAULT false,
  review_180d_done      boolean NOT NULL DEFAULT false,
  review_365d_done      boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paper_positions_user_status_idx ON paper_positions(user_id, status, opened_at DESC);

CREATE TABLE paper_fills (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position_id         uuid NOT NULL REFERENCES paper_positions(id) ON DELETE CASCADE,
  proposed_action_id  uuid REFERENCES proposed_actions(id) ON DELETE SET NULL,
  side                varchar(8) NOT NULL,        -- buy | sell
  quantity            numeric(28,8) NOT NULL,
  price               numeric(20,4) NOT NULL,
  fees_gbp            numeric(20,4) NOT NULL DEFAULT 0,
  filled_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX paper_fills_position_idx ON paper_fills(position_id, filled_at);
