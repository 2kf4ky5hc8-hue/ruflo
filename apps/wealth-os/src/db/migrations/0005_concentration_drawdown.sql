-- Ruflo Wealth OS — concentration + drawdown tracking (Portfolio Risk Dashboard)
-- Tags on holdings, periodic portfolio snapshots, and drawdown thresholds on
-- the risk profile so the evaluator can gate paper/speculative activity when
-- the portfolio is in deep drawdown.

-- ───── Holdings: free-form tags ──────────────────────────────────────────

ALTER TABLE holdings
  ADD COLUMN tags text[] NOT NULL DEFAULT '{}';
CREATE INDEX holdings_tags_idx ON holdings USING gin (tags);

-- ───── Portfolio snapshots (high-water mark + drawdown source of truth) ──

CREATE TABLE portfolio_snapshots (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ts                    timestamptz NOT NULL DEFAULT now(),
  -- All in GBP.
  cash_gbp              numeric(20,4) NOT NULL,
  investable_gbp        numeric(20,4) NOT NULL,   -- holdings MV only
  total_mv_gbp          numeric(20,4) NOT NULL,   -- cash + investable + ISA cash etc.
  high_water_mark_gbp   numeric(20,4) NOT NULL,
  drawdown_pct          numeric(6,4) NOT NULL DEFAULT 0,
  source                varchar(40) NOT NULL DEFAULT 'manual'
);
CREATE INDEX portfolio_snapshots_user_ts_idx ON portfolio_snapshots(user_id, ts DESC);

-- ───── Risk profile: drawdown thresholds (separate from monthly P&L cap) ──

ALTER TABLE risk_profiles
  ADD COLUMN drawdown_caution_pct numeric(6,4) NOT NULL DEFAULT 0.10,
  ADD COLUMN drawdown_block_pct   numeric(6,4) NOT NULL DEFAULT 0.20;
