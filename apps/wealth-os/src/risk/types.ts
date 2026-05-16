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
  maxSpeculativePct: number;
  maxSectorPct: number;
  maxCountryPct: number;
  maxCurrencyPct: number;
  maxDailyLossPct: number;
  maxWeeklyLossPct: number;
  maxMonthlyLossPct: number;
  leverageAllowed: boolean;
  optionsAllowed: boolean;
  cryptoCapPct: number;
  /** months of essential expenses required as cash floor */
  cashFloorMonths: number;
  coolingOffMinutes: number;
  sleepModeStart: string; // "HH:MM"
  sleepModeEnd: string;   // "HH:MM"
  newInstrumentSizeCapPct: number;
  liquidityMinAdvGbp: number;
  paperTradeDays: number;
}

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
  /** Optional: P&L percentages — if known, used for max-loss rules. */
  dayPnlPct?: number;
  weekPnlPct?: number;
  monthPnlPct?: number;
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
  | 'max_speculative'
  | 'crypto_cap'
  | 'cash_floor'
  | 'isa_allowance'
  | 'leverage_disallowed'
  | 'options_disallowed'
  | 'requires_approval_high_risk'
  | 'requires_approval_crypto_or_derivative'
  | 'new_instrument_cap'
  | 'sleep_mode'
  | 'paper_trade_required';

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
