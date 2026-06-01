// Domain types for the deterministic risk-rule evaluator.
//
// Money is GBP minor-unit-aware but we use `number` here for the evaluator
// because all calculations are ratios. Callers convert from the schema's
// numeric(20,4) -> number via `Number(...)` at the boundary.
//
// Asset classes here are coarser than `instruments.asset_class` because the
// evaluator only cares about risk classification.

export type AssetClass =
  | 'cash'
  | 'gilt'
  | 'investment_grade_bond'
  | 'high_yield_bond'
  | 'developed_equity'
  | 'emerging_equity'
  | 'small_cap_equity'
  | 'thematic_equity'
  | 'reit'
  | 'commodity'
  | 'crypto'
  | 'derivative';

export type ProposedActionKind =
  | 'buy'
  | 'sell'
  | 'allocate_cash'
  | 'deposit_isa'
  | 'transfer'
  | 'rebalance';

export type Wrapper = 'isa' | 'gia' | 'sipp' | 'lisa' | 'jisa' | 'cash' | 'crypto_exchange';

// Asset classes the evaluator counts toward `speculative_exposure`.
export const SPECULATIVE_CLASSES: ReadonlySet<AssetClass> = new Set<AssetClass>([
  'small_cap_equity',
  'thematic_equity',
  'emerging_equity',
  'high_yield_bond',
  'commodity',
  'crypto',
  'derivative',
]);

// Assets that always require explicit human approval regardless of size.
export const ALWAYS_REQUIRE_APPROVAL: ReadonlySet<AssetClass> = new Set<AssetClass>([
  'crypto',
  'derivative',
]);

// What "high risk" means for the requiresApproval flag (above and beyond
// `ALWAYS_REQUIRE_APPROVAL` and any breach result).
export const HIGH_RISK_CLASSES: ReadonlySet<AssetClass> = new Set<AssetClass>([
  ...SPECULATIVE_CLASSES,
  'thematic_equity',
]);

export interface RiskProfile {
  /** e.g. 'aggressive' | 'balanced' | 'conservative' */
  name: string;
  /** decimal, 0..1 — e.g. 0.12 for 12% */
  maxSinglePositionPct: number;
  /**
   * Tighter cap that applies while the user's portfolio is below
   * `smallPortfolioThresholdGbp`. Null = no special tighter cap.
   */
  maxSinglePositionSmallPortfolioPct?: number | null;
  maxSpeculativePct: number;
  /**
   * Tighter speculative cap until the personal cash buffer is at the
   * floor. Null = no special tighter cap.
   */
  maxSpeculativeUntilBufferHealthyPct?: number | null;
  maxSectorPct: number;
  maxCountryPct: number;
  maxCurrencyPct: number;
  maxDailyLossPct: number;
  maxWeeklyLossPct: number;
  maxMonthlyLossPct: number;
  leverageAllowed: boolean;
  optionsAllowed: boolean;
  cryptoCapPct: number;
  /** Crypto allocation is blocked while personal cash buffer is below floor. */
  cryptoRequiresBuffer: boolean;
  /** Crypto allocation is blocked while any debt is above the toxic-debt APR. */
  cryptoRequiresNoToxicDebt: boolean;
  /** Months of essential expenses required as cash floor */
  cashFloorMonths: number;
  /** Months of business fixed costs required as business reserve. */
  businessReserveFloorMonths: number;
  /** Portfolio drawdown that triggers a warn-level approval gate. */
  drawdownCautionPct?: number;
  /** Portfolio drawdown that blocks new risk-up entirely. */
  drawdownBlockPct?: number;
  coolingOffMinutes: number;
  sleepModeStart: string; // "HH:MM"
  sleepModeEnd: string;   // "HH:MM"
  newInstrumentSizeCapPct: number;
  liquidityMinAdvGbp: number;
  paperTradeDays: number;
}

/**
 * Global constants the evaluator needs but that aren't profile-tunable.
 * Centralised here so callers can override for tests.
 */
export interface EvaluatorConstants {
  smallPortfolioThresholdGbp: number;
  toxicDebtAprPct: number;
}

export const DEFAULT_CONSTANTS: EvaluatorConstants = {
  smallPortfolioThresholdGbp: 25_000,
  toxicDebtAprPct: 0.06,
};

export interface ProposedAction {
  kind: ProposedActionKind;
  assetClass: AssetClass;
  wrapper: Wrapper;
  /** GBP amount being committed (always positive for buys/allocations) */
  amountGbp: number;
  /** Optional: the instrument the action targets. Used for first-time caps. */
  instrumentRef?: string;
  /** Optional: when did the portfolio first acquire this instrument? */
  firstHeldAt?: Date;
}

export interface PortfolioState {
  /** Total investable portfolio value in GBP (excluding emergency fund). */
  totalValueGbp: number;
  /** Current GBP value of the existing position in the action's instrument (if any). */
  existingPositionGbp: number;
  /** Aggregate GBP value across speculative asset classes. */
  speculativeExposureGbp: number;
  /** Aggregate GBP value of crypto holdings. */
  cryptoExposureGbp: number;
  /** Cash buffer earmarked as the emergency fund (GBP). */
  cashBufferGbp: number;
  /** User's monthly essential expenses (GBP). */
  monthlyExpensesGbp: number;
  /** Remaining ISA allowance this tax year (GBP). */
  isaRemainingGbp: number;

  /**
   * Business cashflow signals (review §10.2). Optional — when both are 0
   * or undefined, business-reserve checks are skipped.
   */
  /** Cash sitting in business accounts. */
  businessCashGbp?: number;
  /** Sum of unpaid business obligations (VAT/PAYE/CT/payroll/rent etc.) due in the next 90 days. */
  businessObligationsDue90dGbp?: number;
  /** Monthly business fixed overhead (payroll + rent + recurring software). */
  businessMonthlyFixedGbp?: number;

  /**
   * Highest APR across the user's debt items. Used for crypto / risk-up
   * gating against toxic debt. 0 means no debt or debt only at 0% APR.
   */
  highestDebtAprPct?: number;

  /** Optional: P&L percentages — if known, used for max-loss rules. */
  dayPnlPct?: number;
  weekPnlPct?: number;
  monthPnlPct?: number;
  /** Current peak-to-trough portfolio drawdown (0..1). Gates risk-up. */
  portfolioDrawdownPct?: number;
}

export type EvaluatorContext = {
  /** Used to detect sleep-mode windows. Pass UTC time; we resolve UK local. */
  now?: Date;
  /** Treat the proposal as a paper trade if true — skips cash-floor + ISA rules. */
  isPaperTrade?: boolean;
};

// ────── Result types ──────────────────────────────────────────────────────

export type Severity = 'info' | 'warn' | 'block';

export type RuleId =
  | 'invalid_input'
  | 'max_single_position'
  | 'max_single_position_small_portfolio'
  | 'max_speculative'
  | 'max_speculative_until_buffer_healthy'
  | 'crypto_cap'
  | 'crypto_requires_buffer'
  | 'crypto_requires_no_toxic_debt'
  | 'cash_floor'
  | 'business_reserve_floor'
  | 'business_obligations_unpaid'
  | 'isa_allowance'
  | 'leverage_disallowed'
  | 'options_disallowed'
  | 'requires_approval_high_risk'
  | 'requires_approval_crypto_or_derivative'
  | 'new_instrument_cap'
  | 'sleep_mode'
  | 'paper_trade_required'
  | 'drawdown_caution'
  | 'drawdown_block';

export interface BreachedRule {
  rule: RuleId;
  severity: Severity;
  message: string;
  /** Capped vs current — populated where it makes sense. */
  capPct?: number;
  observedPct?: number;
  overByGbp?: number;
}

export interface SuggestedAdjustment {
  /** Reduce the proposal's amount to this value to satisfy all rules. */
  newAmountGbp: number;
  reason: string;
}

export interface SaferAlternative {
  kind: 'switch_wrapper' | 'switch_asset_class' | 'split' | 'wait';
  description: string;
}

export interface RiskEvaluation {
  /** True iff the action passes all rules with no breaches at all. */
  allowed: boolean;
  /** True iff at least one severity='block' rule fired. */
  blocked: boolean;
  /** True iff allowed=false OR any warn-severity rule that gates human review fired. */
  requiresApproval: boolean;
  /** 0..10 integer summarising overall risk of the proposed action. */
  riskScore: number;
  /** Plain-English summary lines, one per rule (passed or failed). */
  reasons: string[];
  /** Non-blocking warnings the user should see. */
  warnings: string[];
  /** Every rule that breached (warn or block). */
  breachedRules: BreachedRule[];
  /** If we can salvage the proposal by shrinking it, this is set. */
  suggestedAdjustment: SuggestedAdjustment | null;
  /** One suggested alternative course of action. */
  suggestedSaferAlternative: SaferAlternative | null;
}
