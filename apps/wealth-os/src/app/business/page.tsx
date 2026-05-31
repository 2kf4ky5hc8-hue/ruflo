import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { gbp, loadSnapshot } from '@/lib/finance';
import {
  addObligation, listObligations, markObligationPaid, deleteObligation,
  OBLIGATION_KINDS, type ObligationKind,
} from '@/services/balance-sheet';

type Recurring = 'one_off' | 'monthly' | 'quarterly' | 'annual';

function num(v: FormDataEntryValue | null): number {
  const n = Number(String(v ?? '0').replace(/[, £]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function addAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const kind = String(formData.get('kind') ?? 'other') as ObligationKind;
  const amount = num(formData.get('amount'));
  if (amount <= 0) redirect('/business?err=amount');
  await addObligation(userId, {
    kind,
    description: String(formData.get('description') ?? '').trim() || undefined,
    amountGbp: amount,
    dueAtIso: String(formData.get('due') ?? '').trim() || undefined,
    recurring: String(formData.get('recurring') ?? 'one_off') as Recurring,
  });
  redirect('/business');
}

async function payAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  await markObligationPaid((session.user as { id: string }).id, String(formData.get('id')));
  redirect('/business');
}

async function deleteAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  await deleteObligation((session.user as { id: string }).id, String(formData.get('id')));
  redirect('/business');
}

const KIND_LABEL: Record<string, string> = {
  vat: 'VAT', paye: 'PAYE', corp_tax: 'Corporation tax', corp_tax_reserve: 'Corp tax reserve',
  payroll: 'Payroll', rent: 'Rent', supplier: 'Supplier', software: 'Software',
  loan_repayment: 'Loan repayment', other: 'Other',
};

export default async function BusinessPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const snap = await loadSnapshot(userId);
  const obligations = await listObligations(userId);
  const unpaid = obligations.filter((o) => !o.paidAt);

  const safe = snap.business.cashGbp >= snap.business.obligationsDue90dGbp;

  return (
    <AppShell current="/business">
      <h1 className="h1">Business cashflow</h1>
      <p className="subtle mt-1">
        Cash that's owed to HMRC, payroll, or suppliers is not spare. The risk engine
        blocks personal risk-up while obligations due in 90 days exceed business cash.
      </p>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card">
          <div className="h3">Business cash</div>
          <div className="mt-2 text-2xl font-semibold">{gbp(snap.business.cashGbp)}</div>
        </div>
        <div className="card">
          <div className="h3">Due in 90 days</div>
          <div className="mt-2 text-2xl font-semibold">{gbp(snap.business.obligationsDue90dGbp)}</div>
          <div className={`mt-1 text-sm ${safe ? 'text-ok' : 'text-bad'}`}>
            {safe ? 'Covered by business cash.' : 'Exceeds business cash — risk-up is blocked.'}
          </div>
        </div>
        <div className="card">
          <div className="h3">Runway</div>
          <div className="mt-2 text-2xl font-semibold">
            {snap.business.runwayMonths != null ? `${snap.business.runwayMonths} mo` : '—'}
          </div>
          <div className="mt-1 subtle">
            {snap.business.monthlyFixedGbp > 0
              ? `${gbp(snap.business.monthlyFixedGbp)}/mo fixed costs`
              : 'Add recurring obligations to compute.'}
          </div>
        </div>
      </section>

      <section className="card mt-6">
        <div className="h2">Add an obligation</div>
        <form action={addAction} className="mt-4 grid grid-cols-12 gap-2">
          <select className="input col-span-3" name="kind" defaultValue="vat">
            {OBLIGATION_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <input className="input col-span-3" name="description" placeholder="Description (optional)" />
          <input className="input col-span-2" name="amount" type="number" min={0} step={50} placeholder="£ amount" required />
          <input className="input col-span-2" name="due" type="date" />
          <select className="input col-span-1" name="recurring" defaultValue="one_off">
            <option value="one_off">Once</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="annual">Annual</option>
          </select>
          <button className="btn btn-primary col-span-1" type="submit">Add</button>
        </form>
      </section>

      <section className="mt-6">
        <div className="h2">Unpaid obligations</div>
        {unpaid.length === 0 ? (
          <p className="subtle mt-2">Nothing outstanding. Add VAT, PAYE, corp tax, payroll, rent and suppliers above.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {unpaid.map((o) => {
              const due = o.dueAt ? new Date(o.dueAt) : null;
              const overdue = due != null && due.getTime() < Date.now();
              return (
                <div key={o.id} className="card flex items-center gap-4 py-3">
                  <div className="w-32 text-sm font-medium">{KIND_LABEL[o.kind] ?? o.kind}</div>
                  <div className="flex-1 text-sm text-muted">{o.description ?? '—'}</div>
                  <div className="text-sm">{o.recurring !== 'one_off' ? `${o.recurring} · ` : ''}{due ? due.toLocaleDateString('en-GB') : 'no date'}</div>
                  {overdue && <span className="rounded bg-bad/10 px-2 py-0.5 text-xs text-bad">overdue</span>}
                  <div className="w-24 text-right text-sm font-semibold">{gbp(Number(o.amountGbp))}</div>
                  <form action={payAction}><input type="hidden" name="id" value={o.id} /><button className="btn btn-ghost text-xs">Mark paid</button></form>
                  <form action={deleteAction}><input type="hidden" name="id" value={o.id} /><button className="btn btn-ghost text-xs text-bad">Delete</button></form>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}
