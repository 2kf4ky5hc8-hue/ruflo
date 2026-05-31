// Deterministic stub provider. No network. Produces a stable pseudo-price per
// symbol so dev / tests / offline always work. Prices are clearly flagged
// `stub: true` so the UI can label them "simulated".

import type { MarketDataProvider, Quote } from './types';

// FNV-1a hash → stable per-symbol seed.
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Stub price: a stable base derived from the symbol, nudged by the day so it
 * "moves" a little day to day but is deterministic for a given (symbol, day).
 */
export function stubPrice(symbol: string, asOf: Date = new Date()): number {
  const base = 20 + (hash(symbol.toUpperCase()) % 48000) / 100; // £20–£500
  const dayIndex = Math.floor(asOf.getTime() / 86_400_000);
  const wobble = ((hash(symbol + dayIndex) % 600) - 300) / 10000; // ±3%
  return Math.round(base * (1 + wobble) * 100) / 100;
}

export class StubProvider implements MarketDataProvider {
  readonly id = 'stub';

  async getQuote(symbol: string): Promise<Quote | null> {
    const asOf = new Date();
    return {
      symbol: symbol.toUpperCase(),
      price: stubPrice(symbol, asOf),
      currency: 'GBP',
      asOf,
      source: 'stub',
      stub: true,
    };
  }

  async getQuotes(symbols: string[]): Promise<Map<string, Quote>> {
    const out = new Map<string, Quote>();
    for (const s of symbols) {
      const q = await this.getQuote(s);
      if (q) out.set(s.toUpperCase(), q);
    }
    return out;
  }
}
