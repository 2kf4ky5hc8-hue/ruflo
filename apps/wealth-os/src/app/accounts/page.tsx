import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppShell } from '@/components/AppShell';
import {
  ACCOUNT_TYPES,
  createAccount,
  deleteAccount,
  listAccounts,
  listInstitutions,
  updateAccount,
  validateAccountInput,
} from '@/services/accounts';

function fromForm(formData: FormData) {
  return {
    name: String(formData.get('name') ?? '').trim(),
    type: String(formData.get('type') ?? 'cash'),
    currency: String(formData.get('currency') ?? 'GBP'),
    currentBalanceGbp: Number(String(formData.get('balance') ?? '0').replace(/[, ]/g, '')) || 0,
    isBusiness: formData.get('is_business') === 'on',
    isIsa: formData.get('is_isa') === 'on',
    institutionId: (formData.get('institution_id') as string) || null,
    notes: (formData.get('notes') as string) || null,
    active: formData.get('active') === 'on',
  };
}

async function createAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const input = validateAccountInput(fromForm(formData));
  await createAccount(db, { userId, input });
  revalidatePath('/accounts');
  revalidatePath('/dashboard');
}

async function updateAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const accountId = String(formData.get('id') ?? '');
  const input = validateAccountInput(fromForm(formData));
  await updateAccount(db, { userId, accountId, input });
  revalidatePath('/accounts');
  revalidatePath('/dashboard');
}

async function deleteAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const accountId = String(formData.get('id') ?? '');
  await deleteAccount(db, { userId, accountId });
  revalidatePath('/accounts');
  revalidatePath('/dashboard');
}

export default async function AccountsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;

  const [rows, institutions] = await Promise.all([
    listAccounts(db, userId),
    listInstitutions(db),
  ]);

  return (
    <AppShell current="/accounts">
      <h1 className="h1">Accounts</h1>
      <p className="subtle mt-1">
        Manual entry. Balances here drive the dashboard totals directly.
      </p>

      <section className="card mt-6">
        <h2 className="h3">Add account</h2>
        <form action={createAction} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <input className="input" name="name" placeholder="e.g. Monzo current" required />
          <select className="input" name="type" defaultValue="cash" required>
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <input className="input" name="balance" type="number" inputMode="decimal" step="0.01"
                 placeholder="Current balance (GBP)" defaultValue={0} />
          <select className="input" name="institution_id" defaultValue="">
            <option value="">(no institution)</option>
            {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
          <input className="input" name="currency" defaultValue="GBP" maxLength={3} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_business" /> Business account
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="is_isa" /> ISA wrapper
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked /> Active
          </label>
          <input className="input md:col-span-3" name="notes" placeholder="Notes (optional)" />
          <div className="md:col-span-3">
            <button className="btn btn-primary" type="submit">Add account</button>
          </div>
        </form>
      </section>

      <section className="mt-6">
        <h2 className="h3">Your accounts</h2>
        {rows.length === 0 ? (
          <p className="mt-3 subtle">No accounts yet. Add your first one above.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {rows.map((a) => (
              <form key={a.id} action={updateAction} className="card grid grid-cols-1 gap-3 md:grid-cols-6">
                <input type="hidden" name="id" value={a.id} />
                <input className="input md:col-span-2" name="name" defaultValue={a.name} required />
                <select className="input" name="type" defaultValue={a.type}>
                  {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input className="input" name="balance" type="number" inputMode="decimal" step="0.01"
                       defaultValue={a.currentBalanceGbp} />
                <input className="input" name="currency" defaultValue={a.currency} maxLength={3} />
                <select className="input" name="institution_id" defaultValue={a.institutionId ?? ''}>
                  <option value="">(no institution)</option>
                  {institutions.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="is_business" defaultChecked={a.isBusiness} /> Business
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="is_isa" defaultChecked={a.isIsa} /> ISA
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="active" defaultChecked={a.active} /> Active
                </label>
                <input className="input md:col-span-3" name="notes" defaultValue={a.notes ?? ''}
                       placeholder="Notes (optional)" />
                <div className="flex items-center gap-2 md:col-span-6">
                  <button className="btn btn-primary" type="submit">Update</button>
                  <span className={`text-xs ${a.source === 'manual' ? 'text-muted' : 'text-amber-700'}`}>
                    source: {a.source}
                  </span>
                  <span className="ml-auto" />
                  <button
                    className="btn btn-ghost text-red-700"
                    type="submit"
                    formAction={deleteAction}
                  >
                    Delete
                  </button>
                </div>
              </form>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
