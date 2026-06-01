import { describe, it, expect } from 'vitest';
import { evaluateRisk } from './evaluator';
import type {
  PortfolioState, ProposedAction, RiskProfile,
} from './types';

// Aggressive preset — matches config/risk-profiles.yaml (post-review).
// NOTE: these match the *post-review* tighter caps. Tests below use a
// £50,000 portfolio so the standard caps apply unless small-portfolio
// behaviour is being exercised explicitly.
const aggressive: RiskProfile = {
  name: 'aggressive',
  maxSinglePositionPct: 0.10,
  maxSinglePositionSmallPortfolioPct: 0.05,
  maxSpeculativePct: 0.15,
  maxSpeculativeUntilBufferHealthyPct: 0.05,
  maxSectorPct: 0.40,
  maxCountryPct: 0.70,
  maxCurrencyPct: 0.80,
  maxDailyLossPct: 0.05,
  maxWeeklyLossPct: 0.10,
  maxMonthlyLossPct: 0.18,
  leverageAllowed: false,
  optionsAllowed: false,
  cryptoCapPct: 0.03,
  cryptoRequiresBuffer: true,
  cryptoRequiresNoToxicDebt: true,
  cashFloorMonths: 6,
  businessReserveFloorMonths: 3,
  coolingOffMinutes: 15,
  sleepModeStart: '23:30',
  sleepModeEnd: '06:00',
  newInstrumentSizeCapPct: 0.04,
  liquidityMinAdvGbp: 100000,
  paperTradeDays: 7,
  drawdownCautionPct: 0.10,
  drawdownBlockPct: 0.20,
};

const baseline: PortfolioState = {
  totalValueGbp: 50_000,
  existingPositionGbp: 0,
  speculativeExposureGbp: 0,
  cryptoExposureGbp: 0,
  cashBufferGbp: 14_000,        // above the 6-month floor of 12,000
  monthlyExpensesGbp: 2_000,    // floor = 6 months * 2,000 = £12,000 on aggressive
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
    // floor = 12,000 (6 mo × 2,000), cash = 14,000 -> after 1,800 buy = 12,200 (>= 12,000)
    // 1,800 < 10% of 50,000 = 5,000 single-position cap.
    const r = evaluateRisk(
      action({ kind: 'buy', assetClass: 'developed_equity', amountGbp: 1_800, wrapper: 'gia' }),
      baseline,
      aggressive,
      ctx,
    );
    expect(r.allowed).toBe(true);
  });
});

describe('evaluateRisk — single position cap', () => {
  it('blocks a buy that pushes a single position above 10% on Aggressive', () => {
    const r = evaluateRisk(
      action({ assetClass: 'developed_equity', amountGbp: 6_000, wrapper: 'gia' }),
      { ...baseline, existingPositionGbp: 0 },
      aggressive,
      ctx,
    );
    // 6000 / 50000 = 12% > 10% mature cap
    expect(r.blocked).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'max_single_position')).toBeDefined();
    expect(r.suggestedAdjustment).not.toBeNull();
    expect(r.suggestedAdjustment!.newAmountGbp).toBeLessThan(6_000);
    expect(r.suggestedAdjustment!.newAmountGbp).toBeLessThanOrEqual(5_000); // 10% cap
  });

  it('applies the tighter small-portfolio cap when portfolio is under £25k', () => {
    // Aggressive small-portfolio cap is 5%. £4,000 portfolio, £400 buy = 10% > 5%.
    const smallPortfolio: typeof baseline = {
      ...baseline,
      totalValueGbp: 4_000,
      cashBufferGbp: 14_000,
    };
    const r = evaluateRisk(
      action({ assetClass: 'developed_equity', amountGbp: 400, wrapper: 'gia' }),
      smallPortfolio,
      aggressive,
      ctx,
    );
    expect(r.blocked).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'max_single_position_small_portfolio')).toBeDefined();
  });

  it('warns when approaching 90% of the single-position cap', () => {
    // 90% of 10% = 9% of 50,000 = 4,500. Use 4,800 → 9.6%.
    // Paper-trade mode so the cash-floor check doesn't dominate the result.
    const r = evaluateRisk(
      action({ assetClass: 'developed_equity', amountGbp: 4_800, wrapper: 'gia' }),
      baseline,
      aggressive,
      { ...ctx, isPaperTrade: true },
    );
    expect(r.allowed).toBe(true);
    expect(r.warnings.length).toBeGreaterThanOrEqual(1);
  });
});

describe('evaluateRisk — speculative cap', () => {
  it('blocks small-cap buy that breaches the 15% speculative cap', () => {
    // baseline cash 14k > floor 12k → standard 15% cap applies.
    // existing spec 6000 + 2500 = 8500 / 50000 = 17% > 15%.
    const r = evaluateRisk(
      action({ assetClass: 'small_cap_equity', amountGbp: 2_500, wrapper: 'gia' }),
      { ...baseline, speculativeExposureGbp: 6_000 },
      aggressive,
      ctx,
    );
    expect(r.blocked).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'max_speculative')).toBeDefined();
    expect(r.requiresApproval).toBe(true);
  });

  it('applies tighter 5% speculative cap until cash buffer is at the floor', () => {
    // cash 6,000 < floor 12,000 (6 mo × 2,000) → tight cap applies.
    // Even a £500 speculative buy on a 0-spec baseline = 1% — fine. So push
    // existing spec to 2,000, add 600 → 2,600 / 50,000 = 5.2% > 5%.
    const r = evaluateRisk(
      action({ assetClass: 'small_cap_equity', amountGbp: 600, wrapper: 'gia' }),
      { ...baseline, cashBufferGbp: 6_000, speculativeExposureGbp: 2_000 },
      aggressive,
      ctx,
    );
    expect(r.blocked).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'max_speculative_until_buffer_healthy')).toBeDefined();
  });

  it('allows a small speculative position that stays within both caps', () => {
    const r = evaluateRisk(
      action({ assetClass: 'small_cap_equity', amountGbp: 1_000, wrapper: 'gia' }),
      { ...baseline, speculativeExposureGbp: 2_000 },
      aggressive,
      ctx,
    );
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBe(true);
  });
});

describe('evaluateRisk — crypto', () => {
  it('blocks a crypto buy that breaches the 3% cap', () => {
    // baseline has cashBuffer 14k > floor 12k → buffer gate does NOT fire.
    // 1,000 + 600 = 1,600 / 50,000 = 3.2% > 3%.
    const r = evaluateRisk(
      action({ assetClass: 'crypto', amountGbp: 600, wrapper: 'crypto_exchange' }),
      { ...baseline, cryptoExposureGbp: 1_000 },
      aggressive,
      ctx,
    );
    expect(r.blocked).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'crypto_cap')).toBeDefined();
  });

  it('blocks any crypto action while cash buffer is below floor', () => {
    const r = evaluateRisk(
      action({ assetClass: 'crypto', amountGbp: 50, wrapper: 'crypto_exchange' }),
      { ...baseline, cashBufferGbp: 6_000 }, // 6k < 12k floor
      aggressive,
      ctx,
    );
    expect(r.blocked).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'crypto_requires_buffer')).toBeDefined();
    expect(r.suggestedSaferAlternative?.kind).toBe('wait');
  });

  it('blocks crypto while any debt is above the toxic-debt APR (6%)', () => {
    const r = evaluateRisk(
      action({ assetClass: 'crypto', amountGbp: 50, wrapper: 'crypto_exchange' }),
      { ...baseline, highestDebtAprPct: 0.18 }, // credit-card-style debt
      aggressive,
      ctx,
    );
    expect(r.blocked).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'crypto_requires_no_toxic_debt')).toBeDefined();
    expect(r.suggestedSaferAlternative?.kind).toBe('switch_asset_class');
  });

  it('requires approval for every crypto action, even tiny ones', () => {
    const r = evaluateRisk(
      action({ assetClass: 'crypto', amountGbp: 50, wrapper: 'crypto_exchange' }),
      baseline,
      aggressive,
      ctx,
    );
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
  it('blocks a buy that drops cash below the 6-month floor', () => {
    // Aggressive floor = 6 × 2,000 = 12,000. Cash 14,000.
    // A 4,500 buy leaves 9,500 < 12,000.
    // 4,500 = 9% < 10% single-position cap, so cash_floor is the only block.
    const r = evaluateRisk(
      action({ kind: 'buy', amountGbp: 4_500, wrapper: 'gia' }),
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
      action({ kind: 'buy', amountGbp: 4_500, wrapper: 'gia' }),
      baseline,
      aggressive,
      { ...ctx, isPaperTrade: true },
    );
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

describe('evaluateRisk — business reserve gate (review §10.2)', () => {
  it('blocks personal risk-up when business obligations exceed business cash', () => {
    const r = evaluateRisk(
      action({ kind: 'buy', assetClass: 'developed_equity', amountGbp: 1_500, wrapper: 'gia' }),
      {
        ...baseline,
        businessCashGbp: 2_000,
        businessObligationsDue90dGbp: 5_000,   // VAT + payroll + supplier due
      },
      aggressive,
      ctx,
    );
    expect(r.blocked).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'business_obligations_unpaid')).toBeDefined();
    expect(r.suggestedSaferAlternative?.kind).toBe('wait');
  });

  it('does not gate ISA contributions on business obligations (ISA is the disciplined path)', () => {
    const r = evaluateRisk(
      action({ kind: 'deposit_isa', assetClass: 'cash', amountGbp: 500, wrapper: 'isa' }),
      {
        ...baseline,
        businessCashGbp: 2_000,
        businessObligationsDue90dGbp: 5_000,
      },
      aggressive,
      ctx,
    );
    expect(r.breachedRules.find((b) => b.rule === 'business_obligations_unpaid')).toBeUndefined();
  });

  it('warns (not blocks) when business cash is below the fixed-cost reserve floor', () => {
    const r = evaluateRisk(
      action({ kind: 'buy', assetClass: 'developed_equity', amountGbp: 1_500, wrapper: 'gia' }),
      {
        ...baseline,
        businessCashGbp: 1_000,
        businessMonthlyFixedGbp: 1_500,        // 3 mo floor = 4,500 > 1,000
      },
      aggressive,
      ctx,
    );
    expect(r.breachedRules.find((b) => b.rule === 'business_reserve_floor')).toBeDefined();
    expect(r.blocked).toBe(false); // warn-severity, not block
    expect(r.requiresApproval).toBe(true);
  });
});

describe('evaluateRisk — drawdown gate', () => {
  it('blocks risk-up at or above the block threshold (20%)', () => {
    const r = evaluateRisk(
      action({ kind: 'buy', assetClass: 'developed_equity', amountGbp: 500, wrapper: 'gia' }),
      { ...baseline, portfolioDrawdownPct: 0.22 },
      aggressive,
      ctx,
    );
    expect(r.blocked).toBe(true);
    expect(r.breachedRules.find((b) => b.rule === 'drawdown_block')).toBeDefined();
    expect(r.suggestedSaferAlternative?.kind).toBe('wait');
  });

  it('warns between caution and block thresholds', () => {
    const r = evaluateRisk(
      action({ kind: 'buy', assetClass: 'developed_equity', amountGbp: 500, wrapper: 'gia' }),
      { ...baseline, portfolioDrawdownPct: 0.12 },
      aggressive,
      ctx,
    );
    expect(r.breachedRules.find((b) => b.rule === 'drawdown_caution')?.severity).toBe('warn');
    expect(r.blocked).toBe(false);
    expect(r.requiresApproval).toBe(true);
  });

  it('does not gate ISA cash deposits even in drawdown (keep contributing)', () => {
    const r = evaluateRisk(
      action({ kind: 'deposit_isa', assetClass: 'cash', amountGbp: 500, wrapper: 'isa' }),
      { ...baseline, portfolioDrawdownPct: 0.25 },
      aggressive,
      ctx,
    );
    expect(r.breachedRules.find((b) => b.rule === 'drawdown_block')).toBeUndefined();
  });

  it('no gate when portfolioDrawdownPct is not provided', () => {
    const r = evaluateRisk(
      action({ kind: 'buy', assetClass: 'developed_equity', amountGbp: 500, wrapper: 'gia' }),
      baseline,
      aggressive,
      ctx,
    );
    expect(r.breachedRules.find((b) => b.rule === 'drawdown_block')).toBeUndefined();
    expect(r.breachedRules.find((b) => b.rule === 'drawdown_caution')).toBeUndefined();
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
