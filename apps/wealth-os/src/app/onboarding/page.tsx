import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { loadSnapshot } from '@/lib/finance';
import { saveStep1, type RiskChoice } from '@/services/onboarding';

const RISK_CHOICES: Array<{ id: RiskChoice; title: string; blurb: string }> = [
  {
    id: 'conservative',
    title: 'Conservative',
    blurb: '6 months cash floor · 5% single position cap · 0% crypto · no leverage. Capital preservation first.',
  },
  {
    id: 'balanced',
    title: 'Balanced',
    blurb: '3 months cash floor · 8% position cap · 2% crypto cap · 10% speculative cap. Steady compounding.',
  },
  {
    id: 'aggressive',
    title: 'Aggressive',
    blurb: '2 months cash floor · 12% position cap · 5% crypto cap · 20% speculative cap. Growth-tilted.',
  },
];

async function submitStep1(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;

  const name = String(formData.get('name') ?? '').trim();
  const choice = String(formData.get('risk') ?? '') as RiskChoice;
  if (!name || !['conservative', 'balanced', 'aggressive'].includes(choice)) {
    redirect('/onboarding?err=1');
  }
  await saveStep1(userId, { name, riskProfile: choice });
  redirect('/onboarding/position');
}

export default async function OnboardingIndex() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const snap = await loadSnapshot(userId);

  return (
    <AppShell current="/onboarding">
      <div className="max-w-3xl">
        <p className="label">Step 1 of 4</p>
        <h1 className="h1 mt-1">Tell me about you</h1>
        <p className="subtle mt-2">
          We'll capture your current position, monthly cashflow, and goals across
          three more screens. Estimates are fine — refine later in settings.
        </p>

        <form action={submitStep1} className="mt-8 space-y-6">
          <div>
            <label className="label">Display name</label>
            <input className="input mt-1" name="name" defaultValue={snap.user.name}
                   required maxLength={120} />
          </div>

          <div>
            <span className="label">Risk profile</span>
            <div className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-3">
              {RISK_CHOICES.map((c) => {
                const checked = snap.activeRiskProfile?.name === c.id;
                return (
                  <label key={c.id}
                         className={`cursor-pointer rounded-lg border p-4 ${
                           checked ? 'border-ink ring-2 ring-ink/10' : 'border-line hover:border-muted/40'
                         }`}>
                    <input type="radio" name="risk" value={c.id} defaultChecked={checked}
                           className="sr-only" required />
                    <div className="text-sm font-semibold">{c.title}</div>
                    <div className="mt-1 text-xs text-muted leading-relaxed">{c.blurb}</div>
                  </label>
                );
              })}
            </div>
            <p className="subtle mt-2">
              You can change this later. Risk caps are enforced deterministically on every
              proposed action.
            </p>
          </div>

          <div className="flex justify-end">
            <button className="btn btn-primary" type="submit">Continue →</button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
