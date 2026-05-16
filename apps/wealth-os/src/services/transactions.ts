// Manual transaction CRUD service.
//
// Transactions are used by loadSnapshot for cashflow analysis (monthly
// income vs expense in the current calendar month). They do NOT drive
// account balances any more — that lives on accounts.current_balance.

import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { accounts, transactions, categories } from '../db/schema/index';

export const TRANSACTION_DIRECTIONS = [
  'income',
  'expense',
  'transfer',
  'investment',
  'debt_payment',
] as const;
export type TransactionDirection = (typeof TRANSACTION_DIRECTIONS)[number];

export const transactionInputSchema = z.object({
  accountId: z.string().uuid(),
  postedAt: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'invalid date'),
  amountGbp: z.coerce.number().finite(),
  direction: z.enum(TRANSACTION_DIRECTIONS),
  categoryId: z.string().uuid().optional().nullable(),
  description: z.string().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  holdingId: z.string().uuid().optional().nullable(),
  recurring: z.boolean().default(false),
});

export type TransactionInput = z.infer<typeof transactionInputSchema>;

export interface TransactionRow {
  id: string;
  accountId: string;
  accountName: string;
  postedAt: Date;
  amountGbp: number;
  direction: TransactionDirection | null;
  categoryId: string | null;
  categoryName: string | null;
  description: string | null;
  notes: string | null;
  holdingId: string | null;
  recurring: boolean;
}

export function validateTransactionInput(raw: unknown): TransactionInput {
  return transactionInputSchema.parse(raw);
}

export async function listTransactions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  userId: string,
  opts: { limit?: number } = {},
): Promise<TransactionRow[]> {
  const rows = await db
    .select({
      t: transactions,
      accountName: accounts.name,
      categoryName: categories.name,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(eq(accounts.userId, userId))
    .orderBy(desc(transactions.postedAt))
    .limit(opts.limit ?? 200);

  return rows.map((r) => ({
    id: r.t.id,
    accountId: r.t.accountId,
    accountName: r.accountName,
    postedAt: r.t.postedAt,
    amountGbp: Number(r.t.amount),
    direction: (r.t.direction as TransactionDirection | null) ?? null,
    categoryId: r.t.categoryId,
    categoryName: r.categoryName,
    description: r.t.descriptionClean ?? r.t.descriptionRaw ?? null,
    notes: r.t.notes,
    holdingId: r.t.holdingId,
    recurring: r.t.recurring,
  }));
}

export async function listCategories(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  userId: string,
): Promise<Array<{ id: string; name: string; kind: string }>> {
  return db
    .select({ id: categories.id, name: categories.name, kind: categories.kind })
    .from(categories)
    .where(eq(categories.userId, userId))
    .orderBy(asc(categories.kind), asc(categories.name));
}

async function assertAccountOwnership(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  userId: string,
  accountId: string,
): Promise<void> {
  const [a] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)))
    .limit(1);
  if (!a) throw new Error('account not found for this user');
}

// Convention: amounts are stored signed, where income/expense direction
// determines the sign. Storing both `direction` and a signed `amount`
// is intentional — sign helps charting, direction helps filtering.
function signedAmount(input: TransactionInput): string {
  const abs = Math.abs(input.amountGbp);
  const signed = input.direction === 'expense' || input.direction === 'debt_payment'
    ? -abs
    : abs;
  return signed.toString();
}

export async function createTransaction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  args: { userId: string; input: TransactionInput },
): Promise<{ id: string }> {
  await assertAccountOwnership(db, args.userId, args.input.accountId);
  const i = args.input;
  const [row] = await db
    .insert(transactions)
    .values({
      accountId: i.accountId,
      postedAt: new Date(i.postedAt),
      amount: signedAmount(i),
      currency: 'GBP',
      descriptionClean: i.description ?? null,
      descriptionRaw: i.description ?? null,
      categoryId: i.categoryId ?? null,
      direction: i.direction,
      notes: i.notes ?? null,
      holdingId: i.holdingId ?? null,
      recurring: i.recurring,
      isTransfer: i.direction === 'transfer',
      source: 'manual',
    })
    .returning({ id: transactions.id });
  return { id: row!.id };
}

export async function updateTransaction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  args: { userId: string; transactionId: string; input: TransactionInput },
): Promise<void> {
  await assertAccountOwnership(db, args.userId, args.input.accountId);
  const i = args.input;
  await db
    .update(transactions)
    .set({
      accountId: i.accountId,
      postedAt: new Date(i.postedAt),
      amount: signedAmount(i),
      descriptionClean: i.description ?? null,
      descriptionRaw: i.description ?? null,
      categoryId: i.categoryId ?? null,
      direction: i.direction,
      notes: i.notes ?? null,
      holdingId: i.holdingId ?? null,
      recurring: i.recurring,
      isTransfer: i.direction === 'transfer',
    })
    .where(eq(transactions.id, args.transactionId));
}

export async function deleteTransaction(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  args: { userId: string; transactionId: string },
): Promise<void> {
  const [t] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .where(and(eq(transactions.id, args.transactionId), eq(accounts.userId, args.userId)))
    .limit(1);
  if (!t) return;
  await db.delete(transactions).where(eq(transactions.id, args.transactionId));
}
