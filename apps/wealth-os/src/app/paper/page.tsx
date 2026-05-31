import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { gbp } from '@/lib/finance';
import {
  openPaperPosition, listPositions, markPosition, closePosition, deletePosition,
  valuePosition, refreshPaperMarks, REASON_CODES, type ReasonCode,
} from '@/services/paper-portfolio';

function num(v: FormDataEntryValue | null): number {
  const n = Number(String(v ?? '0').replace(/[, £]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

async function openAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const amount = num(formData.get('amount'));
  const price = num(formData.get('price'));
  if (amount <= 0 || price <= 0) redirect('/paper?err=1');
  await openPaperPosition(userId, {
    instrumentRef: String(formData.get('ref') ?? '').trim() || 'UNKNOWN',
    instrumentName: String(formData.get('name') ?? '').trim() || undefined,
    assetClass: String(formData.get('asset') ?? 'developed_equity'),
    wrapper: String(formData.get('wrapper') ?? 'isa'),
    amountGbp: amount,
    fillPrice: price,
    reasonCode: String(formData.get('reason') ?? 'other') as ReasonCode,
    thesis: String(formData.get('thesis') ?? '').trim() || undefined,
    isOverseas: formData.get('overseas') === 'on',
    isUkShare: formData.get('ukshare') === 'on',
    proposalExpectedReturnPct: num(formData.get('expret')) / 100 || undefined,
  });
  redirect('/paper');
}

async function markAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  await markPosition((session.user as { id: string }).id, String(formData.get('id')), num(formData.get('mark')));
  redirect('/paper');
}

async function closeAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  await closePosition((session.user as { id: string }).id, String(formData.get('id')), num(formData.get('exit')));
  redirect('/paper');
}

async function deleteAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  await deletePosition((session.user as { id: string }).id, String(formData.get('id')));
  redirect('/paper');
}

async function refreshMarksAction() {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  await refreshPaperMarks((session.user as { id: string }).id);
  redirect('/paper');
}

const ASSET_CLASSES = ['developed_equity', 'emerging_equity', 'small_cap_equity', 'thematic_equity', 'reit', 'investment_grade_bond', 'gilt', 'commodity', 'crypto'];

export default async function PaperPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const positions = await listPositions(userId);
  const now = new Date();

  const valued = positions.map((p) => ({
    p,
    v: valuePosition({
      quantity: Number(p.quantity), avgFillPrice: Number(p.avgFillPrice), feesGbp: Number(p.feesGbp),
      markPrice: Number(p.markPrice ?? p.avgFillPrice), openedAt: new Date(p.openedAt), now,
      benchmarkReturnPct: p.benchmarkReturnPct != null ? Number(p.benchmarkReturnPct) : null,
    }),
  }));
  const open = valued.filter((x) => x.p.status === 'open');
  const totalMv = open.reduce((acc, x) => acc + x.v.marketValueGbp, 0);
  const totalPnl = open.reduce((acc, x) => acc + x.v.unrealisedPnlGbp, 0);
  const totalVsBench = open.reduce((acc, x) => acc + (x.v.vsBenchmarkGbp ?? 0), 0);

  return (
    <AppShell current="/paper">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="h1">Paper portfolio</h1>
          <p className="subtle mt-1 max-w-3xl">
            Simulated only — nothing here touches a broker. Open paper positions, mark them
            to market, and watch whether your picks beat the default plan. This is a decision
            journal, not a game.
          </p>
        </div>
        <form action={refreshMarksAction}><button className="btn btn-ghost" type="submit">Refresh marks</button></form>
      </div>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="card"><div className="h3">Open market value</div><div className="mt-2 text-2xl font-semibold">{gbp(totalMv)}</div></div>
        <div className="card"><div className="h3">Unrealised P&amp;L</div>
          <div className={`mt-2 text-2xl font-semibold ${totalPnl >= 0 ? 'text-ok' : 'text-bad'}`}>{gbp(totalPnl)}</div>
        </div>
        <div className="card"><div className="h3">vs default plan</div>
          <div className={`mt-2 text-2xl font-semibold ${totalVsBench >= 0 ? 'text-ok' : 'text-bad'}`}>{gbp(totalVsBench)}</div>
          <div className="mt-1 subtle">{totalVsBench >= 0 ? 'Your picks are ahead of the boring baseline.' : 'The default plan would have done better.'}</div>
        </div>
      </section>

      <section className="card mt-6">
        <div className="h2">Open a paper position</div>
        <form action={openAction} className="mt-4 grid grid-cols-12 gap-2">
          <input className="input col-span-2" name="ref" placeholder="Ticker (VWRP)" required />
          <input className="input col-span-3" name="name" placeholder="Name (optional)" />
          <select className="input col-span-2" name="asset" defaultValue="developed_equity">
            {ASSET_CLASSES.map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ')}</option>)}
          </select>
          <select className="input col-span-1" name="wrapper" defaultValue="isa">
            <option value="isa">ISA</option><option value="gia">GIA</option><option value="crypto_exchange">crypto</option>
          </select>
          <input className="input col-span-2" name="amount" type="number" min={0} step={50} placeholder="£ amount" required />
          <input className="input col-span-1" name="price" type="number" min={0} step={0.01} placeholder="price" required />
          <select className="input col-span-3" name="reason" defaultValue="diversification">
            {REASON_CODES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <input className="input col-span-1" name="expret" type="number" min={0} step={0.5} placeholder="exp %" />
          <input className="input col-span-5" name="thesis" placeholder="Thesis (why this, in one line)" />
          <label className="col-span-1 flex items-center gap-1 text-xs"><input type="checkbox" name="overseas" /> o/s</label>
          <label className="col-span-1 flex items-center gap-1 text-xs"><input type="checkbox" name="ukshare" /> UK shr</label>
          <button className="btn btn-primary col-span-1" type="submit">Open</button>
        </form>
        <p className="subtle mt-2">"exp %" = your expected annual return for this pick — used to compute the delta vs the default plan. Tick o/s for overseas (FX spread) or UK shr for stamp duty.</p>
      </section>

      <section className="mt-6">
        <div className="h2">Positions &amp; decision journal</div>
        {valued.length === 0 ? (
          <p className="subtle mt-2">No paper positions yet. Open one above to start the journal.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {valued.map(({ p, v }) => {
              const ageDays = Math.floor((now.getTime() - new Date(p.openedAt).getTime()) / 86400000);
              return (
                <div key={p.id} className="card">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-semibold">{p.instrumentRef}</span>
                    {p.instrumentName && <span className="text-sm text-muted">{p.instrumentName}</span>}
                    <span className="rounded bg-line/50 px-2 py-0.5 text-xs">{p.reasonCode}</span>
                    <span className="text-xs text-muted">{p.wrapper} · {p.assetClass.replace(/_/g, ' ')} · {ageDays}d</span>
                    {p.status === 'closed' && <span className="rounded bg-line/50 px-2 py-0.5 text-xs">closed</span>}
                    <span className={`ml-auto text-sm font-semibold ${v.unrealisedPnlGbp >= 0 ? 'text-ok' : 'text-bad'}`}>
                      {gbp(v.marketValueGbp)} ({v.unrealisedPnlGbp >= 0 ? '+' : ''}{(v.unrealisedPnlPct * 100).toFixed(1)}%)
                    </span>
                  </div>

                  {p.thesis && <p className="mt-2 text-sm text-muted">"{p.thesis}"</p>}

                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-muted md:grid-cols-4">
                    <div>Cost: {gbp(v.costGbp)}</div>
                    <div>Fill: £{Number(p.avgFillPrice).toFixed(2)} · Mark: £{Number(p.markPrice ?? p.avgFillPrice).toFixed(2)}</div>
                    {v.annualisedReturnPct != null && <div>Annualised: {(v.annualisedReturnPct * 100).toFixed(1)}%</div>}
                    {v.vsBenchmarkGbp != null && (
                      <div className={v.vsBenchmarkGbp >= 0 ? 'text-ok' : 'text-bad'}>
                        vs default: {v.vsBenchmarkGbp >= 0 ? '+' : ''}{gbp(v.vsBenchmarkGbp)}
                      </div>
                    )}
                  </div>

                  {p.status === 'open' && (
                    <div className="mt-3 flex flex-wrap items-end gap-2">
                      <form action={markAction} className="flex items-end gap-1">
                        <input type="hidden" name="id" value={p.id} />
                        <input className="input w-28" name="mark" type="number" step={0.01} placeholder="new mark" />
                        <button className="btn btn-ghost text-xs">Update mark</button>
                      </form>
                      <form action={closeAction} className="flex items-end gap-1">
                        <input type="hidden" name="id" value={p.id} />
                        <input className="input w-28" name="exit" type="number" step={0.01} placeholder="exit price" />
                        <button className="btn btn-ghost text-xs">Close</button>
                      </form>
                      <form action={deleteAction}><input type="hidden" name="id" value={p.id} /><button className="btn btn-ghost text-xs text-bad">Delete</button></form>
                    </div>
                  )}
                  {p.status === 'closed' && p.realisedPnlGbp != null && (
                    <div className={`mt-2 text-sm font-semibold ${Number(p.realisedPnlGbp) >= 0 ? 'text-ok' : 'text-bad'}`}>
                      Realised: {gbp(Number(p.realisedPnlGbp))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </AppShell>
  );
}
