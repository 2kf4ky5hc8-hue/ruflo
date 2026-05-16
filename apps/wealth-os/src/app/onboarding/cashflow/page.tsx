import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { loadSnapshot } from '@/lib/finance';
import { saveStep3 } from '@/services/onboarding';

async function submit(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const inc = Number(String(formData.get('income') ?? '0').replace(/[, ]/g, ''));
  const out = Number(String(formData.get('expenses') ?? '0').replace(/[, ]/g, ''));
  await saveStep3(userId, {
    monthlyIncomeGbp: Number.isFinite(inc) && inc >= 0 ? inc : 0,
    monthlyExpensesGbp: Number.isFinite(out) && out >= 0 ? out : 0,
  });
  redirect('/onboarding/goals');
}

export default async function StepCashflow() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const snap = await loadSnapshot(userId);

  return (
    <AppShell current="/onboarding">
      <div className="max-w-3xl">
        <p className="label">Step 3 of 4</p>
        <h1 className="h1 mt-1">Monthly cashflow</h1>
        <p className="subtle mt-2">
          Used for the cash-floor rule, allocation engine, and "spare £X" detector.
          We replace these with real numbers once you connect bank feeds.
        </p>

        <form action={submit} className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="label">Monthly take-home income</label>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-muted">£</span>
              <input className="input" type="number" name="income" min={0} step={50}
                     defaultValue={snap.monthlyIncomeGbp || 0} />
            </div>
            <p className="mt-1 text-xs text-muted">
              Salary + dividends + reliable side income after tax.
            </p>
          </div>
          <div>
            <label className="label">Monthly essential expenses</label>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-muted">£</span>
              <input className="input" type="number" name="expenses" min={0} step={50}
                     defaultValue={snap.monthlyExpensesGbp || 0} />
            </div>
            <p className="mt-1 text-xs text-muted">
              Rent/mortgage, bills, food, transport — the must-pay items.
            </p>
          </div>
          <div className="md:col-span-2 flex justify-between pt-2">
            <a className="btn btn-ghost" href="/onboarding/position">← Back</a>
            <button className="btn btn-primary" type="submit">Continue →</button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
