// Provider factory. Reads env; falls back to the deterministic stub when no
// key is configured, so the app always has a working price source.

import type { MarketDataProvider } from './types';
import { StubProvider } from './stub';
import { FmpProvider } from './fmp';

export type { MarketDataProvider, Quote } from './types';
export { StubProvider, stubPrice } from './stub';
export { FmpProvider, parseFmpQuote } from './fmp';

export function getMarketDataProvider(): MarketDataProvider {
  const which = (process.env.MARKET_DATA_PROVIDER ?? 'stub').toLowerCase();
  const key = process.env.MARKET_DATA_API_KEY ?? '';

  if (which === 'fmp' && key) return new FmpProvider(key);
  // Any unconfigured / unknown provider → stub. Never throws; never blocks.
  return new StubProvider();
}

export function isUsingStub(): boolean {
  const which = (process.env.MARKET_DATA_PROVIDER ?? 'stub').toLowerCase();
  return which !== 'fmp' || !(process.env.MARKET_DATA_API_KEY ?? '');
}
