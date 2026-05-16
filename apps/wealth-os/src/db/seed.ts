import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import {
  users, categories, riskProfiles, allocationRules, isaYears, institutions,
} from './schema/index';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configDir = resolve(__dirname, '../../config');

interface TaxRules {
  tax_year: { number: number };
  isa: { total_allowance_gbp: number };
}

interface RiskProfilePreset {
  name: string;
  max_single_position_pct: number;
  max_speculative_pct: number;
  max_sector_pct: number;
  max_country_pct: number;
  max_currency_pct: number;
  max_daily_loss_pct: number;
  max_weekly_loss_pct: number;
  max_monthly_loss_pct: number;
  leverage_allowed: boolean;
  options_allowed: boolean;
  crypto_cap_pct: number;
  cash_floor_months: number;
  cooling_off_minutes: number;
  sleep_mode_start: string;
  sleep_mode_end: string;
  new_instrument_size_cap_pct: number;
  liquidity_min_adv_gbp: number;
  paper_trade_days: number;
}

interface RiskFile {
  profiles: Record<string, RiskProfilePreset>;
  allocation_presets: Record<string, Record<string, number>>;
}

const DEFAULT_CATEGORIES: Array<{ name: string; kind: 'income' | 'expense' | 'transfer' | 'investment' }> = [
  { name: 'Salary',              kind: 'income' },
  { name: 'Business income',     kind: 'income' },
  { name: 'Dividends received',  kind: 'income' },
  { name: 'Interest received',   kind: 'income' },
  { name: 'Refunds',             kind: 'income' },
  { name: 'Rent',                kind: 'expense' },
  { name: 'Mortgage',            kind: 'expense' },
  { name: 'Utilities',           kind: 'expense' },
  { name: 'Groceries',           kind: 'expense' },
  { name: 'Eating out',          kind: 'expense' },
  { name: 'Transport',           kind: 'expense' },
  { name: 'Subscriptions',       kind: 'expense' },
  { name: 'Insurance',           kind: 'expense' },
  { name: 'Tax payments',        kind: 'expense' },
  { name: 'Health',              kind: 'expense' },
  { name: 'Education',           kind: 'expense' },
  { name: 'Travel',              kind: 'expense' },
  { name: 'Discretionary',       kind: 'expense' },
  { name: 'Bank transfer',       kind: 'transfer' },
  { name: 'ISA deposit',         kind: 'investment' },
  { name: 'GIA deposit',         kind: 'investment' },
  { name: 'Pension contribution', kind: 'investment' },
];

const SEED_INSTITUTIONS = [
  { name: 'Vanguard UK',          country: 'GB', type: 'broker' },
  { name: 'AJ Bell',              country: 'GB', type: 'broker' },
  { name: 'Hargreaves Lansdown',  country: 'GB', type: 'broker' },
  { name: 'Trading 212',          country: 'GB', type: 'broker' },
  { name: 'Freetrade',            country: 'GB', type: 'broker' },
  { name: 'InvestEngine',         country: 'GB', type: 'broker' },
  { name: 'Interactive Brokers',  country: 'GB', type: 'broker' },
  { name: 'Monzo',                country: 'GB', type: 'bank' },
  { name: 'Starling',             country: 'GB', type: 'bank' },
  { name: 'Revolut',              country: 'GB', type: 'bank' },
];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql);

  const taxRules = parseYaml(readFileSync(resolve(configDir, 'tax-rules.yaml'), 'utf8')) as TaxRules;
  const riskFile = parseYaml(readFileSync(resolve(configDir, 'risk-profiles.yaml'), 'utf8')) as RiskFile;

  const seedEmail = process.env.SEED_USER_EMAIL ?? 'you@example.com';
  const seedName = process.env.SEED_USER_NAME ?? 'Owner';

  console.log('Seeding institutions…');
  for (const inst of SEED_INSTITUTIONS) {
    await db.insert(institutions).values(inst).onConflictDoNothing();
  }

  console.log(`Seeding user ${seedEmail}…`);
  let [user] = await db.select().from(users).where(eq(users.email, seedEmail)).limit(1);
  if (!user) {
    [user] = await db.insert(users).values({
      email: seedEmail,
      name: seedName,
      baseCurrency: 'GBP',
      taxResidency: 'GB',
      riskProfile: 'aggressive',
    }).returning();
  }
  if (!user) throw new Error('User insert failed.');

  console.log('Seeding categories…');
  for (const cat of DEFAULT_CATEGORIES) {
    await db.insert(categories).values({
      userId: user.id,
      name: cat.name,
      kind: cat.kind,
    }).onConflictDoNothing();
  }

  console.log('Seeding risk profiles…');
  for (const preset of Object.values(riskFile.profiles)) {
    await db.insert(riskProfiles).values({
      userId: user.id,
      name: preset.name,
      maxSinglePositionPct: preset.max_single_position_pct.toString(),
      maxSpeculativePct: preset.max_speculative_pct.toString(),
      maxSectorPct: preset.max_sector_pct.toString(),
      maxCountryPct: preset.max_country_pct.toString(),
      maxCurrencyPct: preset.max_currency_pct.toString(),
      maxDailyLossPct: preset.max_daily_loss_pct.toString(),
      maxWeeklyLossPct: preset.max_weekly_loss_pct.toString(),
      maxMonthlyLossPct: preset.max_monthly_loss_pct.toString(),
      leverageAllowed: preset.leverage_allowed,
      optionsAllowed: preset.options_allowed,
      cryptoCapPct: preset.crypto_cap_pct.toString(),
      cashFloorMonths: preset.cash_floor_months.toString(),
      coolingOffMinutes: preset.cooling_off_minutes,
      sleepModeStart: preset.sleep_mode_start,
      sleepModeEnd: preset.sleep_mode_end,
      newInstrumentSizeCapPct: preset.new_instrument_size_cap_pct.toString(),
      liquidityMinAdvGbp: preset.liquidity_min_adv_gbp.toString(),
      paperTradeDays: preset.paper_trade_days,
      active: preset.name === 'aggressive',
    });
  }

  console.log('Seeding allocation rules…');
  for (const [presetName, weights] of Object.entries(riskFile.allocation_presets)) {
    await db.insert(allocationRules).values({
      userId: user.id,
      name: `${presetName} allocation`,
      preset: presetName,
      weights,
      active: presetName === 'aggressive',
    });
  }

  console.log('Seeding current ISA year…');
  const allowance = taxRules.isa.total_allowance_gbp.toString();
  await db.insert(isaYears).values({
    userId: user.id,
    taxYear: taxRules.tax_year.number,
    allowance,
    deposited: '0',
    remaining: allowance,
  }).onConflictDoNothing();

  console.log('Seed complete.');
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
