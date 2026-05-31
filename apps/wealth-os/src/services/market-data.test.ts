import { describe, it, expect } from 'vitest';
import { StubProvider, stubPrice, parseFmpQuote } from './market-data/index';
import { valueHolding } from './prices';

describe('stubPrice', () => {
  it('is deterministic for a given symbol and day', () => {
    const day = new Date('2026-05-16T12:00:00Z');
    expect(stubPrice('VWRP', day)).toBe(stubPrice('VWRP', day));
  });

  it('differs between symbols', () => {
    const day = new Date('2026-05-16T12:00:00Z');
    expect(stubPrice('VWRP', day)).not.toBe(stubPrice('VUSA', day));
  });

  it('stays in a sane range (£20–£520)', () => {
    const day = new Date('2026-05-16T12:00:00Z');
    for (const s of ['VWRP', 'VUSA', 'AAPL', 'TSLA', 'SMT.L', 'III.L']) {
      const p = stubPrice(s, day);
      expect(p).toBeGreaterThan(15);
      expect(p).toBeLessThan(540);
    }
  });
});

describe('StubProvider', () => {
  it('returns a stub-flagged GBP quote', async () => {
    const p = new StubProvider();
    const q = await p.getQuote('VWRP');
    expect(q).not.toBeNull();
    expect(q!.stub).toBe(true);
    expect(q!.currency).toBe('GBP');
    expect(q!.symbol).toBe('VWRP');
  });

  it('batch-quotes many symbols', async () => {
    const p = new StubProvider();
    const m = await p.getQuotes(['VWRP', 'VUSA']);
    expect(m.size).toBe(2);
    expect(m.get('VWRP')).toBeDefined();
  });
});

describe('parseFmpQuote', () => {
  it('parses a /quote-short style response', () => {
    const q = parseFmpQuote([{ symbol: 'AAPL', price: 212.34 }], 'AAPL');
    expect(q).not.toBeNull();
    expect(q!.price).toBe(212.34);
    expect(q!.currency).toBe('USD');
    expect(q!.stub).toBe(false);
  });

  it('infers GBP for .L (London) symbols', () => {
    const q = parseFmpQuote([{ symbol: 'SMT.L', price: 9.12 }], 'SMT.L');
    expect(q!.currency).toBe('GBP');
  });

  it('returns null for empty or malformed responses', () => {
    expect(parseFmpQuote([], 'X')).toBeNull();
    expect(parseFmpQuote({}, 'X')).toBeNull();
    expect(parseFmpQuote([{ symbol: 'X' }], 'X')).toBeNull(); // no price
  });
});

describe('valueHolding', () => {
  it('values a holding at market when priced', () => {
    const v = valueHolding({ quantity: 50, avgCostGbp: 95, marketPrice: 110 });
    expect(v.bookValueGbp).toBe(4750);
    expect(v.marketValueGbp).toBe(5500);
    expect(v.unrealisedPnlGbp).toBe(750);
    expect(v.unrealisedPnlPct).toBeCloseTo(750 / 4750, 4);
    expect(v.priced).toBe(true);
  });

  it('returns book value only when unpriced', () => {
    const v = valueHolding({ quantity: 50, avgCostGbp: 95, marketPrice: null });
    expect(v.bookValueGbp).toBe(4750);
    expect(v.marketValueGbp).toBeNull();
    expect(v.priced).toBe(false);
  });

  it('is deterministic', () => {
    const args = { quantity: 12.5, avgCostGbp: 80, marketPrice: 88 };
    const first = valueHolding(args);
    for (let i = 0; i < 20; i++) expect(valueHolding(args)).toEqual(first);
  });
});
