import { redirect } from 'next/navigation';
import Link from 'next/link';
import { and, eq, gte, sum } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppShell } from '@/components/AppShell';
import { RunCoachButton } from '@/components/RunCoachButton';
import { loadSnapshot, gbp } from '@/lib/finance';
import { agentRuns } from '@/db/schema/index';
import { env } from '@/lib/env';
import { utcMonthStart } from '@/services/coach-budget';

async function fetchMonthlyCoachSpend(userId: string, now: Date): Promise<number> {
  const [row] = await db
    .select({ total: sum(agentRuns.costUsd) })
    .from(agentRuns)
    .where(and(
      eq(agentRuns.userId, userId),
      eq(agentRuns.agent, 'wealth-coach'),
      gte(agentRuns.startedAt, utcMonthStart(now)),
    ));
  return Number(row?.total ?? 0);
}

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;

  const snap = await loadSnapshot(userId);
  if (!snap.user.onboardedAt) redirect('/onboarding');

  const coachSpentUsd = await fetchMonthlyCoachSpend(userId, new Date());
  const coachCapUsd = env.COACH_MONTHLY_USD_CAP;
  const coachDailyCap = env.COACH_DAILY_CAP;

  const monthsBuffer = snap.monthlyExpensesGbp > 0
    ? (snap.cashGbp / snap.monthlyExpensesGbp).toFixed(1)
    : '—';
  const isaPct = snap.isa
    ? Math.round((snap.isa.deposited / snap.isa.allowance) * 100)
    : 0;
  const investmentGbp = snap.isaValueGbp + snap.giaValueGbp;
  const hello = snap.user.name?.split(' ')[0] ?? 'there';

  return (
    <AppShell current="/dashboard">
      <h1 className="h1">Hi, {hello}.</h1>
      <p className="subtle mt-1">
        Net worth, ISA progress, and the moves your Coach is considering this week.
      </p>

      {!snap.hasAnyAccounts && (
        <div className="mt-6 rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>You haven't added any accounts yet.</strong>{' '}
          The dashboard will stay empty until you do.{' '}
          <Link className="underline" href="/accounts">Add your first account →</Link>
        </div>
      )}

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card">
          <div className="h3">Net worth</div>
          <div className="mt-2 text-3xl font-semibold">{gbp(snap.netWorthGbp)}</div>
          <div className="mt-1 subtle">Cash + business + ISA + GIA + crypto + pension − debt.</div>
        </div>
        <div className="card">
          <div className="h3">Cash (personal)</div>
          <div className="mt-2 text-3xl font-semibold">{gbp(snap.cashGbp)}</div>
          <div className="mt-1 subtle">
            {snap.monthlyExpensesGbp > 0
              ? `${monthsBuffer} months of expenses (floor ${snap.activeRiskProfile?.cashFloorMonths ?? '—'} mo).`
              : 'Add a transaction or set monthly expenses to see your buffer.'}
          </div>
        </div>
        <div className="card">
          <div className="h3">ISA allowance</div>
          {snap.isa ? (
            <>
              <div className="mt-2 text-3xl font-semibold">
                {gbp(snap.isa.deposited)}
                <span className="text-base text-muted"> / {gbp(snap.isa.allowance)}</span>
              </div>
              <div className="mt-2 h-2 w-full rounded-full bg-line/60">
                <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.min(100, isaPct)}%` }} />
              </div>
              <div className="mt-2 subtle">{gbp(snap.isa.remaining)} remaining this tax year.</div>
              {snap.isa.deposited > snap.isa.allowance && (
                <p className="mt-2 text-xs text-red-700">
                  Over allowance — check ISA contributions for duplicates.
                </p>
              )}
            </>
          ) : (
            <>
              <div className="mt-2 text-3xl font-semibold">—</div>
              <Link className="mt-2 inline-block text-accent underline" href="/isa">
                Log your first ISA deposit →
              </Link>
            </>
          )}
        </div>
      </section>

      <section className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="card">
          <div className="h3">Business cash</div>
          <div className="mt-2 text-xl font-semibold">{gbp(snap.businessGbp)}</div>
          <div className="mt-1 subtle">Held separately from personal cash.</div>
        </div>
        <div className="card">
          <div className="h3">Investments</div>
          <div className="mt-2 text-xl font-semibold">{gbp(investmentGbp)}</div>
          <div className="mt-1 subtle">ISA + GIA combined.</div>
        </div>
        <div className="card">
          <div className="h3">Crypto + pension</div>
          <div className="mt-2 text-xl font-semibold">{gbp(snap.cryptoGbp + snap.pensionGbp)}</div>
          <div className="mt-1 subtle">
            {gbp(snap.cryptoGbp)} crypto · {gbp(snap.pensionGbp)} pension.
          </div>
        </div>
        <div className="card">
          <div className="h3">Debt</div>
          <div className="mt-2 text-xl font-semibold">{gbp(snap.debtGbp)}</div>
          <div className="mt-1 subtle">Mortgages, loans, credit. Subtracted from net worth.</div>
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
          <p className="mt-3 text-xs text-muted">
            Coach LLM spend this month: <strong>${coachSpentUsd.toFixed(2)}</strong> of ${coachCapUsd.toFixed(2)} cap · daily run cap {coachDailyCap}.
            {coachSpentUsd >= coachCapUsd && ' Cap reached — Coach paused until 1st of next month.'}
          </p>
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
            {' '}<em className="text-xs">
              ({snap.monthlyIncomeSource === 'derived' ? 'from transactions' : snap.monthlyIncomeSource === 'user_set' ? 'from onboarding' : 'not set'})
            </em>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
