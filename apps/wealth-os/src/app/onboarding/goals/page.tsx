import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { loadSnapshot } from '@/lib/finance';
import { saveStep4, markOnboarded } from '@/services/onboarding';
import { generatePlaybook } from '@/services/playbook';

const SUGGESTED = [
  { name: 'Emergency fund (6 months)', category: 'emergency_fund', target: 12000 },
  { name: 'House deposit',              category: 'property',       target: 50000 },
  { name: 'Hit £100k invested',         category: 'milestone',      target: 100000 },
];

async function submit(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;

  const goals: Array<{ name: string; targetGbp: number; targetIsoDate?: string; category: string }> = [];
  for (let i = 0; i < 6; i++) {
    const name = String(formData.get(`name_${i}`) ?? '').trim();
    const tgt  = Number(String(formData.get(`target_${i}`) ?? '0').replace(/[, ]/g, ''));
    const date = String(formData.get(`date_${i}`) ?? '').trim();
    const cat  = String(formData.get(`cat_${i}`) ?? 'milestone');
    if (name && tgt > 0) {
      goals.push({ name, targetGbp: tgt, targetIsoDate: date || undefined, category: cat });
    }
  }
  await saveStep4(userId, { goals });
  await markOnboarded(userId);

  // WC-1202: generate playbook from the freshly-saved data.
  await generatePlaybook(userId);

  redirect('/playbook');
}

export default async function StepGoals() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const snap = await loadSnapshot(userId);
  const existing = snap.goals.length > 0
    ? snap.goals.map((g) => ({ name: g.name, target: g.target, category: 'milestone', date: g.targetDate?.toISOString().slice(0, 10) ?? '' }))
    : SUGGESTED.map((s) => ({ name: s.name, target: s.target, category: s.category, date: '' }));

  const rows = Array.from({ length: 6 }, (_, i) => existing[i] ?? { name: '', target: 0, category: 'milestone', date: '' });

  return (
    <AppShell current="/onboarding">
      <div className="max-w-3xl">
        <p className="label">Step 4 of 4</p>
        <h1 className="h1 mt-1">Goals</h1>
        <p className="subtle mt-2">
          Up to six. Anything you'd celebrate hitting. The Coach uses these to size each
          recommendation.
        </p>

        <form action={submit} className="mt-8 space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input className="input col-span-5" name={`name_${i}`} placeholder="Goal name" defaultValue={r.name} />
              <input className="input col-span-3" name={`target_${i}`} type="number" min={0} step={500}
                     placeholder="£ target" defaultValue={r.target || ''} />
              <input className="input col-span-2" name={`date_${i}`} type="date" defaultValue={r.date} />
              <select className="input col-span-2" name={`cat_${i}`} defaultValue={r.category}>
                <option value="emergency_fund">Emergency</option>
                <option value="property">Property</option>
                <option value="milestone">Milestone</option>
                <option value="retirement">Retirement</option>
                <option value="business">Business</option>
                <option value="other">Other</option>
              </select>
            </div>
          ))}

          <div className="flex justify-between pt-4">
            <a className="btn btn-ghost" href="/onboarding/cashflow">← Back</a>
            <button className="btn btn-primary" type="submit">Finish &amp; generate playbook</button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
