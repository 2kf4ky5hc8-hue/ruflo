import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { gbp } from '@/lib/finance';
import {
  listAccounts, addAccount, deleteAccount, accountBalance,
  listCategories, addTransaction, listTransactions, deleteTransaction,
  ACCOUNT_TYPES, type AccountType,
} from '@/services/ledger';

function num(v: FormDataEntryValue | null): number {
  const n = Number(String(v ?? '0').replace(/[, £]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

async function addAccountAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const name = String(formData.get('name') ?? '').trim();
  if (!name) redirect('/accounts?err=name');
  await addAccount((session.user as { id: string }).id, {
    name, type: String(formData.get('type') ?? 'cash') as AccountType,
  });
  redirect('/accounts');
}

async function deleteAccountAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  await deleteAccount((session.user as { id: string }).id, String(formData.get('id')));
  redirect('/accounts');
}

async function addTxAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const accountId = String(formData.get('account'));
  const amount = num(formData.get('amount'));
  const direction = String(formData.get('direction') ?? 'out');
  const dateStr = String(formData.get('date') ?? '').trim();
  if (!accountId || amount === 0) redirect('/accounts?err=tx');
  await addTransaction(userId, {
    accountId,
    postedAt: dateStr ? new Date(dateStr) : new Date(),
    amountGbp: direction === 'in' ? Math.abs(amount) : -Math.abs(amount),
    description: String(formData.get('description') ?? '').trim() || '(manual entry)',
    categoryId: String(formData.get('category') ?? '') || undefined,
  });
  redirect('/accounts');
}

async function deleteTxAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  await deleteTransaction((session.user as { id: string }).id, String(formData.get('id')));
  redirect('/accounts');
}

const TYPE_LABEL: Record<string, string> = {
  cash: 'Cash', isa: 'Stocks & Shares ISA', gia: 'GIA', sipp: 'Pension/SIPP',
  business: 'Business', mortgage: 'Mortgage', credit: 'Credit', debt: 'Debt',
  property: 'Property', crypto: 'Crypto',
};

export default async function AccountsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;

  const accs = await listAccounts(userId);
  const balances = await Promise.all(accs.map((a) => accountBalance(a.id)));
  const cats = await listCategories(userId);
  const recentTx = await listTransactions(userId, undefined, 25);
  const accById = new Map(accs.map((a) => [a.id, a]));

  return (
    <AppShell current="/accounts">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="h1">Accounts &amp; ledger</h1>
          <p className="subtle mt-1">Your real accounts and transactions. Plan and Paper run off this.</p>
        </div>
        <div className="flex gap-2">
          <Link className="btn btn-ghost" href="/holdings">Holdings →</Link>
          <Link className="btn btn-ghost" href="/import">Import CSV →</Link>
        </div>
      </div>

      <section className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {accs.map((a, i) => (
          <div key={a.id} className="card">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">{a.name}</div>
              <span className="text-xs text-muted">{TYPE_LABEL[a.type] ?? a.type}</span>
            </div>
            <div className="mt-2 text-xl font-semibold">{gbp(balances[i] ?? 0)}</div>
            <form action={deleteAccountAction} className="mt-2">
              <input type="hidden" name="id" value={a.id} />
              <button className="text-xs text-muted hover:text-bad">Delete account</button>
            </form>
          </div>
        ))}
        {accs.length === 0 && <p className="subtle">No accounts yet. Add one below.</p>}
      </section>

      <section className="card mt-6">
        <div className="h2">Add account</div>
        <form action={addAccountAction} className="mt-4 grid grid-cols-12 gap-2">
          <input className="input col-span-5" name="name" placeholder="Account name (e.g. Vanguard ISA)" required />
          <select className="input col-span-4" name="type" defaultValue="cash">
            {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
          <button className="btn btn-primary col-span-3" type="submit">Add account</button>
        </form>
      </section>

      <section className="card mt-6">
        <div className="h2">Add transaction</div>
        <form action={addTxAction} className="mt-4 grid grid-cols-12 gap-2">
          <select className="input col-span-3" name="account" required>
            {accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input className="input col-span-2" name="date" type="date" />
          <select className="input col-span-1" name="direction" defaultValue="out">
            <option value="out">out</option><option value="in">in</option>
          </select>
          <input className="input col-span-2" name="amount" type="number" min={0} step={0.01} placeholder="£ amount" required />
          <input className="input col-span-2" name="description" placeholder="Description" />
          <select className="input col-span-1" name="category" defaultValue="">
            <option value="">—</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="btn btn-primary col-span-1" type="submit">Add</button>
        </form>
      </section>

      <section className="mt-6">
        <div className="h2">Recent transactions</div>
        {recentTx.length === 0 ? (
          <p className="subtle mt-2">No transactions yet. Add one above or import a CSV.</p>
        ) : (
          <div className="mt-3 space-y-1">
            {recentTx.map((t) => (
              <div key={t.id} className="card flex items-center gap-3 py-2">
                <span className="w-24 text-xs text-muted">{new Date(t.postedAt).toLocaleDateString('en-GB')}</span>
                <span className="w-40 text-xs text-muted">{accById.get(t.accountId)?.name ?? '—'}</span>
                <span className="flex-1 text-sm">{t.descriptionClean ?? t.descriptionRaw ?? '—'}</span>
                <span className="text-xs text-muted">{t.source}</span>
                <span className={`w-24 text-right text-sm font-semibold ${Number(t.amount) >= 0 ? 'text-ok' : ''}`}>
                  {Number(t.amount) >= 0 ? '+' : ''}{gbp(Number(t.amount))}
                </span>
                <form action={deleteTxAction}><input type="hidden" name="id" value={t.id} /><button className="text-xs text-muted hover:text-bad">✕</button></form>
              </div>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
