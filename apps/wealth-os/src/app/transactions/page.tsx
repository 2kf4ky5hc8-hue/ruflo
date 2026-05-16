import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppShell } from '@/components/AppShell';
import { listAccounts } from '@/services/accounts';
import {
  TRANSACTION_DIRECTIONS,
  createTransaction,
  deleteTransaction,
  listCategories,
  listTransactions,
  updateTransaction,
  validateTransactionInput,
} from '@/services/transactions';
import { gbp } from '@/lib/finance';

function fromForm(formData: FormData) {
  return {
    accountId: String(formData.get('account_id') ?? ''),
    postedAt: String(formData.get('posted_at') ?? new Date().toISOString().slice(0, 10)),
    amountGbp: Number(String(formData.get('amount') ?? '0').replace(/[, ]/g, '')) || 0,
    direction: String(formData.get('direction') ?? 'expense'),
    categoryId: (formData.get('category_id') as string) || null,
    description: (formData.get('description') as string) || null,
    notes: (formData.get('notes') as string) || null,
    holdingId: (formData.get('holding_id') as string) || null,
    recurring: formData.get('recurring') === 'on',
  };
}

async function createAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const input = validateTransactionInput(fromForm(formData));
  await createTransaction(db, { userId, input });
  revalidatePath('/transactions');
  revalidatePath('/dashboard');
}

async function updateAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const transactionId = String(formData.get('id') ?? '');
  const input = validateTransactionInput(fromForm(formData));
  await updateTransaction(db, { userId, transactionId, input });
  revalidatePath('/transactions');
  revalidatePath('/dashboard');
}

async function deleteAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const transactionId = String(formData.get('id') ?? '');
  await deleteTransaction(db, { userId, transactionId });
  revalidatePath('/transactions');
  revalidatePath('/dashboard');
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function TransactionsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;

  const [rows, accounts, cats] = await Promise.all([
    listTransactions(db, userId),
    listAccounts(db, userId),
    listCategories(db, userId),
  ]);

  const activeAccounts = accounts.filter((a) => a.active);

  return (
    <AppShell current="/transactions">
      <h1 className="h1">Transactions</h1>
      <p className="subtle mt-1">
        Used for monthly cashflow analysis. They do not change account balances —
        edit balances directly on the Accounts page.
      </p>

      {activeAccounts.length === 0 ? (
        <p className="card mt-6 subtle">Add an account first, then record transactions here.</p>
      ) : (
        <section className="card mt-6">
          <h2 className="h3">Add transaction</h2>
          <form action={createAction} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <select className="input" name="account_id" required defaultValue="">
              <option value="" disabled>Account…</option>
              {activeAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <input className="input" name="posted_at" type="date"
                   defaultValue={formatDate(new Date())} required />
            <input className="input" name="amount" type="number" inputMode="decimal" step="0.01"
                   placeholder="Amount (GBP)" required />
            <select className="input" name="direction" defaultValue="expense" required>
              {TRANSACTION_DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className="input" name="category_id" defaultValue="">
              <option value="">Category (optional)…</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>{c.kind}: {c.name}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="recurring" /> Recurring
            </label>
            <input className="input md:col-span-3" name="description" placeholder="Description" />
            <input className="input md:col-span-3" name="notes" placeholder="Notes (optional)" />
            <div className="md:col-span-3">
              <button className="btn btn-primary" type="submit">Add transaction</button>
            </div>
          </form>
        </section>
      )}

      <section className="mt-6">
        <h2 className="h3">Recent transactions</h2>
        {rows.length === 0 ? (
          <p className="mt-3 subtle">No transactions yet.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {rows.map((t) => (
              <form key={t.id} action={updateAction} className="card grid grid-cols-1 gap-3 md:grid-cols-6">
                <input type="hidden" name="id" value={t.id} />
                <select className="input md:col-span-2" name="account_id" defaultValue={t.accountId}>
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <input className="input" name="posted_at" type="date"
                       defaultValue={formatDate(t.postedAt)} />
                <input className="input" name="amount" type="number" inputMode="decimal" step="0.01"
                       defaultValue={Math.abs(t.amountGbp)} />
                <select className="input" name="direction" defaultValue={t.direction ?? 'expense'}>
                  {TRANSACTION_DIRECTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <select className="input" name="category_id" defaultValue={t.categoryId ?? ''}>
                  <option value="">(no category)</option>
                  {cats.map((c) => <option key={c.id} value={c.id}>{c.kind}: {c.name}</option>)}
                </select>
                <input className="input md:col-span-3" name="description" defaultValue={t.description ?? ''}
                       placeholder="Description" />
                <input className="input md:col-span-3" name="notes" defaultValue={t.notes ?? ''}
                       placeholder="Notes" />
                <label className="flex items-center gap-2 text-sm md:col-span-2">
                  <input type="checkbox" name="recurring" defaultChecked={t.recurring} /> Recurring
                </label>
                <div className="md:col-span-6 flex items-center gap-3 text-sm">
                  <span className="text-muted">
                    signed: <strong>{gbp(t.amountGbp)}</strong> · {t.accountName}
                  </span>
                  <span className="ml-auto" />
                  <button className="btn btn-primary" type="submit">Update</button>
                  <button className="btn btn-ghost text-red-700" type="submit" formAction={deleteAction}>
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
