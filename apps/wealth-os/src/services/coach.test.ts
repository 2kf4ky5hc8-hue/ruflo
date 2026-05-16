import { describe, it, expect, vi } from 'vitest';
import { buildCoachReport, buildNarratorPrompt, runCoach, type Narrator } from './coach';
import type { FinanceSnapshot } from '../lib/finance';
import { TaxRulesSchema, type TaxRules } from '../tax/types';

// 2025/26 fixture — same numbers as tax helpers tests so we trust the math.
const rules: TaxRules = TaxRulesSchema.parse({
  version: 'coach-test-2025-26',
  jurisdiction: 'GB',
  tax_year: {
    current_starts_on: '2025-04-06',
    current_ends_on: '2026-04-05',
    number: 2025,
  },
  isa: {
    total_allowance_gbp: 20_000,
    junior_isa_allowance_gbp: 9_000,
    lifetime_isa_allowance_gbp: 4_000,
    lifetime_isa_bonus_pct: 0.25,
    lifetime_isa_age_min: 18,
    lifetime_isa_age_max_open: 39,
    lifetime_isa_age_max_contrib: 49,
    flexible_isa_replacements_allowed_same_year: true,
    multiple_same_type_isas_allowed: true,
    partial_transfers_current_year_allowed: true,
    eligible_investments: [],
    ineligible_examples: [],
  },
  income_tax_england_wales_ni: {
    personal_allowance_gbp: 12_570,
    personal_allowance_taper_starts_gbp: 100_000,
    personal_allowance_fully_lost_at_gbp: 125_140,
    basic_rate_pct: 0.20,
    basic_rate_band_upper_gbp: 50_270,
    higher_rate_pct: 0.40,
    higher_rate_band_upper_gbp: 125_140,
    additional_rate_pct: 0.45,
  },
  dividend_tax: { allowance_gbp: 500, basic_rate_pct: 0.0875, higher_rate_pct: 0.3375, additional_rate_pct: 0.3935 },
  capital_gains_tax: {
    annual_exempt_amount_gbp: 3_000,
    rates: {
      basic_taxpayer_other_assets_pct: 0.10,
      higher_taxpayer_other_assets_pct: 0.20,
      basic_taxpayer_residential_pct: 0.18,
      higher_taxpayer_residential_pct: 0.24,
    },
  },
  national_insurance: { class_1_primary_threshold_gbp: 12_570, class_1_main_rate_pct: 0.08, class_1_upper_earnings_limit_gbp: 50_270, class_1_above_uel_pct: 0.02 },
  corporation_tax: { small_profits_rate_pct: 0.19, small_profits_threshold_gbp: 50_000, main_rate_pct: 0.25, main_rate_threshold_gbp: 250_000, marginal_relief_fraction: 0.015 },
  pension: { annual_allowance_gbp: 60_000, money_purchase_annual_allowance_gbp: 10_000, taper_starts_adjusted_income_gbp: 260_000, taper_floor_annual_allowance_gbp: 10_000, carry_forward_years: 3, lifetime_allowance_abolished: true },
  reminders: [],
  disclaimers: { primary: 'test' },
});

const NOW = new Date('2026-05-16T12:00:00Z');

function snapshot(overrides: Partial<FinanceSnapshot> = {}): FinanceSnapshot {
  return {
    user: { id: 'user-1', email: 'a@b.test', name: 'Owner', onboardedAt: new Date('2026-01-01') },
    accountsByType: { cash: 6_000, isa: 8_000 },
    netWorthGbp: 60_000,
    cashGbp: 6_000,
    isaValueGbp: 8_000,
    giaValueGbp: 0,
    businessGbp: 0,
    debtGbp: 0,
    monthlyIncomeGbp: 4_500,
    monthlyExpensesGbp: 2_500,
    isa: { taxYear: 2026, allowance: 20_000, deposited: 8_000, remaining: 12_000 },
    activeRiskProfile: { name: 'aggressive', cashFloorMonths: 2 },
    activeAllocation: { preset: 'aggressive', weights: { isa: 0.4, higher_risk: 0.2 } },
    goals: [{ id: 'g1', name: 'House deposit', target: 40_000, current: 5_000, targetDate: null }],
    pendingApprovals: 0,
    ...overrides,
  };
}

describe('buildCoachReport — deterministic snapshot', () => {
  it('produces the expected position numbers from a healthy snapshot', () => {
    const r = buildCoachReport({ snap: snapshot(), rules, now: NOW });

    expect(r.position.netWorthGbp).toBe(60_000);
    expect(r.position.cashGbp).toBe(6_000);
    expect(r.position.cashMonthsBuffer).toBe(2.4);
    expect(r.position.investmentGbp).toBe(8_000);
    expect(r.position.debtGbp).toBe(0);
    expect(r.position.isaRemainingGbp).toBe(12_000);
    expect(r.position.monthlySpareGbp).toBe(2_000);
    expect(r.position.pendingApprovals).toBe(0);
  });

  it('always includes the disclaimer + tax rules version + confidence', () => {
    const r = buildCoachReport({ snap: snapshot(), rules, now: NOW });
    expect(r.disclaimer).toMatch(/Decision-support/i);
    expect(r.taxRulesVersion).toBe('coach-test-2025-26');
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });
});

describe('buildCoachReport — risks', () => {
  it('flags cash below floor as a warning', () => {
    const r = buildCoachReport({
      snap: snapshot({ cashGbp: 3_000, monthlyExpensesGbp: 2_500 }), // 1.2 mo vs 2 mo floor
      rules,
      now: NOW,
    });
    const risk = r.risks.find((x) => x.rule === 'cash_floor');
    expect(risk).toBeDefined();
    expect(risk!.severity).toBe('warn');
  });

  it('escalates to block when cash is below half the floor', () => {
    const r = buildCoachReport({
      snap: snapshot({ cashGbp: 1_000, monthlyExpensesGbp: 2_500 }), // 0.4 mo vs 2 mo floor
      rules,
      now: NOW,
    });
    const risk = r.risks.find((x) => x.rule === 'cash_floor');
    expect(risk?.severity).toBe('block');
  });

  it('flags ISA year-end urgency only inside the 30-day window', () => {
    const farFromYearEnd = buildCoachReport({ snap: snapshot(), rules, now: new Date('2026-05-16') });
    expect(farFromYearEnd.risks.find((r) => r.rule === 'isa_year_end')).toBeUndefined();

    const insideWindow = buildCoachReport({ snap: snapshot(), rules, now: new Date('2027-03-20') });
    expect(insideWindow.risks.find((r) => r.rule === 'isa_year_end')).toBeDefined();
  });

  it('reports pending approvals when there are any', () => {
    const r = buildCoachReport({ snap: snapshot({ pendingApprovals: 2 }), rules, now: NOW });
    expect(r.risks.find((x) => x.rule === 'pending_approvals')?.message).toContain('2 proposals');
  });
});

describe('buildCoachReport — suggested actions', () => {
  it('returns at most 3, all informational-only, never executable', () => {
    const r = buildCoachReport({
      snap: snapshot({
        cashGbp: 1_000,
        monthlyExpensesGbp: 2_500,
        pendingApprovals: 1,
      }),
      rules,
      now: NOW,
    });
    expect(r.suggestedActions.length).toBeLessThanOrEqual(3);
    for (const a of r.suggestedActions) {
      expect(a.informationalOnly).toBe(true);
    }
  });

  it('suggests building the emergency fund when cash is short', () => {
    const r = buildCoachReport({
      snap: snapshot({ cashGbp: 1_000, monthlyExpensesGbp: 2_500 }),
      rules,
      now: NOW,
    });
    expect(r.suggestedActions.some((a) => /emergency fund/i.test(a.title))).toBe(true);
  });

  it('suggests using the ISA when allowance remains and there is monthly spare', () => {
    const r = buildCoachReport({ snap: snapshot(), rules, now: NOW });
    expect(r.suggestedActions.some((a) => /ISA/i.test(a.title))).toBe(true);
  });
});

describe('buildCoachReport — missing data & confidence', () => {
  it('lists every missing input when the snapshot is sparse', () => {
    const sparse: FinanceSnapshot = {
      user: { id: 'u', email: '', name: '', onboardedAt: null },
      accountsByType: {},
      netWorthGbp: 0, cashGbp: 0, isaValueGbp: 0, giaValueGbp: 0, businessGbp: 0, debtGbp: 0,
      monthlyIncomeGbp: 0, monthlyExpensesGbp: 0,
      isa: null, activeRiskProfile: null, activeAllocation: null,
      goals: [], pendingApprovals: 0,
    };
    const r = buildCoachReport({ snap: sparse, rules, now: NOW });
    expect(r.missingData.length).toBeGreaterThanOrEqual(4);
    expect(r.confidence).toBeLessThan(0.8);
  });

  it('is high-confidence with a complete snapshot', () => {
    const r = buildCoachReport({ snap: snapshot(), rules, now: NOW });
    expect(r.confidence).toBeGreaterThanOrEqual(0.9);
  });
});

describe('buildCoachReport — guardrails ("do not")', () => {
  it('always includes a non-empty do-not list', () => {
    const r = buildCoachReport({ snap: snapshot(), rules, now: NOW });
    expect(r.doNot.length).toBeGreaterThan(0);
    expect(r.doNot.join(' ')).toMatch(/leverage/i);
  });
});

describe('buildNarratorPrompt', () => {
  it('builds a system prompt that forbids inventing numbers and recommending trades', () => {
    const r = buildCoachReport({ snap: snapshot(), rules, now: NOW });
    const p = buildNarratorPrompt(r);
    expect(p.systemPrompt).toMatch(/never invent or change numbers/i);
    expect(p.systemPrompt).toMatch(/do not recommend specific trades/i);
    expect(p.systemPrompt).toMatch(/decision-support/i);
    // Numbers from the report should appear in the user prompt (the JSON).
    expect(p.userPrompt).toContain('"netWorthGbp"');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Orchestrator — tested with an in-memory DB stub + an injectable narrator.
// No Postgres needed.

interface FakeDb {
  inserts: Array<{ table: string; values: any }>;
  updates: Array<{ table: string; values: any; where: any }>;
}

function fakeDb(opts: { spentRows?: Array<{ costUsd: string | null }> } = {}): { db: any; sink: FakeDb } {
  const sink: FakeDb = { inserts: [], updates: [] };
  const spentRows = opts.spentRows ?? [];
  let nextId = 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    select(_cols?: any) {
      return {
        from(_table: any) {
          return {
            where(_w: any) {
              return Promise.resolve(spentRows);
            },
          };
        },
      };
    },
    insert(_table: any) {
      return {
        values(values: any) {
          sink.inserts.push({ table: String(_table), values });
          return {
            returning(_cols: any) {
              const id = `fake-${nextId++}`;
              return Promise.resolve([{ id }]);
            },
          };
        },
      };
    },
    update(_table: any) {
      return {
        set(values: any) {
          return {
            where(where: any) {
              sink.updates.push({ table: String(_table), values, where });
              const p = Promise.resolve([]);
              (p as any).catch = (cb: any) => p.then(undefined, cb);
              return p;
            },
          };
        },
      };
    },
  };
  return { db, sink };
}

// Stub loadSnapshot via module mock so the orchestrator runs without DB.
vi.mock('../lib/finance', async () => {
  const actual = await vi.importActual<typeof import('../lib/finance')>('../lib/finance');
  return {
    ...actual,
    loadSnapshot: vi.fn(async () => ({
      user: { id: 'user-1', email: 'a@b.test', name: 'Owner', onboardedAt: new Date('2026-01-01') },
      accountsByType: { cash: 6_000, isa: 8_000 },
      netWorthGbp: 60_000,
      cashGbp: 6_000,
      isaValueGbp: 8_000,
      giaValueGbp: 0,
      businessGbp: 0,
      debtGbp: 0,
      monthlyIncomeGbp: 4_500,
      monthlyExpensesGbp: 2_500,
      isa: { taxYear: 2026, allowance: 20_000, deposited: 8_000, remaining: 12_000 },
      activeRiskProfile: { name: 'aggressive', cashFloorMonths: 2 },
      activeAllocation: { preset: 'aggressive', weights: { isa: 0.4 } },
      goals: [],
      pendingApprovals: 0,
    })),
  };
});

describe('runCoach orchestrator', () => {
  it('returns the report without persisting in observer mode', async () => {
    const { db, sink } = fakeDb();
    const out = await runCoach({ db, userId: 'user-1', now: NOW, modeOverride: 'observer' });

    expect(out.observerMode).toBe(true);
    expect(out.reportId).toBeNull();
    expect(out.agentRunId).toBeNull();
    expect(sink.inserts).toHaveLength(0);
    expect(out.report.position.netWorthGbp).toBe(60_000);
  });

  it('persists a coach_summary report + agent_runs row in advisor mode', async () => {
    const { db, sink } = fakeDb();
    const out = await runCoach({ db, userId: 'user-1', now: NOW, modeOverride: 'advisor' });

    expect(out.observerMode).toBe(false);
    expect(out.reportId).toBe('fake-2'); // 2nd insert (agentRuns first, reports second)
    expect(out.agentRunId).toBe('fake-1');
    expect(sink.inserts).toHaveLength(2);
    expect(sink.inserts[0]!.values.agent).toBe('wealth-coach');
    expect(sink.inserts[1]!.values.kind).toBe('coach_summary');
  });

  it('uses the narrator when provided and attaches its output', async () => {
    const { db } = fakeDb();
    const narrator: Narrator = vi.fn(async () => ({
      text: 'Your cash buffer is healthy and your ISA allowance has £12,000 unused. Decision-support, not regulated financial advice.',
      model: 'claude-sonnet-4-6',
      tokensIn: 100,
      tokensOut: 50,
    }));

    const out = await runCoach({
      db,
      userId: 'user-1',
      now: NOW,
      modeOverride: 'advisor',
      narrator,
    });

    expect(narrator).toHaveBeenCalledOnce();
    expect(out.report.llmNarration).toMatch(/cash buffer is healthy/);
    expect(out.report.guardrail?.passed).toBe(true);
    expect(out.tokensIn).toBe(100);
  });

  it('strips narration when the guardrail blocks it', async () => {
    const { db } = fakeDb();
    const narrator: Narrator = async () => ({
      text: 'This is a guaranteed return — buy now for a risk-free yield.',
      model: 'claude-sonnet-4-6',
    });

    const out = await runCoach({
      db,
      userId: 'user-1',
      now: NOW,
      modeOverride: 'advisor',
      narrator,
    });

    expect(out.report.llmNarration).toBeUndefined();
    expect(out.report.guardrail?.passed).toBe(false);
    expect(out.report.guardrail?.flagged.length).toBeGreaterThan(0);
  });

  it('runs the prompt through redactForLLM before sending to the narrator', async () => {
    const { db } = fakeDb();
    // Spy on the shared redactor so we can prove it's in the call path.
    const securityMod = await import('../security/security');
    const spy = vi.spyOn(securityMod, 'redactForLLM');

    const narrator: Narrator = async () => ({
      text: 'OK. Decision-support, not regulated financial advice.',
      model: 'claude-sonnet-4-6',
    });

    await runCoach({
      db,
      userId: 'user-1',
      now: NOW,
      modeOverride: 'advisor',
      narrator,
    });

    expect(spy).toHaveBeenCalled();
    // The deterministic report intentionally carries no PII, so redaction
    // is a no-op here — but it must be in the call path as defence-in-depth.
    const input = spy.mock.calls[0]![0] as string;
    expect(input).toContain('Coach report');
    spy.mockRestore();
  });
});

describe('runCoach budget guard', () => {
  it('always attaches budget status to the report (no narrator needed)', async () => {
    const { db } = fakeDb({ spentRows: [{ costUsd: '0.5' }, { costUsd: '0.25' }] });
    const out = await runCoach({
      db,
      userId: 'user-1',
      now: NOW,
      modeOverride: 'advisor',
      budgetCapUsdOverride: 2,
    });

    expect(out.budget.monthSpentUsd).toBeCloseTo(0.75, 6);
    expect(out.budget.monthCapUsd).toBe(2);
    expect(out.budget.exceeded).toBe(false);
    expect(out.report.budget).toEqual(out.budget);
  });

  it('skips the narrator when monthly spend has reached the cap', async () => {
    const { db } = fakeDb({ spentRows: [{ costUsd: '2.5' }] }); // already over cap
    const narrator: Narrator = vi.fn(async () => ({
      text: 'should never run',
      model: 'claude-sonnet-4-6',
      tokensIn: 1000,
      tokensOut: 500,
    }));

    const out = await runCoach({
      db,
      userId: 'user-1',
      now: NOW,
      modeOverride: 'advisor',
      narrator,
      budgetCapUsdOverride: 2,
    });

    expect(narrator).not.toHaveBeenCalled();
    expect(out.budget.exceeded).toBe(true);
    expect(out.report.llmNarration).toBeUndefined();
    expect(out.report.guardrail).toBeUndefined();
    expect(out.costUsd).toBe(0);
  });

  it('computes and reports cost in USD when narrator runs', async () => {
    const { db, sink } = fakeDb({ spentRows: [] });
    const narrator: Narrator = async () => ({
      text: 'A short clean note. Decision-support, not regulated financial advice.',
      model: 'claude-sonnet-4-6',
      tokensIn: 1_000_000,   // $3.00
      tokensOut: 100_000,    // $1.50
    });

    const out = await runCoach({
      db,
      userId: 'user-1',
      now: NOW,
      modeOverride: 'advisor',
      narrator,
      budgetCapUsdOverride: 5,
    });

    expect(out.costUsd).toBeCloseTo(4.5, 6);

    // agent_runs was updated with cost as a 6-dp string.
    const agentRunUpdate = sink.updates.find((u) => u.values.costUsd != null);
    expect(agentRunUpdate?.values.costUsd).toBe('4.500000');
    expect(agentRunUpdate?.values.tokensIn).toBe(1_000_000);
    expect(agentRunUpdate?.values.tokensOut).toBe(100_000);
  });

  it('leaves agent_runs.costUsd null when no narrator runs', async () => {
    const { db, sink } = fakeDb({ spentRows: [] });
    const out = await runCoach({
      db,
      userId: 'user-1',
      now: NOW,
      modeOverride: 'advisor',
      budgetCapUsdOverride: 5,
    });

    expect(out.costUsd).toBe(0);
    const agentRunUpdate = sink.updates.at(-1);
    expect(agentRunUpdate?.values.costUsd).toBeNull();
  });
});
