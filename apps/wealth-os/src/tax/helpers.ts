// Deterministic UK tax helpers.
//
// Every function is pure: same inputs -> same outputs. No I/O, no clock reads
// other than what's passed in via `now`. All money in GBP as plain `number`.
// Callers pass in the TaxRules they want to use, so tests can supply fixtures
// and the Coach LLM can never inject numbers of its own.
//
// SCOPE: covers the allowances the playbook references today
// (ISA, dividend, CGT, personal allowance, pension annual allowance, LISA bonus,
// income tax). Scottish bands are NOT covered yet.

import type { TaxRules } from './types';

// ────────────────────────────────────────────────────────────────────────────
// Tax-year date helpers

export interface TaxYear {
  number: number;       // 2025 = tax year 2025/26
  startsOn: Date;       // 6 Apr 2025
  endsOn: Date;         // 5 Apr 2026 (last day inclusive)
}

// UK tax year runs 6 April YYYY → 5 April YYYY+1.
export function taxYearFor(now: Date): TaxYear {
  const year = now.getUTCFullYear();
  const aprilSixThisYear = Date.UTC(year, 3, 6);
  const number = now.getTime() >= aprilSixThisYear ? year : year - 1;
  return {
    number,
    startsOn: new Date(Date.UTC(number, 3, 6)),
    endsOn:   new Date(Date.UTC(number + 1, 3, 5, 23, 59, 59)),
  };
}

export function daysUntilTaxYearEnd(now: Date): number {
  const { endsOn } = taxYearFor(now);
  const msPerDay = 86_400_000;
  return Math.max(0, Math.ceil((endsOn.getTime() - now.getTime()) / msPerDay));
}

// ────────────────────────────────────────────────────────────────────────────
// ISA helpers

export interface IsaStatus {
  taxYear: number;
  allowanceGbp: number;
  depositedGbp: number;
  remainingGbp: number;
  utilisedPct: number;             // 0..1
  evenPaceMonthlyGbp: number;      // what would close the gap in 12 months
}

export function isaStatus(
  rules: TaxRules,
  args: { depositedGbp: number; now: Date },
): IsaStatus {
  const ty = taxYearFor(args.now);
  const allowance = rules.isa.total_allowance_gbp;
  const deposited = Math.max(0, args.depositedGbp);
  const remaining = Math.max(0, allowance - deposited);
  return {
    taxYear: ty.number,
    allowanceGbp: allowance,
    depositedGbp: deposited,
    remainingGbp: remaining,
    utilisedPct: allowance === 0 ? 0 : Math.min(1, deposited / allowance),
    evenPaceMonthlyGbp: remaining / 12,
  };
}

export type LisaAction = 'open' | 'contribute';
export interface LisaEligibility {
  eligible: boolean;
  reason: string;
}

export function lisaEligibility(
  rules: TaxRules,
  args: { ageYears: number; action: LisaAction },
): LisaEligibility {
  const { lifetime_isa_age_min, lifetime_isa_age_max_open, lifetime_isa_age_max_contrib } = rules.isa;
  if (args.ageYears < lifetime_isa_age_min) {
    return { eligible: false, reason: `Must be at least ${lifetime_isa_age_min} to use a LISA.` };
  }
  if (args.action === 'open' && args.ageYears > lifetime_isa_age_max_open) {
    return { eligible: false, reason: `LISA can only be opened up to age ${lifetime_isa_age_max_open}.` };
  }
  if (args.action === 'contribute' && args.ageYears > lifetime_isa_age_max_contrib) {
    return { eligible: false, reason: `LISA contributions stop at age ${lifetime_isa_age_max_contrib + 1}.` };
  }
  return { eligible: true, reason: 'OK' };
}

export interface LisaBonus {
  contributionGbp: number;          // capped at LISA allowance
  bonusGbp: number;                 // 25% of capped contribution
  cappedAtAllowance: boolean;
}

export function lisaBonus(
  rules: TaxRules,
  args: { contributionGbp: number },
): LisaBonus {
  const cap = rules.isa.lifetime_isa_allowance_gbp;
  const capped = Math.max(0, Math.min(args.contributionGbp, cap));
  const bonus = capped * rules.isa.lifetime_isa_bonus_pct;
  return {
    contributionGbp: capped,
    bonusGbp: bonus,
    cappedAtAllowance: args.contributionGbp > cap,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Personal allowance + income tax

// Personal allowance tapers £1 for every £2 of adjusted income above £100k,
// fully lost at £125,140 (the taper end).
export function personalAllowanceEffective(
  rules: TaxRules,
  args: { adjustedIncomeGbp: number },
): number {
  const r = rules.income_tax_england_wales_ni;
  const income = Math.max(0, args.adjustedIncomeGbp);
  if (income <= r.personal_allowance_taper_starts_gbp) return r.personal_allowance_gbp;
  if (income >= r.personal_allowance_fully_lost_at_gbp) return 0;
  const excess = income - r.personal_allowance_taper_starts_gbp;
  return Math.max(0, r.personal_allowance_gbp - excess / 2);
}

export interface IncomeTaxResult {
  taxOwedGbp: number;
  effectivePersonalAllowanceGbp: number;
  marginalRatePct: number;     // the rate on the next £1
  bandsBreakdown: Array<{ band: 'basic' | 'higher' | 'additional'; taxableGbp: number; taxGbp: number }>;
}

// England/Wales/NI only. Scotland uses different bands and is intentionally
// out of scope until someone confirms they're in Scotland.
export function incomeTaxOwed(
  rules: TaxRules,
  args: { taxableIncomeGbp: number },
): IncomeTaxResult {
  const r = rules.income_tax_england_wales_ni;
  const pa = personalAllowanceEffective(rules, { adjustedIncomeGbp: args.taxableIncomeGbp });
  const above = Math.max(0, args.taxableIncomeGbp - pa);

  // Band UPPER bounds are quoted in the YAML as "income up to which the band
  // applies", measured from £0. Convert to widths above the personal allowance.
  const basicWidth     = Math.max(0, r.basic_rate_band_upper_gbp     - pa);
  const higherWidth    = Math.max(0, r.higher_rate_band_upper_gbp    - r.basic_rate_band_upper_gbp);

  const inBasic     = Math.min(above, basicWidth);
  const inHigher    = Math.min(Math.max(0, above - basicWidth), higherWidth);
  const inAdditional = Math.max(0, above - basicWidth - higherWidth);

  const taxBasic     = inBasic     * r.basic_rate_pct;
  const taxHigher    = inHigher    * r.higher_rate_pct;
  const taxAdditional = inAdditional * r.additional_rate_pct;

  let marginal = 0;
  if      (inAdditional > 0) marginal = r.additional_rate_pct;
  else if (inHigher     > 0) marginal = r.higher_rate_pct;
  else if (inBasic      > 0) marginal = r.basic_rate_pct;

  return {
    taxOwedGbp: taxBasic + taxHigher + taxAdditional,
    effectivePersonalAllowanceGbp: pa,
    marginalRatePct: marginal,
    bandsBreakdown: [
      { band: 'basic',      taxableGbp: inBasic,      taxGbp: taxBasic },
      { band: 'higher',     taxableGbp: inHigher,     taxGbp: taxHigher },
      { band: 'additional', taxableGbp: inAdditional, taxGbp: taxAdditional },
    ],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Dividend tax
//
// Dividends sit on top of other income for band-determination purposes.
// The first £500 (allowance) is tax-free. The rest is taxed at the dividend
// rate corresponding to whichever income-tax band each £ of dividend falls in.

export interface DividendTaxResult {
  taxOwedGbp: number;
  allowanceUsedGbp: number;
  breakdown: Array<{ band: 'basic' | 'higher' | 'additional'; dividendGbp: number; taxGbp: number }>;
}

export function dividendTaxOwed(
  rules: TaxRules,
  args: { dividendIncomeGbp: number; otherTaxableIncomeGbp: number },
): DividendTaxResult {
  const r = rules.income_tax_england_wales_ni;
  const d = rules.dividend_tax;

  const pa = personalAllowanceEffective(rules, {
    adjustedIncomeGbp: args.otherTaxableIncomeGbp + args.dividendIncomeGbp,
  });

  // Step 1: dividends sitting inside the PA are covered by the PA itself
  // (no tax, no allowance consumed).
  const paRoomLeft = Math.max(0, pa - args.otherTaxableIncomeGbp);
  const inPa = Math.min(paRoomLeft, args.dividendIncomeGbp);

  let remaining = args.dividendIncomeGbp - inPa;
  let cursor = args.otherTaxableIncomeGbp + inPa;

  // Step 2: the £500 dividend allowance taxes the next £500 of dividend at
  // 0% but still uses up band space (so it can push you into a higher band).
  const allowanceUsed = Math.min(d.allowance_gbp, remaining);
  cursor += allowanceUsed;
  remaining -= allowanceUsed;

  // Step 3: slice the rest across the income-tax bands using the matching
  // dividend rate for each band.
  const slice = (
    bandUpperGbp: number,
    ratePct: number,
    band: 'basic' | 'higher' | 'additional',
  ): { dividendGbp: number; taxGbp: number; band: typeof band } => {
    const room = Math.max(0, bandUpperGbp - cursor);
    const used = Math.min(remaining, room);
    cursor += used;
    remaining -= used;
    return { band, dividendGbp: used, taxGbp: used * ratePct };
  };

  const breakdown: DividendTaxResult['breakdown'] = [];
  if (remaining > 0) breakdown.push(slice(r.basic_rate_band_upper_gbp,  d.basic_rate_pct,  'basic'));
  if (remaining > 0) breakdown.push(slice(r.higher_rate_band_upper_gbp, d.higher_rate_pct, 'higher'));
  if (remaining > 0) breakdown.push({ band: 'additional', dividendGbp: remaining, taxGbp: remaining * d.additional_rate_pct });

  const taxOwed = breakdown.reduce((acc, b) => acc + b.taxGbp, 0);
  return { taxOwedGbp: taxOwed, allowanceUsedGbp: allowanceUsed, breakdown };
}

// ────────────────────────────────────────────────────────────────────────────
// CGT

export type CgtAssetType = 'residential_property' | 'other';

export interface CgtResult {
  taxOwedGbp: number;
  taxableGainGbp: number;
  exemptionUsedGbp: number;
  // CGT splits across the unused basic-rate band (lower CGT rate) and above.
  breakdown: Array<{ portion: 'lower' | 'upper'; gainGbp: number; taxGbp: number }>;
}

export function cgtOwed(
  rules: TaxRules,
  args: {
    gainGbp: number;
    otherTaxableIncomeGbp: number;
    assetType: CgtAssetType;
  },
): CgtResult {
  const r = rules.income_tax_england_wales_ni;
  const c = rules.capital_gains_tax;

  const exemptionUsed = Math.min(c.annual_exempt_amount_gbp, Math.max(0, args.gainGbp));
  const taxable = Math.max(0, args.gainGbp - exemptionUsed);

  const pa = personalAllowanceEffective(rules, {
    adjustedIncomeGbp: args.otherTaxableIncomeGbp,
  });
  const basicBandTop = r.basic_rate_band_upper_gbp;
  const incomeUsingBasicBand = Math.max(pa, Math.min(args.otherTaxableIncomeGbp, basicBandTop));
  const basicBandRemaining = Math.max(0, basicBandTop - incomeUsingBasicBand);

  const lowerRate = args.assetType === 'residential_property'
    ? c.rates.basic_taxpayer_residential_pct
    : c.rates.basic_taxpayer_other_assets_pct;
  const upperRate = args.assetType === 'residential_property'
    ? c.rates.higher_taxpayer_residential_pct
    : c.rates.higher_taxpayer_other_assets_pct;

  const inLower = Math.min(taxable, basicBandRemaining);
  const inUpper = Math.max(0, taxable - inLower);

  const taxLower = inLower * lowerRate;
  const taxUpper = inUpper * upperRate;

  return {
    taxOwedGbp: taxLower + taxUpper,
    taxableGainGbp: taxable,
    exemptionUsedGbp: exemptionUsed,
    breakdown: [
      { portion: 'lower', gainGbp: inLower, taxGbp: taxLower },
      { portion: 'upper', gainGbp: inUpper, taxGbp: taxUpper },
    ],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Pension annual allowance (with high-income taper)
//
// Every £2 of adjusted income above the taper threshold reduces AA by £1.
// Floored at the taper floor (£10k currently). If MPAA is triggered the
// money-purchase cap applies instead and isn't tapered.

export interface PensionAnnualAllowanceResult {
  annualAllowanceGbp: number;
  taperedBy: number;
  appliedFloor: boolean;
  mpaaApplies: boolean;
}

export function pensionAnnualAllowance(
  rules: TaxRules,
  args: { adjustedIncomeGbp: number; mpaaTriggered: boolean },
): PensionAnnualAllowanceResult {
  const p = rules.pension;
  if (args.mpaaTriggered) {
    return {
      annualAllowanceGbp: p.money_purchase_annual_allowance_gbp,
      taperedBy: 0,
      appliedFloor: false,
      mpaaApplies: true,
    };
  }
  const excess = Math.max(0, args.adjustedIncomeGbp - p.taper_starts_adjusted_income_gbp);
  const taper = excess / 2;
  const beforeFloor = p.annual_allowance_gbp - taper;
  const after = Math.max(p.taper_floor_annual_allowance_gbp, beforeFloor);
  return {
    annualAllowanceGbp: after,
    taperedBy: Math.max(0, p.annual_allowance_gbp - after),
    appliedFloor: beforeFloor < p.taper_floor_annual_allowance_gbp,
    mpaaApplies: false,
  };
}
