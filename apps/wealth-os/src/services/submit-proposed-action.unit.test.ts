import { describe, it, expect } from 'vitest';
import {
  decideOnProposedAction,
  type SubmitInput,
} from './submit-proposed-action';
import type { PortfolioState, ProposedAction, RiskProfile } from '../risk/types';

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

const portfolio: PortfolioState = {
  totalValueGbp: 50_000,
  existingPositionGbp: 0,
  speculativeExposureGbp: 0,
  cryptoExposureGbp: 0,
  cashBufferGbp: 10_000,
  monthlyExpensesGbp: 2_000,
  isaRemainingGbp: 4_400,
};

const safeAction: ProposedAction = {
  kind: 'buy',
  assetClass: 'developed_equity',
  wrapper: 'isa',
  amountGbp: 500,
};

const blockingAction: ProposedAction = {
  kind: 'buy',
  assetClass: 'developed_equity',
  wrapper: 'gia',
  amountGbp: 7_000, // breaches 12% single-position cap on £50k
};

const DAYTIME = new Date('2026-05-16T12:00:00Z');

function makeInput(overrides: Partial<SubmitInput> = {}): SubmitInput {
  return {
    userId: 'user-1',
    agent: 'wealth-cashflow',
    dbKind: 'allocation_change',
    action: safeAction,
    portfolio,
    caller: { confidence: 0.8 },
    context: { now: DAYTIME },
    ...overrides,
  };
}

describe('decideOnProposedAction', () => {
  it('returns an insert decision with a row-ready payload for a safe action', () => {
    const d = decideOnProposedAction({
      input: makeInput(),
      profile: aggressive,
      mode: 'advisor',
      now: DAYTIME,
    });

    expect(d.kind).toBe('insert');
    if (d.kind !== 'insert') return;
    expect(d.evaluation.allowed).toBe(true);
    expect(d.values.userId).toBe('user-1');
    expect(d.values.agent).toBe('wealth-cashflow');
    expect(d.values.status).toBe('pending');
    expect(d.values.amountAtRisk).toBe('500');
    expect(d.values.confidence).toBe('0.8');
    expect(d.values.expiresAt).toBeInstanceOf(Date);
  });

  it('blocks a single-position-cap breach with a human-readable reason', () => {
    const d = decideOnProposedAction({
      input: makeInput({ action: blockingAction, dbKind: 'trade' }),
      profile: aggressive,
      mode: 'advisor',
      now: DAYTIME,
    });

    expect(d.kind).toBe('block');
    if (d.kind !== 'block') return;
    expect(d.evaluation.blocked).toBe(true);
    expect(d.evaluation.breachedRules.some((b) => b.rule === 'max_single_position')).toBe(true);
    expect(d.reason).toContain('max_single_position');
  });

  it('returns observer_mode without an insert payload when mode=observer', () => {
    const d = decideOnProposedAction({
      input: makeInput(),
      profile: aggressive,
      mode: 'observer',
      now: DAYTIME,
    });

    expect(d.kind).toBe('observer_mode');
    if (d.kind !== 'observer_mode') return;
    expect(d.evaluation.allowed).toBe(true); // evaluator still ran
    expect(d.reason).toMatch(/observer/);
  });

  it('attaches suggested adjustment + alternative when the evaluator provides them', () => {
    // ISA deposit larger than allowance: evaluator suggests reduce_amount +
    // switch_wrapper alternative, but the overall action is blocked.
    const d = decideOnProposedAction({
      input: makeInput({
        agent: 'wealth-isa',
        action: { kind: 'deposit_isa', assetClass: 'cash', wrapper: 'isa', amountGbp: 6_000 },
        portfolio: { ...portfolio, isaRemainingGbp: 4_400 },
        caller: { confidence: 0.9 },
      }),
      profile: aggressive,
      mode: 'advisor',
      now: DAYTIME,
    });

    expect(d.kind).toBe('block');
    if (d.kind !== 'block') return;
    expect(d.evaluation.suggestedAdjustment?.newAmountGbp).toBeLessThanOrEqual(4_400);
    expect(d.evaluation.suggestedSaferAlternative?.kind).toBe('switch_wrapper');
  });

  it('respects custom expiresInMinutes', () => {
    const d = decideOnProposedAction({
      input: makeInput({ caller: { confidence: 0.5, expiresInMinutes: 30 } }),
      profile: aggressive,
      mode: 'advisor',
      now: DAYTIME,
    });
    if (d.kind !== 'insert') throw new Error('expected insert');
    const minutes = ((d.values.expiresAt as Date).getTime() - DAYTIME.getTime()) / 60_000;
    expect(minutes).toBe(30);
  });

  it('joins extraReason with evaluator reasons, both filtered for truthiness', () => {
    const d = decideOnProposedAction({
      input: makeInput({
        caller: { confidence: 0.5, extraReason: 'Caller note for context.' },
      }),
      profile: aggressive,
      mode: 'advisor',
      now: DAYTIME,
    });
    if (d.kind !== 'insert') throw new Error('expected insert');
    expect(d.values.reason).toMatch(/^Caller note for context\./);
  });
});
