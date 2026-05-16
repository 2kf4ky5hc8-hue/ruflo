-- Ruflo Wealth OS — auth + onboarding fields (F-005 / WC-1201)
-- Adds password hashing, TOTP enrolment, recovery codes,
-- and the per-user monthly cashflow fields the onboarding wizard captures.

-- ───── Users: auth + onboarding fields ───────────────────────────────────

ALTER TABLE users
  ADD COLUMN password_hash           text,
  ADD COLUMN totp_secret_encrypted   text,
  ADD COLUMN totp_enrolled_at        timestamptz,
  ADD COLUMN monthly_income_gbp      numeric(20,4),
  ADD COLUMN monthly_expenses_gbp    numeric(20,4),
  ADD COLUMN onboarded_at            timestamptz;

-- ───── Recovery codes (one-shot, hashed) ─────────────────────────────────

CREATE TABLE recovery_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   varchar(128) NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX recovery_codes_user_idx ON recovery_codes(user_id, used_at);
