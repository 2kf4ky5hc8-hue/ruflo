import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppShell } from '@/components/AppShell';
import { listAccounts } from '@/services/accounts';
import {
  ASSET_TYPES,
  RISK_CATEGORIES,
  createHolding,
  deleteHolding,
  listHoldings,
  updateHolding,
  validateHoldingInput,
} from '@/services/holdings';
import { gbp } from '@/lib/finance';

function fromForm(formData: FormData) {
  return {
    accountId: String(formData.get('account_id') ?? ''),
    assetName: String(formData.get('asset_name') ?? '').trim(),
    tickerLocal: (formData.get('ticker') as string) || null,
    assetType: String(formData.get('asset_type') ?? 'other'),
    quantity: Number(String(formData.get('quantity') ?? '0').replace(/[, ]/g, '')) || 0,
    avgCost: formData.get('avg_cost') ? Number(formData.get('avg_cost')) : null,
    currentPrice: formData.get('current_price') ? Number(formData.get('current_price')) : null,
    currency: String(formData.get('currency') ?? 'GBP'),
    riskCategory: (formData.get('risk_category') as string) || null,
    notes: (formData.get('notes') as string) || null,
  };
}

async function createAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const input = validateHoldingInput(fromForm(formData));
  await createHolding(db, { userId, input });
  revalidatePath('/holdings');
  revalidatePath('/dashboard');
}

async function updateAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const holdingId = String(formData.get('id') ?? '');
  const input = validateHoldingInput(fromForm(formData));
  await updateHolding(db, { userId, holdingId, input });
  revalidatePath('/holdings');
  revalidatePath('/dashboard');
}

async function deleteAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const holdingId = String(formData.get('id') ?? '');
  await deleteHolding(db, { userId, holdingId });
  revalidatePath('/holdings');
  revalidatePath('/dashboard');
}

export default async function HoldingsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;

  const [rows, accounts] = await Promise.all([
    listHoldings(db, userId),
    listAccounts(db, userId),
  ]);

  // Only investment-shaped accounts can hold holdings.
  const investableAccounts = accounts.filter(
    (a) => ['isa', 'gia', 'pension', 'crypto'].includes(a.type) && a.active,
  );

  return (
    <AppShell current="/holdings">
      <h1 className="h1">Holdings</h1>
      <p className="subtle mt-1">
        Manual entry. Update current price to keep portfolio valuations honest.
      </p>

      {investableAccounts.length === 0 ? (
        <p className="card mt-6 subtle">
          Add an ISA / GIA / pension / crypto account first, then come back here.
        </p>
      ) : (
        <section className="card mt-6">
          <h2 className="h3">Add holding</h2>
          <form action={createAction} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            <select className="input" name="account_id" required defaultValue="">
              <option value="" disabled>Account…</option>
              {investableAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name} ({a.type})</option>
              ))}
            </select>
            <input className="input" name="asset_name" placeholder="e.g. Vanguard FTSE All Cap" required />
            <input className="input" name="ticker" placeholder="Ticker (optional)" />
            <select className="input" name="asset_type" defaultValue="fund" required>
              {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="input" name="quantity" type="number" inputMode="decimal" step="0.0001"
                   placeholder="Quantity" required />
            <input className="input" name="current_price" type="number" inputMode="decimal" step="0.01"
                   placeholder="Current price (GBP)" />
            <input className="input" name="avg_cost" type="number" inputMode="decimal" step="0.01"
                   placeholder="Avg cost (optional)" />
            <input className="input" name="currency" defaultValue="GBP" maxLength={3} />
            <select className="input" name="risk_category" defaultValue="">
              <option value="">Risk category (optional)…</option>
              {RISK_CATEGORIES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input className="input md:col-span-3" name="notes" placeholder="Notes (optional)" />
            <div className="md:col-span-3">
              <button className="btn btn-primary" type="submit">Add holding</button>
            </div>
          </form>
        </section>
      )}

      <section className="mt-6">
        <h2 className="h3">Your holdings</h2>
        {rows.length === 0 ? (
          <p className="mt-3 subtle">No holdings yet.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {rows.map((h) => (
              <form key={h.id} action={updateAction} className="card grid grid-cols-1 gap-3 md:grid-cols-6">
                <input type="hidden" name="id" value={h.id} />
                <select className="input md:col-span-2" name="account_id" defaultValue={h.accountId}>
                  {investableAccounts.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <input className="input md:col-span-2" name="asset_name" defaultValue={h.assetName} required />
                <input className="input" name="ticker" defaultValue={h.tickerLocal ?? ''} placeholder="Ticker" />
                <select className="input" name="asset_type" defaultValue={h.assetType}>
                  {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <input className="input" name="quantity" type="number" inputMode="decimal" step="0.0001"
                       defaultValue={h.quantity} />
                <input className="input" name="current_price" type="number" inputMode="decimal" step="0.01"
                       defaultValue={h.currentPrice ?? ''} placeholder="Current price" />
                <input className="input" name="avg_cost" type="number" inputMode="decimal" step="0.01"
                       defaultValue={h.avgCost ?? ''} placeholder="Avg cost" />
                <input className="input" name="currency" defaultValue={h.currency} maxLength={3} />
                <select className="input" name="risk_category" defaultValue={h.riskCategory ?? ''}>
                  <option value="">(no risk tag)</option>
                  {RISK_CATEGORIES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <input className="input md:col-span-3" name="notes" defaultValue={h.notes ?? ''}
                       placeholder="Notes" />
                <div className="md:col-span-6 flex items-center gap-3 text-sm">
                  <span className="text-muted">value: <strong>{gbp(h.currentValueGbp)}</strong></span>
                  <span className="text-muted">in <strong>{h.accountName}</strong></span>
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
