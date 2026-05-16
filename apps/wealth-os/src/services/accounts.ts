// Account CRUD service for manual data entry.
//
// Two layers:
//   * Pure validation (validateAccountInput) — Zod schema, no I/O.
//   * Infra (createAccount / updateAccount / deleteAccount / listAccounts) —
//     drizzle reads/writes only. Easy to unit-test the first, easy to
//     integration-test the second.
//
// Accounts hold an explicit `current_balance` after migration 0003; this
// service is the only path that writes to it.

import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { accounts, institutions } from '../db/schema/index';

export const ACCOUNT_TYPES = [
  'cash',
  'savings',
  'current',
  'business',
  'isa',
  'gia',
  'pension',
  'crypto',
  'credit',
  'loan',
  'mortgage',
  'debt',
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const accountInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(ACCOUNT_TYPES),
  currency: z.string().length(3).toUpperCase().default('GBP'),
  currentBalanceGbp: z.coerce.number().finite(),
  isBusiness: z.boolean().default(false),
  isIsa: z.boolean().default(false),
  isaType: z.string().max(30).optional().nullable(),
  institutionId: z.string().uuid().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  active: z.boolean().default(true),
});

export type AccountInput = z.infer<typeof accountInputSchema>;

export interface AccountRow {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  currentBalanceGbp: number;
  isBusiness: boolean;
  isIsa: boolean;
  institutionId: string | null;
  notes: string | null;
  active: boolean;
  source: string;
  createdAt: Date;
}

export function validateAccountInput(raw: unknown): AccountInput {
  return accountInputSchema.parse(raw);
}

function rowToAccount(row: typeof accounts.$inferSelect): AccountRow {
  return {
    id: row.id,
    name: row.name,
    type: row.type as AccountType,
    currency: row.currency,
    currentBalanceGbp: Number(row.currentBalance),
    isBusiness: row.isBusiness,
    isIsa: row.isIsa,
    institutionId: row.institutionId,
    notes: row.notes,
    active: row.closedAt === null,
    source: row.source,
    createdAt: row.createdAt,
  };
}

export async function listAccounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  userId: string,
): Promise<AccountRow[]> {
  const rows = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, userId))
    .orderBy(asc(accounts.createdAt));
  return rows.map(rowToAccount);
}

export async function listInstitutions(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
): Promise<Array<{ id: string; name: string }>> {
  return db
    .select({ id: institutions.id, name: institutions.name })
    .from(institutions)
    .orderBy(asc(institutions.name));
}

export async function createAccount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  args: { userId: string; input: AccountInput },
): Promise<{ id: string }> {
  const { userId, input } = args;
  const [row] = await db
    .insert(accounts)
    .values({
      userId,
      name: input.name,
      type: input.type,
      currency: input.currency,
      currentBalance: input.currentBalanceGbp.toString(),
      isBusiness: input.isBusiness,
      isIsa: input.isIsa || input.type === 'isa',
      isaType: input.isaType ?? null,
      institutionId: input.institutionId ?? null,
      notes: input.notes ?? null,
      source: 'manual',
      closedAt: input.active ? null : new Date(),
    })
    .returning({ id: accounts.id });
  return { id: row!.id };
}

export async function updateAccount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  args: { userId: string; accountId: string; input: AccountInput },
): Promise<void> {
  const { userId, accountId, input } = args;
  await db
    .update(accounts)
    .set({
      name: input.name,
      type: input.type,
      currency: input.currency,
      currentBalance: input.currentBalanceGbp.toString(),
      isBusiness: input.isBusiness,
      isIsa: input.isIsa || input.type === 'isa',
      isaType: input.isaType ?? null,
      institutionId: input.institutionId ?? null,
      notes: input.notes ?? null,
      closedAt: input.active ? null : new Date(),
    })
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
}

export async function deleteAccount(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  args: { userId: string; accountId: string },
): Promise<void> {
  await db
    .delete(accounts)
    .where(and(eq(accounts.id, args.accountId), eq(accounts.userId, args.userId)));
}
