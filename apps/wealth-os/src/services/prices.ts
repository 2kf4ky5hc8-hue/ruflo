// Price service: refresh quotes for the user's instruments into the `prices`
// table, read the latest price, and value holdings at market.

import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../lib/db';
import { instruments, prices, holdings, accounts } from '../db/schema/index';
import { getMarketDataProvider, isUsingStub } from './market-data/index';

/** Symbol we query the provider with for an instrument: prefer ticker, else ISIN. */
function symbolFor(ins: { ticker: string | null; isin: string | null }): string | null {
  return ins.ticker ?? ins.isin ?? null;
}

/**
 * Refresh prices for every instrument the user holds. Writes one `prices` row
 * per instrument (idempotent on the day via the unique (instrument, ts, source)
 * — we truncate ts to the minute to avoid unbounded growth on rapid refreshes).
 */
export async function refreshUserPrices(userId: string): Promise<{ updated: number; stub: boolean }> {
  const accs = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.userId, userId));
  const accIds = accs.map((a) => a.id);
  if (accIds.length === 0) return { updated: 0, stub: isUsingStub() };

  const held = await db.selectDistinct({ instrumentId: holdings.instrumentId })
    .from(holdings).where(inArray(holdings.accountId, accIds));
  const instrIds = held.map((h) => h.instrumentId);
  if (instrIds.length === 0) return { updated: 0, stub: isUsingStub() };

  const instrRows = await db.select().from(instruments).where(inArray(instruments.id, instrIds));
  const provider = getMarketDataProvider();

  const symbolToInstr = new Map<string, string>();
  const symbols: string[] = [];
  for (const ins of instrRows) {
    const sym = symbolFor(ins);
    if (sym) { symbolToInstr.set(sym.toUpperCase(), ins.id); symbols.push(sym); }
  }

  const quotes = await provider.getQuotes(symbols);
  let updated = 0;
  const ts = new Date();
  ts.setSeconds(0, 0);

  for (const [sym, q] of quotes) {
    const instrId = symbolToInstr.get(sym);
    if (!instrId) continue;
    await db.insert(prices).values({
      instrumentId: instrId,
      ts,
      close: q.price.toString(),
      source: q.source,
    }).onConflictDoNothing();
    updated++;
  }
  return { updated, stub: isUsingStub() };
}

/** Latest cached close price for an instrument, or null. */
export async function latestPrice(instrumentId: string): Promise<{ price: number; asOf: Date; source: string } | null> {
  const [row] = await db.select().from(prices)
    .where(eq(prices.instrumentId, instrumentId))
    .orderBy(desc(prices.ts)).limit(1);
  if (!row) return null;
  return { price: Number(row.close), asOf: new Date(row.ts), source: row.source };
}

/** Latest prices for many instruments in one query. */
export async function latestPrices(instrumentIds: string[]): Promise<Map<string, { price: number; asOf: Date; source: string }>> {
  const out = new Map<string, { price: number; asOf: Date; source: string }>();
  if (instrumentIds.length === 0) return out;
  const rows = await db.select().from(prices)
    .where(inArray(prices.instrumentId, instrumentIds))
    .orderBy(desc(prices.ts));
  for (const r of rows) {
    if (!out.has(r.instrumentId)) {
      out.set(r.instrumentId, { price: Number(r.close), asOf: new Date(r.ts), source: r.source });
    }
  }
  return out;
}

// ── Pure valuation (testable) ────────────────────────────────────────────

export interface HoldingValuation {
  bookValueGbp: number;
  marketValueGbp: number | null;
  unrealisedPnlGbp: number | null;
  unrealisedPnlPct: number | null;
  priced: boolean;
}

export function valueHolding(p: {
  quantity: number;
  avgCostGbp: number;
  marketPrice: number | null;
}): HoldingValuation {
  const book = p.quantity * p.avgCostGbp;
  if (p.marketPrice == null) {
    return { bookValueGbp: book, marketValueGbp: null, unrealisedPnlGbp: null, unrealisedPnlPct: null, priced: false };
  }
  const mv = p.quantity * p.marketPrice;
  const pnl = mv - book;
  return {
    bookValueGbp: book,
    marketValueGbp: mv,
    unrealisedPnlGbp: pnl,
    unrealisedPnlPct: book > 0 ? pnl / book : 0,
    priced: true,
  };
}
