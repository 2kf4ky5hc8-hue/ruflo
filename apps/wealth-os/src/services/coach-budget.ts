// Personal limits for the Coach.
//
// Two caps, both per-user, both reset on UTC boundaries:
//   * Daily run cap   — count of wealth-coach agent_runs in the current UTC day
//   * Monthly $ cap   — sum of agent_runs.cost_usd in the current UTC month
//
// Reaching either is a hard stop: the API returns 429, the deterministic
// report doesn't even build. This is deliberate — the caps exist to prevent
// click-spam and runaway spend, and there's nothing useful you can do with
// the report when the cap fires that you couldn't see on your last run.
//
// Pure decision helper + thin infra reads on agent_runs.

import { and, eq, gte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { agentRuns } from '../db/schema/index';

export interface BudgetStatus {
  monthSpentUsd: number;
  monthCapUsd: number;
  exceeded: boolean;
  monthStart: string;     // ISO 8601 UTC
}

export interface CoachLimitCaps {
  dailyCap: number;
  monthlyUsdCap: number;
}

export interface CoachLimitUsage {
  runsToday: number;
  monthlyCostUsd: number;
}

export type CoachLimitReason = 'daily' | 'monthly';

export interface CoachLimitOk {
  ok: true;
  usage: CoachLimitUsage;
  caps: CoachLimitCaps;
  resetsAt: Date;           // next reset boundary that's relevant
}
export interface CoachLimitBlocked {
  ok: false;
  reason: CoachLimitReason;
  usage: CoachLimitUsage;
  caps: CoachLimitCaps;
  resetsAt: Date;
  message: string;
}
export type CoachLimitDecision = CoachLimitOk | CoachLimitBlocked;

// Pure — same inputs, same output.
export function budgetStatus(args: {
  spentUsd: number;
  capUsd: number;
  monthStart: Date;
}): BudgetStatus {
  return {
    monthSpentUsd: args.spentUsd,
    monthCapUsd: args.capUsd,
    exceeded: args.spentUsd >= args.capUsd,
    monthStart: args.monthStart.toISOString(),
  };
}

// UTC month boundary — first day, 00:00:00.000.
export function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
export function utcMonthEnd(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

// UTC day boundary — midnight today, midnight tomorrow.
export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
export function utcDayEnd(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

// Pure decision. Same inputs -> same outputs.
export function evaluateCoachLimits(args: {
  usage: CoachLimitUsage;
  caps: CoachLimitCaps;
  now: Date;
}): CoachLimitDecision {
  const { usage, caps, now } = args;

  if (usage.runsToday >= caps.dailyCap) {
    return {
      ok: false,
      reason: 'daily',
      usage,
      caps,
      resetsAt: utcDayEnd(now),
      message: `Daily Coach cap reached (${usage.runsToday}/${caps.dailyCap} runs today). Resets at midnight UTC.`,
    };
  }
  if (usage.monthlyCostUsd >= caps.monthlyUsdCap) {
    return {
      ok: false,
      reason: 'monthly',
      usage,
      caps,
      resetsAt: utcMonthEnd(now),
      message: `Monthly Coach spend cap reached ($${usage.monthlyCostUsd.toFixed(3)} / $${caps.monthlyUsdCap.toFixed(2)}). Resets on the 1st of next month UTC.`,
    };
  }
  // Earliest meaningful reset is whichever cap is closer to firing.
  const closer = (caps.dailyCap - usage.runsToday) <= 1
    ? utcDayEnd(now)
    : utcMonthEnd(now);
  return { ok: true, usage, caps, resetsAt: closer };
}

// Sum every wealth-coach agent_run cost since the start of `now`'s UTC month.
export async function monthlySpendUsd(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  args: { userId: string; now: Date },
): Promise<number> {
  const monthStart = utcMonthStart(args.now);
  const rows = await db
    .select({ costUsd: agentRuns.costUsd })
    .from(agentRuns)
    .where(and(
      eq(agentRuns.userId, args.userId),
      eq(agentRuns.agent, 'wealth-coach'),
      gte(agentRuns.startedAt, monthStart),
    ));
  return rows.reduce((sum, r) => sum + Number(r.costUsd ?? 0), 0);
}

// Count every wealth-coach agent_run since UTC midnight today.
export async function dailyRunCount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  args: { userId: string; now: Date },
): Promise<number> {
  const dayStart = utcDayStart(args.now);
  const rows = await db
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(and(
      eq(agentRuns.userId, args.userId),
      eq(agentRuns.agent, 'wealth-coach'),
      gte(agentRuns.startedAt, dayStart),
    ));
  return rows.length;
}

// Convenience: load both usage figures + evaluate caps in one call.
export async function checkCoachLimits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  args: { userId: string; caps: CoachLimitCaps; now: Date },
): Promise<CoachLimitDecision> {
  const [runsToday, monthlyCostUsd] = await Promise.all([
    dailyRunCount(db, { userId: args.userId, now: args.now }),
    monthlySpendUsd(db, { userId: args.userId, now: args.now }),
  ]);
  return evaluateCoachLimits({
    usage: { runsToday, monthlyCostUsd },
    caps: args.caps,
    now: args.now,
  });
}

export class CoachLimitError extends Error {
  readonly decision: CoachLimitBlocked;
  constructor(decision: CoachLimitBlocked) {
    super(decision.message);
    this.name = 'CoachLimitError';
    this.decision = decision;
  }
}
