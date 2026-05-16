import { describe, it, expect } from 'vitest';
import { evaluateRisk } from './evaluator';
import type {
  PortfolioState, ProposedAction, RiskProfile,
} from './types';

// Aggressive preset — matches config/risk-profiles.yaml.
const aggressive: RiskProfile = {
  name: 'aggressive',
  maxSinglePositionPct: 0.12,
  maxSpeculativePct: 0.20,
  maxSectorPct: 0.40,
  maxCountryPct: 0.70,
  maxCurrencyPct: 0.80,
  maxDailyLossPct: 0.05,
  maxWeeklyLossPct: 0.10,
  maxMonthlyLossPct: 0.18,
  leverageAllowed: false,
  optionsAllowed: false,
  cryptoCapPct: 0.05,
  cashFloorMonths: 2,
  coolingOffMinutes: 15,
  sleepModeStart: '23:30',
  sleepModeEnd: '06:00',
  newInstrumentSizeCapPct: 0.06,
  liquidityMinAdvGbp: 100000,
  paperTradeDays: 7,
};

const baseline: PortfolioState = {
  totalValueGbp: 50_000,
  existingPositionGbp: 0,
  speculativeExposureGbp: 0,
  cryptoExposureGbp: 0,
  cashBufferGbp: 10_000,
  monthlyExpensesGbp: 2_000,    // floor = 2 months * 2,000 = £4,000
  isaRemainingGbp: 4_400,
};

function action(overrides: Partial<ProposedAction> = {}): ProposedAction {
  return {
    kind: 'buy',
    assetClass: 'developed_equity',
    wrapper: 'isa',
    amountGbp: 500,
    ...overrides,
  };
}

// A daytime UTC instant that's safely outside the UK 23:30-06:00 sleep window.
const DAYTIME_UTC = new Date('2026-05-16T12:00:00Z');
const ctx = { now: DAYTIME_UTC };

describe('evaluateRisk — happy path', () => {
  it('passes a small developed-equity buy in ISA', () => {
    const r = evaluateRisk(action({ amountGbp: 500 }), baseline, aggressive, ctx);
    expect(r.allowed).toBe(true);
    expect(r.blocked).toBe(false);
    expect(r.breachedRules).toHaveLength(0);
    expect(r.riskScore).toBeGreaterThanOrEqual(0);
    expect(r.riskScore).toBeLessThanOrEqual(10);
    expect(r.suggestedAdjustment).toBeNull();
  });

  it('allows a deposit_isa within remaining allowance', () => {
    const r = evaluateRisk(
      action({ kind: 'deposit_isa', amountGbp: 4_000, wrapper: 'isa', assetClass: 'cash' }),
      baseline,
      aggressive,
      ctx,
    );
    expect(r.allowed).toBe(true);
  });

  it('passes a developed-equity buy that uses cash but leaves buffer above the floor', () => {
    // floor = 4000, cash = 10000, action 5000 -> 5000 remaining (>= 4000)
    const r = evaluateRisk(
      action({ kind: 'buy', assetClass: 'developed_equity', amountGbp: 5_000, wrapper: 'gia' }),
      baseline,
      aggressive,
      ctx,
    );
    expect(r.allowed).toBe(true);
  });
});

describe('evaluateRisk — single position cap', () => {
  it('blocks a buy that pushes a single position above 12% on Aggressive', () => {
    const r = evaluateRisk(
      action({ assetClass: 'developed_equity', amountGbp: 7_000, wrapper: 'gia' }),
      { ...baseline, existingPositionGbp: 0 },
      aggressive,
      ctx,
    );
    // 7000 / 50000 = 14% > 12%
    expect(r.blocked).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'max_single_position')).toBeDefined();
    expect(r.suggestedAdjustment).not.toBeNull();
    expect(r.suggestedAdjustment!.newAmountGbp).toBeLessThan(7_000);
    expect(r.suggestedAdjustment!.newAmountGbp).toBeLessThanOrEqual(6_000); // 12% cap
  });

  it('warns when approaching 90% of the single-position cap', () => {
    // 90% of 12% = 10.8% of 50000 = 5400
    const r = evaluateRisk(
      action({ assetClass: 'developed_equity', amountGbp: 5_500, wrapper: 'gia' }),
      baseline,
      aggressive,
      ctx,
    );
    expect(r.allowed).toBe(true);
    expect(r.warnings.length).toBeGreaterThanOrEqual(1);
  });
});

describe('evaluateRisk — speculative cap', () => {
  it('blocks small-cap buy that breaches 20% speculative cap', () => {
    const r = evaluateRisk(
      action({ assetClass: 'small_cap_equity', amountGbp: 4_000, wrapper: 'gia' }),
      { ...baseline, speculativeExposureGbp: 8_000 }, // 8000 + 4000 = 12000 / 50000 = 24%
      aggressive,
      ctx,
    );
    expect(r.blocked).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'max_speculative')).toBeDefined();
    expect(r.requiresApproval).toBe(true); // high-risk class triggers approval
  });

  it('allows a small speculative position that stays within both caps', () => {
    const r = evaluateRisk(
      action({ assetClass: 'small_cap_equity', amountGbp: 1_000, wrapper: 'gia' }),
      { ...baseline, speculativeExposureGbp: 2_000 },
      aggressive,
      ctx,
    );
    // 3000 / 50000 = 6% spec OK; single position 1000 / 50000 = 2% OK.
    expect(r.allowed).toBe(true);
    // Still flagged for approval because asset class is high-risk.
    expect(r.requiresApproval).toBe(true);
  });
});

describe('evaluateRisk — crypto', () => {
  it('blocks a crypto buy that breaches the 5% cap', () => {
    const r = evaluateRisk(
      action({ assetClass: 'crypto', amountGbp: 1_500, wrapper: 'crypto_exchange' }),
      { ...baseline, cryptoExposureGbp: 2_000 }, // 2000 + 1500 = 3500 / 50000 = 7%
      aggressive,
      ctx,
    );
    expect(r.blocked).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'crypto_cap')).toBeDefined();
  });

  it('requires approval for every crypto action, even tiny ones', () => {
    const r = evaluateRisk(
      action({ assetClass: 'crypto', amountGbp: 50, wrapper: 'crypto_exchange' }),
      baseline,
      aggressive,
      ctx,
    );
    // Warn-severity rule fires but does not block — `allowed` stays true.
    expect(r.allowed).toBe(true);
    expect(r.blocked).toBe(false);
    expect(r.requiresApproval).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'requires_approval_crypto_or_derivative')).toBeDefined();
  });

  it('suggests switching asset class as a safer alternative for crypto breaches', () => {
    const r = evaluateRisk(
      action({ assetClass: 'crypto', amountGbp: 5_000, wrapper: 'crypto_exchange' }),
      baseline,
      aggressive,
      ctx,
    );
    expect(r.suggestedSaferAlternative?.kind).toBe('switch_asset_class');
  });
});

describe('evaluateRisk — cash floor', () => {
  it('blocks a buy that drops cash below 2 months of expenses', () => {
    // floor = 2 * 2000 = 4000; cash = 10000; action 7000 -> 3000 remaining < 4000
    const r = evaluateRisk(
      action({ kind: 'buy', amountGbp: 7_000, wrapper: 'gia' }),
      baseline,
      aggressive,
      ctx,
    );
    expect(r.blocked).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'cash_floor')).toBeDefined();
    expect(r.suggestedSaferAlternative?.kind).toBe('split');
  });

  it('skips cash floor for paper trades', () => {
    const r = evaluateRisk(
      action({ kind: 'buy', amountGbp: 9_000, wrapper: 'gia' }),
      baseline,
      aggressive,
      { ...ctx, isPaperTrade: true },
    );
    // Single position cap: 9000 > 12% of 50000 = 6000, so STILL blocks on that rule
    // but NOT on cash_floor.
    expect(r.breachedRules.find((b) => b.rule === 'cash_floor')).toBeUndefined();
  });
});

describe('evaluateRisk — ISA allowance', () => {
  it('blocks an ISA deposit larger than remaining allowance', () => {
    const r = evaluateRisk(
      action({ kind: 'deposit_isa', amountGbp: 5_000, wrapper: 'isa', assetClass: 'cash' }),
      { ...baseline, isaRemainingGbp: 4_400 },
      aggressive,
      ctx,
    );
    expect(r.blocked).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'isa_allowance')).toBeDefined();
    expect(r.suggestedSaferAlternative?.kind).toBe('switch_wrapper');
  });

  it('suggests shrinking the deposit to the remaining allowance', () => {
    const r = evaluateRisk(
      action({ kind: 'deposit_isa', amountGbp: 6_000, wrapper: 'isa', assetClass: 'cash' }),
      { ...baseline, isaRemainingGbp: 4_400 },
      aggressive,
      ctx,
    );
    expect(r.suggestedAdjustment).not.toBeNull();
    expect(r.suggestedAdjustment!.newAmountGbp).toBeLessThanOrEqual(4_400);
  });
});

describe('evaluateRisk — input validation', () => {
  it('reports invalid input when risk profile is missing', () => {
    const r = evaluateRisk(action(), baseline, undefined as unknown as RiskProfile, ctx);
    expect(r.blocked).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'invalid_input')).toBeDefined();
    expect(r.allowed).toBe(false);
  });

  it('rejects zero or negative amounts', () => {
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = evaluateRisk(action({ amountGbp: bad }), baseline, aggressive, ctx);
      expect(r.blocked).toBe(true);
      expect(r.breachedRules[0]!.rule).toBe('invalid_input');
    }
  });

  it('rejects negative portfolio total', () => {
    const r = evaluateRisk(action(), { ...baseline, totalValueGbp: -1 }, aggressive, ctx);
    expect(r.blocked).toBe(true);
    expect(r.breachedRules[0]!.rule).toBe('invalid_input');
  });

  it('rejects a profile with NaN crypto cap', () => {
    const bad: RiskProfile = { ...aggressive, cryptoCapPct: Number.NaN };
    const r = evaluateRisk(action({ assetClass: 'crypto', wrapper: 'crypto_exchange' }), baseline, bad, ctx);
    expect(r.blocked).toBe(true);
    expect(r.breachedRules[0]!.rule).toBe('invalid_input');
  });
});

describe('evaluateRisk — empty portfolio edge case', () => {
  it('handles zero portfolio value without blowing up on percentage rules', () => {
    const r = evaluateRisk(
      action({ kind: 'deposit_isa', amountGbp: 500, wrapper: 'isa', assetClass: 'cash' }),
      { ...baseline, totalValueGbp: 0, existingPositionGbp: 0, cashBufferGbp: 500 },
      aggressive,
      ctx,
    );
    expect(r.blocked).toBe(false);
    expect(r.allowed).toBe(true);
    // Reason line should call out the degenerate case.
    expect(r.reasons.some((s) => s.includes('portfolio is empty'))).toBe(true);
  });

  it('still blocks ISA-allowance breach when portfolio is empty', () => {
    const r = evaluateRisk(
      action({ kind: 'deposit_isa', amountGbp: 25_000, wrapper: 'isa', assetClass: 'cash' }),
      { ...baseline, totalValueGbp: 0, isaRemainingGbp: 20_000 },
      aggressive,
      ctx,
    );
    expect(r.blocked).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'isa_allowance')).toBeDefined();
  });
});

describe('evaluateRisk — derivatives gating', () => {
  it('blocks derivative trades when profile.optionsAllowed=false', () => {
    const r = evaluateRisk(
      action({ assetClass: 'derivative', wrapper: 'gia', amountGbp: 100 }),
      baseline,
      aggressive,
      ctx,
    );
    expect(r.blocked).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'options_disallowed')).toBeDefined();
  });
});

describe('evaluateRisk — sleep mode', () => {
  it('warns (not blocks) on a buy issued during the UK sleep window', () => {
    // 02:00 UTC on a non-DST date = 02:00 UK in winter, well inside 23:30-06:00.
    const middleOfNight = new Date('2026-01-10T02:00:00Z');
    const r = evaluateRisk(action({ assetClass: 'developed_equity', amountGbp: 500, wrapper: 'gia' }),
      baseline, aggressive, { now: middleOfNight });
    expect(r.breachedRules.find((b) => b.rule === 'sleep_mode')).toBeDefined();
    expect(r.requiresApproval).toBe(true);
  });

  it('does not flag sleep mode for daytime actions', () => {
    const r = evaluateRisk(
      action({ assetClass: 'developed_equity', amountGbp: 500, wrapper: 'gia' }),
      baseline,
      aggressive,
      ctx,
    );
    expect(r.breachedRules.find((b) => b.rule === 'sleep_mode')).toBeUndefined();
  });
});

describe('evaluateRisk — determinism', () => {
  it('returns identical results for the same inputs across many calls', () => {
    const a = action({ assetClass: 'small_cap_equity', amountGbp: 2_000, wrapper: 'gia' });
    const p: PortfolioState = { ...baseline, speculativeExposureGbp: 3_000 };
    const first = evaluateRisk(a, p, aggressive, ctx);
    for (let i = 0; i < 50; i++) {
      const r = evaluateRisk(a, p, aggressive, ctx);
      expect(r).toEqual(first);
    }
  });
});
