// K-702 — wire the risk evaluator into the proposed_action insert path.
//
// Every proposal that reaches the Approval Centre passes through here first.
// If the evaluator blocks it, we never insert. If the evaluator allows it
// (with or without warnings), we attach the evaluation to the row so the UI
// can surface reasons, alternatives, and the suggested smaller amount.
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
  | {
      outcome: 'inserted';
      proposedActionId: string;
      evaluation: RiskEvaluation;
    }
  | {
      outcome: 'blocked';
      reason: string;
      evaluation: RiskEvaluation;
    }
  | {
      outcome: 'observer_mode';
      reason: string;
      evaluation: RiskEvaluation;
    }
  | {
      outcome: 'profile_missing';
      reason: string;
    };

const DEFAULT_EXPIRY_MIN = 60 * 24 * 7; // 7 days

function profileRowToProfile(row: typeof riskProfiles.$inferSelect): RiskProfile {
  // numeric(20,4) columns come back as strings via postgres-js / Drizzle.
  const num = (v: unknown): number => Number(v);
  return {
    name: row.name,
    maxSinglePositionPct: num(row.maxSinglePositionPct),
    maxSinglePositionSmallPortfolioPct: row.maxSinglePositionSmallPortfolioPct == null
      ? null : num(row.maxSinglePositionSmallPortfolioPct),
    maxSpeculativePct: num(row.maxSpeculativePct),
    maxSpeculativeUntilBufferHealthyPct: row.maxSpeculativeUntilBufferHealthyPct == null
      ? null : num(row.maxSpeculativeUntilBufferHealthyPct),
    maxSectorPct: num(row.maxSectorPct),
    maxCountryPct: num(row.maxCountryPct),
    maxCurrencyPct: num(row.maxCurrencyPct),
    maxDailyLossPct: num(row.maxDailyLossPct),
    maxWeeklyLossPct: num(row.maxWeeklyLossPct),
    maxMonthlyLossPct: num(row.maxMonthlyLossPct),
    leverageAllowed: row.leverageAllowed,
    optionsAllowed: row.optionsAllowed,
    cryptoCapPct: num(row.cryptoCapPct),
    cryptoRequiresBuffer: row.cryptoRequiresBuffer,
    cryptoRequiresNoToxicDebt: row.cryptoRequiresNoToxicDebt,
    cashFloorMonths: num(row.cashFloorMonths),
    businessReserveFloorMonths: num(row.businessReserveFloorMonths),
    coolingOffMinutes: row.coolingOffMinutes,
    sleepModeStart: row.sleepModeStart,
    sleepModeEnd: row.sleepModeEnd,
    newInstrumentSizeCapPct: num(row.newInstrumentSizeCapPct),
    liquidityMinAdvGbp: num(row.liquidityMinAdvGbp),
    paperTradeDays: row.paperTradeDays,
  };
}

export async function submitProposedAction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  input: SubmitInput,
): Promise<SubmitResult> {
  // 1. Kill switch
  const mode = process.env.WEALTH_MODE ?? 'advisor';
  // We still run the evaluator so the caller learns what *would* have happened.

  // 2. Load active risk profile
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

  // 3. Evaluate
  const evaluation = evaluateRisk(input.action, input.portfolio, profile, input.context ?? {});

  // 4. Kill switch — do not write
  if (mode === 'observer') {
    return {
      outcome: 'observer_mode',
      reason: 'WEALTH_MODE=observer is set; no writes performed.',
      evaluation,
    };
  }

  // 5. Block path
  if (evaluation.blocked) {
    return {
      outcome: 'blocked',
      reason: evaluation.breachedRules
        .filter((b) => b.severity === 'block')
        .map((b) => `${b.rule}: ${b.message}`)
        .join('  |  '),
      evaluation,
    };
  }

  // 6. Insert path
  const reasonText = [input.caller.extraReason, ...evaluation.reasons]
    .filter(Boolean)
    .join('\n');

  const expiresAt = new Date(
    Date.now() + (input.caller.expiresInMinutes ?? DEFAULT_EXPIRY_MIN) * 60_000,
  );

  const alternatives = evaluation.suggestedSaferAlternative
    ? [
        {
          kind: evaluation.suggestedSaferAlternative.kind,
          description: evaluation.suggestedSaferAlternative.description,
        },
        ...(evaluation.suggestedAdjustment
          ? [
              {
                kind: 'reduce_amount' as const,
                description: evaluation.suggestedAdjustment.reason,
                newAmountGbp: evaluation.suggestedAdjustment.newAmountGbp,
              },
            ]
          : []),
      ]
    : evaluation.suggestedAdjustment
    ? [
        {
          kind: 'reduce_amount' as const,
          description: evaluation.suggestedAdjustment.reason,
          newAmountGbp: evaluation.suggestedAdjustment.newAmountGbp,
        },
      ]
    : [];

  const [row] = await db
    .insert(proposedActions)
    .values({
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
    })
    .returning({ id: proposedActions.id });

  return {
    outcome: 'inserted',
    proposedActionId: row!.id,
    evaluation,
  };
}
