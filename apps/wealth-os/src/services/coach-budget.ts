// Personal monthly spend cap for the Coach.
//
// You're the only user, so this is a single number: "don't spend more than
// $X on Coach narration in this calendar month". The deterministic report
// is free and always runs; only the LLM narration step is gated.
//
// Pure decision helper + a thin infra read on agent_runs.

import { and, eq, gte } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { agentRuns } from '../db/schema/index';

export interface BudgetStatus {
  monthSpentUsd: number;
  monthCapUsd: number;
  exceeded: boolean;
  monthStart: string;     // ISO 8601 UTC
}

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
