import { sql } from 'drizzle-orm';
import {
  pgTable, uuid, varchar, text, timestamp, jsonb, inet, index, numeric,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 320 }).notNull().unique(),
  name: varchar('name', { length: 200 }).notNull(),
  baseCurrency: varchar('base_currency', { length: 3 }).notNull().default('GBP'),
  taxResidency: varchar('tax_residency', { length: 2 }).notNull().default('GB'),
  riskProfile: varchar('risk_profile', { length: 20 }).notNull().default('balanced'),
  passwordHash: text('password_hash'),
  totpSecretEncrypted: text('totp_secret_encrypted'),
  totpEnrolledAt: timestamp('totp_enrolled_at', { withTimezone: true }),
  monthlyIncomeGbp: numeric('monthly_income_gbp', { precision: 20, scale: 4 }),
  monthlyExpensesGbp: numeric('monthly_expenses_gbp', { precision: 20, scale: 4 }),
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const recoveryCodes = pgTable('recovery_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  codeHash: varchar('code_hash', { length: 128 }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index('recovery_codes_user_idx').on(t.userId, t.usedAt),
}));

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 128 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ip: inet('ip'),
  userAgent: text('user_agent'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userIdx: index('sessions_user_idx').on(t.userId, t.expiresAt),
}));

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  actor: varchar('actor', { length: 80 }).notNull(),
  action: varchar('action', { length: 80 }).notNull(),
  entityType: varchar('entity_type', { length: 80 }).notNull(),
  entityId: uuid('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: inet('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  entityIdx: index('audit_entity_idx').on(t.entityType, t.entityId),
  userTimeIdx: index('audit_user_time_idx').on(t.userId, t.createdAt),
}));

export const userIdRef = () => uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' });

export const _identityExports = { _: sql`1` };
