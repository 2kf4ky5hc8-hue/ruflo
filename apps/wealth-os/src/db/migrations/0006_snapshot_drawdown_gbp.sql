-- Ruflo Wealth OS — drawdown amount on snapshots
-- The dashboard already persists drawdown_pct; the daily job needs to
-- record the absolute £ drawdown too so it's queryable without recomputing
-- against the HWM at read time.

ALTER TABLE portfolio_snapshots
  ADD COLUMN drawdown_gbp numeric(20,4) NOT NULL DEFAULT 0;
