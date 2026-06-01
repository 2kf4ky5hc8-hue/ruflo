// Deterministic, side-effect-free risk-rule evaluator.
//
// Same input -> same output. Always. No randomness, no I/O, no clock reads
// other than the optional context.now passed in.
//
// Caller responsibility:
//   * Convert numeric(20,4) money columns to JS `number` at the DB boundary.
//   * Pass a fully-populated `RiskProfile` (the seed makes three available).
//   * Treat the result as advisory until the Approval Centre records a decision.

import type {
  AssetClass, BreachedRule, EvaluatorConstants, EvaluatorContext, PortfolioState,
  ProposedAction, RiskEvaluation, RiskProfile, RuleId, SaferAlternative,
  Severity, SuggestedAdjustment,
} from './types';
import {
  ALWAYS_REQUIRE_APPROVAL, DEFAULT_CONSTANTS, HIGH_RISK_CLASSES,
  SPECULATIVE_CLASSES,
} from './types';

const EPS = 1e-6;

function pct(part: number, whole: number): number {
  if (whole <= EPS) return 0;
  return part / whole;
}

function pushBreach(
  breaches: BreachedRule[],
  rule: RuleId,
  severity: Severity,
  message: string,
  extras: Partial<BreachedRule> = {},
): void {
  breaches.push({ rule, severity, message, ...extras });
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return -1;
  return h! * 60 + m!;
}

function isInSleepWindow(now: Date, startHHMM: string, endHHMM: string): boolean {
  // Compute UK-local time. UK is Europe/London — DST aware.
  // We avoid pulling Intl date math complexity by formatting via toLocaleString.
  const ukParts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const hh = Number(ukParts.find((p) => p.type === 'hour')?.value ?? '0');
  const mm = Number(ukParts.find((p) => p.type === 'minute')?.value ?? '0');
  const cur = hh * 60 + mm;
  const start = timeToMinutes(startHHMM);
  const end = timeToMinutes(endHHMM);
  if (start < 0 || end < 0) return false;
  // Window may wrap across midnight (e.g. 22:00 -> 07:00).
  return start <= end ? (cur >= start && cur < end) : (cur >= start || cur < end);
}

function classRiskBucket(c: AssetClass): number {
  // 0 (safest) .. 10 (riskiest) base score per asset class.
  switch (c) {
    case 'cash': return 0;
    case 'gilt': return 1;
    case 'investment_grade_bond': return 2;
    case 'reit': return 4;
    case 'developed_equity': return 4;
    case 'emerging_equity': return 6;
    case 'small_cap_equity': return 7;
    case 'thematic_equity': return 7;
    case 'high_yield_bond': return 6;
    case 'commodity': return 7;
    case 'crypto': return 9;
    case 'derivative': return 10;
  }
}

// Pure helper: what amount would satisfy all *quantitative* caps?
function maxAmountSatisfyingCaps(
  action: ProposedAction,
  portfolio: PortfolioState,
  profile: RiskProfile,
): number {
  if (action.kind !== 'buy' && action.kind !== 'allocate_cash' && action.kind !== 'deposit_isa') {
    return action.amountGbp;
  }

  // Post-action total can grow because cash becomes invested but stays in `totalValueGbp`
  // for purposes of caps (we treat the portfolio as ~constant size for a buy in-portfolio,
  // but allow growth for fresh deposits like deposit_isa).
  const isDeposit = action.kind === 'deposit_isa' || action.kind === 'allocate_cash';
  const baseTotal = portfolio.totalValueGbp;
  const totalAfter = isDeposit ? baseTotal + action.amountGbp : baseTotal;
  const epsilon = Math.max(1, totalAfter * 0.0001);

  const limits: number[] = [action.amountGbp];

  // Single-position cap
  if (totalAfter > EPS) {
    const cap = profile.maxSinglePositionPct * totalAfter;
    const available = Math.max(0, cap - portfolio.existingPositionGbp);
    limits.push(Math.max(0, available - epsilon));
  }

  // Speculative cap
  if (SPECULATIVE_CLASSES.has(action.assetClass) && totalAfter > EPS) {
    const cap = profile.maxSpeculativePct * totalAfter;
    const available = Math.max(0, cap - portfolio.speculativeExposureGbp);
    limits.push(Math.max(0, available - epsilon));
  }

  // Crypto cap
  if (action.assetClass === 'crypto' && totalAfter > EPS) {
    const cap = profile.cryptoCapPct * totalAfter;
    const available = Math.max(0, cap - portfolio.cryptoExposureGbp);
    limits.push(Math.max(0, available - epsilon));
  }

  // ISA allowance — only constrains amount that crosses into the ISA wrapper.
  if (action.wrapper === 'isa' && (action.kind === 'deposit_isa' || action.kind === 'allocate_cash')) {
    limits.push(Math.max(0, portfolio.isaRemainingGbp));
  }

  // New-instrument cap: first 90 days
  if (isWithinNewInstrumentWindow(action, /* context */ undefined) && totalAfter > EPS) {
    const cap = profile.newInstrumentSizeCapPct * totalAfter;
    const available = Math.max(0, cap - portfolio.existingPositionGbp);
    limits.push(Math.max(0, available - epsilon));
  }

  return Math.max(0, Math.min(...limits));
}

function isWithinNewInstrumentWindow(
  action: ProposedAction,
  context: EvaluatorContext | undefined,
): boolean {
  if (!action.firstHeldAt) return action.instrumentRef ? true : false;
  const now = context?.now ?? new Date();
  const days = (now.getTime() - action.firstHeldAt.getTime()) / (1000 * 60 * 60 * 24);
  return days < 90;
}

// ────── Input validation ──────────────────────────────────────────────────

function validate(
  action: ProposedAction,
  portfolio: PortfolioState,
  profile: RiskProfile | null | undefined,
): string | null {
  if (!profile) return 'Risk profile missing.';
  for (const k of [
    'maxSinglePositionPct','maxSpeculativePct','cryptoCapPct','cashFloorMonths',
    'newInstrumentSizeCapPct',
  ] as const) {
    const v = (profile as unknown as Record<string, unknown>)[k];
    if (typeof v !== 'number' || Number.isNaN(v) || v < 0) {
      return `Invalid risk profile field: ${k} (${String(v)}).`;
    }
  }
  if (!Number.isFinite(action.amountGbp)) return 'Action amount is not a finite number.';
  if (action.amountGbp <= 0) return 'Action amount must be positive.';
  if (!Number.isFinite(portfolio.totalValueGbp) || portfolio.totalValueGbp < 0) {
    return 'Portfolio total value must be a non-negative number.';
  }
  return null;
}

// ────── Core ──────────────────────────────────────────────────────────────

export function evaluateRisk(
  action: ProposedAction,
  portfolio: PortfolioState,
  profile: RiskProfile,
  context: EvaluatorContext = {},
  constants: EvaluatorConstants = DEFAULT_CONSTANTS,
): RiskEvaluation {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const breaches: BreachedRule[] = [];

  const fail = validate(action, portfolio, profile);
  if (fail) {
    pushBreach(breaches, 'invalid_input', 'block', fail);
    return finalise({
      action, portfolio, profile, reasons: [fail], warnings, breaches,
      adjustment: null, alt: { kind: 'wait', description: 'Fix inputs and re-evaluate.' },
    });
  }

  const isAddingToPosition = action.kind === 'buy'
    || action.kind === 'allocate_cash'
    || action.kind === 'deposit_isa';

  const isDeposit = action.kind === 'deposit_isa' || action.kind === 'allocate_cash';
  const totalAfter = isDeposit
    ? portfolio.totalValueGbp + action.amountGbp
    : portfolio.totalValueGbp;

  // 1. Leverage / options gating
  if (action.assetClass === 'derivative' && !profile.optionsAllowed) {
    pushBreach(breaches, 'options_disallowed', 'block',
      `Profile "${profile.name}" disallows derivatives. Enable High-Risk Unlock to use options/CFDs.`);
  }
  if (action.kind === 'buy' && action.assetClass !== 'derivative' && !profile.leverageAllowed) {
    // We don't fail here because leverage is a property of the order, not the asset;
    // executors are responsible for ensuring no margin is used.
  }

  // 2. Single-position cap (with portfolio-size aware tightening — review §2).
  // Cash isn't a "position" in the concentration sense; deposits into a cash
  // wrapper don't concentrate risk in a single instrument.
  if (isAddingToPosition && totalAfter > EPS && action.assetClass !== 'cash') {
    const newPosition = portfolio.existingPositionGbp + action.amountGbp;
    const observed = pct(newPosition, totalAfter);
    const baseCap = profile.maxSinglePositionPct;
    const tightCap = profile.maxSinglePositionSmallPortfolioPct;
    const isSmallPortfolio = totalAfter < constants.smallPortfolioThresholdGbp;
    const effectiveCap = (isSmallPortfolio && tightCap != null) ? tightCap : baseCap;
    const ruleId: RuleId = (isSmallPortfolio && tightCap != null)
      ? 'max_single_position_small_portfolio'
      : 'max_single_position';

    if (observed > effectiveCap) {
      const label = (isSmallPortfolio && tightCap != null)
        ? `tighter "starter portfolio" cap ${(effectiveCap * 100).toFixed(1)}% (portfolio under £${constants.smallPortfolioThresholdGbp.toLocaleString('en-GB')})`
        : `cap ${(effectiveCap * 100).toFixed(1)}%`;
      pushBreach(breaches, ruleId, 'block',
        `Single position would be ${(observed * 100).toFixed(1)}% of portfolio (${label}).`,
        { capPct: effectiveCap, observedPct: observed, overByGbp: newPosition - effectiveCap * totalAfter });
    } else if (observed > effectiveCap * 0.9) {
      warnings.push(`Approaching single-position cap (${(observed * 100).toFixed(1)}% vs ${(effectiveCap * 100).toFixed(1)}%).`);
    }
  }

  // 3. Speculative cap (with cash-buffer-aware tightening — review §2).
  if (isAddingToPosition && SPECULATIVE_CLASSES.has(action.assetClass) && totalAfter > EPS) {
    const newSpec = portfolio.speculativeExposureGbp + action.amountGbp;
    const observed = pct(newSpec, totalAfter);
    const baseCap = profile.maxSpeculativePct;
    const tightCap = profile.maxSpeculativeUntilBufferHealthyPct;
    const cashFloor = profile.cashFloorMonths * portfolio.monthlyExpensesGbp;
    const bufferHealthy = portfolio.monthlyExpensesGbp <= EPS
      || portfolio.cashBufferGbp >= cashFloor;
    const effectiveCap = (!bufferHealthy && tightCap != null) ? tightCap : baseCap;
    const ruleId: RuleId = (!bufferHealthy && tightCap != null)
      ? 'max_speculative_until_buffer_healthy'
      : 'max_speculative';

    if (observed > effectiveCap) {
      const label = (!bufferHealthy && tightCap != null)
        ? `tighter "cash buffer below floor" cap ${(effectiveCap * 100).toFixed(1)}%`
        : `cap ${(effectiveCap * 100).toFixed(1)}%`;
      pushBreach(breaches, ruleId, 'block',
        `Speculative exposure would be ${(observed * 100).toFixed(1)}% of portfolio (${label}).`,
        { capPct: effectiveCap, observedPct: observed, overByGbp: newSpec - effectiveCap * totalAfter });
    } else if (observed > effectiveCap * 0.9) {
      warnings.push(`Approaching speculative cap (${(observed * 100).toFixed(1)}% vs ${(effectiveCap * 100).toFixed(1)}%).`);
    }
  }

  // 4. Crypto cap (plus buffer + toxic-debt gates — review §1.4 + §2).
  if (isAddingToPosition && action.assetClass === 'crypto' && totalAfter > EPS) {
    const newCrypto = portfolio.cryptoExposureGbp + action.amountGbp;
    const observed = pct(newCrypto, totalAfter);
    const cap = profile.cryptoCapPct;
    if (observed > cap) {
      pushBreach(breaches, 'crypto_cap', 'block',
        `Crypto exposure would be ${(observed * 100).toFixed(1)}% of portfolio (cap ${(cap * 100).toFixed(1)}%).`,
        { capPct: cap, observedPct: observed, overByGbp: newCrypto - cap * totalAfter });
    }

    if (profile.cryptoRequiresBuffer && portfolio.monthlyExpensesGbp > 0) {
      const cashFloor = profile.cashFloorMonths * portfolio.monthlyExpensesGbp;
      if (portfolio.cashBufferGbp < cashFloor) {
        pushBreach(breaches, 'crypto_requires_buffer', 'block',
          `Crypto allocation is gated until cash buffer is at the floor (£${portfolio.cashBufferGbp.toFixed(0)} vs £${cashFloor.toFixed(0)}).`);
      }
    }

    if (profile.cryptoRequiresNoToxicDebt
        && (portfolio.highestDebtAprPct ?? 0) > constants.toxicDebtAprPct) {
      pushBreach(breaches, 'crypto_requires_no_toxic_debt', 'block',
        `Crypto allocation is gated while you hold debt above ${(constants.toxicDebtAprPct * 100).toFixed(1)}% APR ` +
        `(highest current APR ${((portfolio.highestDebtAprPct ?? 0) * 100).toFixed(1)}%). Clear toxic debt first.`);
    }
  }

  // 5. Cash floor — buying with internal cash (allocate_cash or buy) shouldn't
  //    drop the emergency fund below cashFloorMonths * monthlyExpenses.
  //    deposit_isa adds money in, so it never depletes the buffer.
  if (!context.isPaperTrade
      && (action.kind === 'buy' || action.kind === 'allocate_cash')
      && portfolio.monthlyExpensesGbp > 0) {
    const required = profile.cashFloorMonths * portfolio.monthlyExpensesGbp;
    const cashAfter = portfolio.cashBufferGbp - action.amountGbp;
    if (cashAfter < required) {
      pushBreach(breaches, 'cash_floor', 'block',
        `Cash buffer would fall to £${cashAfter.toFixed(0)} (floor is £${required.toFixed(0)} = ${profile.cashFloorMonths} months of expenses).`,
        { overByGbp: required - cashAfter });
    }
  }

  // 5b. Business reserve floor (review §10.2).
  // Personal risk-up is blocked while the business has unpaid obligations
  // due in the next 90 days that exceed business cash, OR while business cash
  // is below `businessReserveFloorMonths × businessMonthlyFixedGbp`.
  if (!context.isPaperTrade
      && isAddingToPosition
      && action.assetClass !== 'cash'
      && action.wrapper !== 'isa' // ISA deposit is the disciplined path; don't block it
      && (portfolio.businessCashGbp ?? 0) >= 0
      && (portfolio.businessObligationsDue90dGbp ?? 0) > 0) {
    const cash = portfolio.businessCashGbp ?? 0;
    const obligations = portfolio.businessObligationsDue90dGbp ?? 0;
    if (obligations > cash) {
      pushBreach(breaches, 'business_obligations_unpaid', 'block',
        `Business obligations due in 90 days (£${obligations.toFixed(0)}) exceed business cash (£${cash.toFixed(0)}). ` +
        `Personal risk-up is blocked until the business runway is safe.`);
    }
  }
  if (!context.isPaperTrade
      && isAddingToPosition
      && action.assetClass !== 'cash'
      && action.wrapper !== 'isa'
      && profile.businessReserveFloorMonths > 0
      && (portfolio.businessMonthlyFixedGbp ?? 0) > 0) {
    const reserveFloor = profile.businessReserveFloorMonths * (portfolio.businessMonthlyFixedGbp ?? 0);
    const cash = portfolio.businessCashGbp ?? 0;
    if (cash < reserveFloor) {
      pushBreach(breaches, 'business_reserve_floor', 'warn',
        `Business reserve £${cash.toFixed(0)} is below the ${profile.businessReserveFloorMonths}-month fixed-cost floor of £${reserveFloor.toFixed(0)}. ` +
        `Consider topping up the business reserve before increasing personal risk.`);
    }
  }

  // 6. ISA allowance
  if (!context.isPaperTrade && action.wrapper === 'isa'
      && (action.kind === 'deposit_isa' || action.kind === 'allocate_cash')) {
    if (action.amountGbp > portfolio.isaRemainingGbp + EPS) {
      pushBreach(breaches, 'isa_allowance', 'block',
        `ISA allowance remaining is £${portfolio.isaRemainingGbp.toFixed(0)}; proposal is £${action.amountGbp.toFixed(0)}.`,
        { overByGbp: action.amountGbp - portfolio.isaRemainingGbp });
    }
  }

  // 7. New-instrument size cap
  if (isAddingToPosition && isWithinNewInstrumentWindow(action, context) && totalAfter > EPS) {
    const newPosition = portfolio.existingPositionGbp + action.amountGbp;
    const observed = pct(newPosition, totalAfter);
    const cap = profile.newInstrumentSizeCapPct;
    if (observed > cap) {
      pushBreach(breaches, 'new_instrument_cap', 'warn',
        `New instrument (held <90 days) would be ${(observed * 100).toFixed(1)}% of portfolio (early cap ${(cap * 100).toFixed(1)}%).`,
        { capPct: cap, observedPct: observed });
    }
  }

  // 8. Sleep-mode window — only blocks for live trade-kind actions.
  if (action.kind === 'buy' || action.kind === 'sell' || action.kind === 'rebalance') {
    const now = context.now ?? new Date();
    if (isInSleepWindow(now, profile.sleepModeStart, profile.sleepModeEnd)) {
      pushBreach(breaches, 'sleep_mode', 'warn',
        `Inside sleep-mode window (${profile.sleepModeStart}–${profile.sleepModeEnd} UK). Out-of-hours token required for live execution.`);
    }
  }

  // 8b. Drawdown gate — block risk-up when portfolio is in a deep drawdown.
  //     Only applies to risk-up (buy / allocate_cash / deposit_isa) into a
  //     non-cash asset class; deposits into cash wrappers are still allowed.
  if (isAddingToPosition && action.assetClass !== 'cash' && portfolio.portfolioDrawdownPct != null) {
    const dd = portfolio.portfolioDrawdownPct;
    const block = profile.drawdownBlockPct ?? null;
    const caution = profile.drawdownCautionPct ?? null;
    if (block != null && dd >= block) {
      pushBreach(breaches, 'drawdown_block', 'block',
        `Portfolio drawdown ${(dd * 100).toFixed(1)}% has hit the ${(block * 100).toFixed(0)}% block threshold. New risk-up is frozen — review the playbook before adding to positions.`);
    } else if (caution != null && dd >= caution) {
      pushBreach(breaches, 'drawdown_caution', 'warn',
        `Portfolio drawdown ${(dd * 100).toFixed(1)}% is above the ${(caution * 100).toFixed(0)}% caution threshold. Requires explicit approval.`);
    }
  }

  // 9. Always-approval classes
  if (ALWAYS_REQUIRE_APPROVAL.has(action.assetClass)) {
    pushBreach(breaches, 'requires_approval_crypto_or_derivative', 'warn',
      `Asset class "${action.assetClass}" always requires explicit human approval.`);
  } else if (HIGH_RISK_CLASSES.has(action.assetClass) && isAddingToPosition) {
    pushBreach(breaches, 'requires_approval_high_risk', 'warn',
      `High-risk asset class "${action.assetClass}" requires explicit human approval.`);
  }

  // Suggested adjustment & alternative
  const adjustment = computeAdjustment(action, portfolio, profile, breaches);
  const alt = computeAlternative(action, profile, breaches);

  // Reasons: one line per rule outcome.
  reasons.push(...buildReasonLines(action, portfolio, profile, breaches));

  return finalise({
    action, portfolio, profile, reasons, warnings, breaches, adjustment, alt,
  });
}

function computeAdjustment(
  action: ProposedAction,
  portfolio: PortfolioState,
  profile: RiskProfile,
  breaches: BreachedRule[],
): SuggestedAdjustment | null {
  const quantitative: RuleId[] = [
    'max_single_position', 'max_single_position_small_portfolio',
    'max_speculative', 'max_speculative_until_buffer_healthy',
    'crypto_cap', 'isa_allowance', 'new_instrument_cap',
  ];
  const haveBlockingQuant = breaches.some((b) => b.severity === 'block' && quantitative.includes(b.rule));
  const haveCashFloor = breaches.some((b) => b.rule === 'cash_floor' && b.severity === 'block');
  if (!haveBlockingQuant && !haveCashFloor) return null;

  let allowed = maxAmountSatisfyingCaps(action, portfolio, profile);

  // If cash floor is the blocker, derive the largest amount that still keeps the buffer above the floor.
  if (haveCashFloor && portfolio.monthlyExpensesGbp > 0) {
    const required = profile.cashFloorMonths * portfolio.monthlyExpensesGbp;
    const maxFromCash = Math.max(0, portfolio.cashBufferGbp - required);
    allowed = Math.min(allowed, maxFromCash);
  }

  allowed = Math.floor(allowed * 100) / 100; // round down to pence
  if (allowed <= 0 || allowed >= action.amountGbp - 0.01) return null;
  return {
    newAmountGbp: allowed,
    reason: `Shrink to £${allowed.toFixed(2)} to satisfy ${
      breaches.filter((b) => b.severity === 'block').map((b) => b.rule).join(', ')
    }.`,
  };
}

function computeAlternative(
  action: ProposedAction,
  profile: RiskProfile,
  breaches: BreachedRule[],
): SaferAlternative | null {
  if (breaches.some((b) => b.rule === 'drawdown_block')) {
    return {
      kind: 'wait',
      description: 'Drawdown is severe — sit on hands, re-read the playbook, and let the dust settle before adding to risk.',
    };
  }
  if (breaches.some((b) => b.rule === 'drawdown_caution')) {
    return {
      kind: 'split',
      description: 'Drawdown is elevated — half the intended size and stagger the rest over the next two pay cycles.',
    };
  }
  if (breaches.some((b) => b.rule === 'isa_allowance')) {
    return {
      kind: 'switch_wrapper',
      description: 'Route the excess into a GIA (general investment account) or wait for the next tax year.',
    };
  }
  // Buffer + toxic-debt crypto gates take precedence over the generic
  // "swap to thematic ETF" suggestion: their root cause is the user's wider
  // balance sheet, not the asset class.
  if (breaches.some((b) => b.rule === 'crypto_requires_buffer')) {
    return {
      kind: 'wait',
      description: 'Top up the cash buffer to the floor first; crypto allocation unlocks after.',
    };
  }
  if (breaches.some((b) => b.rule === 'crypto_requires_no_toxic_debt')) {
    return {
      kind: 'switch_asset_class',
      description: 'Pay down toxic debt before allocating to crypto — the after-tax return on debt-payoff usually beats expected crypto return.',
    };
  }
  if (breaches.some((b) => b.rule === 'crypto_cap' || b.rule === 'requires_approval_crypto_or_derivative')) {
    return {
      kind: 'switch_asset_class',
      description: 'Consider a thematic equity ETF for similar exposure with regulated wrapper coverage.',
    };
  }
  if (breaches.some((b) => b.rule === 'max_speculative' || b.rule === 'max_speculative_until_buffer_healthy')) {
    return {
      kind: 'switch_asset_class',
      description: 'Use a developed-market equity ETF instead of an individual small/thematic name. Speculative caps relax once the cash buffer is at the floor.',
    };
  }
  if (breaches.some((b) => b.rule === 'business_obligations_unpaid')) {
    return {
      kind: 'wait',
      description: 'Reserve enough cash in the business to cover obligations due in the next 90 days first.',
    };
  }
  if (breaches.some((b) => b.rule === 'business_reserve_floor')) {
    return {
      kind: 'split',
      description: 'Split half this contribution into business reserve until the fixed-cost floor is met.',
    };
  }
  if (breaches.some((b) => b.rule === 'cash_floor')) {
    return {
      kind: 'split',
      description: `Split across pay cycles to keep the cash buffer above ${profile.cashFloorMonths} months of expenses.`,
    };
  }
  if (breaches.some((b) => b.rule === 'sleep_mode')) {
    return { kind: 'wait', description: 'Defer execution until outside the sleep-mode window.' };
  }
  if (breaches.some((b) => b.rule === 'new_instrument_cap')) {
    return { kind: 'split', description: 'Build the position over several months instead of in one go.' };
  }
  return null;
}

function buildReasonLines(
  action: ProposedAction,
  portfolio: PortfolioState,
  _profile: RiskProfile,
  breaches: BreachedRule[],
): string[] {
  const lines: string[] = [];
  if (breaches.length === 0) {
    lines.push(`Action passes all rules: ${action.kind} ${action.assetClass} £${action.amountGbp.toFixed(2)} in ${action.wrapper}.`);
  }
  for (const b of breaches) lines.push(`[${b.severity}] ${b.rule}: ${b.message}`);
  // Brief contextual lines for transparency in audit logs.
  if (portfolio.totalValueGbp === 0) lines.push('Note: portfolio is empty; position-percentage checks degenerate.');
  return lines;
}

function finalise(args: {
  action: ProposedAction;
  portfolio: PortfolioState;
  profile: RiskProfile;
  reasons: string[];
  warnings: string[];
  breaches: BreachedRule[];
  adjustment: SuggestedAdjustment | null;
  alt: SaferAlternative | null;
}): RiskEvaluation {
  const blocked = args.breaches.some((b) => b.severity === 'block');
  const hasWarn = args.breaches.some((b) => b.severity === 'warn');

  // `allowed` means the action could proceed (possibly after human approval).
  // A warn-severity rule does not block — it just gates on approval. Only
  // block-severity rules veto.
  const allowed = !blocked;

  // Human approval required if:
  //   - any rule fired (warn or block), OR
  //   - asset class is high-risk (small/thematic/em equity, HY bond, commodity), OR
  //   - asset class is always-approval (crypto, derivative).
  // Adding to a position in a high-risk class is what concentrates risk;
  // selling or rebalancing out of one should not force approval.
  const isAddingToPosition = args.action.kind === 'buy'
    || args.action.kind === 'allocate_cash'
    || args.action.kind === 'deposit_isa';
  const classGatesApproval = ALWAYS_REQUIRE_APPROVAL.has(args.action.assetClass)
    || (isAddingToPosition && HIGH_RISK_CLASSES.has(args.action.assetClass));
  const requiresApproval = blocked || hasWarn || classGatesApproval;

  // Risk score: base on asset class, then nudged by breaches and concentration.
  let score = classRiskBucket(args.action.assetClass);
  if (blocked) score += 2;
  if (hasWarn) score += 1;
  score = Math.max(0, Math.min(10, score));

  return {
    allowed,
    blocked,
    requiresApproval,
    riskScore: score,
    reasons: args.reasons,
    warnings: args.warnings,
    breachedRules: args.breaches,
    suggestedAdjustment: args.adjustment,
    suggestedSaferAlternative: args.alt,
  };
}
