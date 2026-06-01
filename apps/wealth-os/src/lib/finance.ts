// Cross-page finance helpers that read aggregate state from the DB.
// Pure, no LLM, deterministic.

import { eq, and, desc } from 'drizzle-orm';
import { db } from './db';
import {
  accounts, transactions, isaYears, goals, riskProfiles, allocationRules,
  proposedActions, users, businesses, businessObligations, debtItems,
  insurancePolicies,
} from '../db/schema/index';

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

// Debt kinds that count as a monthly fixed business cost when computing the
// business reserve floor. (Business fixed = recurring obligations.)
const BUSINESS_FIXED_RECURRING = new Set(['payroll', 'rent', 'software', 'loan_repayment']);

export interface FinanceSnapshot {
  user: { id: string; email: string; name: string; onboardedAt: Date | null };
  accountsByType: Record<string, number>;
  netWorthGbp: number;
  cashGbp: number;
  isaValueGbp: number;
  giaValueGbp: number;
  businessGbp: number;
  /** Sum of `debt_items.balance` — the authoritative debt figure once items exist. */
  debtGbp: number;
  /** Highest APR across debt_items (decimal). 0 if no debt. */
  highestDebtAprPct: number;
  /** Debt items above the toxic-debt threshold. */
  toxicDebtCount: number;
  monthlyIncomeGbp: number;
  monthlyExpensesGbp: number;
  isa: { taxYear: number; allowance: number; deposited: number; remaining: number } | null;
  activeRiskProfile: {
    name: string;
    cashFloorMonths: number;
    businessReserveFloorMonths: number;
  } | null;
  activeAllocation: { preset: string; weights: Record<string, number> } | null;
  goals: Array<{ id: string; name: string; target: number; current: number; targetDate: Date | null }>;
  pendingApprovals: number;

  // Business cashflow signals (Epic 15).
  business: {
    cashGbp: number;
    obligationsDue90dGbp: number;
    obligationsTotalUnpaidGbp: number;
    monthlyFixedGbp: number;
    runwayMonths: number | null;
  };

  // Protection (Epic 20) — lightweight summary; detail lives on /protection.
  insurance: {
    activePolicies: number;
    hasIncomeProtection: boolean;
    hasLife: boolean;
    hasWill: boolean;
  };
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
  const accountDebt = Math.abs(sumWhere((a) => a.type === 'debt' || a.type === 'mortgage' || a.type === 'credit'));

  // ── Debt items (Epic 16) — authoritative once present, else fall back to
  //    the account-derived debt figure from onboarding. ──
  const debtRows = await db.select().from(debtItems).where(eq(debtItems.userId, userId));
  const debtItemsTotal = debtRows.reduce((acc, d) => acc + Number(d.balanceGbp), 0);
  const debt = debtRows.length > 0 ? debtItemsTotal : accountDebt;
  const highestDebtAprPct = debtRows.reduce((mx, d) => Math.max(mx, Number(d.aprPct)), 0);
  const toxicDebtCount = debtRows.filter((d) => Number(d.aprPct) > 0.06).length;

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

  // ── Business obligations (Epic 15) ──
  const bizRows = await db.select().from(businesses).where(eq(businesses.userId, userId));
  const bizIds = new Set(bizRows.map((b) => b.id));
  const obligationRows = bizIds.size > 0
    ? (await db.select().from(businessObligations))
        .filter((o) => bizIds.has(o.businessId) && o.paidAt == null)
    : [];
  const now = Date.now();
  const obligationsTotalUnpaid = obligationRows.reduce((acc, o) => acc + Number(o.amountGbp), 0);
  const obligationsDue90d = obligationRows
    .filter((o) => o.dueAt == null || o.dueAt.getTime() <= now + NINETY_DAYS_MS)
    .reduce((acc, o) => acc + Number(o.amountGbp), 0);
  // Monthly business fixed cost: sum of recurring monthly obligations, plus a
  // 12th of recurring annual ones, plus a 3rd of recurring quarterly ones.
  const businessMonthlyFixed = obligationRows.reduce((acc, o) => {
    const amt = Number(o.amountGbp);
    if (!BUSINESS_FIXED_RECURRING.has(o.kind)) return acc;
    switch (o.recurring) {
      case 'monthly':   return acc + amt;
      case 'quarterly': return acc + amt / 3;
      case 'annual':    return acc + amt / 12;
      default:          return acc;
    }
  }, 0);
  const businessRunwayMonths = businessMonthlyFixed > 0
    ? Number((businessV / businessMonthlyFixed).toFixed(1))
    : null;

  // ── Insurance (Epic 20) ──
  const policyRows = await db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, userId));
  const activePolicies = policyRows.filter((p) => p.status === 'active');
  const hasKind = (k: string) => activePolicies.some((p) => p.kind === k);

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
    highestDebtAprPct,
    toxicDebtCount,
    monthlyIncomeGbp: u?.monthlyIncomeGbp ? Number(u.monthlyIncomeGbp) : 0,
    monthlyExpensesGbp: u?.monthlyExpensesGbp ? Number(u.monthlyExpensesGbp) : 0,
    isa: isaRow ? {
      taxYear: isaRow.taxYear,
      allowance: Number(isaRow.allowance),
      deposited: Number(isaRow.deposited),
      remaining: Number(isaRow.remaining),
    } : null,
    activeRiskProfile: rp ? {
      name: rp.name,
      cashFloorMonths: Number(rp.cashFloorMonths),
      businessReserveFloorMonths: Number(rp.businessReserveFloorMonths),
    } : null,
    activeAllocation: al ? { preset: al.preset, weights: al.weights as Record<string, number> } : null,
    goals: goalRows.map((g) => ({
      id: g.id,
      name: g.name,
      target: Number(g.targetAmount),
      current: Number(g.currentAmount),
      targetDate: g.targetDate ?? null,
    })),
    pendingApprovals: pending.length,
    business: {
      cashGbp: businessV,
      obligationsDue90dGbp: obligationsDue90d,
      obligationsTotalUnpaidGbp: obligationsTotalUnpaid,
      monthlyFixedGbp: businessMonthlyFixed,
      runwayMonths: businessRunwayMonths,
    },
    insurance: {
      activePolicies: activePolicies.length,
      hasIncomeProtection: hasKind('income_protection'),
      hasLife: hasKind('life'),
      hasWill: hasKind('will'),
    },
  };
}

export function gbp(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(n);
}

// ── Bridge: FinanceSnapshot → evaluator PortfolioState (BC-1504, DT-1604) ──
//
// The evaluator needs a per-action view: it cares about the *investable*
// portfolio (cash + ISA + GIA, excluding the emergency-fund cash and the
// business), the existing position in the action's instrument, and the
// business + debt signals. We can't know `existingPositionGbp` /
// `speculativeExposureGbp` / `cryptoExposureGbp` from the snapshot alone
// (those are per-instrument holdings, which arrive with the ingest epics),
// so callers pass overrides for those; everything else comes from the
// snapshot.

import type { PortfolioState } from '../risk/types';

export interface PositionContext {
  existingPositionGbp?: number;
  speculativeExposureGbp?: number;
  cryptoExposureGbp?: number;
  /** Current peak-to-trough drawdown (0..1). Derived from portfolio_snapshots. */
  portfolioDrawdownPct?: number;
}

export function toPortfolioState(
  snap: FinanceSnapshot,
  position: PositionContext = {},
): PortfolioState {
  // Investable portfolio for concentration maths = liquid investments.
  // Cash buffer (emergency fund) and business cash are tracked separately.
  const investable = snap.isaValueGbp + snap.giaValueGbp;

  return {
    totalValueGbp: investable,
    existingPositionGbp: position.existingPositionGbp ?? 0,
    speculativeExposureGbp: position.speculativeExposureGbp ?? 0,
    cryptoExposureGbp: position.cryptoExposureGbp ?? 0,
    cashBufferGbp: snap.cashGbp,
    monthlyExpensesGbp: snap.monthlyExpensesGbp,
    isaRemainingGbp: snap.isa?.remaining ?? 0,
    businessCashGbp: snap.business.cashGbp,
    businessObligationsDue90dGbp: snap.business.obligationsDue90dGbp,
    businessMonthlyFixedGbp: snap.business.monthlyFixedGbp,
    highestDebtAprPct: snap.highestDebtAprPct,
    portfolioDrawdownPct: position.portfolioDrawdownPct,
  };
}
