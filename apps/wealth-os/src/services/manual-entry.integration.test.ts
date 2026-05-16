// End-to-end integration test for the manual-entry stack:
//   accounts ↔ holdings ↔ transactions ↔ isa-deposits ↔ loadSnapshot.
//
// Gated on RUN_INTEGRATION=1 + a live, bootstrapped Postgres. Without
// the flag the whole suite is skipped so `pnpm test` stays clean.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  accounts, holdings, transactions, isaDeposits, isaYears, users,
} from '../db/schema/index';
import { createAccount, deleteAccount, listAccounts, updateAccount } from './accounts';
import { createHolding, listHoldings, deleteHolding } from './holdings';
import { createTransaction, deleteTransaction, listTransactions } from './transactions';
import { createIsaDeposit, deleteIsaDeposit, currentTaxYearNumber } from './isa-deposits';
import { loadSnapshot } from '../lib/finance';

const ENABLED = process.env.RUN_INTEGRATION === '1';
const URL = process.env.DATABASE_URL ?? 'postgres://wealth_os:wealth_os@localhost:5432/wealth_os';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: PostgresJsDatabase<any>;
let sqlClient: ReturnType<typeof postgres>;
let userId: string;

async function clearUserManualData(): Promise<void> {
  // Order matters: holdings cascade from accounts, but isaDeposits FK on accounts
  // is ON DELETE CASCADE too — still, clean in order for clarity.
  await db.delete(isaDeposits).where(eq(isaDeposits.userId, userId));
  await db.delete(transactions).where(and(
    eq(transactions.source, 'manual'),
    // accounts are FK-cascaded, so deleting accounts will sweep their txs.
    eq(transactions.source, 'manual'),
  ));
  // Delete only manual-source accounts so we don't nuke the onboarding seed.
  const userAccounts = await db.select({ id: accounts.id, source: accounts.source })
    .from(accounts).where(eq(accounts.userId, userId));
  for (const a of userAccounts) {
    if (a.source === 'manual') {
      await db.delete(accounts).where(eq(accounts.id, a.id));
    }
  }
  // Reset ISA tracker totals.
  await db.update(isaYears)
    .set({ deposited: '0', remaining: '20000' })
    .where(eq(isaYears.userId, userId));
}

beforeAll(async () => {
  if (!ENABLED) return;
  sqlClient = postgres(URL, { max: 1, idle_timeout: 5 });
  db = drizzle(sqlClient);
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error('no seed user — run `pnpm db:bootstrap` first.');
  userId = u.id;
  await clearUserManualData();
});

afterAll(async () => {
  if (!ENABLED) return;
  await clearUserManualData();
  await sqlClient.end();
});

describe.skipIf(!ENABLED)('manual entry — accounts CRUD', () => {
  it('creates, lists, updates, and deletes an account', async () => {
    const { id } = await createAccount(db, {
      userId,
      input: {
        name: 'TEST Monzo current',
        type: 'cash',
        currency: 'GBP',
        currentBalanceGbp: 1_234.56,
        isBusiness: false,
        isIsa: false,
        institutionId: null,
        isaType: null,
        notes: 'integration test row',
        active: true,
      },
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    let list = await listAccounts(db, userId);
    let row = list.find((r) => r.id === id)!;
    expect(row.name).toBe('TEST Monzo current');
    expect(row.currentBalanceGbp).toBe(1234.56);
    expect(row.source).toBe('manual');

    await updateAccount(db, {
      userId,
      accountId: id,
      input: {
        ...row,
        name: 'TEST Monzo (renamed)',
        currentBalanceGbp: 2_000,
        currency: row.currency,
        institutionId: row.institutionId,
        isaType: null,
      } as any,
    });
    list = await listAccounts(db, userId);
    row = list.find((r) => r.id === id)!;
    expect(row.name).toBe('TEST Monzo (renamed)');
    expect(row.currentBalanceGbp).toBe(2_000);

    await deleteAccount(db, { userId, accountId: id });
    list = await listAccounts(db, userId);
    expect(list.find((r) => r.id === id)).toBeUndefined();
  });
});

describe.skipIf(!ENABLED)('manual entry — loadSnapshot semantics', () => {
  it('reports the empty state cleanly when no manual accounts exist', async () => {
    const snap = await loadSnapshot(userId);
    // The seed user has been onboarded so there may be onboarding-source rows;
    // but no MANUAL data has been added in this run.
    expect(snap.user.id).toBe(userId);
    expect(snap.activeRiskProfile).not.toBeNull();
  });

  it('debt accounts reduce net worth and business cash is reported separately', async () => {
    const cash = await createAccount(db, {
      userId,
      input: {
        name: 'TEST personal cash', type: 'cash', currency: 'GBP',
        currentBalanceGbp: 5_000, isBusiness: false, isIsa: false,
        institutionId: null, isaType: null, notes: null, active: true,
      },
    });
    const biz = await createAccount(db, {
      userId,
      input: {
        name: 'TEST business cash', type: 'cash', currency: 'GBP',
        currentBalanceGbp: 7_500, isBusiness: true, isIsa: false,
        institutionId: null, isaType: null, notes: null, active: true,
      },
    });
    const debt = await createAccount(db, {
      userId,
      input: {
        name: 'TEST mortgage', type: 'mortgage', currency: 'GBP',
        currentBalanceGbp: -150_000, isBusiness: false, isIsa: false,
        institutionId: null, isaType: null, notes: null, active: true,
      },
    });

    const snap = await loadSnapshot(userId);
    expect(snap.cashGbp).toBeGreaterThanOrEqual(5_000);
    expect(snap.businessGbp).toBeGreaterThanOrEqual(7_500);
    expect(snap.debtGbp).toBeGreaterThanOrEqual(150_000);
    // Net worth = cash + business + isa + gia + crypto + pension − debt.
    // Other onboarding rows may exist; only assert directionally.
    expect(snap.netWorthGbp).toBeLessThan(snap.cashGbp + snap.businessGbp + snap.isaValueGbp + snap.giaValueGbp);
    expect(snap.hasAnyAccounts).toBe(true);

    await deleteAccount(db, { userId, accountId: cash.id });
    await deleteAccount(db, { userId, accountId: biz.id });
    await deleteAccount(db, { userId, accountId: debt.id });
  });
});

describe.skipIf(!ENABLED)('manual entry — holdings', () => {
  it('creates and lists a holding linked to an account, computes value from price * quantity', async () => {
    const acc = await createAccount(db, {
      userId,
      input: {
        name: 'TEST ISA', type: 'isa', currency: 'GBP',
        currentBalanceGbp: 10_000, isBusiness: false, isIsa: true,
        institutionId: null, isaType: null, notes: null, active: true,
      },
    });

    const { id } = await createHolding(db, {
      userId,
      input: {
        accountId: acc.id,
        assetName: 'TEST Vanguard FTSE Global All Cap',
        tickerLocal: 'VWRP',
        assetType: 'fund',
        quantity: 50,
        avgCost: 90,
        currentPrice: 100,
        currency: 'GBP',
        riskCategory: 'medium',
        notes: null,
      },
    });
    const list = await listHoldings(db, userId);
    const row = list.find((h) => h.id === id)!;
    expect(row.currentValueGbp).toBe(5_000);
    expect(row.accountName).toBe('TEST ISA');

    await deleteHolding(db, { userId, holdingId: id });
    await deleteAccount(db, { userId, accountId: acc.id });
  });
});

describe.skipIf(!ENABLED)('manual entry — transactions feed monthly cashflow', () => {
  it('classifies income and expense correctly for the current month', async () => {
    const acc = await createAccount(db, {
      userId,
      input: {
        name: 'TEST current', type: 'cash', currency: 'GBP',
        currentBalanceGbp: 1_000, isBusiness: false, isIsa: false,
        institutionId: null, isaType: null, notes: null, active: true,
      },
    });

    const today = new Date();
    const inc = await createTransaction(db, {
      userId,
      input: {
        accountId: acc.id,
        postedAt: today.toISOString(),
        amountGbp: 2_500,
        direction: 'income',
        categoryId: null,
        description: 'Salary',
        notes: null,
        holdingId: null,
        recurring: true,
      },
    });
    const exp = await createTransaction(db, {
      userId,
      input: {
        accountId: acc.id,
        postedAt: today.toISOString(),
        amountGbp: 600,
        direction: 'expense',
        categoryId: null,
        description: 'Rent',
        notes: null,
        holdingId: null,
        recurring: true,
      },
    });

    const snap = await loadSnapshot(userId);
    expect(snap.monthlyIncomeGbp).toBeGreaterThanOrEqual(2_500);
    expect(snap.monthlyExpensesGbp).toBeGreaterThanOrEqual(600);
    expect(snap.monthlyIncomeSource).toBe('derived');
    expect(snap.monthlyExpensesSource).toBe('derived');

    const list = await listTransactions(db, userId, { limit: 5 });
    expect(list.find((t) => t.id === inc.id)?.amountGbp).toBe(2_500);
    expect(list.find((t) => t.id === exp.id)?.amountGbp).toBe(-600); // signed

    await deleteTransaction(db, { userId, transactionId: inc.id });
    await deleteTransaction(db, { userId, transactionId: exp.id });
    await deleteAccount(db, { userId, accountId: acc.id });
  });
});

describe.skipIf(!ENABLED)('manual entry — ISA contribution calculation', () => {
  it('inserting a deposit updates isa_years.deposited + remaining', async () => {
    const acc = await createAccount(db, {
      userId,
      input: {
        name: 'TEST ISA contrib', type: 'isa', currency: 'GBP',
        currentBalanceGbp: 0, isBusiness: false, isIsa: true,
        institutionId: null, isaType: null, notes: null, active: true,
      },
    });

    const ty = currentTaxYearNumber();
    const { id, isaYearTotals } = await createIsaDeposit(db, {
      userId,
      input: {
        accountId: acc.id,
        depositedAt: new Date().toISOString(),
        amountGbp: 3_500,
        taxYear: ty,
        notes: null,
      },
    });
    expect(isaYearTotals.deposited).toBe(3_500);
    expect(isaYearTotals.remaining).toBe(16_500);

    // Add a second deposit to confirm running totals.
    await createIsaDeposit(db, {
      userId,
      input: {
        accountId: acc.id,
        depositedAt: new Date().toISOString(),
        amountGbp: 1_000,
        taxYear: ty,
        notes: null,
      },
    });
    const snap = await loadSnapshot(userId);
    expect(snap.isa?.deposited).toBe(4_500);
    expect(snap.isa?.remaining).toBe(15_500);

    // Delete the first one and confirm totals roll back.
    await deleteIsaDeposit(db, { userId, depositId: id });
    const snap2 = await loadSnapshot(userId);
    expect(snap2.isa?.deposited).toBe(1_000);
    expect(snap2.isa?.remaining).toBe(19_000);

    await deleteAccount(db, { userId, accountId: acc.id });
  });
});
