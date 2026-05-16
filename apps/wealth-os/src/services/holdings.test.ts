import { describe, it, expect } from 'vitest';
import { validateHoldingInput, ASSET_TYPES, RISK_CATEGORIES } from './holdings';

const VALID_ACCOUNT = '11111111-2222-3333-4444-555555555555';

describe('validateHoldingInput', () => {
  it('accepts a minimal valid manual holding', () => {
    const r = validateHoldingInput({
      accountId: VALID_ACCOUNT,
      assetName: 'Vanguard FTSE Global All Cap',
      assetType: 'fund',
      quantity: 12.5,
    });
    expect(r.accountId).toBe(VALID_ACCOUNT);
    expect(r.assetName).toBe('Vanguard FTSE Global All Cap');
    expect(r.assetType).toBe('fund');
    expect(r.quantity).toBe(12.5);
    expect(r.currency).toBe('GBP'); // default
  });

  it('rejects negative quantities', () => {
    expect(() => validateHoldingInput({
      accountId: VALID_ACCOUNT,
      assetName: 'X', assetType: 'stock', quantity: -1,
    })).toThrow();
  });

  it('coerces strings for quantity and prices', () => {
    const r = validateHoldingInput({
      accountId: VALID_ACCOUNT,
      assetName: 'X', assetType: 'stock',
      quantity: '10',
      avgCost: '100.25',
      currentPrice: '110.50',
    });
    expect(r.quantity).toBe(10);
    expect(r.avgCost).toBe(100.25);
    expect(r.currentPrice).toBe(110.5);
  });

  it('lists every supported asset type', () => {
    expect(ASSET_TYPES).toContain('stock');
    expect(ASSET_TYPES).toContain('etf');
    expect(ASSET_TYPES).toContain('crypto');
    expect(ASSET_TYPES).toContain('cash');
  });

  it('lists every supported risk category', () => {
    expect(RISK_CATEGORIES).toEqual(['low', 'medium', 'high', 'speculative']);
  });

  it('accepts an optional risk category', () => {
    const r = validateHoldingInput({
      accountId: VALID_ACCOUNT,
      assetName: 'X', assetType: 'stock', quantity: 1, riskCategory: 'high',
    });
    expect(r.riskCategory).toBe('high');
  });
});
