import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { gbp, loadSnapshot } from '@/lib/finance';
import { listHoldings } from '@/services/ledger';
import { latestPrices, refreshUserPrices } from '@/services/prices';
import {
  valuePortfolio, concentrationBreaches, tagExposure, computeRiskStatus,
  type PositionInput, type RiskBannerStatus,
} from '@/services/portfolio-risk';
import { takeSnapshot, currentDrawdown } from '@/services/portfolio-snapshots';
import { db } from '@/lib/db';
import { riskProfiles } from '@/db/schema/index';
import { and, eq } from 'drizzle-orm';

async function refreshAndSnapshot() {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  await refreshUserPrices(userId);
  await takeSnapshot(userId, { force: true, source: 'user_refresh' });
  redirect('/risk');
}

const BANNER: Record<RiskBannerStatus, { label: string; bg: string; ring: string; text: string }> = {
  clear:   { label: 'Clear',   bg: 'bg-ok/10',   ring: 'border-ok/40',   text: 'text-ok'   },
  caution: { label: 'Caution', bg: 'bg-warn/10', ring: 'border-warn/40', text: 'text-warn' },
  blocked: { label: 'Blocked', bg: 'bg-bad/10',  ring: 'border-bad/40',  text: 'text-bad'  },
};

export default async function RiskPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;

  // Take a soft snapshot if it's been > 1 hour since the last one.
  await takeSnapshot(userId, { source: 'page_view' });

  const snap = await loadSnapshot(userId);
  const holdRows = await listHoldings(userId);
  const priceMap = await latestPrices(holdRows.map((r) => r.holding.instrumentId));

  const positions: PositionInput[] = holdRows.map((r) => {
    const px = priceMap.get(r.holding.instrumentId);
    return {
      id: r.holding.id,
      label: r.instrument.ticker ?? r.instrument.isin ?? r.instrument.name,
      accountName: r.account?.name,
      quantity: Number(r.holding.quantity),
      avgCostGbp: Number(r.holding.avgCost ?? 0),
      marketPrice: px?.price ?? null,
      tags: r.holding.tags as string[],
    };
  });

  const valuation = valuePortfolio(positions);
  const [profile] = await db.select().from(riskProfiles)
    .where(and(eq(riskProfiles.userId, userId), eq(riskProfiles.active, true))).limit(1);
  const positionCap = Number(profile?.maxSinglePositionPct ?? 0.10);
  const ddCaution = Number(profile?.drawdownCautionPct ?? 0.10);
  const ddBlock = Number(profile?.drawdownBlockPct ?? 0.20);

  const breaches = concentrationBreaches(valuation.positions, positionCap);
  const exposures = tagExposure(valuation.positions);

  const dd = await currentDrawdown(userId, 90);
  const cashFloor = (snap.activeRiskProfile?.cashFloorMonths ?? 3) * snap.monthlyExpensesGbp;

  const status = computeRiskStatus({
    concentrationBreaches: breaches,
    drawdownPct: dd?.drawdownPct ?? 0,
    drawdownCautionPct: ddCaution,
    drawdownBlockPct: ddBlock,
    cashBufferGbp: snap.cashGbp,
    cashFloorGbp: cashFloor,
    toxicDebtCount: snap.toxicDebtCount,
    businessObligationsDue90dGbp: snap.business.obligationsDue90dGbp,
    businessCashGbp: snap.business.cashGbp,
  });

  const banner = BANNER[status.status];

  return (
    <AppShell current="/risk">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="h1">Portfolio risk dashboard</h1>
          <p className="subtle mt-1 max-w-3xl">
            Live concentration, drawdown, and balance-sheet signals. The risk engine
            uses the same inputs to gate every proposed action.
          </p>
        </div>
        <form action={refreshAndSnapshot}>
          <button className="btn btn-ghost" type="submit">Refresh &amp; snapshot</button>
        </form>
      </div>

      <section className={`card mt-6 border ${banner.ring} ${banner.bg}`}>
        <div className="flex items-center gap-3">
          <span className={`rounded px-2 py-1 text-xs font-semibold uppercase tracking-wide ${banner.text}`}>{banner.label}</span>
          <span className="text-sm font-medium">{status.headline}</span>
        </div>
        {status.reasons.length > 0 && (
          <ul className="mt-3 space-y-1">
            {status.reasons.map((r, i) => (
              <li key={i} className={`text-sm ${r.severity === 'block' ? 'text-bad' : 'text-warn'}`}>
                <span className="font-mono text-xs uppercase tracking-wide">[{r.severity}]</span> {r.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
        <div className="card">
          <div className="h3">Market value</div>
          <div className="mt-2 text-2xl font-semibold">{gbp(valuation.totalMvGbp)}</div>
          <div className="mt-1 subtle">
            {valuation.pricedCount} priced{valuation.unpricedCount > 0 && ` · ${valuation.unpricedCount} unpriced`}
          </div>
        </div>
        <div className="card">
          <div className="h3">Unrealised P&amp;L</div>
          <div className={`mt-2 text-2xl font-semibold ${valuation.totalUnrealisedPnlGbp >= 0 ? 'text-ok' : 'text-bad'}`}>
            {gbp(valuation.totalUnrealisedPnlGbp)}
          </div>
          <div className="mt-1 subtle">vs book value {gbp(valuation.totalBookGbp)}</div>
        </div>
        <div className="card">
          <div className="h3">High-water mark</div>
          <div className="mt-2 text-2xl font-semibold">{gbp(dd?.highWaterMarkGbp ?? valuation.totalMvGbp + snap.cashGbp)}</div>
          <div className="mt-1 subtle">{dd ? `${dd.daysSinceHwm}d since` : 'first snapshot'}</div>
        </div>
        <div className="card">
          <div className="h3">Drawdown</div>
          <div className={`mt-2 text-2xl font-semibold ${(dd?.drawdownPct ?? 0) >= ddCaution ? 'text-warn' : 'text-ok'}`}>
            {((dd?.drawdownPct ?? 0) * 100).toFixed(1)}%
          </div>
          <div className="mt-1 subtle">caution {(ddCaution * 100).toFixed(0)}% · block {(ddBlock * 100).toFixed(0)}%</div>
        </div>
      </section>

      <section className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <div className="h2">Top concentrations</div>
          <p className="subtle mt-1">Single-position cap {(positionCap * 100).toFixed(0)}% of portfolio.</p>
          {valuation.positions.length === 0 ? (
            <p className="subtle mt-3">No holdings yet. <Link className="text-accent underline" href="/holdings">Add some →</Link></p>
          ) : (
            <div className="mt-3 space-y-2">
              {valuation.positions.slice(0, 10).map((p) => {
                const over = p.weightPct > positionCap;
                const near = !over && p.weightPct > positionCap * 0.9;
                const barColour = over ? 'bg-bad' : near ? 'bg-warn' : 'bg-ink';
                return (
                  <div key={p.id}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-medium">{p.label}</span>
                      <span className={`text-xs ${over ? 'text-bad' : near ? 'text-warn' : 'text-muted'}`}>
                        {(p.weightPct * 100).toFixed(1)}% · {gbp(p.marketValueGbp)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full rounded-full bg-line/60">
                      <div className={`h-1.5 rounded-full ${barColour}`} style={{ width: `${Math.min(100, p.weightPct * 100 / positionCap * 100 / 100 * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <div className="h2">Exposure by tag</div>
          <p className="subtle mt-1">Set tags on each holding to group exposure by asset shape, region, or theme.</p>
          {exposures.length === 0 ? (
            <p className="subtle mt-3">No holdings to aggregate.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {exposures.map((e) => (
                <div key={e.tag}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="font-medium">{e.tag === '_untagged' ? 'Untagged' : e.tag}</span>
                    <span className="text-xs text-muted">{(e.weightPct * 100).toFixed(1)}% · {gbp(e.marketValueGbp)} · {e.positionCount} pos</span>
                  </div>
                  <div className="mt-1 h-1.5 w-full rounded-full bg-line/60">
                    <div className={`h-1.5 rounded-full ${e.tag === '_untagged' ? 'bg-muted' : 'bg-accent'}`} style={{ width: `${e.weightPct * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="subtle mt-3">Edit tags on <Link className="text-accent underline" href="/holdings">Holdings</Link>.</p>
        </div>
      </section>

      <section className="mt-6 card">
        <div className="h2">Snapshot history (90 days)</div>
        <p className="subtle mt-1">Each "Refresh &amp; snapshot" writes a row. The dashboard auto-snapshots once an hour on view.</p>
        {!dd ? (
          <p className="subtle mt-3">No snapshots yet — hit "Refresh &amp; snapshot".</p>
        ) : (
          <p className="mt-3 text-sm">
            High-water mark <span className="font-semibold">{gbp(dd.highWaterMarkGbp)}</span>,
            current <span className="font-semibold">{gbp(dd.currentMvGbp)}</span>,
            drawdown <span className="font-semibold">{(dd.drawdownPct * 100).toFixed(1)}%</span>
            {' '}({dd.daysSinceHwm}d since HWM).
          </p>
        )}
      </section>
    </AppShell>
  );
}
