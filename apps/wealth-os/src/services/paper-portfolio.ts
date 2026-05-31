// Epic 14 — paper portfolio + decision journal.
//
// Simulated execution only. Opening a paper position records a fill at a
// given price, captures the default-plan benchmark at that moment, and lets
// the user mark to market over time. NEVER touches a broker.

import { and, eq, desc } from 'drizzle-orm';
import { db } from '../lib/db';
import { paperPositions, paperFills, auditEvents } from '../db/schema/index';
import { loadSnapshot } from '../lib/finance';
import { buildDefaultPlan } from './default-plan';
import { getMarketDataProvider } from './market-data/index';

// ── Fees model (PP-1402) ─────────────────────────────────────────────────
// Deliberately simple and conservative. Real per-broker schedules arrive with
// the fee_schedules table (Epic 17); this is the paper-trade default.

export interface FeeModel {
  dealingFeeFlatGbp: number;   // per trade
  fxSpreadPct: number;         // applied when wrapper trades a non-GBP asset
  stampDutyPct: number;        // 0.5% on UK share purchases (not ETFs/funds)
}

export const DEFAULT_FEE_MODEL: FeeModel = {
  dealingFeeFlatGbp: 0,        // most low-cost platforms: £0 for funds/ETFs
  fxSpreadPct: 0.0015,         // 0.15% FX spread on overseas assets
  stampDutyPct: 0.005,         // UK individual shares only
};

export function estimateFees(
  amountGbp: number,
  opts: { isUkShare?: boolean; isOverseas?: boolean } = {},
  model: FeeModel = DEFAULT_FEE_MODEL,
): number {
  let fees = model.dealingFeeFlatGbp;
  if (opts.isOverseas) fees += amountGbp * model.fxSpreadPct;
  if (opts.isUkShare) fees += amountGbp * model.stampDutyPct;
  return Math.round(fees * 100) / 100;
}

// ── Reason codes (decision journal) ──────────────────────────────────────

export const REASON_CODES = [
  'valuation', 'quality', 'growth', 'income', 'rebalance',
  'tax', 'cashflow', 'concentration', 'diversification', 'opportunity', 'other',
] as const;
export type ReasonCode = typeof REASON_CODES[number];

// ── Open a paper position ────────────────────────────────────────────────

export interface OpenPaperInput {
  instrumentRef: string;
  instrumentName?: string;
  assetClass: string;
  wrapper: string;
  amountGbp: number;      // £ committed
  fillPrice: number;      // simulated unit price at "execution"
  reasonCode: ReasonCode;
  thesis?: string;
  isUkShare?: boolean;
  isOverseas?: boolean;
  proposalExpectedReturnPct?: number;  // for the default-plan delta
  proposedActionId?: string;
}

export async function openPaperPosition(userId: string, input: OpenPaperInput): Promise<string> {
  if (input.amountGbp <= 0 || input.fillPrice <= 0) {
    throw new Error('Amount and fill price must be positive.');
  }
  const fees = estimateFees(input.amountGbp, { isUkShare: input.isUkShare, isOverseas: input.isOverseas });
  const investable = Math.max(0, input.amountGbp - fees);
  const quantity = investable / input.fillPrice;

  // Capture the default-plan benchmark at this moment (PP-1405).
  const snap = await loadSnapshot(userId);
  const plan = buildDefaultPlan(snap);
  const benchmarkReturn = plan.blendedReturnPct;
  const delta = input.proposalExpectedReturnPct != null
    ? input.proposalExpectedReturnPct - benchmarkReturn
    : null;

  const [pos] = await db.insert(paperPositions).values({
    userId,
    proposedActionId: input.proposedActionId ?? null,
    instrumentRef: input.instrumentRef,
    instrumentName: input.instrumentName ?? null,
    assetClass: input.assetClass,
    wrapper: input.wrapper,
    quantity: quantity.toString(),
    avgFillPrice: input.fillPrice.toString(),
    feesGbp: fees.toString(),
    reasonCode: input.reasonCode,
    thesis: input.thesis ?? null,
    benchmarkReturnPct: benchmarkReturn.toString(),
    defaultPlanDeltaPct: delta != null ? delta.toString() : null,
    markPrice: input.fillPrice.toString(),
    markedAt: new Date(),
    status: 'open',
  }).returning({ id: paperPositions.id });

  await db.insert(paperFills).values({
    positionId: pos!.id,
    proposedActionId: input.proposedActionId ?? null,
    side: 'buy',
    quantity: quantity.toString(),
    price: input.fillPrice.toString(),
    feesGbp: fees.toString(),
  });

  await audit(userId, 'open_paper_position', pos!.id);
  return pos!.id;
}

// ── Mark to market (PP-1403) ─────────────────────────────────────────────

export async function markPosition(userId: string, positionId: string, markPrice: number): Promise<void> {
  await assertOwner(userId, positionId);
  if (markPrice <= 0) throw new Error('Mark price must be positive.');
  await db.update(paperPositions)
    .set({ markPrice: markPrice.toString(), markedAt: new Date(), updatedAt: new Date() })
    .where(eq(paperPositions.id, positionId));
  await audit(userId, 'mark_paper_position', positionId);
}

export async function closePosition(userId: string, positionId: string, exitPrice: number): Promise<void> {
  const pos = await assertOwner(userId, positionId);
  if (exitPrice <= 0) throw new Error('Exit price must be positive.');
  const qty = Number(pos.quantity);
  const exitFees = estimateFees(qty * exitPrice);
  const realised = qty * (exitPrice - Number(pos.avgFillPrice)) - Number(pos.feesGbp) - exitFees;
  await db.insert(paperFills).values({
    positionId, side: 'sell', quantity: pos.quantity, price: exitPrice.toString(), feesGbp: exitFees.toString(),
  });
  await db.update(paperPositions).set({
    status: 'closed', closedAt: new Date(), markPrice: exitPrice.toString(), markedAt: new Date(),
    realisedPnlGbp: realised.toString(), updatedAt: new Date(),
  }).where(eq(paperPositions.id, positionId));
  await audit(userId, 'close_paper_position', positionId);
}

// ── Pure valuation helpers (testable, no I/O) ────────────────────────────

export interface PositionValuation {
  costGbp: number;
  marketValueGbp: number;
  unrealisedPnlGbp: number;
  unrealisedPnlPct: number;
  /** Annualised return since open, simple (not IRR). */
  annualisedReturnPct: number | null;
  /** What the default plan would have returned on the same money over the same time. */
  benchmarkValueGbp: number | null;
  /** Position market value minus benchmark value — did the pick beat the default? */
  vsBenchmarkGbp: number | null;
}

export function valuePosition(p: {
  quantity: number;
  avgFillPrice: number;
  feesGbp: number;
  markPrice: number;
  openedAt: Date;
  now?: Date;
  benchmarkReturnPct?: number | null;
}): PositionValuation {
  const cost = p.quantity * p.avgFillPrice + p.feesGbp;
  const marketValue = p.quantity * p.markPrice;
  const unrealised = marketValue - cost;
  const unrealisedPct = cost > 0 ? unrealised / cost : 0;

  const now = p.now ?? new Date();
  const years = Math.max(1e-9, (now.getTime() - p.openedAt.getTime()) / (365.25 * 24 * 3600 * 1000));
  const annualised = cost > 0 && years >= 1 / 365.25
    ? Math.pow(marketValue / cost, 1 / years) - 1
    : null;

  let benchmarkValue: number | null = null;
  let vsBenchmark: number | null = null;
  if (p.benchmarkReturnPct != null) {
    benchmarkValue = cost * Math.pow(1 + p.benchmarkReturnPct, years);
    vsBenchmark = marketValue - benchmarkValue;
  }

  return {
    costGbp: cost,
    marketValueGbp: marketValue,
    unrealisedPnlGbp: unrealised,
    unrealisedPnlPct: unrealisedPct,
    annualisedReturnPct: annualised,
    benchmarkValueGbp: benchmarkValue,
    vsBenchmarkGbp: vsBenchmark,
  };
}

// ── Queries ──────────────────────────────────────────────────────────────

export async function listPositions(userId: string) {
  return db.select().from(paperPositions)
    .where(eq(paperPositions.userId, userId))
    .orderBy(desc(paperPositions.openedAt));
}

/** Mark every open paper position to the latest quote from the market-data
 *  provider (stub or real), keyed on the position's instrumentRef. */
export async function refreshPaperMarks(userId: string): Promise<{ marked: number; stub: boolean }> {
  const open = await db.select().from(paperPositions)
    .where(and(eq(paperPositions.userId, userId), eq(paperPositions.status, 'open')));
  if (open.length === 0) return { marked: 0, stub: false };

  const provider = getMarketDataProvider();
  const symbols = [...new Set(open.map((p) => p.instrumentRef.toUpperCase()))];
  const quotes = await provider.getQuotes(symbols);

  let marked = 0;
  let anyStub = false;
  const now = new Date();
  for (const p of open) {
    const q = quotes.get(p.instrumentRef.toUpperCase());
    if (!q) continue;
    if (q.stub) anyStub = true;
    await db.update(paperPositions)
      .set({ markPrice: q.price.toString(), markedAt: now, updatedAt: now })
      .where(eq(paperPositions.id, p.id));
    marked++;
  }
  return { marked, stub: anyStub };
}

export async function deletePosition(userId: string, positionId: string) {
  await assertOwner(userId, positionId);
  await db.delete(paperPositions).where(eq(paperPositions.id, positionId));
  await audit(userId, 'delete_paper_position', positionId);
}

async function assertOwner(userId: string, positionId: string) {
  const [row] = await db.select().from(paperPositions)
    .where(and(eq(paperPositions.id, positionId), eq(paperPositions.userId, userId)))
    .limit(1);
  if (!row) throw new Error('Position not found or not authorised.');
  return row;
}

async function audit(userId: string, action: string, entityId: string) {
  await db.insert(auditEvents).values({
    userId, actor: 'user', action, entityType: 'paper_position', entityId,
  });
}
