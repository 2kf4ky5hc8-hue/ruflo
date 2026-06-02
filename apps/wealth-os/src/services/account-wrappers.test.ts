import { describe, it, expect } from 'vitest';
import {
  UK_WRAPPERS, ISA_WRAPPERS, REAL_INVESTMENT_WRAPPERS,
  deriveWrapper, wrapperToAccountFields,
} from './account-wrappers';

describe('UK_WRAPPERS enum', () => {
  it('contains exactly the seven UK wrappers requested', () => {
    expect([...UK_WRAPPERS].sort()).toEqual([
      'business_cash', 'cash_isa', 'gia', 'paper',
      'personal_cash', 'sipp', 'stocks_and_shares_isa',
    ]);
  });

  it('does NOT contain any US retirement wrappers', () => {
    const forbidden = ['401k', 'ira', 'roth', 'roth_ira', '529', 'hsa', 'sep_ira'];
    const lower = [...UK_WRAPPERS].map((w) => w.toLowerCase());
    for (const f of forbidden) expect(lower).not.toContain(f);
  });

  it('classifies which wrappers count against ISA allowance', () => {
    expect(ISA_WRAPPERS.has('stocks_and_shares_isa')).toBe(true);
    expect(ISA_WRAPPERS.has('cash_isa')).toBe(true);
    expect(ISA_WRAPPERS.has('gia')).toBe(false);
    expect(ISA_WRAPPERS.has('sipp')).toBe(false);
    expect(ISA_WRAPPERS.has('paper')).toBe(false);
  });

  it('lists real investment wrappers (excludes paper + cash + business)', () => {
    expect(REAL_INVESTMENT_WRAPPERS.has('stocks_and_shares_isa')).toBe(true);
    expect(REAL_INVESTMENT_WRAPPERS.has('sipp')).toBe(true);
    expect(REAL_INVESTMENT_WRAPPERS.has('paper')).toBe(false);
    expect(REAL_INVESTMENT_WRAPPERS.has('personal_cash')).toBe(false);
  });
});

describe('deriveWrapper', () => {
  it('distinguishes stocks-and-shares ISA from cash ISA via isaType', () => {
    expect(deriveWrapper({ type: 'isa', isaType: 'stocks_shares' })).toBe('stocks_and_shares_isa');
    expect(deriveWrapper({ type: 'isa', isaType: 'cash' })).toBe('cash_isa');
  });

  it('handles every account type the app uses', () => {
    expect(deriveWrapper({ type: 'gia', isaType: null })).toBe('gia');
    expect(deriveWrapper({ type: 'sipp', isaType: null })).toBe('sipp');
    expect(deriveWrapper({ type: 'cash', isaType: null })).toBe('personal_cash');
    expect(deriveWrapper({ type: 'business', isaType: null })).toBe('business_cash');
    expect(deriveWrapper({ type: 'paper', isaType: null })).toBe('paper');
  });

  it('returns null for non-investing account types', () => {
    expect(deriveWrapper({ type: 'mortgage', isaType: null })).toBeNull();
    expect(deriveWrapper({ type: 'credit', isaType: null })).toBeNull();
    expect(deriveWrapper({ type: 'debt', isaType: null })).toBeNull();
    expect(deriveWrapper({ type: 'property', isaType: null })).toBeNull();
  });
});

describe('wrapperToAccountFields', () => {
  it('is the inverse of deriveWrapper', () => {
    for (const w of UK_WRAPPERS) {
      const f = wrapperToAccountFields(w);
      expect(deriveWrapper({ type: f.type, isaType: f.isaType })).toBe(w);
    }
  });

  it('sets isIsa correctly for both ISA wrappers', () => {
    expect(wrapperToAccountFields('stocks_and_shares_isa').isIsa).toBe(true);
    expect(wrapperToAccountFields('cash_isa').isIsa).toBe(true);
    expect(wrapperToAccountFields('gia').isIsa).toBe(false);
    expect(wrapperToAccountFields('sipp').isIsa).toBe(false);
  });
});
