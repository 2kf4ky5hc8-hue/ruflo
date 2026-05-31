// Epic 13 — the default benchmark plan.
//
// The disciplined, boring baseline a UK retail compounder should beat before
// doing anything cleverer: emergency fund → clear toxic debt → ISA into a
// low-cost global tracker → cash/short-gilt ballast → business reserve.
//
// Pure + deterministic. No LLM, no randomness, no I/O. Every "opportunity"
// in the system is later compared against this — if it doesn't beat the
// default plan on a risk-adjusted, tax-aware basis, the honest answer is
// "just do the default".

import type { FinanceSnapshot } from '../lib/finance';

export interface DefaultPlanStep {
  id:
    | 'emergency_fund'
    | 'clear_toxic_debt'
    | 'isa_core'
    | 'cash_gilt_ballast'
    | 'business_reserve'
    | 'pension'
    | 'invest_surplus';
  title: string;
  /** Monthly £ this step claims from spare cash. */
  monthlyGbp: number;
  /** One-off £ target this step is working towards (where relevant). */
  targetGbp?: number;
  rationale: string;
  /** Expected annualised return this step "earns" (decimal). For debt this is
   *  the APR saved; for cash it's the savings rate; for equity the assumed real. */
  expectedReturnPct: number;
}

export interface DefaultPlan {
  monthlySpareGbp: number;
  /** Blended expected annual return of the plan, weighted by £ allocated. */
  blendedReturnPct: number;
  steps: DefaultPlanStep[];
  /** Assumptions used, surfaced for transparency. */
  assumptions: {
    globalEquityRealReturnPct: number;
    cashSavingsRatePct: number;
    giltYieldPct: number;
    isaMonthlyTargetGbp: number;
  };
}

export interface DefaultPlanOptions {
  /** Assumed long-run real return on a low-cost global equity tracker. */
  globalEquityRealReturnPct?: number;
  /** Best easy-access savings rate available to the user. */
  cashSavingsRatePct?: number;
  /** Short-gilt / money-market yield. */
  giltYieldPct?: number;
  /** APR above which debt counts as toxic (matches risk config). */
  toxicDebtAprPct?: number;
}

const DEFAULTS: Required<DefaultPlanOptions> = {
  globalEquityRealReturnPct: 0.05,
  cashSavingsRatePct: 0.045,
  giltYieldPct: 0.04,
  toxicDebtAprPct: 0.06,
};

export function buildDefaultPlan(
  snap: FinanceSnapshot,
  opts: DefaultPlanOptions = {},
): DefaultPlan {
  const o = { ...DEFAULTS, ...opts };
  const monthlySpare = Math.max(0, snap.monthlyIncomeGbp - snap.monthlyExpensesGbp);
  const cashFloorMonths = snap.activeRiskProfile?.cashFloorMonths ?? 3;
  const cashFloor = cashFloorMonths * snap.monthlyExpensesGbp;
  const cashGap = Math.max(0, cashFloor - snap.cashGbp);

  const steps: DefaultPlanStep[] = [];
  let remaining = monthlySpare;

  const claim = (want: number): number => {
    const got = Math.max(0, Math.min(want, remaining));
    remaining -= got;
    return got;
  };

  // 1. Emergency fund to floor (waterfall priority 1, after business
  //    obligations which are handled by the risk gate, not the plan).
  if (cashGap > 0 && remaining > 0) {
    // Spread closing the gap over up to 6 months, but never less than 25%
    // of spare while there's a gap — the buffer is the foundation.
    const overSixMonths = cashGap / 6;
    const want = Math.max(overSixMonths, monthlySpare * 0.25);
    const amt = claim(want);
    if (amt > 0) {
      steps.push({
        id: 'emergency_fund',
        title: 'Top up emergency fund',
        monthlyGbp: amt,
        targetGbp: cashFloor,
        rationale: `${cashFloorMonths} months of essential expenses (£${cashFloor.toFixed(0)}). Currently £${snap.cashGbp.toFixed(0)} — gap of £${cashGap.toFixed(0)}.`,
        expectedReturnPct: o.cashSavingsRatePct,
      });
    }
  }

  // 2. Clear toxic debt (anything above the toxic threshold).
  if (snap.toxicDebtCount > 0 && remaining > 0) {
    // The plan throws everything left at toxic debt — a guaranteed high return.
    const amt = claim(remaining);
    steps.push({
      id: 'clear_toxic_debt',
      title: 'Clear high-interest debt',
      monthlyGbp: amt,
      rationale: `${snap.toxicDebtCount} debt(s) above ${(o.toxicDebtAprPct * 100).toFixed(0)}% APR (highest ${(snap.highestDebtAprPct * 100).toFixed(1)}%). Paying these down is a guaranteed, tax-free return.`,
      expectedReturnPct: Math.max(snap.highestDebtAprPct, o.toxicDebtAprPct),
    });
  }

  // 3. ISA core: low-cost global tracker, up to remaining allowance, capped at
  //    an even-paced 1/12 of the remaining allowance per month (so it lasts the
  //    tax year) or the larger of half the remaining spare.
  const isaRemaining = snap.isa?.remaining ?? 0;
  const isaMonthlyTarget = isaRemaining > 0
    ? Math.min(isaRemaining / 12, Math.max(remaining * 0.6, 0))
    : 0;
  if (isaMonthlyTarget > 0 && remaining > 0) {
    const amt = claim(isaMonthlyTarget);
    if (amt > 0) {
      steps.push({
        id: 'isa_core',
        title: 'ISA → low-cost global equity tracker',
        monthlyGbp: amt,
        targetGbp: isaRemaining,
        rationale: `Tax-free wrapper. £${isaRemaining.toFixed(0)} allowance remaining this year. A global tracker (e.g. FTSE Global All Cap / VWRP) is the diversified default.`,
        expectedReturnPct: o.globalEquityRealReturnPct,
      });
    }
  }

  // 4. Cash / short-gilt ballast — once the buffer is met, hold some ballast
  //    rather than chase. Small slice.
  if (remaining > 0) {
    const amt = claim(remaining * 0.2);
    if (amt > 0) {
      steps.push({
        id: 'cash_gilt_ballast',
        title: 'Cash / short-gilt ballast',
        monthlyGbp: amt,
        rationale: 'A small fixed-income / cash sleeve dampens drawdowns and funds opportunistic buys without selling equities at the wrong time.',
        expectedReturnPct: o.giltYieldPct,
      });
    }
  }

  // 5. Anything left → invest surplus into the same global tracker (GIA once
  //    ISA is full).
  if (remaining > 0) {
    const amt = claim(remaining);
    steps.push({
      id: 'invest_surplus',
      title: 'Invest the surplus (GIA global tracker)',
      monthlyGbp: amt,
      rationale: isaRemaining > 0
        ? 'Surplus beyond the even-paced ISA contribution. Same diversified tracker.'
        : 'ISA allowance used for the year — surplus into a GIA global tracker until 6 April.',
      expectedReturnPct: o.globalEquityRealReturnPct,
    });
  }

  // Blended expected return, weighted by £ allocated.
  const totalAllocated = steps.reduce((acc, s) => acc + s.monthlyGbp, 0);
  const blendedReturnPct = totalAllocated > 0
    ? steps.reduce((acc, s) => acc + s.expectedReturnPct * s.monthlyGbp, 0) / totalAllocated
    : 0;

  return {
    monthlySpareGbp: monthlySpare,
    blendedReturnPct,
    steps,
    assumptions: {
      globalEquityRealReturnPct: o.globalEquityRealReturnPct,
      cashSavingsRatePct: o.cashSavingsRatePct,
      giltYieldPct: o.giltYieldPct,
      isaMonthlyTargetGbp: isaMonthlyTarget,
    },
  };
}

// DT/BM comparison primitive: does a proposed allocation beat the default
// plan's blended expected return? Returns the delta in percentage points and a
// plain-English verdict. Conservative: an uncertain proposal must clear the
// default by a margin to be judged "better".
export interface DefaultPlanComparison {
  proposalReturnPct: number;
  defaultReturnPct: number;
  deltaPct: number;
  verdict: 'default_is_better' | 'roughly_equal' | 'proposal_is_better';
  reason: string;
}

export function compareToDefaultPlan(
  proposalExpectedReturnPct: number,
  plan: DefaultPlan,
  marginPct = 0.02,
): DefaultPlanComparison {
  const delta = proposalExpectedReturnPct - plan.blendedReturnPct;
  let verdict: DefaultPlanComparison['verdict'];
  let reason: string;
  if (delta > marginPct) {
    verdict = 'proposal_is_better';
    reason = `Proposal's expected ${(proposalExpectedReturnPct * 100).toFixed(1)}% clears the default plan's ${(plan.blendedReturnPct * 100).toFixed(1)}% by more than ${(marginPct * 100).toFixed(0)}pp — worth considering on return grounds (risk still applies).`;
  } else if (delta > -marginPct) {
    verdict = 'roughly_equal';
    reason = `Proposal's expected ${(proposalExpectedReturnPct * 100).toFixed(1)}% is roughly level with the default plan's ${(plan.blendedReturnPct * 100).toFixed(1)}%. The default plan is simpler and more diversified — favour it unless there's a non-return reason.`;
  } else {
    verdict = 'default_is_better';
    reason = `Default plan's ${(plan.blendedReturnPct * 100).toFixed(1)}% beats the proposal's expected ${(proposalExpectedReturnPct * 100).toFixed(1)}%. Just do the default.`;
  }
  return {
    proposalReturnPct: proposalExpectedReturnPct,
    defaultReturnPct: plan.blendedReturnPct,
    deltaPct: delta,
    verdict,
    reason,
  };
}
