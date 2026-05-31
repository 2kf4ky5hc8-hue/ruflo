import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { gbp } from '@/lib/finance';
import {
  listAccounts, addHolding, listHoldings, deleteHolding,
} from '@/services/ledger';

function num(v: FormDataEntryValue | null): number {
  const n = Number(String(v ?? '0').replace(/[, £]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const ASSET_CLASSES = [
  'developed_equity', 'emerging_equity', 'small_cap_equity', 'thematic_equity',
  'reit', 'investment_grade_bond', 'high_yield_bond', 'gilt', 'commodity', 'crypto', 'cash',
];

async function addAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const accountId = String(formData.get('account'));
  const ref = String(formData.get('ref') ?? '').trim();
  const qty = num(formData.get('qty'));
  const cost = num(formData.get('cost'));
  if (!accountId || !ref || qty <= 0) redirect('/holdings?err=1');
  await addHolding(userId, {
    accountId,
    instrumentRef: ref,
    instrumentName: String(formData.get('name') ?? '').trim() || undefined,
    assetClass: String(formData.get('asset') ?? 'developed_equity'),
    quantity: qty,
    avgCostGbp: cost,
  });
  redirect('/holdings');
}

async function deleteAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  await deleteHolding((session.user as { id: string }).id, String(formData.get('id')));
  redirect('/holdings');
}

export default async function HoldingsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const accs = (await listAccounts(userId)).filter((a) => ['isa', 'gia', 'sipp', 'crypto'].includes(a.type));
  const rows = await listHoldings(userId);

  return (
    <AppShell current="/holdings">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="h1">Holdings</h1>
          <p className="subtle mt-1">Your real ISA / GIA / pension positions. Enter cost basis at purchase.</p>
        </div>
        <Link className="btn btn-ghost" href="/accounts">← Accounts</Link>
      </div>

      <section className="card mt-6">
        <div className="h2">Add a holding</div>
        {accs.length === 0 ? (
          <p className="subtle mt-2">Add an ISA, GIA, pension or crypto account first on the <Link className="text-accent underline" href="/accounts">Accounts</Link> page.</p>
        ) : (
          <form action={addAction} className="mt-4 grid grid-cols-12 gap-2">
            <select className="input col-span-3" name="account" required>
              {accs.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <input className="input col-span-2" name="ref" placeholder="ISIN / ticker" required />
            <input className="input col-span-3" name="name" placeholder="Name (optional)" />
            <select className="input col-span-2" name="asset" defaultValue="developed_equity">
              {ASSET_CLASSES.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
            </select>
            <input className="input col-span-1" name="qty" type="number" min={0} step="any" placeholder="qty" required />
            <input className="input col-span-1" name="cost" type="number" min={0} step={0.01} placeholder="£ avg cost" />
            <div className="col-span-12 flex justify-end">
              <button className="btn btn-primary" type="submit">Add holding</button>
            </div>
          </form>
        )}
        <p className="subtle mt-2">"Avg cost" is the price per unit you paid. Re-adding the same instrument in the same account updates it.</p>
      </section>

      <section className="mt-6">
        <div className="h2">Current holdings</div>
        {rows.length === 0 ? (
          <p className="subtle mt-2">No holdings recorded yet.</p>
        ) : (
          <div className="mt-3 space-y-1">
            {rows.map(({ holding: h, instrument: ins, account }) => {
              const bookValue = Number(h.quantity) * Number(h.avgCost ?? 0);
              return (
                <div key={h.id} className="card flex items-center gap-3 py-2">
                  <span className="w-28 text-sm font-semibold">{ins.ticker ?? ins.isin ?? '—'}</span>
                  <span className="flex-1 text-sm text-muted">{ins.name}</span>
                  <span className="w-28 text-xs text-muted">{account?.name}</span>
                  <span className="w-24 text-xs text-muted">{ins.assetClass.replace(/_/g, ' ')}</span>
                  <span className="text-sm">{Number(h.quantity).toLocaleString('en-GB')} @ £{Number(h.avgCost ?? 0).toFixed(2)}</span>
                  <span className="w-24 text-right text-sm font-semibold">{gbp(bookValue)}</span>
                  <form action={deleteAction}><input type="hidden" name="id" value={h.id} /><button className="text-xs text-muted hover:text-bad">✕</button></form>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}
