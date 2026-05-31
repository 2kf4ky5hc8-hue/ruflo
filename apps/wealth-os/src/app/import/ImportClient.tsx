'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { previewImportAction, commitImportAction, type PreviewResult } from './actions';

interface Account { id: string; name: string; type: string; }

function gbp(n: number): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(n);
}

export function ImportClient({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [csv, setCsv] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [committed, setCommitted] = useState<{ inserted: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setPreview(null);
    setCommitted(null);
  }

  function doPreview() {
    setError(null);
    setCommitted(null);
    start(async () => {
      const res = await previewImportAction(csv);
      setPreview(res);
    });
  }

  function doCommit() {
    setError(null);
    start(async () => {
      const res = await commitImportAction(accountId, csv);
      if (res.ok) {
        setCommitted({ inserted: res.inserted });
        setPreview(null);
        setCsv('');
        router.refresh();
      } else {
        setError(res.error ?? 'Import failed.');
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="h2">1. Choose account &amp; paste / upload CSV</div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <select className="input w-64" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="text-sm" />
        </div>
        <textarea
          className="input mt-3 h-40 font-mono text-xs"
          placeholder="…or paste CSV content here (Monzo, Starling, HL, Trading 212, or any Date/Description/Amount export)"
          value={csv}
          onChange={(e) => { setCsv(e.target.value); setPreview(null); setCommitted(null); }}
        />
        <div className="mt-3 flex gap-2">
          <button className="btn btn-primary" onClick={doPreview} disabled={pending || !csv.trim()}>
            {pending ? 'Working…' : 'Preview'}
          </button>
        </div>
      </div>

      {committed && (
        <div className="card border-ok/40 bg-ok/5">
          <p className="text-sm text-ok">Imported {committed.inserted} transactions. They're marked un-reconciled — review them on the Accounts page.</p>
        </div>
      )}

      {error && (
        <div className="card border-bad/40 bg-bad/5"><p className="text-sm text-bad">{error}</p></div>
      )}

      {preview && (
        <div className="card">
          <div className="flex items-center justify-between">
            <div className="h2">2. Preview — {preview.formatLabel}</div>
            <span className="text-sm text-muted">{preview.total} rows detected</span>
          </div>

          {preview.warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {preview.warnings.map((w, i) => <li key={i} className="text-sm text-warn">⚠ {w}</li>)}
            </ul>
          )}

          {preview.format === 'unknown' && (
            <p className="mt-2 text-sm text-muted">
              Headers found: {preview.headers.join(', ')}. Re-export with a Date, Description and Amount
              (or Money In / Money Out) column, or use a supported format.
            </p>
          )}

          {preview.rows.length > 0 && (
            <>
              <div className="mt-3 max-h-80 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted">
                    <tr><th className="py-1">Date</th><th>Description</th><th className="text-right">Amount</th></tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.index} className="border-t border-line">
                        <td className="py-1 text-xs text-muted">{r.date}</td>
                        <td>{r.description}</td>
                        <td className={`text-right ${r.amountGbp >= 0 ? 'text-ok' : ''}`}>
                          {r.amountGbp >= 0 ? '+' : ''}{gbp(r.amountGbp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.total > preview.rows.length && (
                  <p className="mt-2 text-xs text-muted">Showing first {preview.rows.length} of {preview.total}.</p>
                )}
              </div>
              <div className="mt-3">
                <button className="btn btn-primary" onClick={doCommit} disabled={pending}>
                  {pending ? 'Importing…' : `Import ${preview.total} transactions`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
