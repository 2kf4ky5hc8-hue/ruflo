import { redirect } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { AppShell } from '@/components/AppShell';
import { listAccounts } from '@/services/ledger';
import { ImportClient } from './ImportClient';

export default async function ImportPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const userId = (session.user as { id: string }).id;
  const accs = await listAccounts(userId);

  return (
    <AppShell current="/import">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="h1">Import transactions</h1>
          <p className="subtle mt-1 max-w-2xl">
            Upload or paste a CSV export from your bank or broker. Supported: Monzo,
            Starling, Hargreaves Lansdown, Trading 212, and any export with Date /
            Description / Amount (or Money In / Money Out) columns.
          </p>
        </div>
        <Link className="btn btn-ghost" href="/accounts">← Accounts</Link>
      </div>

      <div className="mt-6">
        {accs.length === 0 ? (
          <div className="card">
            <p className="subtle">Add an account first on the <Link className="text-accent underline" href="/accounts">Accounts</Link> page.</p>
          </div>
        ) : (
          <ImportClient accounts={accs.map((a) => ({ id: a.id, name: a.name, type: a.type }))} />
        )}
      </div>

      <p className="subtle mt-6">
        Imported rows are marked un-reconciled so you can review them. Nothing is sent
        anywhere — parsing happens on your own server.
      </p>
    </AppShell>
  );
}
