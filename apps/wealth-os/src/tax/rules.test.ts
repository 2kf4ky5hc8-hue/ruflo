import { describe, it, expect, afterEach } from 'vitest';
import { getTaxRules, __setTaxRulesForTest } from './rules';

describe('getTaxRules', () => {
  afterEach(() => __setTaxRulesForTest(null));

  it('loads config/tax-rules.yaml and validates against the schema', () => {
    const rules = getTaxRules();
    expect(rules.jurisdiction).toBe('GB');
    expect(rules.isa.total_allowance_gbp).toBeGreaterThan(0);
    expect(rules.income_tax_england_wales_ni.personal_allowance_gbp).toBeGreaterThan(0);
    expect(rules.pension.annual_allowance_gbp).toBeGreaterThan(0);
  });

  it('caches across calls (same reference)', () => {
    const a = getTaxRules();
    const b = getTaxRules();
    expect(a).toBe(b);
  });
});
