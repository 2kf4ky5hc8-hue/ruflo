import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { RunCoachButton } from '@/components/RunCoachButton';
import { loadSnapshot, gbp } from '@/lib/finance';

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;

  const snap = await loadSnapshot(userId);
  if (!snap.user.onboardedAt) redirect('/onboarding');

  const monthsBuffer = snap.monthlyExpensesGbp > 0
    ? (snap.cashGbp / snap.monthlyExpensesGbp).toFixed(1)
    : '—';
  const isaPct = snap.isa
    ? Math.round((snap.isa.deposited / snap.isa.allowance) * 100)
    : 0;

  const hello = snap.user.name?.split(' ')[0] ?? 'there';

  return (
    <AppShell current="/dashboard">
      <h1 className="h1">Hi, {hello}.</h1>
      <p className="subtle mt-1">
        Net worth, ISA progress, and the moves your Coach is considering this week.
      </p>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card">
          <div className="h3">Net worth</div>
          <div className="mt-2 text-3xl font-semibold">{gbp(snap.netWorthGbp)}</div>
          <div className="mt-1 subtle">Total across cash, ISA, GIA, business — debts deducted.</div>
        </div>
        <div className="card">
          <div className="h3">Cash position</div>
          <div className="mt-2 text-3xl font-semibold">{gbp(snap.cashGbp)}</div>
          <div className="mt-1 subtle">
            {snap.monthlyExpensesGbp > 0
              ? `${monthsBuffer} months of expenses (floor ${snap.activeRiskProfile?.cashFloorMonths ?? '—'} mo).`
              : 'Set monthly expenses to see your buffer.'}
          </div>
        </div>
        <div className="card">
          <div className="h3">ISA allowance</div>
          <div className="mt-2 text-3xl font-semibold">{gbp(snap.isa?.deposited ?? 0)}<span className="text-base text-muted"> / {gbp(snap.isa?.allowance ?? 20000)}</span></div>
          <div className="mt-2 h-2 w-full rounded-full bg-line/60">
            <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.min(100, isaPct)}%` }} />
          </div>
          <div className="mt-2 subtle">{gbp(snap.isa?.remaining ?? 0)} remaining this tax year.</div>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="card">
          <div className="h3">This week's moves</div>
          <p className="mt-3 subtle">
            Run the Coach to see your next 3 informational suggestions, year-end ISA pacing,
            and a risk summary. The Coach never executes anything — every monetary move
            still goes through the Approval Centre.
          </p>
          {snap.pendingApprovals > 0 && (
            <p className="mt-3">
              <Link className="text-accent underline" href="/approvals">
                {snap.pendingApprovals} pending approval{snap.pendingApprovals === 1 ? '' : 's'} →
              </Link>
            </p>
          )}
          <div className="mt-4">
            <RunCoachButton />
          </div>
        </div>

        <div className="card">
          <div className="h3">Goals</div>
          {snap.goals.length === 0 ? (
            <p className="mt-3 subtle">No goals yet. Set some during onboarding or in settings.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {snap.goals.map((g) => {
                const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
                return (
                  <li key={g.id}>
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-medium">{g.name}</span>
                      <span className="text-xs text-muted">{gbp(g.current)} / {gbp(g.target)}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-line/60">
                      <div className="h-1.5 rounded-full bg-ink" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card">
          <div className="h3">Risk profile</div>
          <div className="mt-2 text-lg font-medium capitalize">{snap.activeRiskProfile?.name ?? '—'}</div>
          <div className="mt-1 subtle">Cash floor: {snap.activeRiskProfile?.cashFloorMonths ?? '—'} months.</div>
        </div>
        <div className="card">
          <div className="h3">Allocation</div>
          <div className="mt-2 text-lg font-medium capitalize">{snap.activeAllocation?.preset ?? '—'}</div>
          <div className="mt-1 subtle">
            {snap.activeAllocation
              ? Object.entries(snap.activeAllocation.weights)
                  .map(([k, v]) => `${k.replace(/_/g, ' ')} ${Math.round(v * 100)}%`)
                  .join(' · ')
              : '—'}
          </div>
        </div>
        <div className="card">
          <div className="h3">Monthly cashflow</div>
          <div className="mt-2 text-lg font-medium">
            {gbp(snap.monthlyIncomeGbp)} in / {gbp(snap.monthlyExpensesGbp)} out
          </div>
          <div className="mt-1 subtle">
            Spare: {gbp(snap.monthlyIncomeGbp - snap.monthlyExpensesGbp)} / month.
          </div>
        </div>
      </section>
    </AppShell>
  );
}
