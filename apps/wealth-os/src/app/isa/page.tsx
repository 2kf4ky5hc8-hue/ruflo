import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppShell } from '@/components/AppShell';
import { listAccounts } from '@/services/accounts';
import {
  createIsaDeposit,
  currentTaxYearNumber,
  deleteIsaDeposit,
  listIsaDeposits,
  validateIsaDepositInput,
} from '@/services/isa-deposits';
import { gbp, loadSnapshot } from '@/lib/finance';
import { daysUntilTaxYearEnd } from '@/tax';

function fromForm(formData: FormData) {
  return {
    accountId: String(formData.get('account_id') ?? ''),
    depositedAt: String(formData.get('deposited_at') ?? new Date().toISOString().slice(0, 10)),
    amountGbp: Number(String(formData.get('amount') ?? '0').replace(/[, ]/g, '')) || 0,
    taxYear: Number(formData.get('tax_year')) || currentTaxYearNumber(),
    notes: (formData.get('notes') as string) || null,
  };
}

async function createAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const input = validateIsaDepositInput(fromForm(formData));
  await createIsaDeposit(db, { userId, input });
  revalidatePath('/isa');
  revalidatePath('/dashboard');
}

async function deleteAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const depositId = String(formData.get('id') ?? '');
  await deleteIsaDeposit(db, { userId, depositId });
  revalidatePath('/isa');
  revalidatePath('/dashboard');
}

export default async function IsaPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;

  const [deposits, accounts, snap] = await Promise.all([
    listIsaDeposits(db, userId),
    listAccounts(db, userId),
    loadSnapshot(userId),
  ]);

  const isaAccounts = accounts.filter((a) => (a.type === 'isa' || a.isIsa) && a.active);
  const ty = currentTaxYearNumber();
  const daysLeft = daysUntilTaxYearEnd(new Date());

  const allowance = snap.isa?.allowance ?? 20_000;
  const deposited = snap.isa?.deposited ?? 0;
  const remaining = snap.isa?.remaining ?? allowance;
  const overCap = deposited > allowance;

  return (
    <AppShell current="/isa">
      <h1 className="h1">ISA contributions</h1>
      <p className="subtle mt-1">
        Tax year {ty}/{(ty + 1) % 100} · {daysLeft} day{daysLeft === 1 ? '' : 's'} until 5 April.
      </p>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card">
          <div className="h3">Used</div>
          <div className="mt-2 text-2xl font-semibold">{gbp(deposited)}</div>
        </div>
        <div className="card">
          <div className="h3">Remaining</div>
          <div className="mt-2 text-2xl font-semibold">{gbp(remaining)}</div>
        </div>
        <div className="card">
          <div className="h3">Allowance</div>
          <div className="mt-2 text-2xl font-semibold">{gbp(allowance)}</div>
        </div>
      </section>

      {overCap && (
        <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          You've recorded <strong>{gbp(deposited)}</strong> of ISA contributions —
          that's <strong>{gbp(deposited - allowance)}</strong> over this year's £{allowance.toLocaleString('en-GB')} cap.
          Check that none of the deposits are duplicates and that the tax year is correct on each row.
        </p>
      )}

      {isaAccounts.length === 0 ? (
        <p className="card mt-6 subtle">
          Add an ISA-type account first, then come back here to log contributions.
        </p>
      ) : (
        <section className="card mt-6">
          <h2 className="h3">Record a contribution</h2>
          <form action={createAction} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <select className="input" name="account_id" required defaultValue="">
              <option value="" disabled>ISA account…</option>
              {isaAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <input className="input" name="deposited_at" type="date"
                   defaultValue={new Date().toISOString().slice(0, 10)} required />
            <input className="input" name="amount" type="number" inputMode="decimal" step="0.01"
                   placeholder="Amount (GBP)" required />
            <input className="input" name="tax_year" type="number" defaultValue={ty} />
            <input className="input md:col-span-2" name="notes" placeholder="Notes (optional)" />
            <div className="md:col-span-3">
              <button className="btn btn-primary" type="submit">Add deposit</button>
            </div>
          </form>
        </section>
      )}

      <section className="mt-6">
        <h2 className="h3">Deposit history</h2>
        {deposits.length === 0 ? (
          <p className="mt-3 subtle">No deposits recorded yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-2">Date</th>
                <th>Account</th>
                <th>Tax year</th>
                <th className="text-right">Amount</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((d) => (
                <tr key={d.id} className="border-t border-line">
                  <td className="py-2">{d.depositedAt.toISOString().slice(0, 10)}</td>
                  <td>{d.accountName}</td>
                  <td>{d.taxYear}/{(d.taxYear + 1) % 100}</td>
                  <td className="text-right font-medium">{gbp(d.amountGbp)}</td>
                  <td className="text-muted">{d.notes ?? ''}</td>
                  <td className="text-right">
                    <form action={deleteAction}>
                      <input type="hidden" name="id" value={d.id} />
                      <button className="btn btn-ghost text-red-700" type="submit">Delete</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </AppShell>
  );
}
