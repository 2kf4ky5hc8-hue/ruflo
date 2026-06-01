// Portfolio snapshots — manual refresh, daily idempotent job, history.
//
// Design notes:
//   * All date logic uses the UK (Europe/London) calendar day, so two snapshots
//     on the same UK day are treated as duplicates regardless of the wall-clock
//     hour. The user is a UK taxpayer; everything else in the app is GBP.
//   * No network dependency. Prices come from the `prices` table; if a holding
//     has no cached price, we fall back to book value.
//   * Pure computation is split out so it can be tested without a DB.

import { and, desc, eq, gt } from 'drizzle-orm';
import { db as defaultDb } from '../lib/db';
import {
  portfolioSnapshots, accounts, holdings, transactions, users,
} from '../db/schema/index';
import { latestPrices } from './prices';
import { computeDrawdown, type SnapshotInput } from './portfolio-risk';

const ONE_HOUR_MS = 60 * 60 * 1000;

// The DB type matches our singleton. Test code passes a typed `drizzle()`
// instance with the same schema; production passes the singleton.
type Db = typeof defaultDb;

// ── Pure computation (no I/O) ─────────────────────────────────────────────

export interface SnapshotMetrics {
  cashGbp: number;
  investableGbp: number;
  totalMvGbp: number;
  highWaterMarkGbp: number;
  drawdownPct: number;
  drawdownGbp: number;
}

/**
 * Given the inputs, derive the persisted metrics. The HWM is carried forward
 * — it only ever increases (until reset). Drawdown is computed against it.
 */
export function computeSnapshotMetrics(input: {
  cashGbp: number;
  investableGbp: number;
  prevHighWaterMarkGbp: number;
}): SnapshotMetrics {
  const cash = Math.max(0, Number(input.cashGbp) || 0);
  const inv = Math.max(0, Number(input.investableGbp) || 0);
  const total = cash + inv;
  const hwm = Math.max(input.prevHighWaterMarkGbp ?? 0, total);
  const drawdownGbp = Math.max(0, hwm - total);
  const drawdownPct = hwm > 0 ? drawdownGbp / hwm : 0;
  return {
    cashGbp: cash,
    investableGbp: inv,
    totalMvGbp: total,
    highWaterMarkGbp: hwm,
    drawdownPct,
    drawdownGbp,
  };
}

/** UK calendar day key, YYYY-MM-DD. */
export function ukDayKey(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return `${map.year}-${map.month}-${map.day}`;
}

/** Convert a UK day key (YYYY-MM-DD) to the half-open UTC window [start, nextStart). */
export function ukDayWindowUtc(dayKey: string): { start: Date; nextStart: Date } {
  const [y, m, d] = dayKey.split('-').map(Number);
  // Start of UK day = 00:00 Europe/London. In Jan–Mar that's UTC midnight;
  // in BST it's 23:00 the previous UTC day. We're conservative: scan a wide
  // window and re-check the day key in TS.
  const start = new Date(Date.UTC(y!, (m! - 1), d!, -1, 0, 0)); // -1h to cover BST
  const nextStart = new Date(start.getTime() + 25 * 60 * 60 * 1000); // 25h to overlap
  return { start, nextStart };
}

// ── DB reads ──────────────────────────────────────────────────────────────

async function aggregateCashAndInvestable(db: Db, userId: string): Promise<{ cash: number; investable: number }> {
  const accs = await db.select().from(accounts).where(eq(accounts.userId, userId));

  let cash = 0;
  for (const a of accs.filter((x) => x.type === 'cash')) {
    const txs = await db.select({ amount: transactions.amount })
      .from(transactions).where(eq(transactions.accountId, a.id));
    cash += txs.reduce((acc, t) => acc + Number(t.amount), 0);
  }

  const accIds = new Set(accs.map((a) => a.id));
  const holdRows = await db.select().from(holdings);
  const mine = holdRows.filter((h) => accIds.has(h.accountId));
  const priceMap = await latestPrices(mine.map((h) => h.instrumentId));

  let investable = 0;
  for (const h of mine) {
    const px = priceMap.get(h.instrumentId);
    const qty = Number(h.quantity);
    const cost = Number(h.avgCost ?? 0);
    investable += px ? qty * px.price : qty * cost;
  }
  return { cash, investable };
}

async function mostRecentSnapshot(db: Db, userId: string) {
  const [row] = await db.select().from(portfolioSnapshots)
    .where(eq(portfolioSnapshots.userId, userId))
    .orderBy(desc(portfolioSnapshots.ts)).limit(1);
  return row;
}

async function snapshotExistsForUkDay(db: Db, userId: string, dayKey: string, source?: string) {
  const { start, nextStart } = ukDayWindowUtc(dayKey);
  const rows = await db.select().from(portfolioSnapshots)
    .where(and(
      eq(portfolioSnapshots.userId, userId),
      gt(portfolioSnapshots.ts, start),
    ));
  return rows.some((r) =>
    r.ts <= nextStart &&
    ukDayKey(new Date(r.ts)) === dayKey &&
    (source ? r.source === source : true),
  );
}

// ── Writes ────────────────────────────────────────────────────────────────

async function insertSnapshot(
  db: Db, userId: string, m: SnapshotMetrics, source: string, ts?: Date,
): Promise<string> {
  const [row] = await db.insert(portfolioSnapshots).values({
    userId,
    ts: ts ?? new Date(),
    cashGbp: m.cashGbp.toString(),
    investableGbp: m.investableGbp.toString(),
    totalMvGbp: m.totalMvGbp.toString(),
    highWaterMarkGbp: m.highWaterMarkGbp.toString(),
    drawdownPct: m.drawdownPct.toString(),
    drawdownGbp: m.drawdownGbp.toString(),
    source,
  }).returning({ id: portfolioSnapshots.id });
  return row!.id;
}

// ── Public: manual refresh (preserves /risk button behaviour) ────────────

export async function takeSnapshot(
  userId: string,
  opts: { force?: boolean; source?: string; db?: Db; now?: Date } = {},
): Promise<{ snapshotId: string | null; skipped: boolean } & SnapshotMetrics> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const recent = await mostRecentSnapshot(db, userId);
  const fresh = recent && (now.getTime() - new Date(recent.ts).getTime()) < ONE_HOUR_MS;
  if (!opts.force && fresh) {
    return {
      snapshotId: null, skipped: true,
      cashGbp: Number(recent!.cashGbp),
      investableGbp: Number(recent!.investableGbp),
      totalMvGbp: Number(recent!.totalMvGbp),
      highWaterMarkGbp: Number(recent!.highWaterMarkGbp),
      drawdownPct: Number(recent!.drawdownPct),
      drawdownGbp: Number(recent!.drawdownGbp),
    };
  }
  const { cash, investable } = await aggregateCashAndInvestable(db, userId);
  const metrics = computeSnapshotMetrics({
    cashGbp: cash, investableGbp: investable,
    prevHighWaterMarkGbp: recent ? Number(recent.highWaterMarkGbp) : 0,
  });
  const id = await insertSnapshot(db, userId, metrics, opts.source ?? 'manual', now);
  return { snapshotId: id, skipped: false, ...metrics };
}

// ── Public: daily idempotent job ──────────────────────────────────────────

export interface DailyJobResult {
  userId: string;
  snapshotId: string | null;
  skipped: boolean;
  reason?: 'already_snapshotted_today';
  dayKey: string;
  metrics: SnapshotMetrics | null;
}

/**
 * Take *the* daily snapshot for this user. Idempotent on the UK calendar day:
 * a second invocation on the same day is a no-op.
 *
 * No network access — only consults the cached `prices` table. If a holding
 * has never been quoted, it contributes at book value (matches /holdings).
 */
export async function runDailySnapshot(
  userId: string,
  opts: { now?: Date; db?: Db; force?: boolean; source?: string } = {},
): Promise<DailyJobResult> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const dayKey = ukDayKey(now);
  const source = opts.source ?? 'daily';

  if (!opts.force && await snapshotExistsForUkDay(db, userId, dayKey, source)) {
    return { userId, snapshotId: null, skipped: true, reason: 'already_snapshotted_today', dayKey, metrics: null };
  }

  const recent = await mostRecentSnapshot(db, userId);
  const { cash, investable } = await aggregateCashAndInvestable(db, userId);
  const metrics = computeSnapshotMetrics({
    cashGbp: cash, investableGbp: investable,
    prevHighWaterMarkGbp: recent ? Number(recent.highWaterMarkGbp) : 0,
  });
  const id = await insertSnapshot(db, userId, metrics, source, now);
  return { userId, snapshotId: id, skipped: false, dayKey, metrics };
}

export async function runDailySnapshotForAllUsers(
  opts: { now?: Date; db?: Db; force?: boolean } = {},
): Promise<DailyJobResult[]> {
  const db = opts.db ?? defaultDb;
  const allUsers = await db.select({ id: users.id }).from(users);
  const results: DailyJobResult[] = [];
  for (const u of allUsers) {
    results.push(await runDailySnapshot(u.id, opts));
  }
  return results;
}

// ── Public: history reads ─────────────────────────────────────────────────

export async function recentSnapshots(userId: string, days = 90, db: Db = defaultDb): Promise<SnapshotInput[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.select().from(portfolioSnapshots)
    .where(and(eq(portfolioSnapshots.userId, userId), gt(portfolioSnapshots.ts, since)))
    .orderBy(portfolioSnapshots.ts);
  return rows.map((r) => ({ ts: new Date(r.ts), totalMvGbp: Number(r.totalMvGbp) }));
}

/** Chart-ready history: { ts, totalMvGbp, highWaterMarkGbp, drawdownPct, drawdownGbp }. */
export async function snapshotHistory(userId: string, days = 90, db: Db = defaultDb) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.select().from(portfolioSnapshots)
    .where(and(eq(portfolioSnapshots.userId, userId), gt(portfolioSnapshots.ts, since)))
    .orderBy(portfolioSnapshots.ts);
  return rows.map((r) => ({
    ts: new Date(r.ts),
    cashGbp: Number(r.cashGbp),
    investableGbp: Number(r.investableGbp),
    totalMvGbp: Number(r.totalMvGbp),
    highWaterMarkGbp: Number(r.highWaterMarkGbp),
    drawdownPct: Number(r.drawdownPct),
    drawdownGbp: Number(r.drawdownGbp),
    source: r.source,
  }));
}

/** Drawdown computed from the persisted snapshots (90d by default). */
export async function currentDrawdown(userId: string, days = 90) {
  const series = await recentSnapshots(userId, days);
  return computeDrawdown(series);
}
