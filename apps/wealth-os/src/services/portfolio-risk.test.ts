import { describe, it, expect } from 'vitest';
import {
  valuePortfolio, concentrationBreaches, tagExposure,
  computeDrawdown, computeRiskStatus,
  type PositionInput, type ValuedPosition,
} from './portfolio-risk';

function pos(over: Partial<PositionInput> = {}): PositionInput {
  return {
    id: 'p1', label: 'X', quantity: 10, avgCostGbp: 100,
    marketPrice: 110, tags: [], ...over,
  };
}

describe('valuePortfolio', () => {
  it('totals market value, book value, and unrealised P&L', () => {
    const v = valuePortfolio([
      pos({ id: 'a', label: 'A', quantity: 10, avgCostGbp: 100, marketPrice: 110 }),
      pos({ id: 'b', label: 'B', quantity: 20, avgCostGbp: 50,  marketPrice: 45  }),
    ]);
    // A: book 1000, mv 1100; B: book 1000, mv 900
    expect(v.totalBookGbp).toBe(2000);
    expect(v.totalMvGbp).toBe(2000);
    expect(v.totalUnrealisedPnlGbp).toBe(0);
    expect(v.pricedCount).toBe(2);
  });

  it('falls back to book value for unpriced positions', () => {
    const v = valuePortfolio([pos({ marketPrice: null, quantity: 10, avgCostGbp: 100 })]);
    expect(v.totalMvGbp).toBe(1000);
    expect(v.positions[0]!.priced).toBe(false);
    expect(v.unpricedCount).toBe(1);
    expect(v.positions[0]!.unrealisedPnlGbp).toBeNull();
  });

  it('computes weights summing to 1 and sorts by weight descending', () => {
    const v = valuePortfolio([
      pos({ id: 'small', quantity: 1,  avgCostGbp: 100, marketPrice: 100 }),
      pos({ id: 'big',   quantity: 10, avgCostGbp: 100, marketPrice: 100 }),
    ]);
    expect(v.positions[0]!.id).toBe('big');
    const sum = v.positions.reduce((a, p) => a + p.weightPct, 0);
    expect(sum).toBeCloseTo(1, 6);
  });

  it('handles an empty portfolio', () => {
    const v = valuePortfolio([]);
    expect(v.totalMvGbp).toBe(0);
    expect(v.positions).toEqual([]);
  });

  it('is deterministic', () => {
    const input = [
      pos({ id: 'a', quantity: 10, avgCostGbp: 100, marketPrice: 110 }),
      pos({ id: 'b', quantity: 5,  avgCostGbp: 200, marketPrice: 210 }),
    ];
    const first = valuePortfolio(input);
    for (let i = 0; i < 20; i++) expect(valuePortfolio(input)).toEqual(first);
  });
});

describe('concentrationBreaches', () => {
  it('blocks positions above the cap', () => {
    const v = valuePortfolio([
      pos({ id: 'a', label: 'A', quantity: 15, avgCostGbp: 100, marketPrice: 100 }),  // 15% of 100
      pos({ id: 'b', label: 'B', quantity: 85, avgCostGbp: 100, marketPrice: 100 }),
    ]);
    const out = concentrationBreaches(v.positions, 0.10);  // 10% cap
    const blocks = out.filter((b) => b.severity === 'block');
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]!.severity).toBe('block');
  });

  it('warns when a position is in [0.9 * cap, cap]', () => {
    // 95% of total = 95 / 100 → way over. Use a small position.
    const v = valuePortfolio([
      pos({ id: 'a', quantity: 95, avgCostGbp: 1, marketPrice: 1 }),    // 9.5% if total=1000
      pos({ id: 'b', quantity: 1,  avgCostGbp: 1000, marketPrice: 905 }),// dominant 90.5%
    ]);
    // Cap at 0.10 → 'a' is 9.5% (in warn band), 'b' is 90.5% (block).
    const out = concentrationBreaches(v.positions, 0.10);
    expect(out.find((b) => b.positionId === 'a')?.severity).toBe('warn');
    expect(out.find((b) => b.positionId === 'b')?.severity).toBe('block');
  });

  it('returns nothing when all positions are well below cap', () => {
    const v = valuePortfolio(Array.from({ length: 20 }, (_, i) => pos({
      id: `p${i}`, quantity: 50, avgCostGbp: 1, marketPrice: 1,
    })));  // 20 × 5% each
    expect(concentrationBreaches(v.positions, 0.10)).toEqual([]);
  });
});

describe('tagExposure', () => {
  it('sums market value per tag and computes weights', () => {
    const v = valuePortfolio([
      pos({ id: 'a', quantity: 100, avgCostGbp: 1, marketPrice: 1, tags: ['etf', 'defensive'] }),
      pos({ id: 'b', quantity: 100, avgCostGbp: 1, marketPrice: 1, tags: ['stock', 'speculative'] }),
      pos({ id: 'c', quantity: 100, avgCostGbp: 1, marketPrice: 1, tags: ['etf'] }),
    ]);
    const out = tagExposure(v.positions);
    const etf = out.find((t) => t.tag === 'etf');
    expect(etf?.marketValueGbp).toBe(200);
    expect(etf?.weightPct).toBeCloseTo(200 / 300, 6);
    expect(etf?.positionCount).toBe(2);
  });

  it('puts untagged positions into an `_untagged` bucket', () => {
    const v = valuePortfolio([pos({ quantity: 100, avgCostGbp: 1, marketPrice: 1, tags: [] })]);
    const out = tagExposure(v.positions);
    expect(out[0]!.tag).toBe('_untagged');
  });
});

describe('computeDrawdown', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 0, n));

  it('tracks high-water mark and current drawdown', () => {
    const r = computeDrawdown([
      { ts: day(1), totalMvGbp: 100 },
      { ts: day(2), totalMvGbp: 120 },
      { ts: day(3), totalMvGbp: 110 },
    ])!;
    expect(r.highWaterMarkGbp).toBe(120);
    expect(r.currentMvGbp).toBe(110);
    expect(r.drawdownPct).toBeCloseTo((120 - 110) / 120, 6);
    expect(r.daysSinceHwm).toBe(1);
  });

  it('is zero drawdown when current = HWM', () => {
    const r = computeDrawdown([
      { ts: day(1), totalMvGbp: 100 },
      { ts: day(2), totalMvGbp: 120 },
    ])!;
    expect(r.drawdownPct).toBe(0);
  });

  it('handles a falling portfolio (HWM at first snapshot)', () => {
    const r = computeDrawdown([
      { ts: day(1), totalMvGbp: 100 },
      { ts: day(2), totalMvGbp: 70 },
      { ts: day(3), totalMvGbp: 80 },
    ])!;
    expect(r.highWaterMarkGbp).toBe(100);
    expect(r.drawdownPct).toBeCloseTo(0.20, 6);
  });

  it('returns null for an empty series', () => {
    expect(computeDrawdown([])).toBeNull();
  });
});

describe('computeRiskStatus', () => {
  const baseline = {
    concentrationBreaches: [],
    drawdownPct: 0,
    drawdownCautionPct: 0.10,
    drawdownBlockPct: 0.20,
    cashBufferGbp: 12000,
    cashFloorGbp: 6000,
    toxicDebtCount: 0,
    businessObligationsDue90dGbp: 0,
    businessCashGbp: 0,
  };

  it('is "clear" with no breaches', () => {
    expect(computeRiskStatus(baseline).status).toBe('clear');
  });

  it('is "caution" on warn-level signals only', () => {
    const r = computeRiskStatus({ ...baseline, drawdownPct: 0.12, toxicDebtCount: 1 });
    expect(r.status).toBe('caution');
    expect(r.reasons.find((x) => x.rule === 'drawdown_caution')).toBeDefined();
    expect(r.reasons.find((x) => x.rule === 'toxic_debt')).toBeDefined();
  });

  it('is "blocked" when drawdown hits the block threshold', () => {
    const r = computeRiskStatus({ ...baseline, drawdownPct: 0.22 });
    expect(r.status).toBe('blocked');
    expect(r.reasons.find((x) => x.rule === 'drawdown_block')).toBeDefined();
  });

  it('is "blocked" when business obligations exceed business cash', () => {
    const r = computeRiskStatus({ ...baseline, businessObligationsDue90dGbp: 5000, businessCashGbp: 2000 });
    expect(r.status).toBe('blocked');
  });

  it('is "blocked" when cash buffer is below floor', () => {
    const r = computeRiskStatus({ ...baseline, cashBufferGbp: 1000, cashFloorGbp: 6000 });
    expect(r.status).toBe('blocked');
  });

  it('is deterministic across calls', () => {
    const input = { ...baseline, drawdownPct: 0.12 };
    const first = computeRiskStatus(input);
    for (let i = 0; i < 20; i++) expect(computeRiskStatus(input)).toEqual(first);
  });
});
