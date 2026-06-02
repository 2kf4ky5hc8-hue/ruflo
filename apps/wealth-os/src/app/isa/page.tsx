import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { gbp } from '@/lib/finance';
import { listAccounts } from '@/services/ledger';
import {
  recordIsaMovement, getIsaUsageForUser, listIsaMovements, deleteIsaMovement,
  ISA_DEPOSIT_KINDS, type IsaDepositKind,
} from '@/services/isa-tracking';
import { deriveWrapper, WRAPPER_LABELS } from '@/services/account-wrappers';
import { currentUkTaxYear, formatUkTaxYear } from '@/services/uk-tax-year';

function num(v: FormDataEntryValue | null): number {
  const n = Number(String(v ?? '0').replace(/[, £]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function recordAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const accountId = String(formData.get('account'));
  const amount = num(formData.get('amount'));
  const kind = String(formData.get('kind') ?? 'contribution') as IsaDepositKind;
  const note = String(formData.get('note') ?? '').trim() || undefined;
  const date = String(formData.get('date') ?? '').trim();
  if (!accountId || amount <= 0) redirect('/isa?err=1');
  await recordIsaMovement({
    userId, accountId, amountGbp: amount, kind, note,
    depositedAt: date ? new Date(date) : undefined,
  });
  redirect('/isa');
}

async function deleteAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  await deleteIsaMovement((session.user as { id: string }).id, String(formData.get('id')));
  redirect('/isa');
}

const KIND_LABEL: Record<IsaDepositKind, string> = {
  contribution: 'Contribution (counts)',
  transfer_in:  'Transfer in (doesn\'t count)',
  transfer_out: 'Transfer out (doesn\'t count)',
  withdrawal:   'Withdrawal',
};

const STATUS_STYLE: Record<'ok' | 'warn' | 'over', { bar: string; pill: string; bg: string }> = {
  ok:   { bar: 'bg-ok',   pill: 'text-ok',   bg: 'bg-ok/5'   },
  warn: { bar: 'bg-warn', pill: 'text-warn', bg: 'bg-warn/5' },
  over: { bar: 'bg-bad',  pill: 'text-bad',  bg: 'bg-bad/5'  },
};

export default async function IsaPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;

  const allAccs = await listAccounts(userId);
  const isaAccounts = allAccs.filter((a) => {
    const w = deriveWrapper({ type: a.type, isaType: a.isaType });
    return w === 'stocks_and_shares_isa' || w === 'cash_isa';
  });

  const taxYear = currentUkTaxYear();
  const usage = await getIsaUsageForUser(userId, taxYear);
  const movements = await listIsaMovements(userId, taxYear);
  const style = STATUS_STYLE[usage.status];

  // Per-account breakdown (current year).
  const perAccount = new Map<string, { name: string; wrapper: string; contributionsGbp: number; movements: number }>();
  for (const a of isaAccounts) {
    const w = deriveWrapper({ type: a.type, isaType: a.isaType })!;
    perAccount.set(a.id, { name: a.name, wrapper: WRAPPER_LABELS[w], contributionsGbp: 0, movements: 0 });
  }
  for (const m of movements) {
    const e = perAccount.get(m.accountId);
    if (!e) continue;
    e.movements += 1;
    if (m.kind === 'contribution') e.contributionsGbp += m.amountGbp;
  }

  return (
    <AppShell current="/isa">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="h1">ISA tracker</h1>
          <p className="subtle mt-1">
            UK tax year <span className="font-medium">{usage.taxYearLabel}</span> ·
            {' '}{usage.daysRemaining} day{usage.daysRemaining === 1 ? '' : 's'} until 5 April{' '}
            <span className="text-muted">(tax year-end)</span>.
            {' '}Allowance covers <em>Stocks &amp; Shares</em> and <em>Cash</em> ISA subscriptions combined.
          </p>
        </div>
      </div>

      <section className={`card mt-6 border ${usage.status === 'ok' ? 'border-line' : usage.status === 'warn' ? 'border-warn/40' : 'border-bad/40'} ${style.bg}`}>
        <div className="flex items-baseline justify-between">
          <div>
            <div className="h3">Allowance used</div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={`text-3xl font-semibold ${style.pill}`}>{gbp(usage.usedGbp)}</span>
              <span className="text-muted">of {gbp(usage.allowanceGbp)}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="h3">Remaining</div>
            <div className="mt-2 text-2xl font-semibold">{gbp(usage.remainingGbp)}</div>
          </div>
        </div>

        <div className="mt-4 h-3 w-full rounded-full bg-line/60">
          <div className={`h-3 rounded-full ${style.bar}`}
               style={{ width: `${Math.min(100, usage.utilisationPct * 100)}%` }} />
        </div>
        <p className="mt-3 text-sm text-muted">
          Contributions £{usage.contributionsGbp.toLocaleString('en-GB')} ·
          {' '}Transfers in £{usage.transfersInGbp.toLocaleString('en-GB')} (not counted) ·
          {' '}Withdrawals £{usage.withdrawalsGbp.toLocaleString('en-GB')}
          {usage.flexibleWithdrawalsGbp > 0 && (
            <> (£{usage.flexibleWithdrawalsGbp.toLocaleString('en-GB')} flexible — restores allowance)</>
          )}.
        </p>

        {usage.status === 'warn' && (
          <p className={`mt-3 text-sm ${style.pill}`}>
            ⚠ Approaching the £{usage.allowanceGbp.toLocaleString('en-GB')} cap. Be careful with further contributions —
            any over-subscription is recoverable but a hassle to fix with HMRC.
          </p>
        )}
        {usage.status === 'over' && (
          <p className={`mt-3 text-sm ${style.pill}`}>
            ⚠ You have <strong>exceeded</strong> the {formatUkTaxYear(taxYear)} allowance by
            {' '}<strong>{gbp(usage.usedGbp - usage.allowanceGbp)}</strong>. Contact HMRC or your ISA provider
            about correcting the over-subscription.
          </p>
        )}
      </section>

      <section className="card mt-6">
        <div className="h2">Per-account breakdown ({usage.taxYearLabel})</div>
        {perAccount.size === 0 ? (
          <p className="subtle mt-2">
            No ISA accounts yet. Add a Stocks &amp; Shares ISA or Cash ISA on the
            {' '}<Link className="text-accent underline" href="/accounts">Accounts</Link> page.
          </p>
        ) : (
          <div className="mt-3 space-y-1">
            {[...perAccount.values()].map((a) => (
              <div key={a.name} className="card flex items-center gap-3 py-2">
                <span className="w-48 text-sm font-medium">{a.name}</span>
                <span className="flex-1 text-xs text-muted">{a.wrapper}</span>
                <span className="text-xs text-muted">{a.movements} movement{a.movements === 1 ? '' : 's'}</span>
                <span className="w-32 text-right text-sm font-semibold">{gbp(a.contributionsGbp)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card mt-6">
        <div className="h2">Record an ISA movement</div>
        {isaAccounts.length === 0 ? (
          <p className="subtle mt-2">
            Add at least one ISA account first via <Link className="text-accent underline" href="/accounts">Accounts</Link>.
          </p>
        ) : (
          <form action={recordAction} className="mt-4 grid grid-cols-12 gap-2">
            <select className="input col-span-3" name="account" required>
              {isaAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.isFlexible ? ' (flexible)' : ''}
                </option>
              ))}
            </select>
            <select className="input col-span-3" name="kind" defaultValue="contribution">
              {ISA_DEPOSIT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <input className="input col-span-2" name="amount" type="number" min={0} step={50} placeholder="£ amount" required />
            <input className="input col-span-2" name="date" type="date" />
            <input className="input col-span-2" name="note" placeholder="Note (optional)" />
            <div className="col-span-12 flex justify-end">
              <button className="btn btn-primary" type="submit">Record movement</button>
            </div>
          </form>
        )}
        <p className="subtle mt-3">
          <strong>Contributions</strong> count against the £20,000 annual allowance.{' '}
          <strong>Transfers</strong> between providers <em>do not</em>.{' '}
          <strong>Withdrawals</strong> only restore allowance if the account is marked as a flexible ISA.
        </p>
      </section>

      <section className="mt-6">
        <div className="h2">Movements this tax year ({movements.length})</div>
        {movements.length === 0 ? (
          <p className="subtle mt-2">No movements recorded yet for {usage.taxYearLabel}.</p>
        ) : (
          <div className="mt-3 space-y-1">
            {[...movements].reverse().map((m) => {
              const colour = m.kind === 'contribution' ? 'text-bad'
                          : m.kind === 'withdrawal' ? 'text-ok'
                          : 'text-muted';
              const sign = m.kind === 'contribution' || m.kind === 'transfer_in' ? '+'
                        : m.kind === 'withdrawal' || m.kind === 'transfer_out' ? '−'
                        : '';
              return (
                <div key={m.id} className="card flex items-center gap-3 py-2">
                  <span className="w-24 text-xs text-muted">{m.depositedAt.toLocaleDateString('en-GB')}</span>
                  <span className="w-48 text-sm">{m.accountName}{m.accountIsFlexible ? ' (flex)' : ''}</span>
                  <span className="w-40 text-xs text-muted">{KIND_LABEL[m.kind]}</span>
                  <span className="flex-1 text-xs text-muted">{m.note ?? ''}</span>
                  <span className={`w-28 text-right text-sm font-semibold ${colour}`}>
                    {sign}{gbp(m.amountGbp)}
                  </span>
                  <form action={deleteAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <button className="text-xs text-muted hover:text-bad">✕</button>
                  </form>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="subtle mt-6">
        Reminder: ISA rules and the £20,000 allowance apply per UK tax year. Withdrawals only restore allowance
        in a <em>flexible</em> ISA (and only within the same tax year). Not regulated financial advice.
      </p>
    </AppShell>
  );
}
