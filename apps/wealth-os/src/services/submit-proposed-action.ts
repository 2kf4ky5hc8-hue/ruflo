// K-702 — wire the risk evaluator into the proposed_action insert path.
//
// Two layers:
//   * `decideOnProposedAction` is PURE. Same inputs -> same outputs. No DB,
//     no clock reads other than the one passed in. This is what we unit-test.
//   * `submitProposedAction` is the orchestrator. It loads the risk profile,
//     calls the pure decider, and (only when the decision is "insert")
//     writes the row.
//
// Kill switch: when WEALTH_MODE=observer is set in env, nothing is written
// regardless of evaluator outcome.

import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { proposedActions, riskProfiles } from '../db/schema/index';
import { evaluateRisk } from '../risk/evaluator';
import type {
  EvaluatorContext, PortfolioState, ProposedAction, RiskEvaluation, RiskProfile,
} from '../risk/types';

export type ProposedActionDbKind =
  | 'trade'
  | 'transfer'
  | 'allocation_change'
  | 'rule_change'
  | 'integration_grant'
  | 'cancel_subscription_review'
  | 'allowance_reminder';

export interface SubmitInput {
  userId: string;
  agent: string;
  /** High-level category for the UI; payload carries the typed action. */
  dbKind: ProposedActionDbKind;
  /** The action the risk evaluator scores. */
  action: ProposedAction;
  /** Current portfolio snapshot used by the evaluator. */
  portfolio: PortfolioState;
  /** Caller-supplied data not derivable from the evaluator. */
  caller: {
    confidence: number;          // 0..1
    upside?: string;
    downside?: string;
    /** Extra reason lines prepended to the evaluator's lines. */
    extraReason?: string;
    /** When the approval expires (default: 7 days). */
    expiresInMinutes?: number;
  };
  /** Override clock / mark as paper trade. */
  context?: EvaluatorContext;
}

export type SubmitResult =
  | { outcome: 'inserted';        proposedActionId: string; evaluation: RiskEvaluation }
  | { outcome: 'blocked';         reason: string;            evaluation: RiskEvaluation }
  | { outcome: 'observer_mode';   reason: string;            evaluation: RiskEvaluation }
  | { outcome: 'profile_missing'; reason: string };

const DEFAULT_EXPIRY_MIN = 60 * 24 * 7; // 7 days

// ────────────────────────────────────────────────────────────────────────────
// Pure layer — no DB, no env, no clock.

export type WealthMode = 'advisor' | 'observer';

export type InsertableRow = typeof proposedActions.$inferInsert;

export type Decision =
  | { kind: 'insert';        evaluation: RiskEvaluation; values: InsertableRow }
  | { kind: 'block';         evaluation: RiskEvaluation; reason: string }
  | { kind: 'observer_mode'; evaluation: RiskEvaluation; reason: string };

export function decideOnProposedAction(args: {
  input: SubmitInput;
  profile: RiskProfile;
  mode: WealthMode;
  now: Date;
}): Decision {
  const { input, profile, mode, now } = args;

  const evaluation = evaluateRisk(input.action, input.portfolio, profile, input.context ?? { now });

  if (mode === 'observer') {
    return {
      kind: 'observer_mode',
      evaluation,
      reason: 'WEALTH_MODE=observer is set; no writes performed.',
    };
  }

  if (evaluation.blocked) {
    return {
      kind: 'block',
      evaluation,
      reason: evaluation.breachedRules
        .filter((b) => b.severity === 'block')
        .map((b) => `${b.rule}: ${b.message}`)
        .join('  |  '),
    };
  }

  const reasonText = [input.caller.extraReason, ...evaluation.reasons]
    .filter(Boolean)
    .join('\n');

  const expiresAt = new Date(
    now.getTime() + (input.caller.expiresInMinutes ?? DEFAULT_EXPIRY_MIN) * 60_000,
  );

  const alternatives = buildAlternatives(evaluation);

  const values: InsertableRow = {
    userId: input.userId,
    agent: input.agent,
    kind: input.dbKind,
    payload: {
      action: input.action,
      portfolio: input.portfolio,
      evaluation: {
        allowed: evaluation.allowed,
        requiresApproval: evaluation.requiresApproval,
        warnings: evaluation.warnings,
        breachedRules: evaluation.breachedRules,
      },
    },
    reason: reasonText,
    upside: input.caller.upside ?? null,
    downside: input.caller.downside ?? null,
    riskScore: evaluation.riskScore,
    confidence: input.caller.confidence.toString(),
    amountAtRisk: input.action.amountGbp.toString(),
    alternatives: alternatives.length > 0 ? alternatives : null,
    expiresAt,
    status: 'pending',
  };

  return { kind: 'insert', evaluation, values };
}

function buildAlternatives(evaluation: RiskEvaluation): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (evaluation.suggestedSaferAlternative) {
    out.push({
      kind: evaluation.suggestedSaferAlternative.kind,
      description: evaluation.suggestedSaferAlternative.description,
    });
  }
  if (evaluation.suggestedAdjustment) {
    out.push({
      kind: 'reduce_amount',
      description: evaluation.suggestedAdjustment.reason,
      newAmountGbp: evaluation.suggestedAdjustment.newAmountGbp,
    });
  }
  return out;
}

// numeric(20,4) columns come back as strings via postgres-js / Drizzle.
export function profileRowToProfile(row: typeof riskProfiles.$inferSelect): RiskProfile {
  const num = (v: unknown): number => Number(v);
  return {
    name: row.name,
    maxSinglePositionPct: num(row.maxSinglePositionPct),
    maxSpeculativePct: num(row.maxSpeculativePct),
    maxSectorPct: num(row.maxSectorPct),
    maxCountryPct: num(row.maxCountryPct),
    maxCurrencyPct: num(row.maxCurrencyPct),
    maxDailyLossPct: num(row.maxDailyLossPct),
    maxWeeklyLossPct: num(row.maxWeeklyLossPct),
    maxMonthlyLossPct: num(row.maxMonthlyLossPct),
    leverageAllowed: row.leverageAllowed,
    optionsAllowed: row.optionsAllowed,
    cryptoCapPct: num(row.cryptoCapPct),
    cashFloorMonths: num(row.cashFloorMonths),
    coolingOffMinutes: row.coolingOffMinutes,
    sleepModeStart: row.sleepModeStart,
    sleepModeEnd: row.sleepModeEnd,
    newInstrumentSizeCapPct: num(row.newInstrumentSizeCapPct),
    liquidityMinAdvGbp: num(row.liquidityMinAdvGbp),
    paperTradeDays: row.paperTradeDays,
  };
}

function readMode(): WealthMode {
  return process.env.WEALTH_MODE === 'observer' ? 'observer' : 'advisor';
}

// ────────────────────────────────────────────────────────────────────────────
// Orchestrator — touches the DB.

export async function submitProposedAction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  input: SubmitInput,
): Promise<SubmitResult> {
  const profileRows = await db
    .select()
    .from(riskProfiles)
    .where(and(eq(riskProfiles.userId, input.userId), eq(riskProfiles.active, true)))
    .limit(1);

  if (profileRows.length === 0) {
    return {
      outcome: 'profile_missing',
      reason: `No active risk profile for user ${input.userId}.`,
    };
  }

  const profile = profileRowToProfile(profileRows[0]!);
  const decision = decideOnProposedAction({
    input,
    profile,
    mode: readMode(),
    now: input.context?.now ?? new Date(),
  });

  if (decision.kind === 'observer_mode') {
    return { outcome: 'observer_mode', reason: decision.reason, evaluation: decision.evaluation };
  }
  if (decision.kind === 'block') {
    return { outcome: 'blocked', reason: decision.reason, evaluation: decision.evaluation };
  }

  const [row] = await db
    .insert(proposedActions)
    .values(decision.values)
    .returning({ id: proposedActions.id });

  return {
    outcome: 'inserted',
    proposedActionId: row!.id,
    evaluation: decision.evaluation,
  };
}
