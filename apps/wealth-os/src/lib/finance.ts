// Cross-page finance helpers that read aggregate state from the DB.
// Pure, no LLM, deterministic.

import { eq, and, desc } from 'drizzle-orm';
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
  monthlyIncomeGbp: number;
  monthlyExpensesGbp: number;
  isa: { taxYear: number; allowance: number; deposited: number; remaining: number } | null;
  activeRiskProfile: { name: string; cashFloorMonths: number } | null;
  activeAllocation: { preset: string; weights: Record<string, number> } | null;
  goals: Array<{ id: string; name: string; target: number; current: number; targetDate: Date | null }>;
  pendingApprovals: number;
}

export async function loadSnapshot(userId: string): Promise<FinanceSnapshot> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

  const accs = await db.select().from(accounts).where(eq(accounts.userId, userId));
  const accBalances: Record<string, number> = {};
  for (const a of accs) {
    // Sum signed transactions per account in account currency. For MVP we
    // assume GBP across the board; multi-currency comes with the FX work.
    const txs = await db
      .select({ amount: transactions.amount })
      .from(transactions)
      .where(eq(transactions.accountId, a.id));
    const bal = txs.reduce((acc, t) => acc + Number(t.amount), 0);
    accBalances[a.id] = bal;
  }

  const sumWhere = (predicate: (a: typeof accs[number]) => boolean): number =>
    accs.filter(predicate).reduce((acc, a) => acc + (accBalances[a.id] ?? 0), 0);

  const cash       = sumWhere((a) => a.type === 'cash');
  const isaValue   = sumWhere((a) => a.type === 'isa' || a.isIsa);
  const giaValue   = sumWhere((a) => a.type === 'gia');
  const businessV  = sumWhere((a) => a.type === 'business');
  const debt       = Math.abs(sumWhere((a) => a.type === 'debt' || a.type === 'mortgage' || a.type === 'credit'));

  const netWorth = cash + isaValue + giaValue + businessV - debt;

  const byType: Record<string, number> = {};
  for (const a of accs) {
    byType[a.type] = (byType[a.type] ?? 0) + (accBalances[a.id] ?? 0);
  }

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
    monthlyIncomeGbp: u?.monthlyIncomeGbp ? Number(u.monthlyIncomeGbp) : 0,
    monthlyExpensesGbp: u?.monthlyExpensesGbp ? Number(u.monthlyExpensesGbp) : 0,
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
  };
}

export function gbp(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);
}
