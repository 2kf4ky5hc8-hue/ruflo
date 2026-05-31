import { describe, it, expect } from 'vitest';
import { estimateFees, valuePosition } from './paper-portfolio';

describe('estimateFees', () => {
  it('is zero for a plain low-cost fund/ETF buy', () => {
    expect(estimateFees(1000)).toBe(0);
  });

  it('adds 0.5% stamp duty on UK individual shares', () => {
    expect(estimateFees(1000, { isUkShare: true })).toBeCloseTo(5, 2);
  });

  it('adds 0.15% FX spread on overseas assets', () => {
    expect(estimateFees(1000, { isOverseas: true })).toBeCloseTo(1.5, 2);
  });

  it('stacks stamp duty and FX when both apply', () => {
    expect(estimateFees(1000, { isUkShare: true, isOverseas: true })).toBeCloseTo(6.5, 2);
  });
});

describe('valuePosition', () => {
  const openedAt = new Date('2026-01-01T00:00:00Z');

  it('computes unrealised gain net of fees', () => {
    // 100 units @ £10 = £1000 cost + £5 fees = £1005. Mark £11 → MV £1100.
    const v = valuePosition({
      quantity: 100, avgFillPrice: 10, feesGbp: 5, markPrice: 11,
      openedAt, now: new Date('2026-07-01T00:00:00Z'),
    });
    expect(v.costGbp).toBeCloseTo(1005, 2);
    expect(v.marketValueGbp).toBeCloseTo(1100, 2);
    expect(v.unrealisedPnlGbp).toBeCloseTo(95, 2);
    expect(v.unrealisedPnlPct).toBeCloseTo(95 / 1005, 4);
  });

  it('computes a loss when mark is below cost', () => {
    const v = valuePosition({
      quantity: 100, avgFillPrice: 10, feesGbp: 0, markPrice: 8,
      openedAt, now: new Date('2026-07-01T00:00:00Z'),
    });
    expect(v.unrealisedPnlGbp).toBeCloseTo(-200, 2);
  });

  it('computes vs-benchmark: a 20% gain over ~6mo beats a 5% benchmark', () => {
    const v = valuePosition({
      quantity: 100, avgFillPrice: 10, feesGbp: 0, markPrice: 12,
      openedAt, now: new Date('2026-07-02T00:00:00Z'), // ~0.5y
      benchmarkReturnPct: 0.05,
    });
    expect(v.benchmarkValueGbp).not.toBeNull();
    // benchmark over 0.5y on £1000 ≈ £1000 * 1.05^0.5 ≈ £1024.7
    expect(v.benchmarkValueGbp!).toBeGreaterThan(1020);
    expect(v.benchmarkValueGbp!).toBeLessThan(1030);
    // position MV £1200 > benchmark → positive vsBenchmark
    expect(v.vsBenchmarkGbp!).toBeGreaterThan(170);
  });

  it('returns null benchmark when none provided', () => {
    const v = valuePosition({
      quantity: 10, avgFillPrice: 100, feesGbp: 0, markPrice: 100,
      openedAt, now: new Date('2026-02-01T00:00:00Z'),
    });
    expect(v.benchmarkValueGbp).toBeNull();
    expect(v.vsBenchmarkGbp).toBeNull();
  });

  it('does not annualise sub-day holding periods (avoids explosive numbers)', () => {
    const v = valuePosition({
      quantity: 100, avgFillPrice: 10, feesGbp: 0, markPrice: 10.5,
      openedAt, now: new Date('2026-01-01T01:00:00Z'), // 1 hour
    });
    expect(v.annualisedReturnPct).toBeNull();
  });

  it('is deterministic for fixed inputs', () => {
    const args = {
      quantity: 50, avgFillPrice: 20, feesGbp: 3, markPrice: 22,
      openedAt, now: new Date('2026-06-01T00:00:00Z'), benchmarkReturnPct: 0.05,
    };
    const first = valuePosition(args);
    for (let i = 0; i < 20; i++) expect(valuePosition(args)).toEqual(first);
  });
});
