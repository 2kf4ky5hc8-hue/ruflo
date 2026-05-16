import { describe, it, expect } from 'vitest';
import {
  redactForLLM,
  evaluateGuardrail,
  ProposedActionInput,
  RECOMMENDATION_DISCLAIMER,
} from './security';

describe('redactForLLM', () => {
  it('redacts UK sort codes', () => {
    expect(redactForLLM('Account 12-34-56 transferred')).toBe('Account [SORT_CODE] transferred');
  });

  it('redacts UK account numbers', () => {
    expect(redactForLLM('Pay 12345678')).toBe('Pay [ACCOUNT_NO]');
  });

  it('redacts IBAN', () => {
    expect(redactForLLM('From GB29NWBK60161331926819')).toBe('From [IBAN]');
  });

  it('redacts emails', () => {
    expect(redactForLLM('Contact me@example.com')).toBe('Contact [EMAIL]');
  });

  it('redacts UK postcodes', () => {
    expect(redactForLLM('Visit SW1A 1AA today')).toBe('Visit [POSTCODE] today');
  });

  it('leaves benign text alone', () => {
    expect(redactForLLM('Apple revenue grew 8% YoY')).toBe('Apple revenue grew 8% YoY');
  });
});

describe('evaluateGuardrail', () => {
  it('passes clean text with disclaimer present', () => {
    const text = `Consider VWRL for diversification. ${RECOMMENDATION_DISCLAIMER}`;
    const r = evaluateGuardrail(text, true);
    expect(r.ok).toBe(true);
    expect(r.bannedHits).toEqual([]);
    expect(r.missingDisclaimer).toBe(false);
  });

  it('flags "guaranteed return"', () => {
    const r = evaluateGuardrail('This is a guaranteed return strategy', true);
    expect(r.ok).toBe(false);
    expect(r.bannedHits.length).toBeGreaterThan(0);
  });

  it('flags "risk-free"', () => {
    const r = evaluateGuardrail('A risk-free yield play', true);
    expect(r.ok).toBe(false);
  });

  it('flags missing disclaimer when required', () => {
    const r = evaluateGuardrail('Reasonable allocation suggestion', true);
    expect(r.missingDisclaimer).toBe(true);
    expect(r.ok).toBe(false);
  });

  it('skips disclaimer check when not required', () => {
    const r = evaluateGuardrail('Internal note for system use', false);
    expect(r.ok).toBe(true);
  });
});

describe('ProposedActionInput', () => {
  it('accepts a valid action', () => {
    const parsed = ProposedActionInput.parse({
      agent: 'wealth-isa',
      kind: 'allowance_reminder',
      payload: { taxYear: 2025 },
      reason: 'Thirty days remain in the current ISA tax year.',
      riskScore: 1,
      confidence: 0.95,
    });
    expect(parsed.kind).toBe('allowance_reminder');
  });

  it('rejects out-of-range risk score', () => {
    expect(() =>
      ProposedActionInput.parse({
        agent: 'wealth-isa',
        kind: 'allowance_reminder',
        payload: {},
        reason: 'short reason text here',
        riskScore: 99,
        confidence: 0.5,
      }),
    ).toThrow();
  });

  it('rejects unknown kinds', () => {
    expect(() =>
      ProposedActionInput.parse({
        agent: 'wealth-isa',
        kind: 'rugpull',
        payload: {},
        reason: 'long enough reason text',
        riskScore: 1,
        confidence: 0.5,
      }),
    ).toThrow();
  });
});
