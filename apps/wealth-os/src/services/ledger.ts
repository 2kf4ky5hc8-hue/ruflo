// I-103 / I-104 / I-101-commit — manual data entry + CSV commit into the ledger.
//
// Accounts, transactions, instruments, holdings. These are the writes that
// turn the dashboard / plan / paper from "onboarding estimates" into real data.

import { and, eq, desc, inArray } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  accounts, transactions, categories, instruments, holdings, auditEvents,
} from '../db/schema/index';
import { rowKey, type ParsedRow } from './csv-import';

export const ACCOUNT_TYPES = [
  'cash', 'isa', 'gia', 'sipp', 'business', 'mortgage', 'credit', 'debt', 'property', 'crypto',
] as const;
export type AccountType = typeof ACCOUNT_TYPES[number];

// ── Accounts ───────────────────────────────────────────────────────────────

export async function listAccounts(userId: string) {
  return db.select().from(accounts).where(eq(accounts.userId, userId)).orderBy(desc(accounts.createdAt));
}

export async function addAccount(userId: string, input: {
  name: string; type: AccountType; currency?: string;
}): Promise<string> {
  const isIsa = input.type === 'isa';
  const [row] = await db.insert(accounts).values({
    userId, name: input.name, type: input.type,
    currency: input.currency ?? 'GBP', isIsa,
    isaType: isIsa ? 'stocks_shares' : null,
  }).returning({ id: accounts.id });
  await audit(userId, 'create', 'account', row!.id);
  return row!.id;
}

import { wrapperToAccountFields, type UkWrapper } from './account-wrappers';

/**
 * Create an account from the canonical UK wrapper enum. Sets `type`,
 * `isaType`, `isIsa`, and `isFlexible` (for flexible Cash/S&S ISAs).
 */
export async function addAccountByWrapper(userId: string, input: {
  name: string; wrapper: UkWrapper; isFlexible?: boolean; currency?: string;
}): Promise<string> {
  const f = wrapperToAccountFields(input.wrapper);
  const [row] = await db.insert(accounts).values({
    userId, name: input.name,
    type: f.type, isaType: f.isaType, isIsa: f.isIsa,
    isFlexible: input.isFlexible ?? false,
    currency: input.currency ?? 'GBP',
  }).returning({ id: accounts.id });
  await audit(userId, 'create', 'account', row!.id);
  return row!.id;
}

export async function deleteAccount(userId: string, accountId: string) {
  await assertAccountOwner(userId, accountId);
  await db.delete(accounts).where(eq(accounts.id, accountId));
  await audit(userId, 'delete', 'account', accountId);
}

async function assertAccountOwner(userId: string, accountId: string) {
  const [row] = await db.select().from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId))).limit(1);
  if (!row) throw new Error('Account not found or not authorised.');
  return row;
}

/** Current balance = sum of signed transactions. */
export async function accountBalance(accountId: string): Promise<number> {
  const txs = await db.select({ amount: transactions.amount }).from(transactions)
    .where(eq(transactions.accountId, accountId));
  return txs.reduce((acc, t) => acc + Number(t.amount), 0);
}

// ── Categories ─────────────────────────────────────────────────────────────

export async function listCategories(userId: string) {
  return db.select().from(categories).where(eq(categories.userId, userId));
}

// ── Manual transaction entry (I-103) ─────────────────────────────────────

export const TX_CLASSIFICATIONS = [
  'isa_contribution', 'isa_transfer_in', 'isa_transfer_out', 'isa_withdrawal',
  'gia_deposit', 'sipp_contribution',
  'dividend', 'interest', 'tax', 'fee',
] as const;
export type TxClassification = typeof TX_CLASSIFICATIONS[number];

export const TX_CLASSIFICATION_LABELS: Record<TxClassification, string> = {
  isa_contribution:  'ISA contribution',
  isa_transfer_in:   'ISA transfer in',
  isa_transfer_out:  'ISA transfer out',
  isa_withdrawal:    'ISA withdrawal',
  gia_deposit:       'GIA deposit',
  sipp_contribution: 'SIPP contribution',
  dividend:          'Dividend',
  interest:          'Interest',
  tax:               'Tax',
  fee:               'Fee',
};

export interface ManualTxInput {
  accountId: string;
  postedAt: Date;
  amountGbp: number;     // signed
  description: string;
  categoryId?: string;
  classification?: TxClassification;
}

export async function addTransaction(userId: string, input: ManualTxInput): Promise<string> {
  await assertAccountOwner(userId, input.accountId);
  const [row] = await db.insert(transactions).values({
    accountId: input.accountId,
    postedAt: input.postedAt,
    amount: input.amountGbp.toString(),
    currency: 'GBP',
    descriptionRaw: input.description,
    descriptionClean: input.description,
    categoryId: input.categoryId ?? null,
    classification: input.classification ?? null,
    source: 'manual',
    reconciliationStatus: 'reconciled',
    lastVerifiedAt: new Date(),
  }).returning({ id: transactions.id });
  await audit(userId, 'create', 'transaction', row!.id);
  return row!.id;
}

export async function listTransactions(userId: string, accountId?: string, limit = 100) {
  const accs = await listAccounts(userId);
  const ids = accs.map((a) => a.id);
  if (ids.length === 0) return [];
  const where = accountId
    ? and(eq(transactions.accountId, accountId))
    : inArray(transactions.accountId, ids);
  const rows = await db.select().from(transactions).where(where)
    .orderBy(desc(transactions.postedAt)).limit(limit);
  // Guard: only return rows for accounts this user owns.
  const idSet = new Set(ids);
  return rows.filter((r) => idSet.has(r.accountId));
}

export async function deleteTransaction(userId: string, txId: string) {
  const [tx] = await db.select().from(transactions).where(eq(transactions.id, txId)).limit(1);
  if (!tx) throw new Error('Transaction not found.');
  await assertAccountOwner(userId, tx.accountId);
  await db.delete(transactions).where(eq(transactions.id, txId));
  await audit(userId, 'delete', 'transaction', txId);
}

// ── CSV commit (I-101) ───────────────────────────────────────────────────

export async function commitImportedRows(
  userId: string, accountId: string, rows: ParsedRow[],
): Promise<{ inserted: number; skipped: number }> {
  await assertAccountOwner(userId, accountId);
  if (rows.length === 0) return { inserted: 0, skipped: 0 };

  // I-108 — duplicate detection. Build the set of keys already in this
  // account, then skip any incoming row that matches an existing transaction
  // OR an earlier row in the same batch.
  const existing = await db.select({
    postedAt: transactions.postedAt,
    amount: transactions.amount,
    counterparty: transactions.counterparty,
    descriptionClean: transactions.descriptionClean,
  }).from(transactions).where(eq(transactions.accountId, accountId));

  const seen = new Set<string>();
  for (const t of existing) {
    seen.add(rowKey(accountId, {
      index: 0,
      postedAt: new Date(t.postedAt),
      amountGbp: Number(t.amount),
      description: t.descriptionClean ?? '',
      counterparty: t.counterparty ?? undefined,
      raw: {},
    }));
  }

  const toInsert: ParsedRow[] = [];
  let skipped = 0;
  for (const r of rows) {
    const k = rowKey(accountId, r);
    if (seen.has(k)) { skipped++; continue; }
    seen.add(k);
    toInsert.push(r);
  }

  if (toInsert.length > 0) {
    await db.insert(transactions).values(toInsert.map((r) => ({
      accountId,
      postedAt: r.postedAt,
      amount: r.amountGbp.toString(),
      currency: 'GBP',
      counterparty: r.counterparty ?? null,
      descriptionRaw: r.description,
      descriptionClean: r.description,
      source: 'csv_import',
      reconciliationStatus: 'unreconciled' as const,
    })));
  }
  await audit(userId, 'csv_import', 'account', accountId);
  return { inserted: toInsert.length, skipped };
}

// ── Instruments + holdings (I-104) ───────────────────────────────────────

export async function findOrCreateInstrument(input: {
  ref: string;          // ISIN or ticker
  name?: string;
  assetClass: string;
  currency?: string;
}): Promise<string> {
  const ref = input.ref.trim().toUpperCase();
  const isIsin = /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(ref);
  // Try ISIN match first, then ticker.
  if (isIsin) {
    const [byIsin] = await db.select().from(instruments).where(eq(instruments.isin, ref)).limit(1);
    if (byIsin) return byIsin.id;
  } else {
    const [byTicker] = await db.select().from(instruments).where(eq(instruments.ticker, ref)).limit(1);
    if (byTicker) return byTicker.id;
  }
  const [row] = await db.insert(instruments).values({
    isin: isIsin ? ref : null,
    ticker: isIsin ? null : ref,
    name: input.name ?? ref,
    assetClass: input.assetClass,
    currency: input.currency ?? 'GBP',
  }).returning({ id: instruments.id });
  return row!.id;
}

export interface ManualHoldingInput {
  accountId: string;
  instrumentRef: string;
  instrumentName?: string;
  assetClass: string;
  quantity: number;
  avgCostGbp: number;
}

export async function addHolding(userId: string, input: ManualHoldingInput): Promise<string> {
  await assertAccountOwner(userId, input.accountId);
  const instrumentId = await findOrCreateInstrument({
    ref: input.instrumentRef, name: input.instrumentName, assetClass: input.assetClass,
  });
  // Upsert: one holding row per (account, instrument).
  const [existing] = await db.select().from(holdings)
    .where(and(eq(holdings.accountId, input.accountId), eq(holdings.instrumentId, instrumentId))).limit(1);
  if (existing) {
    await db.update(holdings).set({
      quantity: input.quantity.toString(),
      avgCost: input.avgCostGbp.toString(),
      asOf: new Date(),
      reconciliationStatus: 'reconciled',
      lastVerifiedAt: new Date(),
    }).where(eq(holdings.id, existing.id));
    await audit(userId, 'update', 'holding', existing.id);
    return existing.id;
  }
  const [row] = await db.insert(holdings).values({
    accountId: input.accountId,
    instrumentId,
    quantity: input.quantity.toString(),
    avgCost: input.avgCostGbp.toString(),
    currency: 'GBP',
    asOf: new Date(),
    source: 'manual',
    reconciliationStatus: 'reconciled',
    lastVerifiedAt: new Date(),
  }).returning({ id: holdings.id });
  await audit(userId, 'create', 'holding', row!.id);
  return row!.id;
}

export async function listHoldings(userId: string) {
  const accs = await listAccounts(userId);
  const ids = accs.map((a) => a.id);
  if (ids.length === 0) return [];
  const rows = await db.select({
    holding: holdings, instrument: instruments,
  }).from(holdings)
    .innerJoin(instruments, eq(holdings.instrumentId, instruments.id))
    .where(inArray(holdings.accountId, ids));
  const accById = new Map(accs.map((a) => [a.id, a]));
  return rows.map((r) => ({ ...r, account: accById.get(r.holding.accountId) }));
}

export async function setHoldingTags(userId: string, holdingId: string, tags: string[]): Promise<void> {
  const [h] = await db.select().from(holdings).where(eq(holdings.id, holdingId)).limit(1);
  if (!h) throw new Error('Holding not found.');
  await assertAccountOwner(userId, h.accountId);
  // Normalise: trim, lowercase, dedupe, drop empties, cap at 8.
  const clean = Array.from(new Set(
    tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0 && t.length <= 40),
  )).slice(0, 8);
  await db.update(holdings).set({ tags: clean }).where(eq(holdings.id, holdingId));
  await audit(userId, 'set_tags', 'holding', holdingId);
}

export async function deleteHolding(userId: string, holdingId: string) {
  const [h] = await db.select().from(holdings).where(eq(holdings.id, holdingId)).limit(1);
  if (!h) throw new Error('Holding not found.');
  await assertAccountOwner(userId, h.accountId);
  await db.delete(holdings).where(eq(holdings.id, holdingId));
  await audit(userId, 'delete', 'holding', holdingId);
}

async function audit(userId: string, action: string, entityType: string, entityId: string) {
  await db.insert(auditEvents).values({ userId, actor: 'user', action, entityType, entityId });
}
