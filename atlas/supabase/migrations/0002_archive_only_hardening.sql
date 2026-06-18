-- =============================================================================
-- Atlas Core — Migration 0002: archive-only hardening
-- Enforces the "no hard deletes for business records" rule on existing tables.
--
-- SAFETY: policy-only change. Apply on STAGING first, then production (with a
-- backup) at promotion. No data is touched. Idempotent.
--
-- Standard:
--   jobs              -> archive only      (delete denied)
--   job_contributions -> immutable ledger  (delete denied)
--   job_activity      -> already select-only (no delete policy) — unchanged
--   job_assignments   -> remains removable: it is current state (un-assigning a
--                        team member), not a preserved record — left unchanged
--   profiles          -> account management, admin-managed — left unchanged
-- =============================================================================

-- jobs: archive only (use the archived flag; never DELETE)
drop policy if exists jobs_delete on jobs;
create policy jobs_delete on jobs
  for delete to authenticated using (false);

-- job_contributions: immutable contribution ledger (never hard-deleted)
drop policy if exists job_contributions_delete on job_contributions;
create policy job_contributions_delete on job_contributions
  for delete to authenticated using (false);
