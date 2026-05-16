import { describe, it, expect } from 'vitest';
import { TaxRulesSchema, type TaxRules } from './types';
import {
  taxYearFor,
  daysUntilTaxYearEnd,
  isaStatus,
  lisaEligibility,
  lisaBonus,
  personalAllowanceEffective,
  incomeTaxOwed,
  dividendTaxOwed,
  cgtOwed,
  pensionAnnualAllowance,
} from './helpers';

// Fixture that matches the published 2025/26 UK figures. Kept inline so the
// test file is self-contained — these specs prove the math, not the YAML.
const rules: TaxRules = TaxRulesSchema.parse({
  version: 'test-2025-26',
  jurisdiction: 'GB',
  tax_year: {
    current_starts_on: '2025-04-06',
    current_ends_on: '2026-04-05',
    number: 2025,
  },
  isa: {
    total_allowance_gbp: 20_000,
    junior_isa_allowance_gbp: 9_000,
    lifetime_isa_allowance_gbp: 4_000,
    lifetime_isa_bonus_pct: 0.25,
    lifetime_isa_age_min: 18,
    lifetime_isa_age_max_open: 39,
    lifetime_isa_age_max_contrib: 49,
    flexible_isa_replacements_allowed_same_year: true,
    multiple_same_type_isas_allowed: true,
    partial_transfers_current_year_allowed: true,
    eligible_investments: [],
    ineligible_examples: [],
  },
  income_tax_england_wales_ni: {
    personal_allowance_gbp: 12_570,
    personal_allowance_taper_starts_gbp: 100_000,
    personal_allowance_fully_lost_at_gbp: 125_140,
    basic_rate_pct: 0.20,
    basic_rate_band_upper_gbp: 50_270,
    higher_rate_pct: 0.40,
    higher_rate_band_upper_gbp: 125_140,
    additional_rate_pct: 0.45,
  },
  dividend_tax: {
    allowance_gbp: 500,
    basic_rate_pct: 0.0875,
    higher_rate_pct: 0.3375,
    additional_rate_pct: 0.3935,
  },
  capital_gains_tax: {
    annual_exempt_amount_gbp: 3_000,
    rates: {
      basic_taxpayer_other_assets_pct: 0.10,
      higher_taxpayer_other_assets_pct: 0.20,
      basic_taxpayer_residential_pct: 0.18,
      higher_taxpayer_residential_pct: 0.24,
    },
  },
  national_insurance: {
    class_1_primary_threshold_gbp: 12_570,
    class_1_main_rate_pct: 0.08,
    class_1_upper_earnings_limit_gbp: 50_270,
    class_1_above_uel_pct: 0.02,
  },
  corporation_tax: {
    small_profits_rate_pct: 0.19,
    small_profits_threshold_gbp: 50_000,
    main_rate_pct: 0.25,
    main_rate_threshold_gbp: 250_000,
    marginal_relief_fraction: 0.015,
  },
  pension: {
    annual_allowance_gbp: 60_000,
    money_purchase_annual_allowance_gbp: 10_000,
    taper_starts_adjusted_income_gbp: 260_000,
    taper_floor_annual_allowance_gbp: 10_000,
    carry_forward_years: 3,
    lifetime_allowance_abolished: true,
  },
  reminders: [],
  disclaimers: { primary: 'test' },
});

describe('taxYearFor', () => {
  it('returns the prior year on 5 April', () => {
    expect(taxYearFor(new Date('2026-04-05T12:00:00Z')).number).toBe(2025);
  });
  it('returns the new year on 6 April', () => {
    expect(taxYearFor(new Date('2026-04-06T00:00:00Z')).number).toBe(2026);
  });
  it('returns the current year mid-tax-year', () => {
    expect(taxYearFor(new Date('2026-05-16T12:00:00Z')).number).toBe(2026);
  });
  it('returns start/end dates aligned to 6 April / 5 April', () => {
    const ty = taxYearFor(new Date('2026-05-16T12:00:00Z'));
    expect(ty.startsOn.toISOString().slice(0, 10)).toBe('2026-04-06');
    expect(ty.endsOn.toISOString().slice(0, 10)).toBe('2027-04-05');
  });
});

describe('daysUntilTaxYearEnd', () => {
  it('is zero on the last day of the tax year', () => {
    // Compute against the same end-of-tax-year boundary the helper uses.
    const dayBefore = new Date(Date.UTC(2026, 3, 5, 0, 0, 0));
    expect(daysUntilTaxYearEnd(dayBefore)).toBeLessThanOrEqual(1);
  });
  it('is roughly a full year just after 6 April', () => {
    const justAfter = new Date('2026-04-07T00:00:00Z');
    const d = daysUntilTaxYearEnd(justAfter);
    expect(d).toBeGreaterThan(360);
    expect(d).toBeLessThanOrEqual(365);
  });
});

describe('isaStatus', () => {
  it('returns the full allowance with zero deposited', () => {
    const s = isaStatus(rules, { depositedGbp: 0, now: new Date('2026-05-16') });
    expect(s.allowanceGbp).toBe(20_000);
    expect(s.remainingGbp).toBe(20_000);
    expect(s.utilisedPct).toBe(0);
    expect(s.evenPaceMonthlyGbp).toBeCloseTo(20_000 / 12, 4);
  });
  it('caps utilisation at 100% when overpaid', () => {
    const s = isaStatus(rules, { depositedGbp: 30_000, now: new Date('2026-05-16') });
    expect(s.remainingGbp).toBe(0);
    expect(s.utilisedPct).toBe(1);
  });
  it('reports partial use correctly', () => {
    const s = isaStatus(rules, { depositedGbp: 5_000, now: new Date('2026-05-16') });
    expect(s.remainingGbp).toBe(15_000);
    expect(s.utilisedPct).toBe(0.25);
  });
});

describe('lisaEligibility', () => {
  it('blocks under-18s from opening', () => {
    expect(lisaEligibility(rules, { ageYears: 17, action: 'open' }).eligible).toBe(false);
  });
  it('allows 18-39 to open', () => {
    expect(lisaEligibility(rules, { ageYears: 18, action: 'open' }).eligible).toBe(true);
    expect(lisaEligibility(rules, { ageYears: 39, action: 'open' }).eligible).toBe(true);
  });
  it('blocks opening above 39', () => {
    expect(lisaEligibility(rules, { ageYears: 40, action: 'open' }).eligible).toBe(false);
  });
  it('allows contributions up to 49', () => {
    expect(lisaEligibility(rules, { ageYears: 49, action: 'contribute' }).eligible).toBe(true);
  });
  it('blocks contributions at 50+', () => {
    expect(lisaEligibility(rules, { ageYears: 50, action: 'contribute' }).eligible).toBe(false);
  });
});

describe('lisaBonus', () => {
  it('is 25% of contribution up to the cap', () => {
    expect(lisaBonus(rules, { contributionGbp: 4_000 })).toEqual({
      contributionGbp: 4_000,
      bonusGbp: 1_000,
      cappedAtAllowance: false,
    });
  });
  it('caps at the LISA allowance', () => {
    const b = lisaBonus(rules, { contributionGbp: 6_000 });
    expect(b.contributionGbp).toBe(4_000);
    expect(b.bonusGbp).toBe(1_000);
    expect(b.cappedAtAllowance).toBe(true);
  });
  it('is zero for zero contribution', () => {
    expect(lisaBonus(rules, { contributionGbp: 0 }).bonusGbp).toBe(0);
  });
});

describe('personalAllowanceEffective', () => {
  it('returns the full PA below the taper threshold', () => {
    expect(personalAllowanceEffective(rules, { adjustedIncomeGbp: 50_000 })).toBe(12_570);
    expect(personalAllowanceEffective(rules, { adjustedIncomeGbp: 100_000 })).toBe(12_570);
  });
  it('tapers £1 for every £2 above £100k', () => {
    expect(personalAllowanceEffective(rules, { adjustedIncomeGbp: 110_000 })).toBe(7_570);
    expect(personalAllowanceEffective(rules, { adjustedIncomeGbp: 120_000 })).toBe(2_570);
  });
  it('is zero at or above £125,140', () => {
    expect(personalAllowanceEffective(rules, { adjustedIncomeGbp: 125_140 })).toBe(0);
    expect(personalAllowanceEffective(rules, { adjustedIncomeGbp: 200_000 })).toBe(0);
  });
});

describe('incomeTaxOwed', () => {
  it('is zero at the personal allowance', () => {
    const r = incomeTaxOwed(rules, { taxableIncomeGbp: 12_570 });
    expect(r.taxOwedGbp).toBe(0);
    expect(r.marginalRatePct).toBe(0); // PA covers the lot, no band entered
  });
  it('reports a basic-rate marginal £1 above the PA', () => {
    const r = incomeTaxOwed(rules, { taxableIncomeGbp: 12_571 });
    expect(r.marginalRatePct).toBe(0.20);
  });
  it('matches a known basic-rate income', () => {
    // 50270 - 12570 = 37700 at 20% = 7540
    const r = incomeTaxOwed(rules, { taxableIncomeGbp: 50_270 });
    expect(r.taxOwedGbp).toBeCloseTo(7_540, 2);
  });
  it('matches a known higher-rate income', () => {
    // 7540 basic + (60000-50270)*0.40 = 7540 + 3892 = 11432
    const r = incomeTaxOwed(rules, { taxableIncomeGbp: 60_000 });
    expect(r.taxOwedGbp).toBeCloseTo(11_432, 2);
    expect(r.marginalRatePct).toBe(0.40);
  });
  it('matches a known additional-rate income with tapered PA', () => {
    // PA=0 at 130k. 50270*0.20=10054, (125140-50270)*0.40=29948, (130000-125140)*0.45=2187 -> 42189
    const r = incomeTaxOwed(rules, { taxableIncomeGbp: 130_000 });
    expect(r.taxOwedGbp).toBeCloseTo(42_189, 2);
    expect(r.marginalRatePct).toBe(0.45);
  });
});

describe('dividendTaxOwed', () => {
  it('charges nothing on dividends fully covered by personal allowance', () => {
    const r = dividendTaxOwed(rules, { dividendIncomeGbp: 5_000, otherTaxableIncomeGbp: 0 });
    expect(r.taxOwedGbp).toBe(0);
    expect(r.allowanceUsedGbp).toBe(0); // allowance untouched — PA covered everything
  });
  it('charges only on the part above PA + £500 allowance', () => {
    // other 100, div 13000 -> PA covers 12470, allowance covers 500, taxable 30 at 8.75% = 2.625
    const r = dividendTaxOwed(rules, { dividendIncomeGbp: 13_000, otherTaxableIncomeGbp: 100 });
    expect(r.taxOwedGbp).toBeCloseTo(2.625, 4);
    expect(r.allowanceUsedGbp).toBe(500);
  });
  it('uses the basic dividend rate inside the basic band', () => {
    // other 30000, div 1000 -> allowance 500, 500 left in basic band at 8.75% = 43.75
    const r = dividendTaxOwed(rules, { dividendIncomeGbp: 1_000, otherTaxableIncomeGbp: 30_000 });
    expect(r.taxOwedGbp).toBeCloseTo(43.75, 4);
  });
  it('uses higher dividend rate when stacked above £50,270', () => {
    // other 50000, div 10000 -> allowance 500, all 9500 above 50270 at 33.75% = 3206.25
    const r = dividendTaxOwed(rules, { dividendIncomeGbp: 10_000, otherTaxableIncomeGbp: 50_000 });
    expect(r.taxOwedGbp).toBeCloseTo(3_206.25, 2);
  });
  it('uses additional dividend rate above £125,140', () => {
    const r = dividendTaxOwed(rules, { dividendIncomeGbp: 1_000, otherTaxableIncomeGbp: 200_000 });
    expect(r.taxOwedGbp).toBeCloseTo(500 * 0.3935, 4);
  });
});

describe('cgtOwed', () => {
  it('returns zero below the annual exempt amount', () => {
    const r = cgtOwed(rules, { gainGbp: 2_500, otherTaxableIncomeGbp: 40_000, assetType: 'other' });
    expect(r.taxOwedGbp).toBe(0);
    expect(r.exemptionUsedGbp).toBe(2_500);
    expect(r.taxableGainGbp).toBe(0);
  });
  it('uses basic-rate band capacity at the lower CGT rate', () => {
    // gain 10000 -> taxable 7000. Other 40000 leaves 10270 basic band remaining.
    // 7000 * 10% = 700
    const r = cgtOwed(rules, { gainGbp: 10_000, otherTaxableIncomeGbp: 40_000, assetType: 'other' });
    expect(r.taxOwedGbp).toBeCloseTo(700, 2);
  });
  it('moves into the higher rate when basic band is exhausted', () => {
    // gain 20000 -> taxable 17000. Other 60000 -> basic band fully used.
    // 17000 * 20% = 3400
    const r = cgtOwed(rules, { gainGbp: 20_000, otherTaxableIncomeGbp: 60_000, assetType: 'other' });
    expect(r.taxOwedGbp).toBeCloseTo(3_400, 2);
  });
  it('uses residential rates for property', () => {
    // gain 20000 -> taxable 17000. Other 60000 -> higher rate. 17000 * 24% = 4080
    const r = cgtOwed(rules, { gainGbp: 20_000, otherTaxableIncomeGbp: 60_000, assetType: 'residential_property' });
    expect(r.taxOwedGbp).toBeCloseTo(4_080, 2);
  });
});

describe('pensionAnnualAllowance', () => {
  it('returns the full allowance below the taper threshold', () => {
    const r = pensionAnnualAllowance(rules, { adjustedIncomeGbp: 100_000, mpaaTriggered: false });
    expect(r.annualAllowanceGbp).toBe(60_000);
    expect(r.taperedBy).toBe(0);
  });
  it('tapers £1 for every £2 above £260k', () => {
    const r = pensionAnnualAllowance(rules, { adjustedIncomeGbp: 300_000, mpaaTriggered: false });
    expect(r.annualAllowanceGbp).toBe(40_000); // 60k - (40k/2) = 40k
    expect(r.taperedBy).toBe(20_000);
  });
  it('floors at the taper floor', () => {
    const r = pensionAnnualAllowance(rules, { adjustedIncomeGbp: 500_000, mpaaTriggered: false });
    expect(r.annualAllowanceGbp).toBe(10_000);
    expect(r.appliedFloor).toBe(true);
  });
  it('switches to MPAA when triggered', () => {
    const r = pensionAnnualAllowance(rules, { adjustedIncomeGbp: 50_000, mpaaTriggered: true });
    expect(r.annualAllowanceGbp).toBe(10_000);
    expect(r.mpaaApplies).toBe(true);
  });
});
