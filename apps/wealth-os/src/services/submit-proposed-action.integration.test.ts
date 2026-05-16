// Integration test — requires:
//   * RUN_INTEGRATION=1 in env (opt-in gate)
//   * DATABASE_URL pointing at a Postgres with the schema applied
//   * `pnpm db:bootstrap` already run (seed user must exist)
//
// Without the gate, the whole suite is skipped so `pnpm test:integration`
// stays clean in environments that don't have a live DB.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { proposedActions, users } from '../db/schema/index';
import type { PortfolioState, ProposedAction } from '../risk/types';
import { submitProposedAction } from './submit-proposed-action';

const ENABLED = process.env.RUN_INTEGRATION === '1';
const URL = process.env.DATABASE_URL ?? 'postgres://wealth_os:wealth_os@localhost:5432/wealth_os';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: PostgresJsDatabase<any>;
let sqlClient: ReturnType<typeof postgres>;
let userId: string;

const portfolio: PortfolioState = {
  totalValueGbp: 50_000,
  existingPositionGbp: 0,
  speculativeExposureGbp: 0,
  cryptoExposureGbp: 0,
  cashBufferGbp: 10_000,
  monthlyExpensesGbp: 2_000,
  isaRemainingGbp: 4_400,
};

const safeAction: ProposedAction = {
  kind: 'buy',
  assetClass: 'developed_equity',
  wrapper: 'isa',
  amountGbp: 500,
};

const blockingAction: ProposedAction = {
  kind: 'buy',
  assetClass: 'developed_equity',
  wrapper: 'gia',
  amountGbp: 7_000, // breaches 12% cap on £50k
};

const DAYTIME = new Date('2026-05-16T12:00:00Z');

beforeAll(async () => {
  if (!ENABLED) return;
  sqlClient = postgres(URL, { max: 1, idle_timeout: 5 });
  db = drizzle(sqlClient);
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error('no seed user — run `pnpm db:bootstrap` first.');
  userId = u.id;
});

afterAll(async () => {
  if (!ENABLED) return;
  await sqlClient.end();
});

describe.skipIf(!ENABLED)('submitProposedAction (integration)', () => {
  it('inserts an allowed action and returns the new row id', async () => {
    const r = await submitProposedAction(db, {
      userId,
      agent: 'wealth-cashflow',
      dbKind: 'allocation_change',
      action: safeAction,
      portfolio,
      caller: { confidence: 0.8, upside: '+£35/yr est.', downside: 'small short-term drawdown' },
      context: { now: DAYTIME },
    });

    expect(r.outcome).toBe('inserted');
    if (r.outcome !== 'inserted') return;
    expect(r.proposedActionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.evaluation.allowed).toBe(true);

    const rows = await db.select().from(proposedActions).where(eq(proposedActions.id, r.proposedActionId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.agent).toBe('wealth-cashflow');
    expect(rows[0]!.status).toBe('pending');
    expect(Number(rows[0]!.amountAtRisk)).toBe(500);
    expect(rows[0]!.riskScore).toBeGreaterThanOrEqual(0);

    // Clean up so the next run starts clean.
    await db.delete(proposedActions).where(eq(proposedActions.id, r.proposedActionId));
  });

  it('refuses to insert when the evaluator blocks the action', async () => {
    const before = await db.select({ id: proposedActions.id }).from(proposedActions);
    const beforeCount = before.length;

    const r = await submitProposedAction(db, {
      userId,
      agent: 'wealth-cashflow',
      dbKind: 'trade',
      action: blockingAction,
      portfolio,
      caller: { confidence: 0.8 },
      context: { now: DAYTIME },
    });

    expect(r.outcome).toBe('blocked');
    if (r.outcome !== 'blocked') return;
    expect(r.evaluation.blocked).toBe(true);
    expect(r.evaluation.breachedRules.some((b) => b.rule === 'max_single_position')).toBe(true);
    expect(r.reason).toContain('max_single_position');

    const after = await db.select({ id: proposedActions.id }).from(proposedActions);
    expect(after.length).toBe(beforeCount); // nothing was written
  });

  it('returns profile_missing when no active risk profile exists', async () => {
    const bogusUserId = '00000000-0000-0000-0000-000000000000';
    const r = await submitProposedAction(db, {
      userId: bogusUserId,
      agent: 'wealth-cashflow',
      dbKind: 'allocation_change',
      action: safeAction,
      portfolio,
      caller: { confidence: 0.8 },
    });
    expect(r.outcome).toBe('profile_missing');
  });

  it('honours WEALTH_MODE=observer (kill switch) without writing', async () => {
    const prev = process.env.WEALTH_MODE;
    process.env.WEALTH_MODE = 'observer';

    const before = await db.select({ id: proposedActions.id }).from(proposedActions);
    const beforeCount = before.length;

    const r = await submitProposedAction(db, {
      userId,
      agent: 'wealth-cashflow',
      dbKind: 'allocation_change',
      action: safeAction,
      portfolio,
      caller: { confidence: 0.8 },
      context: { now: DAYTIME },
    });

    process.env.WEALTH_MODE = prev;

    expect(r.outcome).toBe('observer_mode');
    if (r.outcome === 'observer_mode') {
      expect(r.evaluation.allowed).toBe(true); // evaluator still ran
    }
    const after = await db.select({ id: proposedActions.id }).from(proposedActions);
    expect(after.length).toBe(beforeCount);
  });

  it('attaches suggested adjustment and alternative when the evaluator provides them', async () => {
    // ISA deposit larger than allowance: evaluator returns adjustment + switch_wrapper alt.
    const r = await submitProposedAction(db, {
      userId,
      agent: 'wealth-isa',
      dbKind: 'allocation_change',
      action: { kind: 'deposit_isa', assetClass: 'cash', wrapper: 'isa', amountGbp: 6_000 },
      portfolio: { ...portfolio, isaRemainingGbp: 4_400 },
      caller: { confidence: 0.9 },
      context: { now: DAYTIME },
    });
    // This is blocked, so should not insert.
    expect(r.outcome).toBe('blocked');
    if (r.outcome !== 'blocked') return;
    expect(r.evaluation.suggestedAdjustment?.newAmountGbp).toBeLessThanOrEqual(4_400);
    expect(r.evaluation.suggestedSaferAlternative?.kind).toBe('switch_wrapper');
  });
});
