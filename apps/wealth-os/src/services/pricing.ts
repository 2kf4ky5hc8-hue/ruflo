// USD pricing per million tokens for the Claude models the Coach can use.
//
// Pure data + a single helper. If a model isn't listed we fall back to a
// conservative HIGH estimate so personal spend is never undercounted.
//
// Verify against https://www.anthropic.com/pricing when you bump a model;
// these are quoted in USD per 1,000,000 tokens.

export interface ModelRate {
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

export const MODEL_PRICING: Record<string, ModelRate> = {
  // Haiku 4.5 — cheapest tier
  'claude-haiku-4-5':         { inputUsdPerMTok: 0.80, outputUsdPerMTok: 4.00 },
  'claude-haiku-4-5-20251001':{ inputUsdPerMTok: 0.80, outputUsdPerMTok: 4.00 },

  // Sonnet 4.5 / 4.6
  'claude-sonnet-4-5':        { inputUsdPerMTok: 3.00, outputUsdPerMTok: 15.00 },
  'claude-sonnet-4-6':        { inputUsdPerMTok: 3.00, outputUsdPerMTok: 15.00 },

  // Opus 4.6 / 4.7 — expensive; not the Coach default but supported
  'claude-opus-4-6':          { inputUsdPerMTok: 15.00, outputUsdPerMTok: 75.00 },
  'claude-opus-4-7':          { inputUsdPerMTok: 15.00, outputUsdPerMTok: 75.00 },
};

// Conservative overestimate for unknown models — better to flag spend high
// than to silently undercount.
const FALLBACK: ModelRate = { inputUsdPerMTok: 5.00, outputUsdPerMTok: 25.00 };

export function rateFor(model: string): ModelRate {
  return MODEL_PRICING[model] ?? FALLBACK;
}

export function costUsd(
  model: string,
  tokensIn: number | undefined,
  tokensOut: number | undefined,
): number {
  const r = rateFor(model);
  const ti = Math.max(0, tokensIn ?? 0);
  const to = Math.max(0, tokensOut ?? 0);
  return (ti * r.inputUsdPerMTok + to * r.outputUsdPerMTok) / 1_000_000;
}
