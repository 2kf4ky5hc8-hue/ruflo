'use server';

import { auth } from '@/lib/auth';
import { detectAndParse } from '@/services/csv-import';
import { commitImportedRows } from '@/services/ledger';

export interface PreviewResult {
  ok: boolean;
  format: string;
  formatLabel: string;
  warnings: string[];
  headers: string[];
  /** Serialisable preview rows (dates as ISO strings). */
  rows: Array<{ index: number; date: string; amountGbp: number; description: string; counterparty?: string }>;
  total: number;
}

export async function previewImportAction(csvText: string): Promise<PreviewResult> {
  const session = await auth();
  if (!session?.user) return { ok: false, format: 'unauth', formatLabel: '', warnings: ['Not signed in.'], headers: [], rows: [], total: 0 };

  const parsed = detectAndParse(csvText);
  return {
    ok: parsed.rows.length > 0,
    format: parsed.format,
    formatLabel: parsed.formatLabel,
    warnings: parsed.warnings,
    headers: parsed.headers,
    rows: parsed.rows.slice(0, 50).map((r) => ({
      index: r.index,
      date: r.postedAt.toISOString().slice(0, 10),
      amountGbp: r.amountGbp,
      description: r.description,
      counterparty: r.counterparty,
    })),
    total: parsed.rows.length,
  };
}

export async function commitImportAction(
  accountId: string, csvText: string,
): Promise<{ ok: boolean; inserted: number; skipped: number; error?: string }> {
  const session = await auth();
  if (!session?.user) return { ok: false, inserted: 0, skipped: 0, error: 'Not signed in.' };
  const userId = (session.user as { id: string }).id;
  try {
    const parsed = detectAndParse(csvText);
    if (parsed.rows.length === 0) return { ok: false, inserted: 0, skipped: 0, error: 'No rows to import.' };
    const res = await commitImportedRows(userId, accountId, parsed.rows);
    return { ok: true, inserted: res.inserted, skipped: res.skipped };
  } catch (e) {
    return { ok: false, inserted: 0, skipped: 0, error: (e as Error).message };
  }
}
