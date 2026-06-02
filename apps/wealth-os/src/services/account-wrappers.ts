// UK-only account wrapper taxonomy. Deliberately *no* US wrappers
// (401k, IRA, HSA, Roth, 529 …). Pure, deterministic.

export const UK_WRAPPERS = [
  'stocks_and_shares_isa',
  'cash_isa',
  'gia',
  'sipp',
  'personal_cash',
  'business_cash',
  'paper',
] as const;
export type UkWrapper = typeof UK_WRAPPERS[number];

export const WRAPPER_LABELS: Record<UkWrapper, string> = {
  stocks_and_shares_isa: 'Stocks & Shares ISA',
  cash_isa:              'Cash ISA',
  gia:                   'General Investment Account (GIA)',
  sipp:                  'Pension / SIPP',
  personal_cash:         'Personal cash',
  business_cash:         'Business cash',
  paper:                 'Paper portfolio',
};

/** Wrappers that count against the annual ISA subscription allowance. */
export const ISA_WRAPPERS: ReadonlySet<UkWrapper> = new Set<UkWrapper>([
  'stocks_and_shares_isa', 'cash_isa',
]);

/** All wrappers that represent real money in a tax wrapper (not paper). */
export const REAL_INVESTMENT_WRAPPERS: ReadonlySet<UkWrapper> = new Set<UkWrapper>([
  'stocks_and_shares_isa', 'cash_isa', 'gia', 'sipp',
]);

/**
 * Derive the canonical UK wrapper from an `accounts` row. We keep the
 * existing `type` + `isaType` columns and translate at the edge, so the
 * schema doesn't need a breaking migration.
 */
export function deriveWrapper(account: {
  type: string;
  isaType: string | null;
}): UkWrapper | null {
  switch (account.type) {
    case 'isa': return account.isaType === 'cash' ? 'cash_isa' : 'stocks_and_shares_isa';
    case 'gia': return 'gia';
    case 'sipp': return 'sipp';
    case 'cash': return 'personal_cash';
    case 'business': return 'business_cash';
    case 'paper': return 'paper';
    default: return null; // mortgage, credit, debt, property, crypto — not investing wrappers
  }
}

/**
 * Inverse: from the canonical wrapper, produce the `type` + `isaType` to
 * persist on an `accounts` row. Used by the UI when creating accounts.
 */
export function wrapperToAccountFields(wrapper: UkWrapper): { type: string; isaType: string | null; isIsa: boolean } {
  switch (wrapper) {
    case 'stocks_and_shares_isa': return { type: 'isa', isaType: 'stocks_shares', isIsa: true };
    case 'cash_isa':              return { type: 'isa', isaType: 'cash',          isIsa: true };
    case 'gia':                   return { type: 'gia', isaType: null,            isIsa: false };
    case 'sipp':                  return { type: 'sipp', isaType: null,           isIsa: false };
    case 'personal_cash':         return { type: 'cash', isaType: null,           isIsa: false };
    case 'business_cash':         return { type: 'business', isaType: null,       isIsa: false };
    case 'paper':                 return { type: 'paper', isaType: null,          isIsa: false };
  }
}
