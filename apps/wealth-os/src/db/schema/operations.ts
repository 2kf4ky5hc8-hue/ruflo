import {
  pgTable, uuid, varchar, text, timestamp, jsonb, numeric, boolean, integer,
  index,
} from 'drizzle-orm/pg-core';
import { users, userIdRef } from './identity';
import { instruments } from './finance';

const money = (name: string) => numeric(name, { precision: 20, scale: 4 });
const pct = (name: string) => numeric(name, { precision: 6, scale: 4 });

export const riskProfiles = pgTable('risk_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  name: varchar('name', { length: 40 }).notNull(),
  maxSinglePositionPct: pct('max_single_position_pct').notNull(),
  maxSinglePositionSmallPortfolioPct: pct('max_single_position_small_portfolio_pct'),
  maxSpeculativePct: pct('max_speculative_pct').notNull(),
  maxSpeculativeUntilBufferHealthyPct: pct('max_speculative_until_buffer_healthy_pct'),
  maxSectorPct: pct('max_sector_pct').notNull(),
  maxCountryPct: pct('max_country_pct').notNull(),
  maxCurrencyPct: pct('max_currency_pct').notNull(),
  maxDailyLossPct: pct('max_daily_loss_pct').notNull(),
  maxWeeklyLossPct: pct('max_weekly_loss_pct').notNull(),
  maxMonthlyLossPct: pct('max_monthly_loss_pct').notNull(),
  leverageAllowed: boolean('leverage_allowed').notNull().default(false),
  optionsAllowed: boolean('options_allowed').notNull().default(false),
  cryptoCapPct: pct('crypto_cap_pct').notNull().default('0'),
  cryptoRequiresBuffer: boolean('crypto_requires_buffer').notNull().default(true),
  cryptoRequiresNoToxicDebt: boolean('crypto_requires_no_toxic_debt').notNull().default(true),
  cashFloorMonths: numeric('cash_floor_months', { precision: 5, scale: 2 }).notNull(),
  businessReserveFloorMonths: numeric('business_reserve_floor_months', { precision: 5, scale: 2 }).notNull().default('3'),
  drawdownCautionPct: pct('drawdown_caution_pct').notNull().default('0.10'),
  drawdownBlockPct: pct('drawdown_block_pct').notNull().default('0.20'),
  coolingOffMinutes: integer('cooling_off_minutes').notNull(),
  sleepModeStart: varchar('sleep_mode_start', { length: 5 }).notNull(),
  sleepModeEnd: varchar('sleep_mode_end', { length: 5 }).notNull(),
  newInstrumentSizeCapPct: pct('new_instrument_size_cap_pct').notNull(),
  liquidityMinAdvGbp: money('liquidity_min_adv_gbp').notNull(),
  paperTradeDays: integer('paper_trade_days').notNull().default(30),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const riskBreaches = pgTable('risk_breaches', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  rule: varchar('rule', { length: 80 }).notNull(),
  severity: varchar('severity', { length: 20 }).notNull(),
  detail: jsonb('detail').notNull(),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => ({
  userOpenIdx: index('risk_breaches_user_open_idx').on(t.userId, t.resolvedAt),
}));

export const allocationRules = pgTable('allocation_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  name: varchar('name', { length: 60 }).notNull(),
  preset: varchar('preset', { length: 30 }).notNull(),
  weights: jsonb('weights').notNull(),
  active: boolean('active').notNull().default(true),
});

export const spareCashEvents = pgTable('spare_cash_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
  amount: money('amount').notNull(),
  recommendedSplit: jsonb('recommended_split').notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  accepted: boolean('accepted'),
});

export const opportunities = pgTable('opportunities', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  kind: varchar('kind', { length: 30 }).notNull(),
  title: varchar('title', { length: 240 }).notNull(),
  assetRef: varchar('asset_ref', { length: 200 }),
  summary: text('summary'),
  upsidePct: pct('upside_pct'),
  riskScore: integer('risk_score').notNull(),
  liquidityScore: integer('liquidity_score'),
  complexityScore: integer('complexity_score'),
  capitalRequired: money('capital_required'),
  taxImpact: jsonb('tax_impact'),
  confidence: pct('confidence'),
  worstCasePct: pct('worst_case_pct'),
  fitScore: pct('fit_score'),
  sources: jsonb('sources'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  status: varchar('status', { length: 20 }).notNull().default('new'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userStatusFitIdx: index('opp_user_status_fit_idx').on(t.userId, t.status, t.fitScore),
}));

export const researchNotes = pgTable('research_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  instrumentId: uuid('instrument_id').notNull().references(() => instruments.id, { onDelete: 'cascade' }),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  version: integer('version').notNull().default(1),
  businessModel: text('business_model'),
  revenueModel: text('revenue_model'),
  valuation: jsonb('valuation'),
  growth: jsonb('growth'),
  balanceSheet: jsonb('balance_sheet'),
  risks: jsonb('risks'),
  bullCase: text('bull_case'),
  bearCase: text('bear_case'),
  baseCase: text('base_case'),
  ratios: jsonb('ratios'),
  news: jsonb('news'),
  sentiment: jsonb('sentiment'),
  insider: jsonb('insider'),
  isaEligible: boolean('isa_eligible'),
  suggestedSizePct: pct('suggested_size_pct'),
  suggestedAction: varchar('suggested_action', { length: 20 }).notNull(),
  citations: jsonb('citations').notNull(),
}, (t) => ({
  userInstrIdx: index('research_user_instr_idx').on(t.userId, t.instrumentId, t.generatedAt),
}));

export const proposedActions = pgTable('proposed_actions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  agent: varchar('agent', { length: 60 }).notNull(),
  kind: varchar('kind', { length: 40 }).notNull(),
  payload: jsonb('payload').notNull(),
  reason: text('reason').notNull(),
  upside: text('upside'),
  downside: text('downside'),
  riskScore: integer('risk_score').notNull(),
  confidence: pct('confidence').notNull(),
  amountAtRisk: money('amount_at_risk'),
  alternatives: jsonb('alternatives'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
  decisionNote: text('decision_note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userPendingIdx: index('proposed_user_pending_idx').on(t.userId, t.status, t.expiresAt),
}));

export const goals = pgTable('goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  name: varchar('name', { length: 160 }).notNull(),
  targetAmount: money('target_amount').notNull(),
  targetDate: timestamp('target_date', { withTimezone: true }),
  category: varchar('category', { length: 40 }).notNull(),
  priority: integer('priority').notNull().default(100),
  currentAmount: money('current_amount').notNull().default('0'),
  projection: jsonb('projection'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  kind: varchar('kind', { length: 40 }).notNull(),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
  periodStart: timestamp('period_start', { withTimezone: true }),
  periodEnd: timestamp('period_end', { withTimezone: true }),
  content: jsonb('content').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }),
}, (t) => ({
  userKindTimeIdx: index('reports_user_kind_time_idx').on(t.userId, t.kind, t.generatedAt),
}));

export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  agent: varchar('agent', { length: 60 }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  status: varchar('status', { length: 20 }).notNull().default('running'),
  input: jsonb('input'),
  output: jsonb('output'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  error: text('error'),
}, (t) => ({
  userAgentTimeIdx: index('agent_runs_user_agent_time_idx').on(t.userId, t.agent, t.startedAt),
}));

export const paperPositions = pgTable('paper_positions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: userIdRef(),
  proposedActionId: uuid('proposed_action_id').references(() => proposedActions.id, { onDelete: 'set null' }),
  instrumentRef: varchar('instrument_ref', { length: 200 }).notNull(),
  instrumentName: varchar('instrument_name', { length: 300 }),
  assetClass: varchar('asset_class', { length: 30 }).notNull(),
  wrapper: varchar('wrapper', { length: 40 }).notNull(),
  quantity: numeric('quantity', { precision: 28, scale: 8 }).notNull(),
  avgFillPrice: money('avg_fill_price').notNull(),
  feesGbp: money('fees_gbp').notNull().default('0'),
  openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  status: varchar('status', { length: 20 }).notNull().default('open'),
  reasonCode: varchar('reason_code', { length: 40 }).notNull().default('other'),
  thesis: text('thesis'),
  benchmarkReturnPct: pct('benchmark_return_pct'),
  defaultPlanDeltaPct: pct('default_plan_delta_pct'),
  markPrice: money('mark_price'),
  markedAt: timestamp('marked_at', { withTimezone: true }),
  realisedPnlGbp: money('realised_pnl_gbp'),
  review30dDone: boolean('review_30d_done').notNull().default(false),
  review90dDone: boolean('review_90d_done').notNull().default(false),
  review180dDone: boolean('review_180d_done').notNull().default(false),
  review365dDone: boolean('review_365d_done').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userStatusIdx: index('paper_positions_user_status_idx').on(t.userId, t.status, t.openedAt),
}));

export const paperFills = pgTable('paper_fills', {
  id: uuid('id').primaryKey().defaultRandom(),
  positionId: uuid('position_id').notNull().references(() => paperPositions.id, { onDelete: 'cascade' }),
  proposedActionId: uuid('proposed_action_id').references(() => proposedActions.id, { onDelete: 'set null' }),
  side: varchar('side', { length: 8 }).notNull(),
  quantity: numeric('quantity', { precision: 28, scale: 8 }).notNull(),
  price: money('price').notNull(),
  feesGbp: money('fees_gbp').notNull().default('0'),
  filledAt: timestamp('filled_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  positionIdx: index('paper_fills_position_idx').on(t.positionId, t.filledAt),
}));
