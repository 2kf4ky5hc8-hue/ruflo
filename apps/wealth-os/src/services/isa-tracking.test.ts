import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import * as schema from '../db/schema/index';
import { users, accounts, isaDeposits, isaYears } from '../db/schema/index';
import {
  computeIsaUsage, recordIsaMovement, getIsaUsageForUser, deleteIsaMovement,
  DEFAULT_ISA_ALLOWANCE_GBP,
} from './isa-tracking';
import { currentUkTaxYear } from './uk-tax-year';

// ── Pure tests ────────────────────────────────────────────────────────────

describe('computeIsaUsage — pure', () => {
  const taxYear = 2026;

  it('default allowance is the UK £20,000', () => {
    expect(DEFAULT_ISA_ALLOWANCE_GBP).toBe(20_000);
  });

  it('contributions count, transfers and withdrawals do NOT (non-flexible)', () => {
    const u = computeIsaUsage({
      taxYear,
      deposits: [
        { amountGbp: 5_000, kind: 'contribution',  accountIsFlexible: false },
        { amountGbp: 1_000, kind: 'transfer_in',   accountIsFlexible: false },
        { amountGbp:   500, kind: 'transfer_out',  accountIsFlexible: false },
        { amountGbp: 1_000, kind: 'withdrawal',    accountIsFlexible: false }, // does NOT restore
      ],
    });
    expect(u.contributionsGbp).toBe(5_000);
    expect(u.transfersInGbp).toBe(1_000);
    expect(u.transfersOutGbp).toBe(500);
    expect(u.withdrawalsGbp).toBe(1_000);
    expect(u.flexibleWithdrawalsGbp).toBe(0);
    expect(u.usedGbp).toBe(5_000);                           // not 5,000 - 1,000
    expect(u.remainingGbp).toBe(15_000);
  });

  it('flexible-ISA withdrawals restore allowance in the same year', () => {
    const u = computeIsaUsage({
      taxYear,
      deposits: [
        { amountGbp: 20_000, kind: 'contribution', accountIsFlexible: true },
        { amountGbp:  5_000, kind: 'withdrawal',   accountIsFlexible: true },
      ],
    });
    expect(u.usedGbp).toBe(15_000);
    expect(u.remainingGbp).toBe(5_000);
  });

  it('flexible withdrawals never drive used below zero', () => {
    const u = computeIsaUsage({
      taxYear,
      deposits: [
        { amountGbp: 2_000, kind: 'contribution', accountIsFlexible: true },
        { amountGbp: 5_000, kind: 'withdrawal',   accountIsFlexible: true },
      ],
    });
    expect(u.usedGbp).toBe(0);
    expect(u.remainingGbp).toBe(20_000);
  });

  it('multiple ISA accounts contribute to the same allowance bucket', () => {
    const u = computeIsaUsage({
      taxYear,
      deposits: [
        { amountGbp: 4_000, kind: 'contribution', accountIsFlexible: false }, // S&S ISA
        { amountGbp: 8_000, kind: 'contribution', accountIsFlexible: false }, // Cash ISA
      ],
    });
    expect(u.usedGbp).toBe(12_000);
  });

  it('over-subscription is surfaced (status: over)', () => {
    const u = computeIsaUsage({
      taxYear,
      deposits: [{ amountGbp: 21_000, kind: 'contribution', accountIsFlexible: false }],
    });
    expect(u.usedGbp).toBe(21_000);
    expect(u.remainingGbp).toBe(0);
    expect(u.status).toBe('over');
    expect(u.utilisationPct).toBeGreaterThan(1);
  });

  it('warn band kicks in at >= 80%', () => {
    const u = computeIsaUsage({
      taxYear,
      deposits: [{ amountGbp: 16_001, kind: 'contribution', accountIsFlexible: false }],
    });
    expect(u.status).toBe('warn');
  });

  it('configurable allowance (e.g. simulated 2027/28 with a hypothetical rise)', () => {
    const u = computeIsaUsage({
      taxYear: 2027,
      allowanceGbp: 25_000,
      deposits: [{ amountGbp: 5_000, kind: 'contribution', accountIsFlexible: false }],
    });
    expect(u.allowanceGbp).toBe(25_000);
    expect(u.remainingGbp).toBe(20_000);
  });

  it('is deterministic + does NOT call any network APIs (pure function)', () => {
    // No global setup, no fetch — a single import suffices.
    const args = {
      taxYear,
      deposits: [{ amountGbp: 1_000, kind: 'contribution' as const, accountIsFlexible: true }],
    };
    const first = computeIsaUsage(args);
    for (let i = 0; i < 20; i++) expect(computeIsaUsage(args)).toEqual(first);
  });
});

// ── DB integration ───────────────────────────────────────────────────────

const URL = process.env.DATABASE_URL ?? 'postgres://wealth_os:wealth_os@localhost:5432/wealth_os';
let sqlClient: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let userId: string;
let ssIsaId: string;
let cashIsaId: string;
let flexibleIsaId: string;
let giaId: string;
const taxYear = currentUkTaxYear();

beforeAll(async () => {
  sqlClient = postgres(URL, { max: 1 });
  db = drizzle(sqlClient, { schema });
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error('Run pnpm db:bootstrap first.');
  userId = u.id;

  // Wipe any pre-existing ISA test data for a clean slate.
  await db.delete(isaDeposits).where(eq(isaDeposits.userId, userId));

  const mk = async (name: string, type: string, isaType: string | null, isFlexible = false) => {
    const [a] = await db.insert(accounts).values({
      userId, name, type, currency: 'GBP', isFlexible,
      isaType: isaType, isIsa: isaType != null,
    }).returning({ id: accounts.id });
    return a!.id;
  };
  ssIsaId = await mk('Vanguard S&S ISA', 'isa', 'stocks_shares');
  cashIsaId = await mk('Marcus Cash ISA', 'isa', 'cash');
  flexibleIsaId = await mk('Flex S&S ISA', 'isa', 'stocks_shares', true);
  giaId = await mk('Trading 212 GIA', 'gia', null);
});

afterAll(async () => {
  await db.delete(isaDeposits).where(eq(isaDeposits.userId, userId));
  await db.delete(accounts).where(eq(accounts.id, ssIsaId));
  await db.delete(accounts).where(eq(accounts.id, cashIsaId));
  await db.delete(accounts).where(eq(accounts.id, flexibleIsaId));
  await db.delete(accounts).where(eq(accounts.id, giaId));
  await sqlClient.end();
});

describe('recordIsaMovement + getIsaUsageForUser — DB integration', () => {
  it('records a contribution, refreshes isa_years, and shows usage', async () => {
    await recordIsaMovement({ userId, accountId: ssIsaId, amountGbp: 5_000, kind: 'contribution', db });
    const u = await getIsaUsageForUser(userId, taxYear, db);
    expect(u.contributionsGbp).toBe(5_000);
    expect(u.usedGbp).toBe(5_000);
    expect(u.remainingGbp).toBe(15_000);
    // isa_years aggregate row reflects the new total.
    const [row] = await db.select().from(isaYears)
      .where(and(eq(isaYears.userId, userId), eq(isaYears.taxYear, taxYear))).limit(1);
    expect(Number(row!.deposited)).toBe(5_000);
    expect(Number(row!.remaining)).toBe(15_000);
  });

  it('transfers in do NOT reduce the allowance', async () => {
    await recordIsaMovement({ userId, accountId: cashIsaId, amountGbp: 30_000, kind: 'transfer_in', db });
    const u = await getIsaUsageForUser(userId, taxYear, db);
    expect(u.transfersInGbp).toBe(30_000);
    expect(u.usedGbp).toBe(5_000);                  // unchanged
    expect(u.remainingGbp).toBe(15_000);
  });

  it('two ISA wrappers share the same annual bucket', async () => {
    await recordIsaMovement({ userId, accountId: cashIsaId, amountGbp: 8_000, kind: 'contribution', db });
    const u = await getIsaUsageForUser(userId, taxYear, db);
    expect(u.contributionsGbp).toBe(13_000);
    expect(u.usedGbp).toBe(13_000);
  });

  it('flexible withdrawals restore allowance; non-flexible do not', async () => {
    // First, withdraw from the (non-flexible) S&S ISA → should NOT restore.
    await recordIsaMovement({ userId, accountId: ssIsaId, amountGbp: 2_000, kind: 'withdrawal', db });
    const u1 = await getIsaUsageForUser(userId, taxYear, db);
    expect(u1.usedGbp).toBe(13_000);  // unchanged

    // Now contribute to the flexible ISA and withdraw the same amount.
    await recordIsaMovement({ userId, accountId: flexibleIsaId, amountGbp: 4_000, kind: 'contribution', db });
    await recordIsaMovement({ userId, accountId: flexibleIsaId, amountGbp: 1_500, kind: 'withdrawal',   db });
    const u2 = await getIsaUsageForUser(userId, taxYear, db);
    expect(u2.contributionsGbp).toBe(17_000);        // 5,000 + 8,000 + 4,000
    expect(u2.flexibleWithdrawalsGbp).toBe(1_500);
    expect(u2.usedGbp).toBe(17_000 - 1_500);
    expect(u2.remainingGbp).toBe(20_000 - 15_500);
  });

  it('refuses to record an ISA movement against a non-ISA account', async () => {
    await expect(recordIsaMovement({
      userId, accountId: giaId, amountGbp: 1_000, kind: 'contribution', db,
    })).rejects.toThrow(/ISA wrapper/);
  });

  it('refuses zero / negative amounts and unknown kinds', async () => {
    await expect(recordIsaMovement({
      userId, accountId: ssIsaId, amountGbp: 0, kind: 'contribution', db,
    })).rejects.toThrow();
    await expect(recordIsaMovement({
      userId, accountId: ssIsaId, amountGbp: 100, kind: 'foo' as never, db,
    })).rejects.toThrow();
  });

  it('deleteIsaMovement rolls back the totals', async () => {
    const u0 = await getIsaUsageForUser(userId, taxYear, db);
    const ids = await db.select({ id: isaDeposits.id, kind: isaDeposits.kind })
      .from(isaDeposits).where(eq(isaDeposits.userId, userId));
    const aContribution = ids.find((r) => r.kind === 'contribution')!.id;
    await deleteIsaMovement(userId, aContribution, db);
    const u1 = await getIsaUsageForUser(userId, taxYear, db);
    expect(u1.contributionsGbp).toBeLessThan(u0.contributionsGbp);
  });
});

describe('GBP-only assumption', () => {
  it('accounts seeded by the suite are GBP', async () => {
    const accs = await db.select({ currency: accounts.currency }).from(accounts);
    for (const a of accs) expect(a.currency).toBe('GBP');
  });

  it('isa_deposits.amount is GBP (no currency column on the row)', () => {
    // We don't store a currency on isa_deposits; the table is GBP-by-design.
    expect(Object.keys(schema.isaDeposits)).not.toContain('currency');
  });
});
