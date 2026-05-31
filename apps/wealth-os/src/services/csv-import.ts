// I-101 / I-102 — CSV import for UK bank + broker statement exports.
//
// Pure, deterministic, no I/O. Parses CSV text, auto-detects the source
// format from its header row, and normalises each row into a common shape.
// The caller previews the result and commits accepted rows as transactions.

export interface ParsedRow {
  /** Row index in the source (after header), for dedupe + display. */
  index: number;
  postedAt: Date;
  /** Signed amount: positive = money in, negative = money out. */
  amountGbp: number;
  description: string;
  counterparty?: string;
  /** Raw cells kept for audit / debugging. */
  raw: Record<string, string>;
}

export interface ParseResult {
  format: string;          // detected format id
  formatLabel: string;     // human label
  rows: ParsedRow[];
  warnings: string[];
  /** Header names we found, for the manual-mapping fallback. */
  headers: string[];
}

// ── Low-level CSV parsing (RFC4180-ish: quotes, commas, escaped quotes) ────

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  // Normalise newlines.
  const s = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.some((f) => f.trim() !== '')) rows.push(row);
  }
  return rows;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseMoney(s: string | undefined): number | null {
  if (s == null) return null;
  const cleaned = s.replace(/[£$€,\s]/g, '').replace(/[()]/g, (m) => (m === '(' ? '-' : ''));
  if (cleaned === '' || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Parse a date that may be ISO, DD/MM/YYYY, or DD-MM-YYYY (UK convention).
function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const t = s.trim();
  // ISO yyyy-mm-dd[...]
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // DD/MM/YYYY or DD-MM-YYYY
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    let [, dd, mm, yy] = m;
    const year = yy!.length === 2 ? 2000 + Number(yy) : Number(yy);
    const d = new Date(Date.UTC(year, Number(mm) - 1, Number(dd)));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function norm(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function findCol(headers: string[], candidates: string[]): number {
  const normed = headers.map(norm);
  for (const cand of candidates) {
    const idx = normed.indexOf(cand);
    if (idx >= 0) return idx;
  }
  // partial contains match
  for (let i = 0; i < normed.length; i++) {
    if (candidates.some((c) => normed[i]!.includes(c))) return i;
  }
  return -1;
}

// ── Format profiles ────────────────────────────────────────────────────────

interface FormatProfile {
  id: string;
  label: string;
  /** Returns true if this profile matches the header row. */
  matches: (normedHeaders: string[]) => boolean;
  dateCols: string[];
  descCols: string[];
  counterpartyCols?: string[];
  /** Single signed amount column. */
  amountCols?: string[];
  /** Separate money-in / money-out columns (Monzo, Starling, bank exports). */
  inCols?: string[];
  outCols?: string[];
}

const PROFILES: FormatProfile[] = [
  {
    id: 'monzo', label: 'Monzo',
    matches: (h) => h.includes('transaction_id') && h.includes('amount') && h.includes('category'),
    dateCols: ['date'], descCols: ['name', 'description', 'notes_tags'], counterpartyCols: ['name'],
    amountCols: ['amount'],
  },
  {
    id: 'starling', label: 'Starling',
    matches: (h) => h.includes('counter_party') && (h.includes('amount_gbp') || h.includes('amount')),
    dateCols: ['date'], descCols: ['reference', 'counter_party'], counterpartyCols: ['counter_party'],
    amountCols: ['amount_gbp', 'amount'],
  },
  {
    id: 'trading212', label: 'Trading 212',
    matches: (h) => h.includes('action') && h.includes('ticker') && (h.includes('total') || h.includes('total_gbp')),
    dateCols: ['time', 'date'], descCols: ['action', 'ticker', 'name'], counterpartyCols: ['name', 'ticker'],
    amountCols: ['total', 'total_gbp'],
  },
  {
    id: 'hl', label: 'Hargreaves Lansdown',
    matches: (h) => (h.includes('trade_date') || h.includes('date')) && h.includes('description') && (h.includes('debit') || h.includes('credit')),
    dateCols: ['trade_date', 'date'], descCols: ['description'],
    inCols: ['credit', 'paid_in'], outCols: ['debit', 'paid_out'],
  },
  {
    id: 'generic_inout', label: 'Generic (money in / out columns)',
    matches: (h) => (h.includes('money_in') || h.includes('paid_in') || h.includes('credit'))
                 && (h.includes('money_out') || h.includes('paid_out') || h.includes('debit')),
    dateCols: ['date', 'transaction_date', 'posted_date'], descCols: ['description', 'reference', 'details', 'narrative'],
    inCols: ['money_in', 'paid_in', 'credit'], outCols: ['money_out', 'paid_out', 'debit'],
  },
  {
    id: 'generic_signed', label: 'Generic (single amount column)',
    matches: (h) => (h.includes('date')) && (h.includes('amount') || h.includes('value')),
    dateCols: ['date', 'transaction_date', 'posted_date'], descCols: ['description', 'reference', 'details', 'narrative', 'memo'],
    amountCols: ['amount', 'value'],
  },
];

// ── Public API ───────────────────────────────────────────────────────────

export function detectAndParse(text: string): ParseResult {
  const grid = parseCsv(text);
  if (grid.length === 0) {
    return { format: 'empty', formatLabel: 'Empty file', rows: [], warnings: ['No rows found.'], headers: [] };
  }
  const headers = grid[0]!;
  const normed = headers.map(norm);
  const profile = PROFILES.find((p) => p.matches(normed));

  if (!profile) {
    return {
      format: 'unknown', formatLabel: 'Unrecognised',
      rows: [], headers,
      warnings: ['Could not auto-detect the format. Use manual column mapping.'],
    };
  }

  const dateIdx = findCol(headers, profile.dateCols);
  const descIdx = findCol(headers, profile.descCols);
  const cpIdx = profile.counterpartyCols ? findCol(headers, profile.counterpartyCols) : -1;
  const amtIdx = profile.amountCols ? findCol(headers, profile.amountCols) : -1;
  const inIdx = profile.inCols ? findCol(headers, profile.inCols) : -1;
  const outIdx = profile.outCols ? findCol(headers, profile.outCols) : -1;

  const warnings: string[] = [];
  if (dateIdx < 0) warnings.push('Could not find a date column.');
  if (amtIdx < 0 && inIdx < 0 && outIdx < 0) warnings.push('Could not find an amount column.');

  const rows: ParsedRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r]!;
    const date = parseDate(cells[dateIdx]);
    if (!date) continue;

    let amount: number | null = null;
    if (amtIdx >= 0) {
      amount = parseMoney(cells[amtIdx]);
    } else {
      const inV = inIdx >= 0 ? (parseMoney(cells[inIdx]) ?? 0) : 0;
      const outV = outIdx >= 0 ? (parseMoney(cells[outIdx]) ?? 0) : 0;
      amount = inV - Math.abs(outV);
    }
    if (amount == null) continue;

    const raw: Record<string, string> = {};
    headers.forEach((h, i) => { raw[h] = cells[i] ?? ''; });

    rows.push({
      index: r - 1,
      postedAt: date,
      amountGbp: amount,
      description: (descIdx >= 0 ? cells[descIdx] : '')?.trim() || '(no description)',
      counterparty: cpIdx >= 0 ? cells[cpIdx]?.trim() : undefined,
      raw,
    });
  }

  if (rows.length === 0) warnings.push('No valid rows parsed (check date/amount columns).');

  return { format: profile.id, formatLabel: profile.label, rows, warnings, headers };
}

// Dedupe key for I-108-style duplicate detection within a single import.
export function rowKey(accountId: string, r: ParsedRow): string {
  return `${accountId}|${r.postedAt.toISOString().slice(0, 10)}|${r.amountGbp.toFixed(2)}|${(r.counterparty ?? r.description).slice(0, 40)}`;
}
