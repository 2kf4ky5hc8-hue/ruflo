import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { gbp } from '@/lib/finance';
import {
  listAccounts, addHolding, listHoldings, deleteHolding, setHoldingTags,
} from '@/services/ledger';
import { refreshUserPrices, latestPrices, valueHolding } from '@/services/prices';

const TAG_SUGGESTIONS = [
  'etf', 'fund', 'stock', 'bond', 'gilt', 'cash', 'crypto', 'reit',
  'defensive', 'balanced', 'speculative',
  'growth', 'value', 'income', 'thematic',
  'uk', 'us', 'europe', 'global', 'emerging',
];

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

async function refreshPricesAction() {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  await refreshUserPrices((session.user as { id: string }).id);
  redirect('/holdings');
}

async function setTagsAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const id = String(formData.get('id'));
  const raw = String(formData.get('tags') ?? '');
  const tags = raw.split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);
  await setHoldingTags((session.user as { id: string }).id, id, tags);
  redirect('/holdings');
}

export default async function HoldingsPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const accs = (await listAccounts(userId)).filter((a) => ['isa', 'gia', 'sipp', 'crypto'].includes(a.type));
  const rows = await listHoldings(userId);

  const priceMap = await latestPrices(rows.map((r) => r.holding.instrumentId));
  const valued = rows.map((r) => {
    const px = priceMap.get(r.holding.instrumentId);
    const v = valueHolding({
      quantity: Number(r.holding.quantity),
      avgCostGbp: Number(r.holding.avgCost ?? 0),
      marketPrice: px?.price ?? null,
    });
    return { ...r, v, px };
  });
  const totalMv = valued.reduce((acc, x) => acc + (x.v.marketValueGbp ?? x.v.bookValueGbp), 0);
  const totalPnl = valued.reduce((acc, x) => acc + (x.v.unrealisedPnlGbp ?? 0), 0);
  const anyStub = valued.some((x) => x.px?.source === 'stub');

  return (
    <AppShell current="/holdings">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="h1">Holdings</h1>
          <p className="subtle mt-1">Your real ISA / GIA / pension positions. Enter cost basis at purchase.</p>
        </div>
        <div className="flex gap-2">
          <form action={refreshPricesAction}><button className="btn btn-ghost" type="submit">Refresh prices</button></form>
          <Link className="btn btn-ghost" href="/accounts">← Accounts</Link>
        </div>
      </div>

      {rows.length > 0 && (
        <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="card"><div className="h3">Market value</div><div className="mt-2 text-2xl font-semibold">{gbp(totalMv)}</div></div>
          <div className="card"><div className="h3">Unrealised P&amp;L</div>
            <div className={`mt-2 text-2xl font-semibold ${totalPnl >= 0 ? 'text-ok' : 'text-bad'}`}>{gbp(totalPnl)}</div>
          </div>
          <div className="card"><div className="h3">Pricing</div>
            <div className="mt-2 text-sm">{anyStub ? 'Simulated (stub) prices' : 'Live prices'}</div>
            <div className="mt-1 subtle">{anyStub ? 'Set MARKET_DATA_PROVIDER=fmp + API key for live quotes.' : 'From your configured provider.'}</div>
          </div>
        </section>
      )}

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
        {valued.length === 0 ? (
          <p className="subtle mt-2">No holdings recorded yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {valued.map(({ holding: h, instrument: ins, account, v, px }) => {
              const tagList = (h.tags as string[]) ?? [];
              return (
                <div key={h.id} className="card py-3">
                  <div className="flex items-center gap-3">
                    <span className="w-24 text-sm font-semibold">{ins.ticker ?? ins.isin ?? '—'}</span>
                    <span className="flex-1 text-sm text-muted">{ins.name}</span>
                    <span className="w-24 text-xs text-muted">{account?.name}</span>
                    <span className="text-sm">{Number(h.quantity).toLocaleString('en-GB')} @ £{Number(h.avgCost ?? 0).toFixed(2)}</span>
                    {px ? (
                      <span className="w-24 text-right text-xs text-muted">mkt £{px.price.toFixed(2)}</span>
                    ) : (
                      <span className="w-24 text-right text-xs text-muted">unpriced</span>
                    )}
                    <span className="w-24 text-right text-sm font-semibold">{gbp(v.marketValueGbp ?? v.bookValueGbp)}</span>
                    {v.unrealisedPnlGbp != null && (
                      <span className={`w-24 text-right text-xs ${v.unrealisedPnlGbp >= 0 ? 'text-ok' : 'text-bad'}`}>
                        {v.unrealisedPnlGbp >= 0 ? '+' : ''}{gbp(v.unrealisedPnlGbp)}
                      </span>
                    )}
                    <form action={deleteAction}><input type="hidden" name="id" value={h.id} /><button className="text-xs text-muted hover:text-bad">✕</button></form>
                  </div>
                  <form action={setTagsAction} className="mt-2 flex items-center gap-2">
                    <input type="hidden" name="id" value={h.id} />
                    <span className="text-xs text-muted">tags</span>
                    <input
                      className="input flex-1 text-xs"
                      name="tags"
                      defaultValue={tagList.join(', ')}
                      placeholder="comma-separated, e.g. etf, defensive, global"
                      list="tag-suggestions"
                    />
                    <button className="btn btn-ghost text-xs" type="submit">Save</button>
                  </form>
                  {tagList.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tagList.map((t) => (
                        <span key={t} className="rounded bg-line/40 px-2 py-0.5 text-xs">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
      <datalist id="tag-suggestions">
        {TAG_SUGGESTIONS.map((t) => <option key={t} value={t} />)}
      </datalist>
    </AppShell>
  );
}
