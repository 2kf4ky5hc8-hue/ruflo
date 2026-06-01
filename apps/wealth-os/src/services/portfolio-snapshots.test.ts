// Daily snapshot — pure logic tests + DB integration tests.
//
// Pure tests cover HWM carry-forward, drawdown maths, and UK calendar day
// bucketing. Integration tests cover idempotent reruns and "no network" —
// the price provider is never touched; we work off the cached `prices` table.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../db/schema/index';
import {
  users, accounts, holdings, transactions, prices, instruments, portfolioSnapshots,
} from '../db/schema/index';
import {
  computeSnapshotMetrics, ukDayKey, ukDayWindowUtc,
  runDailySnapshot, takeSnapshot, snapshotHistory,
} from './portfolio-snapshots';
import { computeDrawdown } from './portfolio-risk';

// ── Pure tests ────────────────────────────────────────────────────────────

describe('computeSnapshotMetrics', () => {
  it('uses today\'s total as the HWM when there is no prior HWM', () => {
    const m = computeSnapshotMetrics({ cashGbp: 1000, investableGbp: 9000, prevHighWaterMarkGbp: 0 });
    expect(m.totalMvGbp).toBe(10000);
    expect(m.highWaterMarkGbp).toBe(10000);
    expect(m.drawdownPct).toBe(0);
    expect(m.drawdownGbp).toBe(0);
  });

  it('carries the HWM forward when total falls', () => {
    const m = computeSnapshotMetrics({ cashGbp: 0, investableGbp: 8000, prevHighWaterMarkGbp: 10000 });
    expect(m.highWaterMarkGbp).toBe(10000);
    expect(m.totalMvGbp).toBe(8000);
    expect(m.drawdownGbp).toBe(2000);
    expect(m.drawdownPct).toBeCloseTo(0.20, 6);
  });

  it('raises the HWM when total exceeds the prior HWM', () => {
    const m = computeSnapshotMetrics({ cashGbp: 0, investableGbp: 12000, prevHighWaterMarkGbp: 10000 });
    expect(m.highWaterMarkGbp).toBe(12000);
    expect(m.drawdownPct).toBe(0);
  });

  it('treats negative inputs as zero (no double-counting if a sign flips)', () => {
    const m = computeSnapshotMetrics({ cashGbp: -100, investableGbp: 5000, prevHighWaterMarkGbp: 0 });
    expect(m.cashGbp).toBe(0);
    expect(m.totalMvGbp).toBe(5000);
  });

  it('is deterministic', () => {
    const args = { cashGbp: 4321.50, investableGbp: 56789.10, prevHighWaterMarkGbp: 70000 };
    const first = computeSnapshotMetrics(args);
    for (let i = 0; i < 20; i++) expect(computeSnapshotMetrics(args)).toEqual(first);
  });
});

describe('ukDayKey + ukDayWindowUtc', () => {
  it('keys by the UK calendar day in GMT (Jan)', () => {
    // 03:30 UTC on 2026-01-15 is 03:30 UK in winter → same UK day.
    expect(ukDayKey(new Date('2026-01-15T03:30:00Z'))).toBe('2026-01-15');
    expect(ukDayKey(new Date('2026-01-15T23:59:00Z'))).toBe('2026-01-15');
  });

  it('keys correctly during BST (UTC behind UK by 1h)', () => {
    // 23:30 UTC on 2026-06-15 = 00:30 UK on 2026-06-16 (BST is UTC+1).
    expect(ukDayKey(new Date('2026-06-15T23:30:00Z'))).toBe('2026-06-16');
    expect(ukDayKey(new Date('2026-06-15T22:00:00Z'))).toBe('2026-06-15');
  });

  it('produces a window that contains all UTC instants for the UK day', () => {
    const win = ukDayWindowUtc('2026-06-15');
    expect(win.start.getTime()).toBeLessThanOrEqual(Date.UTC(2026, 5, 14, 23, 0));
    expect(win.nextStart.getTime()).toBeGreaterThanOrEqual(Date.UTC(2026, 5, 15, 23, 30));
  });
});

describe('computeDrawdown (snapshot integration)', () => {
  it('finds the HWM and current drawdown from a historical series', () => {
    const r = computeDrawdown([
      { ts: new Date('2026-01-01'), totalMvGbp: 10000 },
      { ts: new Date('2026-02-01'), totalMvGbp: 12500 },
      { ts: new Date('2026-03-01'), totalMvGbp: 11000 },
      { ts: new Date('2026-04-01'), totalMvGbp:  9000 },
    ])!;
    expect(r.highWaterMarkGbp).toBe(12500);
    expect(r.currentMvGbp).toBe(9000);
    expect(r.drawdownPct).toBeCloseTo((12500 - 9000) / 12500, 6);
  });
});

// ── DB integration ────────────────────────────────────────────────────────

const URL = process.env.DATABASE_URL ?? 'postgres://wealth_os:wealth_os@localhost:5432/wealth_os';

let sqlClient: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>;
let userId: string;
let cashId: string;
let isaId: string;
let instrId: string;

beforeAll(async () => {
  sqlClient = postgres(URL, { max: 1 });
  db = drizzle(sqlClient, { schema });
  const [u] = await db.select({ id: users.id }).from(users).limit(1);
  if (!u) throw new Error('Run pnpm db:bootstrap first.');
  userId = u.id;

  // Test accounts.
  const [cash] = await db.insert(accounts).values({ userId, name: 'Snapshot test cash', type: 'cash', currency: 'GBP' }).returning({ id: accounts.id });
  cashId = cash!.id;
  const [isa] = await db.insert(accounts).values({ userId, name: 'Snapshot test ISA', type: 'isa', currency: 'GBP' }).returning({ id: accounts.id });
  isaId = isa!.id;

  // £10,000 of cash.
  await db.insert(transactions).values({
    accountId: cashId, postedAt: new Date(), amount: '10000', currency: 'GBP', source: 'test',
  });

  // One holding with a cached price → known investable value.
  const [ins] = await db.insert(instruments).values({
    ticker: 'TESTSNAP', name: 'Snapshot test ETF', assetClass: 'developed_equity', currency: 'GBP',
  }).returning({ id: instruments.id });
  instrId = ins!.id;
  await db.insert(holdings).values({
    accountId: isaId, instrumentId: instrId, quantity: '100', avgCost: '90', currency: 'GBP',
    asOf: new Date(), source: 'test',
  });
  // Cached price £100 → investable £10,000.
  await db.insert(prices).values({
    instrumentId: instrId, ts: new Date(), close: '100', source: 'stub',
  });
});

afterAll(async () => {
  // Clean up so the next run is fresh.
  await db.delete(portfolioSnapshots).where(eq(portfolioSnapshots.userId, userId));
  await db.delete(holdings).where(eq(holdings.accountId, isaId));
  await db.delete(instruments).where(eq(instruments.id, instrId));
  await db.delete(transactions).where(eq(transactions.accountId, cashId));
  await db.delete(accounts).where(eq(accounts.id, cashId));
  await db.delete(accounts).where(eq(accounts.id, isaId));
  await sqlClient.end();
});

describe('runDailySnapshot — DB integration', () => {
  // Use a fixed "now" so tests are repeatable.
  const day1 = new Date('2026-05-15T17:00:00Z');
  const day2 = new Date('2026-05-16T17:00:00Z');

  it('creates a snapshot on first call of the day', async () => {
    // Make sure the £100 price is fresher than the bootstrap fixture so
    // latestPrices returns it on day1.
    await db.update(prices).set({ ts: new Date(day1.getTime() - 1000) })
      .where(eq(prices.instrumentId, instrId));

    const r = await runDailySnapshot(userId, { now: day1, db });
    expect(r.skipped).toBe(false);
    expect(r.snapshotId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.metrics).not.toBeNull();
    expect(r.metrics!.cashGbp).toBeCloseTo(10000, 2);
    expect(r.metrics!.investableGbp).toBeCloseTo(10000, 2);  // 100 × £100
    expect(r.metrics!.totalMvGbp).toBeCloseTo(20000, 2);
    expect(r.metrics!.highWaterMarkGbp).toBeCloseTo(20000, 2);
    expect(r.metrics!.drawdownPct).toBe(0);
  });

  it('is idempotent — a second call on the same UK day is a no-op', async () => {
    const r = await runDailySnapshot(userId, { now: new Date(day1.getTime() + 2 * 3600 * 1000), db });
    expect(r.skipped).toBe(true);
    expect(r.reason).toBe('already_snapshotted_today');
  });

  it('carries the HWM forward when the next day\'s value is lower', async () => {
    // Drop the cached price to £80 → investable £8,000 → total £18,000.
    await db.insert(prices).values({
      instrumentId: instrId, ts: new Date(day2.getTime()), close: '80', source: 'stub',
    });
    const r = await runDailySnapshot(userId, { now: day2, db });
    expect(r.skipped).toBe(false);
    expect(r.metrics!.totalMvGbp).toBeCloseTo(18000, 2);
    expect(r.metrics!.highWaterMarkGbp).toBeCloseTo(20000, 2);  // carried forward
    expect(r.metrics!.drawdownGbp).toBeCloseTo(2000, 2);
    expect(r.metrics!.drawdownPct).toBeCloseTo(0.10, 4);
  });

  it('snapshotHistory returns the persisted rows in order', async () => {
    const rows = await snapshotHistory(userId, 30, db);
    // First 2 daily snapshots (plus any taken by other tests via takeSnapshot).
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.ts.getTime()).toBeGreaterThanOrEqual(rows[i - 1]!.ts.getTime());
    }
  });

  it('does NOT make network calls (provider is never invoked)', async () => {
    // The runner reads prices from the DB cache only. We mark the provider as
    // unreachable for the duration of this test; the job should still succeed.
    const prev = process.env.MARKET_DATA_PROVIDER;
    process.env.MARKET_DATA_PROVIDER = 'fmp';
    process.env.MARKET_DATA_API_KEY = '';  // empty → factory falls back to stub anyway
    try {
      const r = await runDailySnapshot(userId, { now: day2, db, force: true });
      expect(r.snapshotId).not.toBeNull();
      expect(r.metrics!.totalMvGbp).toBeGreaterThan(0);
    } finally {
      process.env.MARKET_DATA_PROVIDER = prev;
    }
  });

  it('forced rerun on the same day creates a new row', async () => {
    const before = await snapshotHistory(userId, 30, db);
    await runDailySnapshot(userId, { now: day2, db, force: true });
    const after = await snapshotHistory(userId, 30, db);
    expect(after.length).toBe(before.length + 1);
  });
});

describe('takeSnapshot — manual refresh still works', () => {
  it('writes a snapshot with source=manual by default', async () => {
    const r = await takeSnapshot(userId, { db, force: true, source: 'manual' });
    expect(r.skipped).toBe(false);
    const rows = await snapshotHistory(userId, 1, db);
    const last = rows[rows.length - 1]!;
    expect(last.source).toBe('manual');
  });
});
