// Market-data provider abstraction. The app never hard-depends on a network
// provider: the factory falls back to a deterministic stub when no API key is
// configured, so holdings/paper valuation always works (with clearly-labelled
// stub prices in dev).

export interface Quote {
  /** The symbol queried (ticker or ISIN). */
  symbol: string;
  /** Latest price in the instrument's own currency. */
  price: number;
  /** Currency of `price`. */
  currency: string;
  /** As-of timestamp. */
  asOf: Date;
  /** Provider id that produced this quote. */
  source: string;
  /** True when this is a deterministic stub, not a real market price. */
  stub: boolean;
}

export interface MarketDataProvider {
  readonly id: string;
  /** Fetch one quote. Returns null if the symbol can't be priced. */
  getQuote(symbol: string): Promise<Quote | null>;
  /** Batch fetch. Default implementations may call getQuote in a loop. */
  getQuotes(symbols: string[]): Promise<Map<string, Quote>>;
}
