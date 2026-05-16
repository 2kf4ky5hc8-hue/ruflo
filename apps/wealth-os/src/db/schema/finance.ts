import {
  pgTable, uuid, varchar, text, timestamp, jsonb, numeric, boolean, integer,
  index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users, userIdRef } from './identity';

const money = (name: string) => numeric(name, { precision: 20, scale: 4 });

export const institutions = pgTable('institutions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 200 }).notNull(),
  country: varchar('country', { length: 2 }).notNull().default('GB'),
  type: varchar('type', { length: 30 }).notNull(),
});

export const connections = pgTable('connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  institutionId: uuid('institution_id').references(() => institutions.id, { onDelete: 'set null' }),
  provider: varchar('provider', { length: 40 }).notNull(),
  providerAccountId: varchar('provider_account_id', { length: 200 }),
  scope: varchar('scope', { length: 40 }).notNull().default('read'),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  consentExpiresAt: timestamp('consent_expires_at', { withTimezone: true }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  refreshTokenEncrypted: text('refresh_token_encrypted'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index('connections_user_idx').on(t.userId, t.status),
}));

export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  connectionId: uuid('connection_id').references(() => connections.id, { onDelete: 'set null' }),
  type: varchar('type', { length: 30 }).notNull(),
  subtype: varchar('subtype', { length: 40 }),
  name: varchar('name', { length: 200 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull().default('GBP'),
  ibanMasked: varchar('iban_masked', { length: 40 }),
  sortcodeMasked: varchar('sortcode_masked', { length: 12 }),
  accountNumberMasked: varchar('account_number_masked', { length: 20 }),
  isIsa: boolean('is_isa').notNull().default(false),
  isaType: varchar('isa_type', { length: 30 }),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userTypeIdx: index('accounts_user_type_idx').on(t.userId, t.type),
}));

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  name: varchar('name', { length: 120 }).notNull(),
  kind: varchar('kind', { length: 20 }).notNull(),
  parentId: uuid('parent_id'),
}, (t) => ({
  userKindIdx: index('categories_user_kind_idx').on(t.userId, t.kind),
}));

export const categoryRules = pgTable('category_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  pattern: text('pattern').notNull(),
  field: varchar('field', { length: 40 }).notNull().default('description_clean'),
  categoryId: uuid('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' }),
  priority: integer('priority').notNull().default(100),
  active: boolean('active').notNull().default(true),
});

export const transactions = pgTable('transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
  valueDate: timestamp('value_date', { withTimezone: true }),
  amount: money('amount').notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  fxRate: numeric('fx_rate', { precision: 20, scale: 10 }),
  counterparty: varchar('counterparty', { length: 200 }),
  descriptionRaw: text('description_raw'),
  descriptionClean: text('description_clean'),
  categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'set null' }),
  isTransfer: boolean('is_transfer').notNull().default(false),
  transferPairId: uuid('transfer_pair_id'),
  source: varchar('source', { length: 40 }).notNull().default('manual'),
  sourceRef: varchar('source_ref', { length: 200 }),
  confidenceScore: numeric('confidence_score', { precision: 5, scale: 4 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  accountTimeIdx: index('tx_account_time_idx').on(t.accountId, t.postedAt),
  pairIdx: index('tx_pair_idx').on(t.transferPairId),
}));

export const instruments = pgTable('instruments', {
  id: uuid('id').primaryKey().defaultRandom(),
  isin: varchar('isin', { length: 12 }).unique(),
  ticker: varchar('ticker', { length: 20 }),
  mic: varchar('mic', { length: 10 }),
  name: varchar('name', { length: 300 }).notNull(),
  assetClass: varchar('asset_class', { length: 30 }).notNull(),
  sector: varchar('sector', { length: 80 }),
  country: varchar('country', { length: 2 }),
  currency: varchar('currency', { length: 3 }).notNull(),
  listingStatus: varchar('listing_status', { length: 20 }).notNull().default('active'),
}, (t) => ({
  tickerIdx: index('instruments_ticker_idx').on(t.ticker, t.mic),
}));

export const holdings = pgTable('holdings', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  instrumentId: uuid('instrument_id').notNull().references(() => instruments.id),
  quantity: numeric('quantity', { precision: 28, scale: 8 }).notNull(),
  avgCost: money('avg_cost'),
  currency: varchar('currency', { length: 3 }).notNull(),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  source: varchar('source', { length: 40 }).notNull().default('manual'),
}, (t) => ({
  accountInstrUnique: uniqueIndex('holdings_account_instr_uq').on(t.accountId, t.instrumentId),
}));

export const lots = pgTable('lots', {
  id: uuid('id').primaryKey().defaultRandom(),
  holdingId: uuid('holding_id').notNull().references(() => holdings.id, { onDelete: 'cascade' }),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull(),
  quantity: numeric('quantity', { precision: 28, scale: 8 }).notNull(),
  price: money('price').notNull(),
  fees: money('fees').notNull().default('0'),
  fxRate: numeric('fx_rate', { precision: 20, scale: 10 }),
});

export const corporateActions = pgTable('corporate_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  instrumentId: uuid('instrument_id').notNull().references(() => instruments.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 30 }).notNull(),
  exDate: timestamp('ex_date', { withTimezone: true }),
  recordDate: timestamp('record_date', { withTimezone: true }),
  payDate: timestamp('pay_date', { withTimezone: true }),
  details: jsonb('details').notNull(),
});

export const prices = pgTable('prices', {
  id: uuid('id').primaryKey().defaultRandom(),
  instrumentId: uuid('instrument_id').notNull().references(() => instruments.id, { onDelete: 'cascade' }),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
  open: money('open'),
  high: money('high'),
  low: money('low'),
  close: money('close').notNull(),
  volume: numeric('volume', { precision: 28, scale: 4 }),
  source: varchar('source', { length: 40 }).notNull(),
}, (t) => ({
  instrTsUnique: uniqueIndex('prices_instr_ts_uq').on(t.instrumentId, t.ts, t.source),
}));

export const fundamentals = pgTable('fundamentals', {
  id: uuid('id').primaryKey().defaultRandom(),
  instrumentId: uuid('instrument_id').notNull().references(() => instruments.id, { onDelete: 'cascade' }),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  metric: varchar('metric', { length: 60 }).notNull(),
  value: numeric('value', { precision: 28, scale: 6 }),
  source: varchar('source', { length: 40 }).notNull(),
}, (t) => ({
  instrMetricIdx: index('fundamentals_instr_metric_idx').on(t.instrumentId, t.metric, t.asOf),
}));

export const isaYears = pgTable('isa_years', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  taxYear: integer('tax_year').notNull(),
  allowance: money('allowance').notNull(),
  deposited: money('deposited').notNull().default('0'),
  remaining: money('remaining').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userYearUnique: uniqueIndex('isa_years_user_year_uq').on(t.userId, t.taxYear),
}));

export const isaDeposits = pgTable('isa_deposits', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  depositedAt: timestamp('deposited_at', { withTimezone: true }).notNull(),
  amount: money('amount').notNull(),
  taxYear: integer('tax_year').notNull(),
  sourceTransactionId: uuid('source_transaction_id').references(() => transactions.id, { onDelete: 'set null' }),
}, (t) => ({
  userYearIdx: index('isa_deposits_user_year_idx').on(t.userId, t.taxYear),
}));

export const businesses = pgTable('businesses', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  name: varchar('name', { length: 200 }).notNull(),
  companiesHouseNumber: varchar('companies_house_number', { length: 10 }),
  vatNumber: varchar('vat_number', { length: 20 }),
  yearEnd: varchar('year_end', { length: 5 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const businessMetrics = pgTable('business_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').notNull().references(() => businesses.id, { onDelete: 'cascade' }),
  asOf: timestamp('as_of', { withTimezone: true }).notNull(),
  mrr: money('mrr'),
  runwayMonths: numeric('runway_months', { precision: 8, scale: 2 }),
  cash: money('cash'),
  liabilities: money('liabilities'),
  directorsLoanBalance: money('directors_loan_balance'),
  taxReserve: money('tax_reserve'),
  dividendPaidYtd: money('dividend_paid_ytd'),
  salaryPaidYtd: money('salary_paid_ytd'),
}, (t) => ({
  businessTimeIdx: index('biz_metrics_time_idx').on(t.businessId, t.asOf),
}));
