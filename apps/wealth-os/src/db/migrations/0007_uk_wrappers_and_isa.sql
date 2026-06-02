-- Ruflo Wealth OS — UK wrappers + ISA tracker depth
-- Adds:
--   * isa_deposits.kind so we can distinguish contributions from transfers
--     and withdrawals (only contributions count against the allowance).
--   * transactions.classification — a fixed UK-aware enum the user can pick
--     when entering or reviewing a transaction, separate from the user-
--     defined category bucket.

-- ───── ISA deposits: kind ───────────────────────────────────────────────

ALTER TABLE isa_deposits
  ADD COLUMN kind varchar(20) NOT NULL DEFAULT 'contribution',
  ADD COLUMN note text;
-- 'contribution'  — counts against the annual ISA subscription allowance
-- 'transfer_in'   — ISA-to-ISA transfer received; does NOT count
-- 'transfer_out'  — ISA-to-ISA transfer sent; does NOT count
-- 'withdrawal'    — money taken out; only restores allowance if the account
--                   is_flexible AND withdrawal/replacement same tax year

CREATE INDEX isa_deposits_user_year_kind_idx ON isa_deposits(user_id, tax_year, kind);

-- ───── Transactions: UK-aware classification ────────────────────────────

ALTER TABLE transactions
  ADD COLUMN classification varchar(40);
-- Allowed values (enforced in application code):
--   'isa_contribution', 'isa_transfer_in', 'isa_transfer_out', 'isa_withdrawal',
--   'gia_deposit', 'sipp_contribution',
--   'dividend', 'interest', 'tax', 'fee'

CREATE INDEX transactions_classification_idx ON transactions(classification) WHERE classification IS NOT NULL;
