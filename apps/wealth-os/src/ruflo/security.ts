// Reuses @claude-flow/security primitives so wealth-os does not roll its own
// crypto, path-traversal, or input-validation logic.

import { z } from 'zod';

// PII patterns we redact before any LLM call. Conservative — false positives
// are acceptable, false negatives are not.
const PII_PATTERNS: Array<{ name: string; regex: RegExp; replace: string }> = [
  { name: 'uk_sort_code',     regex: /\b\d{2}-\d{2}-\d{2}\b/g,                        replace: '[SORT_CODE]' },
  { name: 'uk_account_no',    regex: /\b\d{8}\b/g,                                    replace: '[ACCOUNT_NO]' },
  { name: 'iban',             regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,             replace: '[IBAN]' },
  { name: 'email',            regex: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g,                 replace: '[EMAIL]' },
  { name: 'uk_ni_number',     regex: /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/g,           replace: '[NI_NO]' },
  { name: 'utr',              regex: /\bUTR[:\s]*\d{10}\b/gi,                         replace: '[UTR]' },
  { name: 'card_pan',         regex: /\b(?:\d[ -]?){13,19}\b/g,                       replace: '[CARD_PAN]' },
  { name: 'uk_postcode',      regex: /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/gi,       replace: '[POSTCODE]' },
];

export function redactForLLM(input: string): string {
  let out = input;
  for (const p of PII_PATTERNS) out = out.replace(p.regex, p.replace);
  return out;
}

// Banned phrases — guardrail rejects any agent output that contains these.
const BANNED_PHRASES: RegExp[] = [
  /\bguaranteed return/i,
  /\brisk[- ]free\b/i,
  /\bcan't lose\b/i,
  /\bsure thing\b/i,
  /\binsider (?:tip|info)\b/i,
  /\bpump\b/i,
  /\bget rich quick\b/i,
  /\bzero risk\b/i,
];

export interface GuardrailReport {
  ok: boolean;
  bannedHits: string[];
  missingDisclaimer: boolean;
}

export const RECOMMENDATION_DISCLAIMER =
  'Decision-support, not regulated financial advice. ' +
  'Consult an FCA-authorised adviser for personalised advice.';

export function evaluateGuardrail(text: string, requiresDisclaimer: boolean): GuardrailReport {
  const bannedHits: string[] = [];
  for (const r of BANNED_PHRASES) {
    const m = text.match(r);
    if (m) bannedHits.push(m[0]);
  }
  const missingDisclaimer = requiresDisclaimer
    && !text.includes('Decision-support')
    && !text.includes('not regulated financial advice');
  return {
    ok: bannedHits.length === 0 && !missingDisclaimer,
    bannedHits,
    missingDisclaimer,
  };
}

// Validation schemas at system boundaries.
export const ProposedActionInput = z.object({
  agent: z.string().min(1).max(60),
  kind: z.enum([
    'trade', 'transfer', 'allocation_change', 'rule_change',
    'integration_grant', 'cancel_subscription_review', 'allowance_reminder',
  ]),
  payload: z.record(z.unknown()),
  reason: z.string().min(10).max(2000),
  upside: z.string().max(2000).optional(),
  downside: z.string().max(2000).optional(),
  riskScore: z.number().int().min(0).max(10),
  confidence: z.number().min(0).max(1),
  amountAtRisk: z.string().regex(/^\d+(\.\d{1,4})?$/).optional(),
  alternatives: z.array(z.record(z.unknown())).optional(),
  expiresAt: z.string().datetime().optional(),
});

export type ProposedActionInput = z.infer<typeof ProposedActionInput>;

// Optional: delegate envelope encryption to @claude-flow/security when present.
export async function getSecurityModule() {
  try {
    return await import('@claude-flow/security');
  } catch {
    return null;
  }
}
