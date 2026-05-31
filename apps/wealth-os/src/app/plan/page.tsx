import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { loadSnapshot, gbp } from '@/lib/finance';
import { buildDefaultPlan } from '@/services/default-plan';

function pctText(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export default async function PlanPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const snap = await loadSnapshot(userId);
  if (!snap.user.onboardedAt) redirect('/onboarding');

  const plan = buildDefaultPlan(snap);
  const allocated = plan.steps.reduce((acc, s) => acc + s.monthlyGbp, 0);

  return (
    <AppShell current="/plan">
      <h1 className="h1">The default plan</h1>
      <p className="subtle mt-1 max-w-3xl">
        The disciplined, boring baseline. Every "opportunity" the system surfaces is
        measured against this — if an idea doesn't clearly beat the default plan on a
        risk-adjusted, tax-aware basis, the honest answer is: just do the default.
      </p>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card">
          <div className="h3">Spare cash / month</div>
          <div className="mt-2 text-2xl font-semibold">{gbp(plan.monthlySpareGbp)}</div>
          <div className="mt-1 subtle">Income {gbp(snap.monthlyIncomeGbp)} − essentials {gbp(snap.monthlyExpensesGbp)}.</div>
        </div>
        <div className="card">
          <div className="h3">Blended expected return</div>
          <div className="mt-2 text-2xl font-semibold">{pctText(plan.blendedReturnPct)}</div>
          <div className="mt-1 subtle">£-weighted across the steps below.</div>
        </div>
        <div className="card">
          <div className="h3">Allocated</div>
          <div className="mt-2 text-2xl font-semibold">{gbp(allocated)}</div>
          <div className="mt-1 subtle">of {gbp(plan.monthlySpareGbp)} spare.</div>
        </div>
      </section>

      <section className="mt-6">
        <div className="h2">This month's waterfall</div>
        {plan.steps.length === 0 ? (
          <p className="subtle mt-2">
            No spare cash to allocate. Once income exceeds essential expenses, the plan
            fills the waterfall from the top.
          </p>
        ) : (
          <ol className="mt-3 space-y-2">
            {plan.steps.map((s, i) => (
              <li key={s.id} className="card py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs text-white">{i + 1}</span>
                  <span className="text-sm font-semibold">{s.title}</span>
                  <span className="ml-auto text-sm font-semibold">{gbp(s.monthlyGbp)}/mo</span>
                  <span className="w-20 text-right text-xs text-muted">~{pctText(s.expectedReturnPct)}</span>
                </div>
                <p className="mt-2 pl-9 text-sm text-muted">{s.rationale}</p>
                {s.targetGbp != null && (
                  <p className="mt-1 pl-9 text-xs text-muted">Target: {gbp(s.targetGbp)}.</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="card mt-6">
        <div className="h3">Assumptions</div>
        <ul className="mt-2 space-y-1 text-sm text-muted">
          <li>Global equity tracker real return: {pctText(plan.assumptions.globalEquityRealReturnPct)}</li>
          <li>Easy-access cash rate: {pctText(plan.assumptions.cashSavingsRatePct)}</li>
          <li>Short-gilt / money-market yield: {pctText(plan.assumptions.giltYieldPct)}</li>
          <li>Even-paced ISA target: {gbp(plan.assumptions.isaMonthlyTargetGbp)}/month</li>
        </ul>
        <p className="subtle mt-3">
          These are conservative planning assumptions, not forecasts. Decision-support,
          not regulated financial advice.
        </p>
      </section>
    </AppShell>
  );
}
