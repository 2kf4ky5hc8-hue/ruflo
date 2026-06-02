// ISA contribution + allowance tracking — UK-specific.
//
// Rules baked in:
//   * Only `contribution` rows count against the £20,000 (configurable) annual
//     allowance. Transfers (in or out) never do.
//   * Withdrawals only restore allowance if the source ISA account is marked
//     `is_flexible = true` AND the withdrawal sits in the same UK tax year.
//   * Flexible-ISA accounting: used = max(0, contributions − flexible_withdrawals).
//   * Currency = GBP everywhere. There is intentionally no FX in this module.

import { and, asc, eq } from 'drizzle-orm';
import { db as defaultDb } from '../lib/db';
import {
  accounts, isaDeposits, isaYears, auditEvents,
} from '../db/schema/index';
import { currentUkTaxYear, ukTaxYearDaysRemaining, formatUkTaxYear } from './uk-tax-year';
import { deriveWrapper } from './account-wrappers';

type Db = typeof defaultDb;

// Default UK Stocks & Shares + Cash ISA combined annual allowance (2026/27).
// Configurable per-year via `isa_years.allowance`.
export const DEFAULT_ISA_ALLOWANCE_GBP = 20_000;

export const ISA_DEPOSIT_KINDS = [
  'contribution', 'transfer_in', 'transfer_out', 'withdrawal',
] as const;
export type IsaDepositKind = typeof ISA_DEPOSIT_KINDS[number];

// ── Pure compute (testable without a DB) ─────────────────────────────────

export interface IsaDepositInput {
  amountGbp: number;
  kind: IsaDepositKind;
  /** True iff the source account is a flexible ISA. */
  accountIsFlexible: boolean;
}

export interface IsaUsage {
  taxYear: number;
  allowanceGbp: number;
  contributionsGbp: number;
  transfersInGbp: number;
  transfersOutGbp: number;
  withdrawalsGbp: number;
  flexibleWithdrawalsGbp: number;
  usedGbp: number;
  remainingGbp: number;
  utilisationPct: number;       // 0..1, can exceed 1 if over-subscribed
  status: 'ok' | 'warn' | 'over';
}

export function computeIsaUsage(opts: {
  taxYear: number;
  allowanceGbp?: number;
  deposits: IsaDepositInput[];
}): IsaUsage {
  const allowance = opts.allowanceGbp ?? DEFAULT_ISA_ALLOWANCE_GBP;
  let contributions = 0;
  let transfersIn = 0;
  let transfersOut = 0;
  let withdrawals = 0;
  let flexibleWithdrawals = 0;

  for (const d of opts.deposits) {
    const amt = Math.max(0, Number(d.amountGbp) || 0);
    switch (d.kind) {
      case 'contribution':  contributions  += amt; break;
      case 'transfer_in':   transfersIn    += amt; break;
      case 'transfer_out':  transfersOut   += amt; break;
      case 'withdrawal':
        withdrawals += amt;
        if (d.accountIsFlexible) flexibleWithdrawals += amt;
        break;
    }
  }

  // Flexible model: a £500 withdrawal from a flexible ISA gives you £500
  // back to "subscribe", capped at what you've already subscribed (you can
  // never have negative used).
  const used = Math.max(0, contributions - flexibleWithdrawals);
  const remaining = Math.max(0, allowance - used);
  const utilisation = allowance > 0 ? used / allowance : 0;
  const status: IsaUsage['status'] = used > allowance ? 'over' : utilisation >= 0.8 ? 'warn' : 'ok';

  return {
    taxYear: opts.taxYear,
    allowanceGbp: allowance,
    contributionsGbp: contributions,
    transfersInGbp: transfersIn,
    transfersOutGbp: transfersOut,
    withdrawalsGbp: withdrawals,
    flexibleWithdrawalsGbp: flexibleWithdrawals,
    usedGbp: used,
    remainingGbp: remaining,
    utilisationPct: utilisation,
    status,
  };
}

// ── DB-backed service ────────────────────────────────────────────────────

export interface RecordIsaArgs {
  userId: string;
  accountId: string;
  amountGbp: number;
  kind: IsaDepositKind;
  depositedAt?: Date;
  note?: string;
  sourceTransactionId?: string;
  db?: Db;
}

/** Persist an ISA movement and refresh the `isa_years` aggregate. */
export async function recordIsaMovement(args: RecordIsaArgs): Promise<{ id: string; taxYear: number }> {
  const db = args.db ?? defaultDb;
  const at = args.depositedAt ?? new Date();
  const taxYear = currentUkTaxYear(at);

  // Verify the account is owned by the user AND is an ISA wrapper.
  const [acc] = await db.select().from(accounts)
    .where(and(eq(accounts.id, args.accountId), eq(accounts.userId, args.userId))).limit(1);
  if (!acc) throw new Error('Account not found or not owned by user.');
  const wrapper = deriveWrapper({ type: acc.type, isaType: acc.isaType });
  if (wrapper !== 'stocks_and_shares_isa' && wrapper !== 'cash_isa') {
    throw new Error('ISA movements can only be recorded against an ISA wrapper account.');
  }

  if (!(args.amountGbp > 0)) throw new Error('Amount must be > 0.');
  if (!ISA_DEPOSIT_KINDS.includes(args.kind)) throw new Error(`Unknown ISA kind: ${args.kind}`);

  const [row] = await db.insert(isaDeposits).values({
    userId: args.userId,
    accountId: args.accountId,
    depositedAt: at,
    amount: args.amountGbp.toString(),
    taxYear,
    kind: args.kind,
    note: args.note ?? null,
    sourceTransactionId: args.sourceTransactionId ?? null,
  }).returning({ id: isaDeposits.id });

  await db.insert(auditEvents).values({
    userId: args.userId, actor: 'user', action: 'isa_movement',
    entityType: 'isa_deposit', entityId: row!.id,
    after: { kind: args.kind, amountGbp: args.amountGbp, taxYear, accountId: args.accountId },
  });

  await recomputeIsaYear(args.userId, taxYear, db);
  return { id: row!.id, taxYear };
}

/** Recompute the aggregate row in `isa_years` from the raw deposits. */
export async function recomputeIsaYear(
  userId: string, taxYear: number, db: Db = defaultDb,
): Promise<IsaUsage> {
  const rows = await db.select({
    amount: isaDeposits.amount,
    kind: isaDeposits.kind,
    accountId: isaDeposits.accountId,
  }).from(isaDeposits)
    .where(and(eq(isaDeposits.userId, userId), eq(isaDeposits.taxYear, taxYear)));

  // Need flexibility flag per account.
  const accIds = [...new Set(rows.map((r) => r.accountId))];
  const flexMap = new Map<string, boolean>();
  if (accIds.length > 0) {
    const accs = await db.select({ id: accounts.id, isFlexible: accounts.isFlexible })
      .from(accounts);
    for (const a of accs) flexMap.set(a.id, a.isFlexible);
  }

  const deposits: IsaDepositInput[] = rows.map((r) => ({
    amountGbp: Number(r.amount),
    kind: r.kind as IsaDepositKind,
    accountIsFlexible: flexMap.get(r.accountId) ?? false,
  }));

  // Find the existing allowance row (or seed one with the default).
  const [existing] = await db.select().from(isaYears)
    .where(and(eq(isaYears.userId, userId), eq(isaYears.taxYear, taxYear))).limit(1);

  const allowance = existing ? Number(existing.allowance) : DEFAULT_ISA_ALLOWANCE_GBP;
  const usage = computeIsaUsage({ taxYear, allowanceGbp: allowance, deposits });

  if (existing) {
    await db.update(isaYears).set({
      deposited: usage.usedGbp.toString(),
      remaining: usage.remainingGbp.toString(),
      computedAt: new Date(),
    }).where(eq(isaYears.id, existing.id));
  } else {
    await db.insert(isaYears).values({
      userId, taxYear,
      allowance: allowance.toString(),
      deposited: usage.usedGbp.toString(),
      remaining: usage.remainingGbp.toString(),
    });
  }

  return usage;
}

// ── Reads for the /isa page ──────────────────────────────────────────────

export interface IsaDepositRow {
  id: string;
  depositedAt: Date;
  amountGbp: number;
  kind: IsaDepositKind;
  accountId: string;
  accountName: string;
  accountIsFlexible: boolean;
  note: string | null;
}

export async function listIsaMovements(
  userId: string, taxYear: number, db: Db = defaultDb,
): Promise<IsaDepositRow[]> {
  const rows = await db.select({
    id: isaDeposits.id,
    depositedAt: isaDeposits.depositedAt,
    amount: isaDeposits.amount,
    kind: isaDeposits.kind,
    accountId: isaDeposits.accountId,
    note: isaDeposits.note,
  }).from(isaDeposits)
    .where(and(eq(isaDeposits.userId, userId), eq(isaDeposits.taxYear, taxYear)))
    .orderBy(asc(isaDeposits.depositedAt));

  if (rows.length === 0) return [];
  const accIds = [...new Set(rows.map((r) => r.accountId))];
  const accs = await db.select({ id: accounts.id, name: accounts.name, isFlexible: accounts.isFlexible })
    .from(accounts);
  const accMap = new Map(accs.map((a) => [a.id, a]));

  return rows.map((r) => ({
    id: r.id,
    depositedAt: new Date(r.depositedAt),
    amountGbp: Number(r.amount),
    kind: r.kind as IsaDepositKind,
    accountId: r.accountId,
    accountName: accMap.get(r.accountId)?.name ?? '(unknown account)',
    accountIsFlexible: accMap.get(r.accountId)?.isFlexible ?? false,
    note: r.note,
  }));
}

export async function getIsaUsageForUser(
  userId: string, taxYear?: number, db: Db = defaultDb,
): Promise<IsaUsage & { taxYearLabel: string; daysRemaining: number }> {
  const year = taxYear ?? currentUkTaxYear();
  const rows = await listIsaMovements(userId, year, db);
  const usage = computeIsaUsage({
    taxYear: year,
    deposits: rows.map((r) => ({
      amountGbp: r.amountGbp, kind: r.kind, accountIsFlexible: r.accountIsFlexible,
    })),
  });
  return {
    ...usage,
    taxYearLabel: formatUkTaxYear(year),
    daysRemaining: ukTaxYearDaysRemaining(new Date(), year),
  };
}

export async function deleteIsaMovement(userId: string, depositId: string, db: Db = defaultDb): Promise<void> {
  const [row] = await db.select().from(isaDeposits).where(eq(isaDeposits.id, depositId)).limit(1);
  if (!row || row.userId !== userId) throw new Error('Not found or not authorised.');
  await db.delete(isaDeposits).where(eq(isaDeposits.id, depositId));
  await recomputeIsaYear(userId, row.taxYear, db);
}
