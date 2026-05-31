import { describe, it, expect } from 'vitest';
import { buildDefaultPlan, compareToDefaultPlan } from './default-plan';
import type { FinanceSnapshot } from '../lib/finance';

function snap(overrides: Partial<FinanceSnapshot> = {}): FinanceSnapshot {
  return {
    user: { id: 'u', email: 'a@b.c', name: 'Test', onboardedAt: new Date() },
    accountsByType: {},
    netWorthGbp: 0,
    cashGbp: 12_000,
    isaValueGbp: 0,
    giaValueGbp: 0,
    businessGbp: 0,
    debtGbp: 0,
    highestDebtAprPct: 0,
    toxicDebtCount: 0,
    monthlyIncomeGbp: 4_000,
    monthlyExpensesGbp: 2_000,        // £2,000 spare/month
    isa: { taxYear: 2026, allowance: 20_000, deposited: 0, remaining: 20_000 },
    activeRiskProfile: { name: 'aggressive', cashFloorMonths: 6, businessReserveFloorMonths: 3 },
    activeAllocation: { preset: 'aggressive', weights: {} },
    goals: [],
    pendingApprovals: 0,
    business: { cashGbp: 0, obligationsDue90dGbp: 0, obligationsTotalUnpaidGbp: 0, monthlyFixedGbp: 0, runwayMonths: null },
    insurance: { activePolicies: 0, hasIncomeProtection: false, hasLife: false, hasWill: false },
    ...overrides,
  };
}

describe('buildDefaultPlan', () => {
  it('prioritises the emergency fund when the buffer is below floor', () => {
    // cash 4,000 vs floor 12,000 (6 × 2,000) → gap 8,000
    const plan = buildDefaultPlan(snap({ cashGbp: 4_000 }));
    expect(plan.steps[0]!.id).toBe('emergency_fund');
    expect(plan.steps[0]!.monthlyGbp).toBeGreaterThan(0);
  });

  it('throws spare at toxic debt before investing', () => {
    const plan = buildDefaultPlan(snap({
      cashGbp: 12_000,           // buffer already met
      toxicDebtCount: 1,
      highestDebtAprPct: 0.22,
    }));
    const debtStep = plan.steps.find((s) => s.id === 'clear_toxic_debt');
    expect(debtStep).toBeDefined();
    expect(debtStep!.expectedReturnPct).toBeCloseTo(0.22, 4);
    // With toxic debt present, no ISA step should appear (all spare goes to debt).
    expect(plan.steps.find((s) => s.id === 'isa_core')).toBeUndefined();
  });

  it('routes to ISA core when buffer met and no toxic debt', () => {
    const plan = buildDefaultPlan(snap({ cashGbp: 12_000 }));
    expect(plan.steps.find((s) => s.id === 'isa_core')).toBeDefined();
  });

  it('falls back to GIA surplus when ISA allowance is exhausted', () => {
    const plan = buildDefaultPlan(snap({
      cashGbp: 12_000,
      isa: { taxYear: 2026, allowance: 20_000, deposited: 20_000, remaining: 0 },
    }));
    expect(plan.steps.find((s) => s.id === 'isa_core')).toBeUndefined();
    expect(plan.steps.find((s) => s.id === 'invest_surplus')).toBeDefined();
  });

  it('computes a blended return weighted by allocation', () => {
    const plan = buildDefaultPlan(snap({ cashGbp: 12_000 }));
    expect(plan.blendedReturnPct).toBeGreaterThan(0);
    expect(plan.blendedReturnPct).toBeLessThanOrEqual(0.05);
  });

  it('allocates nothing when there is no spare cash', () => {
    const plan = buildDefaultPlan(snap({ monthlyIncomeGbp: 2_000, monthlyExpensesGbp: 2_000 }));
    expect(plan.monthlySpareGbp).toBe(0);
    expect(plan.steps).toHaveLength(0);
    expect(plan.blendedReturnPct).toBe(0);
  });

  it('is deterministic', () => {
    const s = snap({ cashGbp: 8_000, toxicDebtCount: 0 });
    const first = buildDefaultPlan(s);
    for (let i = 0; i < 20; i++) expect(buildDefaultPlan(s)).toEqual(first);
  });
});

describe('compareToDefaultPlan', () => {
  const plan = buildDefaultPlan(snap({ cashGbp: 12_000 })); // blended ~5% equity-heavy

  it('says default is better when the proposal underperforms', () => {
    const c = compareToDefaultPlan(0.02, plan);
    expect(c.verdict).toBe('default_is_better');
  });

  it('says roughly equal within the margin', () => {
    const c = compareToDefaultPlan(plan.blendedReturnPct + 0.01, plan);
    expect(c.verdict).toBe('roughly_equal');
  });

  it('says proposal is better when it clears the margin', () => {
    const c = compareToDefaultPlan(plan.blendedReturnPct + 0.05, plan);
    expect(c.verdict).toBe('proposal_is_better');
  });
});
