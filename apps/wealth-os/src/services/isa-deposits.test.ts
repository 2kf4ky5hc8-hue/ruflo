import { describe, it, expect } from 'vitest';
import { validateIsaDepositInput, currentTaxYearNumber } from './isa-deposits';

const VALID_ACCOUNT = '11111111-2222-3333-4444-555555555555';

describe('validateIsaDepositInput', () => {
  it('accepts a minimal valid deposit', () => {
    const r = validateIsaDepositInput({
      accountId: VALID_ACCOUNT,
      depositedAt: '2026-05-16',
      amountGbp: 500,
      taxYear: 2026,
    });
    expect(r.amountGbp).toBe(500);
    expect(r.taxYear).toBe(2026);
  });

  it('rejects non-positive amounts', () => {
    expect(() => validateIsaDepositInput({
      accountId: VALID_ACCOUNT, depositedAt: '2026-05-16', amountGbp: 0, taxYear: 2026,
    })).toThrow();
    expect(() => validateIsaDepositInput({
      accountId: VALID_ACCOUNT, depositedAt: '2026-05-16', amountGbp: -10, taxYear: 2026,
    })).toThrow();
  });

  it('rejects implausible tax years', () => {
    expect(() => validateIsaDepositInput({
      accountId: VALID_ACCOUNT, depositedAt: '2026-05-16', amountGbp: 100, taxYear: 1900,
    })).toThrow();
    expect(() => validateIsaDepositInput({
      accountId: VALID_ACCOUNT, depositedAt: '2026-05-16', amountGbp: 100, taxYear: 3000,
    })).toThrow();
  });
});

describe('currentTaxYearNumber', () => {
  it('returns 2025 just before 6 April 2026', () => {
    expect(currentTaxYearNumber(new Date('2026-04-05T12:00:00Z'))).toBe(2025);
  });
  it('returns 2026 on 6 April 2026 and after', () => {
    expect(currentTaxYearNumber(new Date('2026-04-06T00:00:00Z'))).toBe(2026);
    expect(currentTaxYearNumber(new Date('2026-12-01T00:00:00Z'))).toBe(2026);
  });
});
