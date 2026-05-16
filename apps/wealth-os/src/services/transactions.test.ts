import { describe, it, expect } from 'vitest';
import { validateTransactionInput, TRANSACTION_DIRECTIONS } from './transactions';

const VALID_ACCOUNT = '11111111-2222-3333-4444-555555555555';

describe('validateTransactionInput', () => {
  it('accepts a minimal income transaction', () => {
    const r = validateTransactionInput({
      accountId: VALID_ACCOUNT,
      postedAt: '2026-05-16',
      amountGbp: 1500,
      direction: 'income',
    });
    expect(r.direction).toBe('income');
    expect(r.amountGbp).toBe(1500);
    expect(r.recurring).toBe(false); // default
  });

  it('rejects an invalid date string', () => {
    expect(() => validateTransactionInput({
      accountId: VALID_ACCOUNT,
      postedAt: 'not-a-date',
      amountGbp: 1,
      direction: 'income',
    })).toThrow();
  });

  it('rejects unknown directions', () => {
    expect(() => validateTransactionInput({
      accountId: VALID_ACCOUNT,
      postedAt: '2026-05-16', amountGbp: 1, direction: 'yoink',
    })).toThrow();
  });

  it('lists every supported direction', () => {
    expect(TRANSACTION_DIRECTIONS).toEqual([
      'income', 'expense', 'transfer', 'investment', 'debt_payment',
    ]);
  });

  it('accepts an optional category and notes', () => {
    const r = validateTransactionInput({
      accountId: VALID_ACCOUNT,
      postedAt: '2026-05-16',
      amountGbp: 50,
      direction: 'expense',
      categoryId: '11111111-2222-3333-4444-555555555555',
      notes: 'Lunch',
    });
    expect(r.categoryId).toBe('11111111-2222-3333-4444-555555555555');
    expect(r.notes).toBe('Lunch');
  });
});
