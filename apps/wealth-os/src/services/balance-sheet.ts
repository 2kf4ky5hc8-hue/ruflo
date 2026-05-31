// Balance-sheet data entry: business obligations, debt items, insurance.
// Plain functions the server actions call. No request/response coupling so
// these stay unit-testable.

import { and, eq, asc, desc } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  businesses, businessObligations, debtItems, insurancePolicies, auditEvents,
} from '../db/schema/index';

// ── Businesses ─────────────────────────────────────────────────────────────

/** Ensure the user has at least one business; return its id. */
export async function ensureDefaultBusiness(userId: string, name = 'My business'): Promise<string> {
  const existing = await db.select().from(businesses).where(eq(businesses.userId, userId)).limit(1);
  if (existing[0]) return existing[0].id;
  const [row] = await db.insert(businesses).values({ userId, name }).returning({ id: businesses.id });
  return row!.id;
}

export async function listBusinesses(userId: string) {
  return db.select().from(businesses).where(eq(businesses.userId, userId)).orderBy(asc(businesses.createdAt));
}

// ── Business obligations ─────────────────────────────────────────────────

export type ObligationKind =
  | 'vat' | 'paye' | 'corp_tax' | 'corp_tax_reserve' | 'payroll'
  | 'rent' | 'supplier' | 'software' | 'loan_repayment' | 'other';

export const OBLIGATION_KINDS: ObligationKind[] = [
  'vat', 'paye', 'corp_tax', 'corp_tax_reserve', 'payroll',
  'rent', 'supplier', 'software', 'loan_repayment', 'other',
];

export interface ObligationInput {
  businessId?: string;
  kind: ObligationKind;
  description?: string;
  amountGbp: number;
  dueAtIso?: string;
  recurring: 'one_off' | 'monthly' | 'quarterly' | 'annual';
}

export async function listObligations(userId: string) {
  const biz = await listBusinesses(userId);
  const ids = new Set(biz.map((b) => b.id));
  if (ids.size === 0) return [];
  const rows = await db.select().from(businessObligations).orderBy(asc(businessObligations.dueAt));
  return rows.filter((r) => ids.has(r.businessId));
}

export async function addObligation(userId: string, input: ObligationInput) {
  const businessId = input.businessId ?? await ensureDefaultBusiness(userId);
  const [row] = await db.insert(businessObligations).values({
    businessId,
    kind: input.kind,
    description: input.description ?? null,
    amountGbp: input.amountGbp.toString(),
    dueAt: input.dueAtIso ? new Date(input.dueAtIso) : null,
    recurring: input.recurring,
  }).returning({ id: businessObligations.id });
  await audit(userId, 'create', 'business_obligation', row!.id);
  return row!.id;
}

export async function markObligationPaid(userId: string, id: string) {
  await assertObligationOwner(userId, id);
  await db.update(businessObligations).set({ paidAt: new Date(), updatedAt: new Date() })
    .where(eq(businessObligations.id, id));
  await audit(userId, 'mark_paid', 'business_obligation', id);
}

export async function deleteObligation(userId: string, id: string) {
  await assertObligationOwner(userId, id);
  await db.delete(businessObligations).where(eq(businessObligations.id, id));
  await audit(userId, 'delete', 'business_obligation', id);
}

async function assertObligationOwner(userId: string, id: string): Promise<void> {
  const [row] = await db.select({ businessId: businessObligations.businessId })
    .from(businessObligations).where(eq(businessObligations.id, id)).limit(1);
  if (!row) throw new Error('Obligation not found.');
  const [biz] = await db.select({ userId: businesses.userId })
    .from(businesses).where(eq(businesses.id, row.businessId)).limit(1);
  if (!biz || biz.userId !== userId) throw new Error('Not authorised.');
}

// ── Debt items ──────────────────────────────────────────────────────────

export type DebtKind =
  | 'mortgage' | 'credit_card' | 'personal_loan' | 'student_loan'
  | 'car_finance' | 'bnpl' | 'hmrc_arrears' | 'director_loan' | 'other';

export const DEBT_KINDS: DebtKind[] = [
  'mortgage', 'credit_card', 'personal_loan', 'student_loan',
  'car_finance', 'bnpl', 'hmrc_arrears', 'director_loan', 'other',
];

export interface DebtInput {
  name: string;
  kind: DebtKind;
  balanceGbp: number;
  aprPct: number;          // decimal, e.g. 0.219 for 21.9%
  minimumPaymentGbp?: number;
  secured?: boolean;
  termMonths?: number;
  taxDeductible?: boolean;
}

export async function listDebts(userId: string) {
  return db.select().from(debtItems).where(eq(debtItems.userId, userId)).orderBy(desc(debtItems.aprPct));
}

export async function addDebt(userId: string, input: DebtInput) {
  const [row] = await db.insert(debtItems).values({
    userId,
    name: input.name,
    kind: input.kind,
    balanceGbp: input.balanceGbp.toString(),
    aprPct: input.aprPct.toString(),
    minimumPaymentGbp: input.minimumPaymentGbp?.toString() ?? null,
    secured: input.secured ?? false,
    termMonths: input.termMonths ?? null,
    taxDeductible: input.taxDeductible ?? false,
    lastVerifiedAt: new Date(),
  }).returning({ id: debtItems.id });
  await audit(userId, 'create', 'debt_item', row!.id);
  return row!.id;
}

export async function deleteDebt(userId: string, id: string) {
  const [row] = await db.select({ userId: debtItems.userId }).from(debtItems).where(eq(debtItems.id, id)).limit(1);
  if (!row || row.userId !== userId) throw new Error('Not authorised.');
  await db.delete(debtItems).where(eq(debtItems.id, id));
  await audit(userId, 'delete', 'debt_item', id);
}

// ── Insurance ───────────────────────────────────────────────────────────

export type InsuranceKind =
  | 'life' | 'income_protection' | 'critical_illness'
  | 'private_medical' | 'home_contents' | 'home_buildings'
  | 'travel' | 'business_liability' | 'employers_liability'
  | 'key_person' | 'professional_indemnity' | 'will' | 'lpa';

export const INSURANCE_KINDS: InsuranceKind[] = [
  'life', 'income_protection', 'critical_illness',
  'private_medical', 'home_contents', 'home_buildings',
  'travel', 'business_liability', 'employers_liability',
  'key_person', 'professional_indemnity', 'will', 'lpa',
];

export interface InsuranceInput {
  kind: InsuranceKind;
  provider?: string;
  coverAmountGbp?: number;
  monthlyPremiumGbp?: number;
  renewalDateIso?: string;
  beneficiary?: string;
  notes?: string;
}

export async function listInsurance(userId: string) {
  return db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId))
    .orderBy(asc(insurancePolicies.kind));
}

export async function addInsurance(userId: string, input: InsuranceInput) {
  const [row] = await db.insert(insurancePolicies).values({
    userId,
    kind: input.kind,
    provider: input.provider ?? null,
    coverAmountGbp: input.coverAmountGbp?.toString() ?? null,
    monthlyPremiumGbp: input.monthlyPremiumGbp?.toString() ?? null,
    renewalDate: input.renewalDateIso ? new Date(input.renewalDateIso) : null,
    beneficiary: input.beneficiary ?? null,
    notes: input.notes ?? null,
    status: 'active',
  }).returning({ id: insurancePolicies.id });
  await audit(userId, 'create', 'insurance_policy', row!.id);
  return row!.id;
}

export async function setInsuranceStatus(userId: string, id: string, status: 'active' | 'lapsed' | 'cancelled') {
  const [row] = await db.select({ userId: insurancePolicies.userId })
    .from(insurancePolicies).where(eq(insurancePolicies.id, id)).limit(1);
  if (!row || row.userId !== userId) throw new Error('Not authorised.');
  await db.update(insurancePolicies).set({ status, updatedAt: new Date() }).where(eq(insurancePolicies.id, id));
  await audit(userId, 'set_status', 'insurance_policy', id);
}

// Deterministic protection gap analysis (PR-2002). Rule-based, no LLM.
export interface ProtectionGap { kind: InsuranceKind; reason: string; severity: 'info' | 'warn'; }

export function analyseProtectionGaps(opts: {
  hasLife: boolean;
  hasIncomeProtection: boolean;
  hasWill: boolean;
  isBusinessOwner: boolean;
  hasDependants: boolean;
}): ProtectionGap[] {
  const gaps: ProtectionGap[] = [];
  if (!opts.hasIncomeProtection) {
    gaps.push({
      kind: 'income_protection',
      reason: 'No income protection. For irregular business income, this is the single most wealth-preserving cover — it protects the contributions that drive compounding.',
      severity: 'warn',
    });
  }
  if (opts.hasDependants && !opts.hasLife) {
    gaps.push({ kind: 'life', reason: 'You have dependants but no life cover recorded.', severity: 'warn' });
  }
  if (!opts.hasWill) {
    gaps.push({ kind: 'will', reason: 'No will recorded. Intestacy rules may not match your wishes.', severity: 'info' });
  }
  if (opts.isBusinessOwner) {
    gaps.push({ kind: 'key_person', reason: 'Business owner: consider key-person cover if the business depends on you.', severity: 'info' });
  }
  return gaps;
}

// ── audit ─────────────────────────────────────────────────────────────────

async function audit(userId: string, action: string, entityType: string, entityId: string) {
  await db.insert(auditEvents).values({
    userId, actor: 'user', action, entityType, entityId,
  });
}
