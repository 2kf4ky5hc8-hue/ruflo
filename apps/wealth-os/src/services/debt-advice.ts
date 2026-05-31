// DT-1602 — debt-vs-invest comparator. Pure, deterministic, no LLM.
//
// The core discipline: a guaranteed after-tax return from clearing a debt is
// usually better than an uncertain expected investment return. We compare the
// debt's effective rate against the user's assumed real investment return and
// give a clear verdict with the reasoning shown.

export interface DebtLike {
  name: string;
  kind: string;
  balanceGbp: number;
  aprPct: number;        // decimal
  secured: boolean;
  taxDeductible: boolean;
}

export type DebtVerdict = 'clear_debt_first' | 'lean_clear_debt' | 'either' | 'lean_invest' | 'invest_first';

export interface DebtComparison {
  name: string;
  effectiveRatePct: number;       // after any tax-deductibility adjustment
  assumedInvestReturnPct: number;
  verdict: DebtVerdict;
  reason: string;
}

export interface DebtAdviceOptions {
  /** Assumed long-run real investment return (decimal). Default 5%. */
  assumedInvestReturnPct?: number;
  /** Marginal income/dividend tax rate, used for tax-deductible debt. */
  marginalTaxRatePct?: number;
}

/**
 * Compare each debt against investing. A guaranteed X% saved by clearing debt
 * is compared to an uncertain Y% expected from investing — so we apply an
 * uncertainty margin: investing must clear the debt rate by >2 percentage
 * points before we lean towards it.
 */
export function compareDebtsVsInvest(
  debts: DebtLike[],
  opts: DebtAdviceOptions = {},
): DebtComparison[] {
  const investReturn = opts.assumedInvestReturnPct ?? 0.05;
  const marginalTax = opts.marginalTaxRatePct ?? 0;

  // Decision bands on diff = (effective debt rate) − (assumed invest return).
  // A guaranteed return is worth a small premium, so the "either" band sits
  // slightly below parity rather than centred on it.
  //   diff ≥ +2.0pp  → clear_debt_first   (e.g. cards, high-rate loans)
  //   diff ≥ +0.5pp  → lean_clear_debt
  //   diff > −0.5pp  → either              (within ~½pp of the return)
  //   diff > −2.0pp  → lean_invest
  //   else           → invest_first        (≥2pp below, e.g. low-rate mortgage)

  return debts.map((d) => {
    // Tax-deductible interest (e.g. some business borrowing) has a lower
    // effective cost. Personal debt is paid from after-tax income, so its
    // headline APR is already the right comparison.
    const effective = d.taxDeductible ? d.aprPct * (1 - marginalTax) : d.aprPct;

    let verdict: DebtVerdict;
    let reason: string;
    const diff = effective - investReturn;

    if (diff >= 0.02) {
      verdict = 'clear_debt_first';
      reason = `${(effective * 100).toFixed(1)}% guaranteed saved beats the assumed ${(investReturn * 100).toFixed(1)}% uncertain return. Clear this before investing.`;
    } else if (diff >= 0.005) {
      verdict = 'lean_clear_debt';
      reason = `${(effective * 100).toFixed(1)}% is above the assumed investment return. Leaning towards clearing it — a guaranteed return is worth a small premium.`;
    } else if (diff > -0.005) {
      verdict = 'either';
      reason = `${(effective * 100).toFixed(1)}% is roughly level with the assumed ${(investReturn * 100).toFixed(1)}% return. Split, or favour clearing it for the certainty.`;
    } else if (diff > -0.02) {
      verdict = 'lean_invest';
      reason = `${(effective * 100).toFixed(1)}% is below the assumed investment return. Minimums plus investing the rest is reasonable${d.secured ? '' : ' — but keep an eye on it'}.`;
    } else {
      verdict = 'invest_first';
      reason = `${(effective * 100).toFixed(1)}% is well below the assumed ${(investReturn * 100).toFixed(1)}% return${d.secured ? ' (and it\'s secured/low-rate)' : ''}. Pay the minimum and invest the surplus.`;
    }

    return {
      name: d.name,
      effectiveRatePct: effective,
      assumedInvestReturnPct: investReturn,
      verdict,
      reason,
    };
  }).sort((a, b) => b.effectiveRatePct - a.effectiveRatePct);
}
