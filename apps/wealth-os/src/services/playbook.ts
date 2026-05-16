// WC-1202 — deterministic 6-month playbook generator.
//
// Pure function over the FinanceSnapshot (no LLM, no randomness). The result
// is a markdown document stored in `reports.kind='playbook'`. Re-runnable.
//
// The Coach LLM layer wraps this later; the deterministic core stays.

import { db } from '../lib/db';
import { loadSnapshot, gbp, type FinanceSnapshot } from '../lib/finance';
import { reports } from '../db/schema/index';
import { getTaxRules, isaStatus, daysUntilTaxYearEnd, taxYearFor } from '../tax';

interface Allocation {
  emergency_fund: number;
  isa: number;
  higher_risk: number;
  debt: number;
  business_reinvest: number;
  education: number;
  opportunity: number;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function compoundedValue(monthlyContribution: number, monthlyRate: number, months: number): number {
  // FV of an annuity (contribution made at end of each period).
  if (monthlyRate === 0) return monthlyContribution * months;
  return monthlyContribution * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
}

function buildMarkdown(snap: FinanceSnapshot, now: Date = new Date()): string {
  const rules = getTaxRules();
  const isa = isaStatus(rules, {
    depositedGbp: snap.isa?.deposited ?? 0,
    now,
  });
  const taxYear = taxYearFor(now);
  const daysToYearEnd = daysUntilTaxYearEnd(now);

  const monthlySpare = Math.max(0, snap.monthlyIncomeGbp - snap.monthlyExpensesGbp);
  const cashFloor = (snap.activeRiskProfile?.cashFloorMonths ?? 3) * snap.monthlyExpensesGbp;
  const cashGap = Math.max(0, cashFloor - snap.cashGbp);
  const weights = (snap.activeAllocation?.weights ?? {}) as Partial<Allocation>;

  const targets = {
    emergency_fund: (weights.emergency_fund ?? 0.2) * monthlySpare,
    isa:            (weights.isa            ?? 0.4) * monthlySpare,
    higher_risk:    (weights.higher_risk    ?? 0.1) * monthlySpare,
    debt:           (weights.debt           ?? 0.1) * monthlySpare,
    business:       (weights.business_reinvest ?? 0.1) * monthlySpare,
    education:      (weights.education      ?? 0.05) * monthlySpare,
    opportunity:    (weights.opportunity    ?? 0.05) * monthlySpare,
  };

  // Front-load the emergency fund if there's a gap.
  if (cashGap > 0 && monthlySpare > 0) {
    const months = Math.ceil(cashGap / monthlySpare);
    targets.emergency_fund = Math.min(monthlySpare, cashGap / Math.max(1, months));
  }

  const isaPlanMonthly = Math.max(0, Math.min(targets.isa, isa.remainingGbp / 12));
  const projections = [3, 5, 7, 10].map((r) => {
    const months = 6;
    const monthlyRate = r / 100 / 12;
    const fv = compoundedValue(isaPlanMonthly, monthlyRate, months);
    return { rate: r, fv };
  });

  const horizon = '6 months';
  const today = new Date().toISOString().slice(0, 10);

  const milestoneGoal = [...snap.goals]
    .sort((a, b) => a.target - a.current - (b.target - b.current))[0];

  const lines: string[] = [];
  lines.push(`# Your 6-month wealth playbook`);
  lines.push(``);
  lines.push(`*Generated ${today}. Decision-support, not regulated financial advice.*`);
  lines.push(``);
  lines.push(`## Where you are today`);
  lines.push(`- **Net worth:** ${gbp(snap.netWorthGbp)} across ${gbp(snap.cashGbp)} cash · ${gbp(snap.isaValueGbp)} ISA · ${gbp(snap.giaValueGbp)} GIA · ${gbp(snap.businessGbp)} business. Debt: ${gbp(snap.debtGbp)}.`);
  lines.push(`- **Monthly cashflow:** ${gbp(snap.monthlyIncomeGbp)} in, ${gbp(snap.monthlyExpensesGbp)} out. Spare: **${gbp(monthlySpare)}/month**.`);
  lines.push(`- **Risk profile:** ${snap.activeRiskProfile?.name ?? '—'} (cash floor ${snap.activeRiskProfile?.cashFloorMonths ?? '—'} months).`);
  lines.push(`- **ISA allowance used:** ${gbp(isa.depositedGbp)} of ${gbp(isa.allowanceGbp)} (${gbp(isa.remainingGbp)} remaining). Tax year ${taxYear.number}/${(taxYear.number + 1) % 100}, **${daysToYearEnd} day${daysToYearEnd === 1 ? '' : 's'}** until 5 April.`);

  lines.push(``);
  lines.push(`## The next ${horizon}`);

  // Emergency fund
  if (cashGap > 0) {
    const months = monthlySpare > 0 ? Math.ceil(cashGap / monthlySpare) : null;
    lines.push(``);
    lines.push(`### 1. Get the emergency fund to floor`);
    lines.push(`You're **${gbp(cashGap)}** below the ${snap.activeRiskProfile?.cashFloorMonths ?? 3}-month floor (${gbp(cashFloor)}).`);
    if (months) {
      lines.push(`At your current monthly spare, you'd close the gap in **${months} month${months === 1 ? '' : 's'}**.`);
    }
    lines.push(`Until the floor is hit, the system will not propose buys that consume cash below it.`);
  } else {
    lines.push(``);
    lines.push(`### 1. Emergency fund is healthy`);
    lines.push(`You're at ${gbp(snap.cashGbp)} cash vs a ${gbp(cashFloor)} floor. Keep it parked in the best easy-access rate.`);
  }

  // ISA
  lines.push(``);
  lines.push(`### 2. Use the ISA wrapper before the tax year ends`);
  lines.push(`Per the **${snap.activeAllocation?.preset ?? 'default'}** allocation, route **${gbp(targets.isa)}/month** into the ISA.`);
  if (isa.remainingGbp > 0) {
    lines.push(`Remaining allowance for this tax year: **${gbp(isa.remainingGbp)}**. Even-pace contribution: ${gbp(isa.evenPaceMonthlyGbp)}/month.`);
    if (daysToYearEnd <= 30) {
      lines.push(`> Only ${daysToYearEnd} day${daysToYearEnd === 1 ? '' : 's'} left to use this year's allowance — it doesn't roll over.`);
    }
  } else {
    lines.push(`This year's ISA allowance is fully used — move excess to a GIA until 6 April.`);
  }

  // Higher-risk + opportunity
  lines.push(``);
  lines.push(`### 3. Higher-risk + opportunity sleeves`);
  lines.push(`- Higher-risk allocation target: **${gbp(targets.higher_risk)}/month** (${pct(weights.higher_risk ?? 0)} of spare).`);
  lines.push(`- Opportunity fund target: **${gbp(targets.opportunity)}/month**. The scanner shouldn't fire trades from this bucket without your approval.`);
  lines.push(`- Crypto cap: ${pct(snap.activeRiskProfile && (snap.activeRiskProfile.cashFloorMonths === 2) ? 0.05 : 0.02)} of investable portfolio.`);

  // Debt
  if (snap.debtGbp > 0) {
    lines.push(``);
    lines.push(`### 4. Debt`);
    lines.push(`You hold **${gbp(snap.debtGbp)}** of debt. Suggested allocation: **${gbp(targets.debt)}/month** above the contractual minimums.`);
    lines.push(`Reminder: any debt above ~6% should usually beat the investment side. The Coach will flag if you tilt the wrong way.`);
  }

  // Business
  if (snap.businessGbp > 0) {
    lines.push(``);
    lines.push(`### 5. Business reinvestment`);
    lines.push(`Reserve **${gbp(targets.business)}/month** for reinvestment. Keep the cash-flow safety buffer ahead of profit extraction.`);
  }

  // Goal trajectory
  if (milestoneGoal && monthlySpare > 0) {
    const remaining = Math.max(0, milestoneGoal.target - milestoneGoal.current);
    const monthsAtSpare = Math.ceil(remaining / monthlySpare);
    lines.push(``);
    lines.push(`## On track for: ${milestoneGoal.name}`);
    lines.push(`Gap: **${gbp(remaining)}**. At your current spare, you'd hit it in **${monthsAtSpare} months** (linear, no growth).`);
    lines.push(``);
    lines.push(`### ISA projections after ${horizon} at ${gbp(isaPlanMonthly)}/month`);
    lines.push(`| Annual return | Projected ISA value |`);
    lines.push(`|---|---|`);
    for (const p of projections) {
      lines.push(`| ${p.rate}% | ${gbp(isa.depositedGbp + p.fv)} |`);
    }
  }

  lines.push(``);
  lines.push(`## Guardrails this month`);
  lines.push(`- Single-position cap: ${pct(snap.activeRiskProfile?.cashFloorMonths === 2 ? 0.12 : 0.08)} of portfolio.`);
  lines.push(`- No leverage, no options, no spread bet (default mode).`);
  lines.push(`- Sleep window: no live execution outside daytime hours.`);
  lines.push(`- Every action above £1,000 will go to the Approval Centre.`);
  lines.push(``);
  lines.push(`*Re-run this playbook from settings any time your numbers materially change.*`);
  lines.push(``);
  lines.push(`---`);
  lines.push(`*Tax rules version: ${rules.version}. ${rules.disclaimers.primary.split('\n').join(' ').trim()}*`);

  return lines.join('\n');
}

export async function generatePlaybook(userId: string): Promise<{ id: string; markdown: string }> {
  const snap = await loadSnapshot(userId);
  const markdown = buildMarkdown(snap);
  const periodStart = new Date();
  const periodEnd = new Date(periodStart.getTime() + 1000 * 60 * 60 * 24 * 30 * 6);

  const [row] = await db.insert(reports).values({
    userId,
    kind: 'playbook',
    periodStart,
    periodEnd,
    content: { markdown, snapshot: snap },
  }).returning({ id: reports.id });

  return { id: row!.id, markdown };
}
