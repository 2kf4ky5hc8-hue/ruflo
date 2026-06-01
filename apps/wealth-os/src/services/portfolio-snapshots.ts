// Portfolio snapshot writer + reader. Persists the running market value so
// drawdown can be computed across time, not just from in-memory state.

import { and, desc, eq, gt } from 'drizzle-orm';
import { db } from '../lib/db';
import { portfolioSnapshots, accounts, holdings, transactions } from '../db/schema/index';
import { latestPrices } from './prices';
import { computeDrawdown, type SnapshotInput } from './portfolio-risk';

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Compute and persist a snapshot of the user's portfolio. Updates the running
 * high-water mark and current drawdown in the row.
 *
 * `force=false` (default) will skip if a snapshot exists within the last hour;
 * pass `true` (e.g. for the "snapshot now" button) to bypass that.
 */
export async function takeSnapshot(
  userId: string, opts: { force?: boolean; source?: string } = {},
): Promise<{ snapshotId: string | null; skipped: boolean; cashGbp: number; investableGbp: number; totalMvGbp: number; hwmGbp: number; drawdownPct: number }> {
  // Skip if a recent snapshot exists.
  const [recent] = await db.select().from(portfolioSnapshots)
    .where(eq(portfolioSnapshots.userId, userId))
    .orderBy(desc(portfolioSnapshots.ts)).limit(1);
  const fresh = recent && (Date.now() - new Date(recent.ts).getTime()) < ONE_HOUR_MS;
  if (!opts.force && fresh) {
    return {
      snapshotId: null, skipped: true,
      cashGbp: Number(recent!.cashGbp),
      investableGbp: Number(recent!.investableGbp),
      totalMvGbp: Number(recent!.totalMvGbp),
      hwmGbp: Number(recent!.highWaterMarkGbp),
      drawdownPct: Number(recent!.drawdownPct),
    };
  }

  // Cash position = sum of transactions across cash + ISA-cash accounts.
  const accs = await db.select().from(accounts).where(eq(accounts.userId, userId));
  let cash = 0;
  for (const a of accs.filter((x) => x.type === 'cash')) {
    const txs = await db.select({ amount: transactions.amount })
      .from(transactions).where(eq(transactions.accountId, a.id));
    cash += txs.reduce((acc, t) => acc + Number(t.amount), 0);
  }

  // Investable = sum of holdings MV (priced; falls back to book if unpriced).
  const holdRows = await db.select().from(holdings);
  const accIds = new Set(accs.map((a) => a.id));
  const mine = holdRows.filter((h) => accIds.has(h.accountId));
  const priceMap = await latestPrices(mine.map((h) => h.instrumentId));
  let investable = 0;
  for (const h of mine) {
    const px = priceMap.get(h.instrumentId);
    const qty = Number(h.quantity);
    const cost = Number(h.avgCost ?? 0);
    investable += px ? qty * px.price : qty * cost;
  }

  const total = cash + investable;
  const prevHwm = recent ? Number(recent.highWaterMarkGbp) : 0;
  const hwm = Math.max(prevHwm, total);
  const drawdown = hwm > 0 ? Math.max(0, (hwm - total) / hwm) : 0;

  const [row] = await db.insert(portfolioSnapshots).values({
    userId,
    cashGbp: cash.toString(),
    investableGbp: investable.toString(),
    totalMvGbp: total.toString(),
    highWaterMarkGbp: hwm.toString(),
    drawdownPct: drawdown.toString(),
    source: opts.source ?? 'manual',
  }).returning({ id: portfolioSnapshots.id });

  return {
    snapshotId: row!.id, skipped: false,
    cashGbp: cash, investableGbp: investable, totalMvGbp: total,
    hwmGbp: hwm, drawdownPct: drawdown,
  };
}

export async function recentSnapshots(userId: string, days = 90): Promise<SnapshotInput[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db.select().from(portfolioSnapshots)
    .where(and(eq(portfolioSnapshots.userId, userId), gt(portfolioSnapshots.ts, since)))
    .orderBy(portfolioSnapshots.ts);
  return rows.map((r) => ({ ts: new Date(r.ts), totalMvGbp: Number(r.totalMvGbp) }));
}

/** Drawdown computed from the persisted snapshots (90d by default). */
export async function currentDrawdown(userId: string, days = 90) {
  const series = await recentSnapshots(userId, days);
  return computeDrawdown(series);
}
