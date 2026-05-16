// Cross-page finance helpers that read aggregate state from the DB.
// Pure derivation logic, deterministic — same DB state -> same output.
//
// After 0003_manual_entry.sql, account balances live directly on
// `accounts.current_balance`. Transactions are kept only for cashflow
// analysis (sum of income/expense in the current calendar month) and for
// future broker integrations. Edit the balance on the account page; record
// transactions separately for cashflow analysis.

import { eq, and, desc, gte, inArray } from 'drizzle-orm';
import { db } from './db';
import {
  accounts, transactions, isaYears, goals, riskProfiles, allocationRules,
  proposedActions, users,
} from '../db/schema/index';

export interface FinanceSnapshot {
  user: { id: string; email: string; name: string; onboardedAt: Date | null };
  accountsByType: Record<string, number>;
  netWorthGbp: number;
  cashGbp: number;
  isaValueGbp: number;
  giaValueGbp: number;
  businessGbp: number;
  debtGbp: number;
  cryptoGbp: number;
  pensionGbp: number;
  monthlyIncomeGbp: number;
  monthlyExpensesGbp: number;
  monthlyIncomeSource: 'derived' | 'user_set' | 'none';
  monthlyExpensesSource: 'derived' | 'user_set' | 'none';
  isa: { taxYear: number; allowance: number; deposited: number; remaining: number } | null;
  activeRiskProfile: { name: string; cashFloorMonths: number } | null;
  activeAllocation: { preset: string; weights: Record<string, number> } | null;
  goals: Array<{ id: string; name: string; target: number; current: number; targetDate: Date | null }>;
  pendingApprovals: number;
  hasAnyAccounts: boolean;
}

// Sums the current_balance of every active account matching the predicate.
function sumBalance(
  rows: Array<typeof accounts.$inferSelect>,
  predicate: (a: typeof accounts.$inferSelect) => boolean,
): number {
  return rows.filter(predicate).reduce((acc, a) => acc + Number(a.currentBalance), 0);
}

function isActive(a: typeof accounts.$inferSelect): boolean {
  return a.closedAt === null;
}

const DEBT_TYPES = new Set(['debt', 'mortgage', 'credit', 'loan']);
const CASH_TYPES = new Set(['cash', 'savings', 'current']);

export async function loadSnapshot(userId: string): Promise<FinanceSnapshot> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  const accs = (await db.select().from(accounts).where(eq(accounts.userId, userId)))
    .filter(isActive);

  const hasAnyAccounts = accs.length > 0;

  const cashByOwnership = (business: boolean): number =>
    sumBalance(accs, (a) => a.isBusiness === business && CASH_TYPES.has(a.type));

  const cash       = cashByOwnership(false);
  const businessV  = cashByOwnership(true) + sumBalance(accs, (a) => a.type === 'business');
  const isaValue   = sumBalance(accs, (a) => a.type === 'isa' || a.isIsa);
  const giaValue   = sumBalance(accs, (a) => a.type === 'gia');
  const debt       = Math.abs(sumBalance(accs, (a) => DEBT_TYPES.has(a.type)));
  const crypto     = sumBalance(accs, (a) => a.type === 'crypto');
  const pension    = sumBalance(accs, (a) => a.type === 'pension' || a.type === 'sipp');

  const netWorth = cash + businessV + isaValue + giaValue + crypto + pension - debt;

  const byType: Record<string, number> = {};
  for (const a of accs) {
    byType[a.type] = (byType[a.type] ?? 0) + Number(a.currentBalance);
  }

  // Monthly cashflow — derive from this month's transactions when available,
  // fall back to the user-set figures from onboarding, else zero.
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const accountIds = accs.map((a) => a.id);
  const monthTxs = accountIds.length === 0 ? [] : await db
    .select({ amount: transactions.amount, direction: transactions.direction })
    .from(transactions)
    .where(and(
      inArray(transactions.accountId, accountIds),
      gte(transactions.postedAt, monthStart),
    ));

  const derivedIncome = monthTxs
    .filter((t) => t.direction === 'income')
    .reduce((s, t) => s + Number(t.amount), 0);
  const derivedExpense = Math.abs(monthTxs
    .filter((t) => t.direction === 'expense')
    .reduce((s, t) => s + Number(t.amount), 0));

  const userIncome = u?.monthlyIncomeGbp ? Number(u.monthlyIncomeGbp) : 0;
  const userExpense = u?.monthlyExpensesGbp ? Number(u.monthlyExpensesGbp) : 0;

  const monthlyIncome  = derivedIncome  > 0 ? derivedIncome  : userIncome;
  const monthlyExpense = derivedExpense > 0 ? derivedExpense : userExpense;
  const incomeSource: 'derived' | 'user_set' | 'none' =
    derivedIncome > 0 ? 'derived' : userIncome > 0 ? 'user_set' : 'none';
  const expenseSource: 'derived' | 'user_set' | 'none' =
    derivedExpense > 0 ? 'derived' : userExpense > 0 ? 'user_set' : 'none';

  const [isaRow] = await db.select().from(isaYears).where(eq(isaYears.userId, userId)).orderBy(desc(isaYears.taxYear)).limit(1);
  const [rp] = await db.select().from(riskProfiles).where(and(eq(riskProfiles.userId, userId), eq(riskProfiles.active, true))).limit(1);
  const [al] = await db.select().from(allocationRules).where(and(eq(allocationRules.userId, userId), eq(allocationRules.active, true))).limit(1);

  const goalRows = await db.select().from(goals).where(eq(goals.userId, userId));

  const pending = await db.select({ id: proposedActions.id }).from(proposedActions)
    .where(and(eq(proposedActions.userId, userId), eq(proposedActions.status, 'pending')));

  return {
    user: {
      id: userId,
      email: u?.email ?? '',
      name: u?.name ?? '',
      onboardedAt: u?.onboardedAt ?? null,
    },
    accountsByType: byType,
    netWorthGbp: netWorth,
    cashGbp: cash,
    isaValueGbp: isaValue,
    giaValueGbp: giaValue,
    businessGbp: businessV,
    debtGbp: debt,
    cryptoGbp: crypto,
    pensionGbp: pension,
    monthlyIncomeGbp: monthlyIncome,
    monthlyExpensesGbp: monthlyExpense,
    monthlyIncomeSource: incomeSource,
    monthlyExpensesSource: expenseSource,
    isa: isaRow ? {
      taxYear: isaRow.taxYear,
      allowance: Number(isaRow.allowance),
      deposited: Number(isaRow.deposited),
      remaining: Number(isaRow.remaining),
    } : null,
    activeRiskProfile: rp ? { name: rp.name, cashFloorMonths: Number(rp.cashFloorMonths) } : null,
    activeAllocation: al ? { preset: al.preset, weights: al.weights as Record<string, number> } : null,
    goals: goalRows.map((g) => ({
      id: g.id,
      name: g.name,
      target: Number(g.targetAmount),
      current: Number(g.currentAmount),
      targetDate: g.targetDate ?? null,
    })),
    pendingApprovals: pending.length,
    hasAnyAccounts,
  };
}

export function gbp(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);
}
