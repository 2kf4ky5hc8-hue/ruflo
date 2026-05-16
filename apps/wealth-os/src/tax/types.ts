// Typed view over config/tax-rules.yaml. The Zod schema is the source of
// truth — if the YAML drifts from this shape, loading fails loudly at startup
// rather than silently producing wrong numbers.

import { z } from 'zod';

const Pct = z.number().min(0).max(1);
const Gbp = z.number().min(0);
const Int = z.number().int();

export const TaxRulesSchema = z.object({
  version: z.string(),
  jurisdiction: z.literal('GB'),
  tax_year: z.object({
    current_starts_on: z.string(),
    current_ends_on: z.string(),
    number: Int,
  }),
  isa: z.object({
    total_allowance_gbp: Gbp,
    junior_isa_allowance_gbp: Gbp,
    lifetime_isa_allowance_gbp: Gbp,
    lifetime_isa_bonus_pct: Pct,
    lifetime_isa_age_min: Int,
    lifetime_isa_age_max_open: Int,
    lifetime_isa_age_max_contrib: Int,
    flexible_isa_replacements_allowed_same_year: z.boolean(),
    multiple_same_type_isas_allowed: z.boolean(),
    partial_transfers_current_year_allowed: z.boolean(),
    eligible_investments: z.array(z.string()),
    ineligible_examples: z.array(z.string()),
  }),
  income_tax_england_wales_ni: z.object({
    personal_allowance_gbp: Gbp,
    personal_allowance_taper_starts_gbp: Gbp,
    personal_allowance_fully_lost_at_gbp: Gbp,
    basic_rate_pct: Pct,
    basic_rate_band_upper_gbp: Gbp,
    higher_rate_pct: Pct,
    higher_rate_band_upper_gbp: Gbp,
    additional_rate_pct: Pct,
  }),
  dividend_tax: z.object({
    allowance_gbp: Gbp,
    basic_rate_pct: Pct,
    higher_rate_pct: Pct,
    additional_rate_pct: Pct,
  }),
  capital_gains_tax: z.object({
    annual_exempt_amount_gbp: Gbp,
    rates: z.object({
      basic_taxpayer_other_assets_pct: Pct,
      higher_taxpayer_other_assets_pct: Pct,
      basic_taxpayer_residential_pct: Pct,
      higher_taxpayer_residential_pct: Pct,
    }),
  }),
  national_insurance: z.object({
    class_1_primary_threshold_gbp: Gbp,
    class_1_main_rate_pct: Pct,
    class_1_upper_earnings_limit_gbp: Gbp,
    class_1_above_uel_pct: Pct,
  }),
  corporation_tax: z.object({
    small_profits_rate_pct: Pct,
    small_profits_threshold_gbp: Gbp,
    main_rate_pct: Pct,
    main_rate_threshold_gbp: Gbp,
    marginal_relief_fraction: z.number(),
  }),
  pension: z.object({
    annual_allowance_gbp: Gbp,
    money_purchase_annual_allowance_gbp: Gbp,
    taper_starts_adjusted_income_gbp: Gbp,
    taper_floor_annual_allowance_gbp: Gbp,
    carry_forward_years: Int,
    lifetime_allowance_abolished: z.boolean(),
  }),
  reminders: z.array(z.object({
    id: z.string(),
    when: z.string().optional(),
    when_relative: z.string().optional(),
    message: z.string(),
  })),
  disclaimers: z.object({
    primary: z.string(),
  }),
});

export type TaxRules = z.infer<typeof TaxRulesSchema>;
