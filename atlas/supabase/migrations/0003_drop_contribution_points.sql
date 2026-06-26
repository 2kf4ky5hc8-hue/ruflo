-- =============================================================================
-- Atlas Core — Migration 0003: remove contribution "points"
-- Contributions are a plain "who did what" log — no points / score / weighting.
--
-- This drops the now-unused `weight` column from job_contributions.
-- It is the one change here that removes a column (and any values in it). On
-- staging the column is empty. For production, follow the promotion runbook
-- (back up first). `if exists` makes this safe to re-run and a no-op on fresh
-- installs (the column is already gone from schema.sql).
-- =============================================================================

alter table job_contributions drop column if exists weight;
