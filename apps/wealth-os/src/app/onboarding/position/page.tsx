import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { loadSnapshot } from '@/lib/finance';
import { saveStep2 } from '@/services/onboarding';

function num(v: FormDataEntryValue | null): number {
  const n = Number(String(v ?? '0').replace(/[, ]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function submit(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  await saveStep2(userId, {
    cashGbp:                  num(formData.get('cash')),
    isaGbp:                   num(formData.get('isa')),
    giaGbp:                   num(formData.get('gia')),
    pensionGbp:               num(formData.get('pension')),
    businessCashGbp:          num(formData.get('business')),
    totalDebtGbp:             num(formData.get('debt')),
    isaDepositedThisYearGbp:  num(formData.get('isa_deposited')),
  });
  redirect('/onboarding/cashflow');
}

const FIELDS: Array<{ name: string; label: string; hint: string }> = [
  { name: 'cash',          label: 'Cash + easy access',          hint: 'Current accounts, savings — anything you can spend this week.' },
  { name: 'isa',           label: 'Stocks & Shares ISA balance', hint: 'Total value across all your ISA holdings today.' },
  { name: 'gia',           label: 'General Investment Account',  hint: 'Non-ISA brokerage account total.' },
  { name: 'pension',       label: 'Pension (SIPP/workplace)',    hint: 'Best estimate is fine.' },
  { name: 'business',      label: 'Business cash',               hint: 'Money in business accounts that belongs to your Ltd / sole trader.' },
  { name: 'debt',          label: 'Total debt (mortgage etc.)',  hint: 'Outstanding balance across mortgage, cards, loans.' },
  { name: 'isa_deposited', label: 'ISA paid in this tax year',   hint: 'Counts against your £20,000 allowance for the current year.' },
];

export default async function StepPosition() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const snap = await loadSnapshot(userId);

  const initial: Record<string, number> = {
    cash: snap.cashGbp,
    isa: snap.isaValueGbp,
    gia: snap.giaValueGbp,
    pension: snap.accountsByType['sipp'] ?? 0,
    business: snap.businessGbp,
    debt: snap.debtGbp,
    isa_deposited: snap.isa?.deposited ?? 0,
  };

  return (
    <AppShell current="/onboarding">
      <div className="max-w-3xl">
        <p className="label">Step 2 of 4</p>
        <h1 className="h1 mt-1">Where are you now?</h1>
        <p className="subtle mt-2">
          Round to the nearest hundred. We re-derive everything from connected accounts later.
        </p>

        <form action={submit} className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.name}>
              <label className="label">{f.label}</label>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-muted">£</span>
                <input className="input" name={f.name} type="number" inputMode="decimal"
                       min={0} step={50}
                       defaultValue={initial[f.name] ?? 0} />
              </div>
              <p className="mt-1 text-xs text-muted">{f.hint}</p>
            </div>
          ))}

          <div className="md:col-span-2 flex justify-between pt-2">
            <a className="btn btn-ghost" href="/onboarding">← Back</a>
            <button className="btn btn-primary" type="submit">Continue →</button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
