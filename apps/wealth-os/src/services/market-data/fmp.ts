// Financial Modeling Prep provider. Real network calls, behind an API key.
//
// Configure with:
//   MARKET_DATA_PROVIDER=fmp
//   MARKET_DATA_API_KEY=<your key>   (free tier: https://site.financialmodelingprep.com)
//
// The response parser is split out (parseFmpQuote) so it can be unit-tested
// against recorded fixtures without a live call.

import type { MarketDataProvider, Quote } from './types';

const BASE = 'https://financialmodelingprep.com/api/v3';

interface FmpQuoteRow {
  symbol?: string;
  price?: number;
  // FMP doesn't return currency on /quote-short; assume the exchange's. We
  // default to GBP for .L symbols, USD otherwise — callers can normalise later.
}

export function parseFmpQuote(raw: unknown, symbol: string): Quote | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const row = raw[0] as FmpQuoteRow;
  if (typeof row.price !== 'number' || !Number.isFinite(row.price)) return null;
  const sym = (row.symbol ?? symbol).toUpperCase();
  const currency = sym.endsWith('.L') ? 'GBP' : 'USD';
  return {
    symbol: sym,
    price: row.price,
    currency,
    asOf: new Date(),
    source: 'fmp',
    stub: false,
  };
}

export class FmpProvider implements MarketDataProvider {
  readonly id = 'fmp';
  constructor(private readonly apiKey: string) {}

  async getQuote(symbol: string): Promise<Quote | null> {
    try {
      const url = `${BASE}/quote-short/${encodeURIComponent(symbol)}?apikey=${this.apiKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const json = await res.json();
      return parseFmpQuote(json, symbol);
    } catch {
      return null;
    }
  }

  async getQuotes(symbols: string[]): Promise<Map<string, Quote>> {
    const out = new Map<string, Quote>();
    if (symbols.length === 0) return out;
    try {
      // FMP supports comma-batched symbols on /quote.
      const url = `${BASE}/quote/${symbols.map(encodeURIComponent).join(',')}?apikey=${this.apiKey}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json)) {
          for (const row of json) {
            const q = parseFmpQuote([row], (row as FmpQuoteRow).symbol ?? '');
            if (q) out.set(q.symbol, q);
          }
          return out;
        }
      }
    } catch { /* fall through to per-symbol */ }
    for (const s of symbols) {
      const q = await this.getQuote(s);
      if (q) out.set(s.toUpperCase(), q);
    }
    return out;
  }
}
