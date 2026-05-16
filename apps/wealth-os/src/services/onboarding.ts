// WC-1201 — persist onboarding wizard answers into the canonical tables.
//
// Each step is independently saveable. We avoid creating duplicate accounts
// by reusing accounts that match (name, type) for the user.

import { eq, and } from 'drizzle-orm';
import { db } from '../lib/db';
import {
  users, accounts, transactions, goals, isaYears, riskProfiles, allocationRules,
} from '../db/schema/index';

export type RiskChoice = 'conservative' | 'balanced' | 'aggressive';

export interface Step1Profile {
  name: string;
  riskProfile: RiskChoice;
}

export interface Step2Position {
  cashGbp: number;
  isaGbp: number;
  giaGbp: number;
  pensionGbp: number;
  businessCashGbp: number;
  totalDebtGbp: number;
  isaDepositedThisYearGbp: number;
}

export interface Step3Cashflow {
  monthlyIncomeGbp: number;
  monthlyExpensesGbp: number;
}

export interface Step4Goals {
  goals: Array<{ name: string; targetGbp: number; targetIsoDate?: string; category: string }>;
}

async function ensureAccount(
  userId: string,
  name: string,
  type: string,
  isIsa = false,
): Promise<string> {
  const existing = await db.select().from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.name, name), eq(accounts.type, type)))
    .limit(1);
  if (existing[0]) return existing[0].id;
  const [row] = await db.insert(accounts).values({
    userId, name, type, currency: 'GBP', isIsa,
  }).returning({ id: accounts.id });
  return row!.id;
}

async function setAccountBalance(accountId: string, amountGbp: number) {
  // Replace all `onboarding` transactions for this account with one row that
  // sets the balance. Keeps onboarding idempotent.
  await db.delete(transactions).where(
    and(eq(transactions.accountId, accountId), eq(transactions.source, 'onboarding')),
  );
  if (amountGbp === 0) return;
  await db.insert(transactions).values({
    accountId,
    postedAt: new Date(),
    amount: amountGbp.toString(),
    currency: 'GBP',
    descriptionRaw: 'Opening balance (onboarding)',
    descriptionClean: 'Opening balance',
    source: 'onboarding',
  });
}

export async function saveStep1(userId: string, s: Step1Profile) {
  await db.update(users).set({
    name: s.name,
    riskProfile: s.riskProfile,
    updatedAt: new Date(),
  }).where(eq(users.id, userId));

  // Activate the matching preset.
  await db.update(riskProfiles).set({ active: false }).where(eq(riskProfiles.userId, userId));
  await db.update(riskProfiles).set({ active: true })
    .where(and(eq(riskProfiles.userId, userId), eq(riskProfiles.name, s.riskProfile)));

  await db.update(allocationRules).set({ active: false }).where(eq(allocationRules.userId, userId));
  await db.update(allocationRules).set({ active: true })
    .where(and(eq(allocationRules.userId, userId), eq(allocationRules.preset, s.riskProfile)));
}

export async function saveStep2(userId: string, s: Step2Position) {
  const cashId      = await ensureAccount(userId, 'Cash',                       'cash');
  const isaId       = await ensureAccount(userId, 'Stocks & Shares ISA',        'isa', true);
  const giaId       = await ensureAccount(userId, 'General Investment Account', 'gia');
  const pensionId   = await ensureAccount(userId, 'Pension',                    'sipp');
  const businessId  = await ensureAccount(userId, 'Business cash',              'business');
  const debtId      = await ensureAccount(userId, 'Total debt',                 'debt');

  await setAccountBalance(cashId,     s.cashGbp);
  await setAccountBalance(isaId,      s.isaGbp);
  await setAccountBalance(giaId,      s.giaGbp);
  await setAccountBalance(pensionId,  s.pensionGbp);
  await setAccountBalance(businessId, s.businessCashGbp);
  await setAccountBalance(debtId,    -Math.abs(s.totalDebtGbp));

  // Update ISA tracker for the current tax year.
  const [year] = await db.select().from(isaYears).where(eq(isaYears.userId, userId)).limit(1);
  if (year) {
    const allowance = Number(year.allowance);
    const deposited = Math.max(0, Math.min(allowance, s.isaDepositedThisYearGbp));
    await db.update(isaYears).set({
      deposited: deposited.toString(),
      remaining: (allowance - deposited).toString(),
      computedAt: new Date(),
    }).where(eq(isaYears.id, year.id));
  }
}

export async function saveStep3(userId: string, s: Step3Cashflow) {
  await db.update(users).set({
    monthlyIncomeGbp:   s.monthlyIncomeGbp.toString(),
    monthlyExpensesGbp: s.monthlyExpensesGbp.toString(),
    updatedAt: new Date(),
  }).where(eq(users.id, userId));
}

export async function saveStep4(userId: string, s: Step4Goals) {
  // Replace existing onboarding-sourced goals with the new set. We treat
  // onboarding as the source of truth for the initial pass.
  await db.delete(goals).where(eq(goals.userId, userId));
  for (const g of s.goals) {
    await db.insert(goals).values({
      userId, name: g.name,
      targetAmount: g.targetGbp.toString(),
      targetDate: g.targetIsoDate ? new Date(g.targetIsoDate) : null,
      category: g.category,
      priority: 100,
      currentAmount: '0',
    });
  }
}

export async function markOnboarded(userId: string) {
  await db.update(users).set({ onboardedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));
}
