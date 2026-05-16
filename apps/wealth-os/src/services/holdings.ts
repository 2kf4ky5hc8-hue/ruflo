// Manual holding CRUD service.
//
// Holdings store denormalized asset metadata since 0003_manual_entry —
// manual entry doesn't need an instruments row. Future broker integrations
// can link via holdings.instrument_id and leave the denormalized columns
// null.

import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { holdings, accounts } from '../db/schema/index';

export const ASSET_TYPES = ['stock', 'etf', 'fund', 'bond', 'crypto', 'cash', 'other'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const RISK_CATEGORIES = ['low', 'medium', 'high', 'speculative'] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const holdingInputSchema = z.object({
  accountId: z.string().uuid(),
  assetName: z.string().trim().min(1).max(200),
  tickerLocal: z.string().trim().max(40).optional().nullable(),
  assetType: z.enum(ASSET_TYPES),
  quantity: z.coerce.number().finite().nonnegative(),
  avgCost: z.coerce.number().finite().nonnegative().optional().nullable(),
  currentPrice: z.coerce.number().finite().nonnegative().optional().nullable(),
  currency: z.string().length(3).toUpperCase().default('GBP'),
  riskCategory: z.enum(RISK_CATEGORIES).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export type HoldingInput = z.infer<typeof holdingInputSchema>;

export interface HoldingRow {
  id: string;
  accountId: string;
  accountName: string;
  assetName: string;
  tickerLocal: string | null;
  assetType: AssetType;
  quantity: number;
  avgCost: number | null;
  currentPrice: number | null;
  currentValueGbp: number;       // quantity * currentPrice (0 if no price)
  currency: string;
  riskCategory: RiskCategory | null;
  notes: string | null;
}

export function validateHoldingInput(raw: unknown): HoldingInput {
  return holdingInputSchema.parse(raw);
}

export async function listHoldings(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  userId: string,
): Promise<HoldingRow[]> {
  const rows = await db
    .select({ h: holdings, accountName: accounts.name, accountUserId: accounts.userId })
    .from(holdings)
    .innerJoin(accounts, eq(accounts.id, holdings.accountId))
    .where(eq(accounts.userId, userId))
    .orderBy(asc(holdings.asOf));

  return rows.map((r) => {
    const qty = Number(r.h.quantity);
    const price = r.h.currentPrice === null ? null : Number(r.h.currentPrice);
    const value = price !== null ? qty * price : 0;
    return {
      id: r.h.id,
      accountId: r.h.accountId,
      accountName: r.accountName,
      assetName: r.h.assetName ?? '(unnamed)',
      tickerLocal: r.h.tickerLocal,
      assetType: (r.h.assetType ?? 'other') as AssetType,
      quantity: qty,
      avgCost: r.h.avgCost === null ? null : Number(r.h.avgCost),
      currentPrice: price,
      currentValueGbp: value,
      currency: r.h.currency,
      riskCategory: (r.h.riskCategory as RiskCategory | null) ?? null,
      notes: r.h.notes,
    };
  });
}

async function assertOwnership(
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

export async function createHolding(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  args: { userId: string; input: HoldingInput },
): Promise<{ id: string }> {
  await assertOwnership(db, args.userId, args.input.accountId);
  const i = args.input;
  const [row] = await db
    .insert(holdings)
    .values({
      accountId: i.accountId,
      quantity: i.quantity.toString(),
      avgCost: i.avgCost != null ? i.avgCost.toString() : null,
      currentPrice: i.currentPrice != null ? i.currentPrice.toString() : null,
      currency: i.currency,
      asOf: new Date(),
      source: 'manual',
      assetName: i.assetName,
      tickerLocal: i.tickerLocal ?? null,
      assetType: i.assetType,
      riskCategory: i.riskCategory ?? null,
      notes: i.notes ?? null,
    })
    .returning({ id: holdings.id });
  return { id: row!.id };
}

export async function updateHolding(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  args: { userId: string; holdingId: string; input: HoldingInput },
): Promise<void> {
  await assertOwnership(db, args.userId, args.input.accountId);
  const i = args.input;
  await db
    .update(holdings)
    .set({
      accountId: i.accountId,
      quantity: i.quantity.toString(),
      avgCost: i.avgCost != null ? i.avgCost.toString() : null,
      currentPrice: i.currentPrice != null ? i.currentPrice.toString() : null,
      currency: i.currency,
      assetName: i.assetName,
      tickerLocal: i.tickerLocal ?? null,
      assetType: i.assetType,
      riskCategory: i.riskCategory ?? null,
      notes: i.notes ?? null,
    })
    .where(eq(holdings.id, args.holdingId));
}

export async function deleteHolding(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: PostgresJsDatabase<any>,
  args: { userId: string; holdingId: string },
): Promise<void> {
  // Cascade through accounts.user_id ensures we only nuke our own.
  const [h] = await db
    .select({ id: holdings.id })
    .from(holdings)
    .innerJoin(accounts, eq(accounts.id, holdings.accountId))
    .where(and(eq(holdings.id, args.holdingId), eq(accounts.userId, args.userId)))
    .limit(1);
  if (!h) return;
  await db.delete(holdings).where(eq(holdings.id, args.holdingId));
}
