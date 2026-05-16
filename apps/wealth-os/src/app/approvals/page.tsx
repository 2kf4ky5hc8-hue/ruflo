import { redirect } from 'next/navigation';
import { and, desc, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { db } from '@/lib/db';
import { proposedActions } from '@/db/schema/index';
import { gbp } from '@/lib/finance';

export default async function Approvals() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;

  const rows = await db.select().from(proposedActions)
    .where(and(eq(proposedActions.userId, userId), eq(proposedActions.status, 'pending')))
    .orderBy(desc(proposedActions.createdAt));

  return (
    <AppShell current="/approvals">
      <h1 className="h1">Approval Centre</h1>
      <p className="subtle mt-1">
        Proposals that pass the risk evaluator land here. Decide each one — approve,
        reject, or snooze. Nothing executes outside the system yet (MVP).
      </p>

      {rows.length === 0 ? (
        <div className="card mt-6">
          <p className="subtle">
            No proposals waiting. They'll appear here once agents start producing them.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((r) => (
            <div key={r.id} className="card">
              <div className="flex items-baseline justify-between">
                <div>
                  <div className="text-sm font-semibold capitalize">{r.kind.replace(/_/g, ' ')}</div>
                  <div className="text-xs text-muted">from {r.agent} · risk {r.riskScore}/10 · confidence {Math.round(Number(r.confidence) * 100)}%</div>
                </div>
                <div className="text-sm">
                  {r.amountAtRisk ? gbp(Number(r.amountAtRisk)) : '—'}
                </div>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm">{r.reason}</p>
              {r.upside   && <p className="mt-2 text-sm"><span className="label">Upside:</span> {r.upside}</p>}
              {r.downside && <p className="mt-1 text-sm"><span className="label">Downside:</span> {r.downside}</p>}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}
