// Tests for the tx → isa_deposit bridge (auto-mirror).
// Manual addTransaction and CSV commitImportedRows should both populate
// isa_deposits when the row has an ISA classification on an ISA account.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import * as schema from '../db/schema/index';
import { users, accounts, isaDeposits, transactions } from '../db/schema/index';
import { addAccountByWrapper, addTransaction, commitImportedRows } from './ledger';
import {
  getIsaUsageForUser, isIsaTxClassification, isaKindForClassification,
} from './isa-tracking';

const URL = process.env.DATABASE_URL ?? 'postgres://wealth_os:wealth_os@localhost:5432/wealth_os';
let sqlClient: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let userId: string;

// Per-test account ids — built/torn down fresh each suite.
let ssIsaId: string;
let cashIsaId: string;
let flexIsaId: string;
let giaId: string;

beforeAll(async () => {
  sqlClient = postgres(URL, { max: 1 });
  db = drizzle(sqlClient, { schema });
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error('Run pnpm db:bootstrap first.');
  userId = u.id;

  // Wipe any earlier test residue for this user.
  await db.delete(isaDeposits).where(eq(isaDeposits.userId, userId));

  ssIsaId   = await addAccountByWrapper(userId, { name: 'Bridge S&S ISA',  wrapper: 'stocks_and_shares_isa' });
  cashIsaId = await addAccountByWrapper(userId, { name: 'Bridge Cash ISA', wrapper: 'cash_isa' });
  flexIsaId = await addAccountByWrapper(userId, { name: 'Bridge Flex ISA', wrapper: 'stocks_and_shares_isa', isFlexible: true });
  giaId     = await addAccountByWrapper(userId, { name: 'Bridge GIA',      wrapper: 'gia' });
});

afterAll(async () => {
  await db.delete(isaDeposits).where(eq(isaDeposits.userId, userId));
  for (const id of [ssIsaId, cashIsaId, flexIsaId, giaId]) {
    await db.delete(accounts).where(eq(accounts.id, id));
  }
  await sqlClient.end();
});

// ── Pure mapper tests ────────────────────────────────────────────────────

describe('isIsaTxClassification + isaKindForClassification (pure)', () => {
  it('recognises the four ISA tx classifications', () => {
    expect(isIsaTxClassification('isa_contribution')).toBe(true);
    expect(isIsaTxClassification('isa_transfer_in')).toBe(true);
    expect(isIsaTxClassification('isa_transfer_out')).toBe(true);
    expect(isIsaTxClassification('isa_withdrawal')).toBe(true);
  });
  it('rejects non-ISA classifications and bad input', () => {
    expect(isIsaTxClassification('dividend')).toBe(false);
    expect(isIsaTxClassification('fee')).toBe(false);
    expect(isIsaTxClassification(null)).toBe(false);
    expect(isIsaTxClassification(undefined)).toBe(false);
    expect(isIsaTxClassification('made_up')).toBe(false);
  });
  it('maps classification → ISA deposit kind correctly', () => {
    expect(isaKindForClassification('isa_contribution')).toBe('contribution');
    expect(isaKindForClassification('isa_transfer_in')).toBe('transfer_in');
    expect(isaKindForClassification('isa_transfer_out')).toBe('transfer_out');
    expect(isaKindForClassification('isa_withdrawal')).toBe('withdrawal');
  });
});

// ── DB integration: manual transactions ─────────────────────────────────

describe('addTransaction — auto-mirrors ISA-classified rows', () => {
  it('records a deposit when classification=isa_contribution on an ISA account', async () => {
    const txId = await addTransaction(userId, {
      accountId: ssIsaId,
      postedAt: new Date(),
      amountGbp: 500,
      description: 'Standing order to ISA',
      classification: 'isa_contribution',
    });
    const [d] = await db.select().from(isaDeposits)
      .where(eq(isaDeposits.sourceTransactionId, txId)).limit(1);
    expect(d).toBeDefined();
    expect(d!.kind).toBe('contribution');
    expect(Number(d!.amount)).toBe(500);
  });

  it('uses abs() so an outflow-shaped withdrawal records the right amount', async () => {
    const txId = await addTransaction(userId, {
      accountId: ssIsaId,
      postedAt: new Date(),
      amountGbp: -300,                        // money leaving the ISA
      description: 'Withdraw',
      classification: 'isa_withdrawal',
    });
    const [d] = await db.select().from(isaDeposits)
      .where(eq(isaDeposits.sourceTransactionId, txId)).limit(1);
    expect(d).toBeDefined();
    expect(d!.kind).toBe('withdrawal');
    expect(Number(d!.amount)).toBe(300);     // positive
  });

  it('does NOT mirror when there is no classification', async () => {
    const before = await db.select({ id: isaDeposits.id }).from(isaDeposits)
      .where(eq(isaDeposits.userId, userId));
    await addTransaction(userId, {
      accountId: ssIsaId, postedAt: new Date(), amountGbp: 100,
      description: 'Untagged ISA contribution',
    });
    const after = await db.select({ id: isaDeposits.id }).from(isaDeposits)
      .where(eq(isaDeposits.userId, userId));
    expect(after.length).toBe(before.length);
  });

  it('silently ignores ISA classification on a non-ISA (GIA) account', async () => {
    const txId = await addTransaction(userId, {
      accountId: giaId, postedAt: new Date(), amountGbp: 1_000,
      description: 'Misclassified',
      classification: 'isa_contribution',
    });
    const [d] = await db.select().from(isaDeposits)
      .where(eq(isaDeposits.sourceTransactionId, txId)).limit(1);
    expect(d).toBeUndefined();   // no exception, no deposit
    // The transaction itself is still inserted.
    const [tx] = await db.select().from(transactions).where(eq(transactions.id, txId));
    expect(tx).toBeDefined();
  });

  it('counts ISA usage from mirrored deposits (only contributions count)', async () => {
    await addTransaction(userId, {
      accountId: cashIsaId, postedAt: new Date(), amountGbp: 2_500,
      description: 'Cash ISA deposit', classification: 'isa_contribution',
    });
    await addTransaction(userId, {
      accountId: cashIsaId, postedAt: new Date(), amountGbp: 10_000,
      description: 'Transfer from old Cash ISA', classification: 'isa_transfer_in',
    });
    const u = await getIsaUsageForUser(userId, undefined, db);
    expect(u.contributionsGbp).toBeGreaterThanOrEqual(3_000);  // 500 + 2,500 + earlier tests
    expect(u.transfersInGbp).toBeGreaterThanOrEqual(10_000);
  });

  it('flexible withdrawals from mirrored deposits restore allowance', async () => {
    await addTransaction(userId, {
      accountId: flexIsaId, postedAt: new Date(), amountGbp: 4_000,
      description: 'Flex ISA contribution', classification: 'isa_contribution',
    });
    await addTransaction(userId, {
      accountId: flexIsaId, postedAt: new Date(), amountGbp: -1_500,
      description: 'Flex ISA emergency withdrawal', classification: 'isa_withdrawal',
    });
    const u = await getIsaUsageForUser(userId, undefined, db);
    expect(u.flexibleWithdrawalsGbp).toBeGreaterThanOrEqual(1_500);
  });
});

// ── DB integration: CSV imports ──────────────────────────────────────────

describe('commitImportedRows — auto-mirrors ISA-classified rows', () => {
  it('writes both transactions and isa_deposits, idempotent on re-import', async () => {
    const csvRows = [
      {
        index: 0, postedAt: new Date('2026-05-10T12:00:00Z'),
        amountGbp: 750, description: 'May ISA contribution',
        classification: 'isa_contribution', raw: {},
      },
      {
        index: 1, postedAt: new Date('2026-05-11T12:00:00Z'),
        amountGbp: 25, description: 'May dividend',
        classification: 'dividend', raw: {},
      },
    ];
    const r1 = await commitImportedRows(userId, ssIsaId, csvRows);
    expect(r1.inserted).toBe(2);
    expect(r1.isaMirrored).toBe(1);          // only the contribution mirrors

    // Re-import the same CSV — duplicate detection skips, nothing extra mirrored.
    const r2 = await commitImportedRows(userId, ssIsaId, csvRows);
    expect(r2.inserted).toBe(0);
    expect(r2.skipped).toBe(2);
    expect(r2.isaMirrored).toBe(0);
  });
});