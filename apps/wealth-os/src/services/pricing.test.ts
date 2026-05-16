import { describe, it, expect } from 'vitest';
import { costUsd, rateFor, MODEL_PRICING } from './pricing';

describe('costUsd', () => {
  it('matches a known Sonnet input rate', () => {
    // 1M input tokens at $3/M = $3.00
    expect(costUsd('claude-sonnet-4-6', 1_000_000, 0)).toBeCloseTo(3.00, 6);
  });

  it('matches a known Sonnet output rate', () => {
    // 1M output tokens at $15/M = $15.00
    expect(costUsd('claude-sonnet-4-6', 0, 1_000_000)).toBeCloseTo(15.00, 6);
  });

  it('matches a known Haiku input + output combination', () => {
    // 100k in @ $0.80/M + 50k out @ $4/M = $0.08 + $0.20 = $0.28
    expect(costUsd('claude-haiku-4-5', 100_000, 50_000)).toBeCloseTo(0.28, 6);
  });

  it('returns 0 for empty token counts', () => {
    expect(costUsd('claude-sonnet-4-6', 0, 0)).toBe(0);
    expect(costUsd('claude-sonnet-4-6', undefined, undefined)).toBe(0);
  });

  it('falls back to a conservative overestimate for unknown models', () => {
    const knownSonnet = costUsd('claude-sonnet-4-6', 1_000, 1_000);
    const unknown     = costUsd('claude-unknown-x',  1_000, 1_000);
    expect(unknown).toBeGreaterThan(knownSonnet);
  });

  it('clamps negative token counts to zero', () => {
    expect(costUsd('claude-sonnet-4-6', -100, -100)).toBe(0);
  });
});

describe('MODEL_PRICING', () => {
  it('lists every model the Coach defaults can refer to', () => {
    expect(MODEL_PRICING['claude-sonnet-4-6']).toBeDefined();
    expect(MODEL_PRICING['claude-haiku-4-5']).toBeDefined();
  });
});

describe('rateFor', () => {
  it('returns the same object for a model and its dated alias', () => {
    expect(rateFor('claude-haiku-4-5')).toEqual(rateFor('claude-haiku-4-5-20251001'));
  });
});
