// ISA contribution tracker.
//
// Records individual deposits and keeps isa_years.{deposited,remaining} in
// sync. The Coach + dashboard pull from isa_years; this service is the only
// path that recomputes those totals.

import { and, desc, eq, sum } from 'drizzle-orm';
import { z } from 'zod';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { isaDeposits, isaYears, accounts } from '../db/schema/index';
import { getTaxRules, taxYearFor } from '../tax';

export const isaDepositInputSchema = z.object({
  accountId: z.string().uuid(),
  depositedAt: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'invalid date'),
  amountGbp: z.coerce.number().finite().positive(),
  taxYear: z.coerce.number().int().min(2000).max(2100),
  notes: z.string().max(2000).optional().nullable(),
});

export type IsaDepositInput = z.infer<typeof isaDepositInputSchema>;

export interface IsaDepositRow {
  id: string;
  accountId: string;
  accountName: string;
  depositedAt: Date;
  amountGbp: number;
  taxYear: number;
  notes: string | null;
}

export function validateIsaDepositInput(raw: unknown): IsaDepositInput {
  return isaDepositInputSchema.parse(raw);
}

export function currentTaxYearNumber(now: Date = new Date()): number {
  return taxYearFor(now).number;
}

export async function listIsaDeposits(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  userId: string,
): Promise<IsaDepositRow[]> {
  const rows = await db
    .select({ d: isaDeposits, accountName: accounts.name })
    .from(isaDeposits)
    .innerJoin(accounts, eq(accounts.id, isaDeposits.accountId))
    .where(eq(isaDeposits.userId, userId))
    .orderBy(desc(isaDeposits.depositedAt));
  return rows.map((r) => ({
    id: r.d.id,
    accountId: r.d.accountId,
    accountName: r.accountName,
    depositedAt: r.d.depositedAt,
    amountGbp: Number(r.d.amount),
    taxYear: r.d.taxYear,
    notes: r.d.notes,
  }));
}

/** Ensure an isa_years row exists for (userId, taxYear) and return it. */
async function ensureIsaYearRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  args: { userId: string; taxYear: number },
): Promise<typeof isaYears.$inferSelect> {
  const [existing] = await db
    .select()
    .from(isaYears)
    .where(and(eq(isaYears.userId, args.userId), eq(isaYears.taxYear, args.taxYear)))
    .limit(1);
  if (existing) return existing;

  const rules = getTaxRules();
  const allowance = rules.isa.total_allowance_gbp;
  const [row] = await db
    .insert(isaYears)
    .values({
      userId: args.userId,
      taxYear: args.taxYear,
      allowance: allowance.toString(),
      deposited: '0',
      remaining: allowance.toString(),
    })
    .returning();
  return row!;
}

/** Recompute deposited/remaining for a single (userId, taxYear). */
export async function recomputeIsaYear(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  args: { userId: string; taxYear: number },
): Promise<{ allowance: number; deposited: number; remaining: number }> {
  const year = await ensureIsaYearRow(db, args);
  const allowance = Number(year.allowance);

  const [agg] = await db
    .select({ total: sum(isaDeposits.amount) })
    .from(isaDeposits)
    .where(and(eq(isaDeposits.userId, args.userId), eq(isaDeposits.taxYear, args.taxYear)));
  const deposited = Number(agg?.total ?? 0);
  const remaining = Math.max(0, allowance - deposited);

  await db
    .update(isaYears)
    .set({
      deposited: deposited.toString(),
      remaining: remaining.toString(),
      computedAt: new Date(),
    })
    .where(eq(isaYears.id, year.id));

  return { allowance, deposited, remaining };
}

export async function createIsaDeposit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  args: { userId: string; input: IsaDepositInput },
): Promise<{ id: string; isaYearTotals: { allowance: number; deposited: number; remaining: number } }> {
  // Ownership check via account.
  const [a] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, args.input.accountId), eq(accounts.userId, args.userId)))
    .limit(1);
  if (!a) throw new Error('account not found for this user');

  const [row] = await db
    .insert(isaDeposits)
    .values({
      userId: args.userId,
      accountId: args.input.accountId,
      depositedAt: new Date(args.input.depositedAt),
      amount: args.input.amountGbp.toString(),
      taxYear: args.input.taxYear,
      notes: args.input.notes ?? null,
    })
    .returning({ id: isaDeposits.id });

  const totals = await recomputeIsaYear(db, {
    userId: args.userId,
    taxYear: args.input.taxYear,
  });

  return { id: row!.id, isaYearTotals: totals };
}

export async function deleteIsaDeposit(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  args: { userId: string; depositId: string },
): Promise<void> {
  const [d] = await db
    .select({ id: isaDeposits.id, taxYear: isaDeposits.taxYear })
    .from(isaDeposits)
    .where(and(eq(isaDeposits.id, args.depositId), eq(isaDeposits.userId, args.userId)))
    .limit(1);
  if (!d) return;
  await db.delete(isaDeposits).where(eq(isaDeposits.id, args.depositId));
  await recomputeIsaYear(db, { userId: args.userId, taxYear: d.taxYear });
}
