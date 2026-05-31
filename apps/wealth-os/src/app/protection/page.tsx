import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { gbp } from '@/lib/finance';
import {
  addInsurance, listInsurance, setInsuranceStatus, analyseProtectionGaps,
  listBusinesses, INSURANCE_KINDS, type InsuranceKind,
} from '@/services/balance-sheet';

function num(v: FormDataEntryValue | null): number {
  const n = Number(String(v ?? '0').replace(/[, £]/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

async function addAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  await addInsurance(userId, {
    kind: String(formData.get('kind') ?? 'life') as InsuranceKind,
    provider: String(formData.get('provider') ?? '').trim() || undefined,
    coverAmountGbp: num(formData.get('cover')) || undefined,
    monthlyPremiumGbp: num(formData.get('premium')) || undefined,
    renewalDateIso: String(formData.get('renewal') ?? '').trim() || undefined,
  });
  redirect('/protection');
}

async function lapseAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  await setInsuranceStatus((session.user as { id: string }).id, String(formData.get('id')), 'lapsed');
  redirect('/protection');
}

const KIND_LABEL: Record<string, string> = {
  life: 'Life', income_protection: 'Income protection', critical_illness: 'Critical illness',
  private_medical: 'Private medical', home_contents: 'Home contents', home_buildings: 'Home buildings',
  travel: 'Travel', business_liability: 'Business liability', employers_liability: "Employer's liability",
  key_person: 'Key person', professional_indemnity: 'Professional indemnity', will: 'Will', lpa: 'LPA',
};

export default async function ProtectionPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const policies = await listInsurance(userId);
  const businesses = await listBusinesses(userId);
  const active = policies.filter((p) => p.status === 'active');

  const gaps = analyseProtectionGaps({
    hasLife: active.some((p) => p.kind === 'life'),
    hasIncomeProtection: active.some((p) => p.kind === 'income_protection'),
    hasWill: active.some((p) => p.kind === 'will'),
    isBusinessOwner: businesses.length > 0,
    hasDependants: false, // not yet captured in onboarding — conservative default
  });

  return (
    <AppShell current="/protection">
      <h1 className="h1">Protection</h1>
      <p className="subtle mt-1">
        Not sexy, very wealth-preserving. Cover protects the contributions that drive
        compounding from a single bad year.
      </p>

      {gaps.length > 0 && (
        <section className="card mt-6 border-warn/40 bg-warn/5">
          <div className="h2">Gaps worth closing</div>
          <ul className="mt-3 space-y-2">
            {gaps.map((g) => (
              <li key={g.kind} className="text-sm">
                <span className={`font-semibold ${g.severity === 'warn' ? 'text-warn' : 'text-muted'}`}>
                  {KIND_LABEL[g.kind] ?? g.kind}:
                </span>{' '}
                {g.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card mt-6">
        <div className="h2">Add a policy</div>
        <form action={addAction} className="mt-4 grid grid-cols-12 gap-2">
          <select className="input col-span-3" name="kind" defaultValue="income_protection">
            {INSURANCE_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <input className="input col-span-3" name="provider" placeholder="Provider (optional)" />
          <input className="input col-span-2" name="cover" type="number" min={0} step={1000} placeholder="£ cover" />
          <input className="input col-span-2" name="premium" type="number" min={0} step={5} placeholder="£/mo" />
          <input className="input col-span-1" name="renewal" type="date" />
          <button className="btn btn-primary col-span-1" type="submit">Add</button>
        </form>
        <p className="subtle mt-2">Will and LPA are tracked here too — add them as policy kinds.</p>
      </section>

      <section className="mt-6">
        <div className="h2">Active cover</div>
        {active.length === 0 ? (
          <p className="subtle mt-2">No active policies recorded.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {active.map((p) => (
              <div key={p.id} className="card flex items-center gap-4 py-3">
                <div className="w-44 text-sm font-medium">{KIND_LABEL[p.kind] ?? p.kind}</div>
                <div className="flex-1 text-sm text-muted">{p.provider ?? '—'}</div>
                <div className="text-sm">{p.coverAmountGbp ? `${gbp(Number(p.coverAmountGbp))} cover` : '—'}</div>
                <div className="text-sm">{p.monthlyPremiumGbp ? `${gbp(Number(p.monthlyPremiumGbp))}/mo` : ''}</div>
                <div className="text-sm text-muted">{p.renewalDate ? `renews ${new Date(p.renewalDate).toLocaleDateString('en-GB')}` : ''}</div>
                <form action={lapseAction}><input type="hidden" name="id" value={p.id} /><button className="btn btn-ghost text-xs">Mark lapsed</button></form>
              </div>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}
