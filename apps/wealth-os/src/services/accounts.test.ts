import { describe, it, expect } from 'vitest';
import { validateAccountInput, ACCOUNT_TYPES } from './accounts';

describe('validateAccountInput', () => {
  it('accepts a minimal valid input', () => {
    const r = validateAccountInput({
      name: 'Monzo current',
      type: 'cash',
      currentBalanceGbp: 1234.56,
    });
    expect(r.name).toBe('Monzo current');
    expect(r.type).toBe('cash');
    expect(r.currentBalanceGbp).toBe(1234.56);
    expect(r.currency).toBe('GBP');           // default
    expect(r.isBusiness).toBe(false);         // default
    expect(r.active).toBe(true);              // default
  });

  it('coerces currency to uppercase', () => {
    const r = validateAccountInput({ name: 'X', type: 'cash', currentBalanceGbp: 0, currency: 'eur' });
    expect(r.currency).toBe('EUR');
  });

  it('rejects empty names', () => {
    expect(() => validateAccountInput({ name: '', type: 'cash', currentBalanceGbp: 0 })).toThrow();
    expect(() => validateAccountInput({ name: '   ', type: 'cash', currentBalanceGbp: 0 })).toThrow();
  });

  it('rejects unknown account types', () => {
    expect(() => validateAccountInput({ name: 'X', type: 'spaceship', currentBalanceGbp: 0 })).toThrow();
  });

  it('allows negative balances (mortgages, credit cards)', () => {
    const r = validateAccountInput({ name: 'Mortgage', type: 'mortgage', currentBalanceGbp: -250_000 });
    expect(r.currentBalanceGbp).toBe(-250_000);
  });

  it('coerces string balances to numbers', () => {
    const r = validateAccountInput({ name: 'X', type: 'cash', currentBalanceGbp: '500.50' });
    expect(r.currentBalanceGbp).toBe(500.5);
  });

  it('exposes the full list of supported account types', () => {
    expect(ACCOUNT_TYPES).toContain('cash');
    expect(ACCOUNT_TYPES).toContain('isa');
    expect(ACCOUNT_TYPES).toContain('crypto');
    expect(ACCOUNT_TYPES).toContain('mortgage');
  });

  it('accepts an optional institutionId only when a valid uuid', () => {
    expect(() => validateAccountInput({
      name: 'X', type: 'cash', currentBalanceGbp: 0, institutionId: 'not-a-uuid',
    })).toThrow();
    const r = validateAccountInput({
      name: 'X', type: 'cash', currentBalanceGbp: 0,
      institutionId: '11111111-2222-3333-4444-555555555555',
    });
    expect(r.institutionId).toBe('11111111-2222-3333-4444-555555555555');
  });
});
