import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { gbp } from '@/lib/finance';
import {
  addDebt, listDebts, deleteDebt, DEBT_KINDS, type DebtKind,
} from '@/services/balance-sheet';
import { compareDebtsVsInvest } from '@/services/debt-advice';

function num(v: FormDataEntryValue | null): number {
  const n = Number(String(v ?? '0').replace(/[, £%]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function addAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const name = String(formData.get('name') ?? '').trim();
  const balance = num(formData.get('balance'));
  if (!name || balance <= 0) redirect('/debt?err=1');
  await addDebt(userId, {
    name,
    kind: String(formData.get('kind') ?? 'other') as DebtKind,
    balanceGbp: balance,
    aprPct: num(formData.get('apr')) / 100,    // form holds a percentage
    minimumPaymentGbp: num(formData.get('min')) || undefined,
    secured: formData.get('secured') === 'on',
    taxDeductible: formData.get('deductible') === 'on',
  });
  redirect('/debt');
}

async function deleteAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  await deleteDebt((session.user as { id: string }).id, String(formData.get('id')));
  redirect('/debt');
}

const KIND_LABEL: Record<string, string> = {
  mortgage: 'Mortgage', credit_card: 'Credit card', personal_loan: 'Personal loan',
  student_loan: 'Student loan', car_finance: 'Car finance', bnpl: 'Buy now pay later',
  hmrc_arrears: 'HMRC arrears', director_loan: 'Director loan', other: 'Other',
};

const VERDICT_LABEL: Record<string, { text: string; cls: string }> = {
  clear_debt_first: { text: 'Clear this first', cls: 'text-bad' },
  lean_clear_debt:  { text: 'Lean: clear it',   cls: 'text-warn' },
  either:           { text: 'Toss-up',          cls: 'text-muted' },
  lean_invest:      { text: 'Lean: invest',     cls: 'text-accent' },
  invest_first:     { text: 'Invest instead',   cls: 'text-ok' },
};

export default async function DebtPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const debts = await listDebts(userId);

  const comparisons = compareDebtsVsInvest(
    debts.map((d) => ({
      name: d.name, kind: d.kind, balanceGbp: Number(d.balanceGbp),
      aprPct: Number(d.aprPct), secured: d.secured, taxDeductible: d.taxDeductible,
    })),
    { assumedInvestReturnPct: 0.05, marginalTaxRatePct: 0.40 },
  );
  const byName = new Map(comparisons.map((c) => [c.name, c]));
  const total = debts.reduce((acc, d) => acc + Number(d.balanceGbp), 0);
  const toxic = debts.filter((d) => Number(d.aprPct) > 0.06);

  return (
    <AppShell current="/debt">
      <h1 className="h1">Debt</h1>
      <p className="subtle mt-1">
        APR-aware triage. A guaranteed return from clearing high-rate debt usually beats
        an uncertain investment return — the engine gates crypto and higher-risk while
        toxic debt (&gt;6% APR) is outstanding.
      </p>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card"><div className="h3">Total debt</div><div className="mt-2 text-2xl font-semibold">{gbp(total)}</div></div>
        <div className="card"><div className="h3">Toxic debt (&gt;6%)</div>
          <div className={`mt-2 text-2xl font-semibold ${toxic.length ? 'text-bad' : 'text-ok'}`}>{toxic.length}</div>
          <div className="mt-1 subtle">{toxic.length ? 'Blocks crypto + higher-risk allocation.' : 'Clear — no high-rate debt.'}</div>
        </div>
        <div className="card"><div className="h3">Assumptions</div>
          <div className="mt-2 subtle">5% assumed real investment return · 40% marginal tax for deductible debt.</div>
        </div>
      </section>

      <section className="card mt-6">
        <div className="h2">Add a debt</div>
        <form action={addAction} className="mt-4 grid grid-cols-12 gap-2">
          <input className="input col-span-3" name="name" placeholder="Name (e.g. Barclaycard)" required />
          <select className="input col-span-2" name="kind" defaultValue="credit_card">
            {DEBT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <input className="input col-span-2" name="balance" type="number" min={0} step={50} placeholder="£ balance" required />
          <input className="input col-span-1" name="apr" type="number" min={0} step={0.1} placeholder="APR %" required />
          <input className="input col-span-2" name="min" type="number" min={0} step={10} placeholder="Min/mo (opt)" />
          <label className="col-span-1 flex items-center gap-1 text-xs"><input type="checkbox" name="secured" /> secured</label>
          <button className="btn btn-primary col-span-1" type="submit">Add</button>
        </form>
        <p className="subtle mt-2">Tick "secured" for mortgage/car finance. Tax-deductible business borrowing can be marked after adding.</p>
      </section>

      <section className="mt-6">
        <div className="h2">Triage</div>
        {debts.length === 0 ? (
          <p className="subtle mt-2">No debts recorded. Add them above to see the pay-down-vs-invest call.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {debts.map((d) => {
              const c = byName.get(d.name);
              const v = c ? VERDICT_LABEL[c.verdict]! : null;
              return (
                <div key={d.id} className="card py-3">
                  <div className="flex items-center gap-4">
                    <div className="w-40 text-sm font-medium">{d.name}</div>
                    <div className="w-28 text-sm text-muted">{KIND_LABEL[d.kind] ?? d.kind}</div>
                    <div className="text-sm">{(Number(d.aprPct) * 100).toFixed(1)}% APR{d.secured ? ' · secured' : ''}{d.taxDeductible ? ' · tax-deductible' : ''}</div>
                    <div className="ml-auto w-24 text-right text-sm font-semibold">{gbp(Number(d.balanceGbp))}</div>
                    {v && <div className={`w-28 text-right text-sm font-semibold ${v.cls}`}>{v.text}</div>}
                    <form action={deleteAction}><input type="hidden" name="id" value={d.id} /><button className="btn btn-ghost text-xs text-bad">Delete</button></form>
                  </div>
                  {c && <p className="mt-2 text-sm text-muted">{c.reason}</p>}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}
