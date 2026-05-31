import { describe, it, expect } from 'vitest';
import { parseCsv, detectAndParse, rowKey } from './csv-import';

describe('parseCsv', () => {
  it('handles quoted fields with commas and escaped quotes', () => {
    const grid = parseCsv('a,b,c\n"hello, world","he said ""hi""",3\n');
    expect(grid).toEqual([
      ['a', 'b', 'c'],
      ['hello, world', 'he said "hi"', '3'],
    ]);
  });

  it('skips blank lines', () => {
    const grid = parseCsv('a,b\n\n1,2\n\n');
    expect(grid).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('handles CRLF line endings', () => {
    const grid = parseCsv('a,b\r\n1,2\r\n');
    expect(grid).toEqual([['a', 'b'], ['1', '2']]);
  });
});

describe('detectAndParse — Monzo', () => {
  const csv = [
    'Transaction ID,Date,Time,Name,Category,Amount,Notes and #tags',
    'tx_001,15/05/2026,09:30,Tesco,Groceries,-23.50,weekly shop',
    'tx_002,16/05/2026,12:00,Salary Ltd,Income,2500.00,May salary',
  ].join('\n');

  it('detects Monzo and parses signed amounts', () => {
    const r = detectAndParse(csv);
    expect(r.format).toBe('monzo');
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]!.amountGbp).toBe(-23.5);
    expect(r.rows[1]!.amountGbp).toBe(2500);
    expect(r.rows[0]!.description).toBe('Tesco');
  });

  it('parses UK DD/MM/YYYY dates correctly', () => {
    const r = detectAndParse(csv);
    // 15/05/2026 → 15 May
    expect(r.rows[0]!.postedAt.getUTCMonth()).toBe(4); // May = 4
    expect(r.rows[0]!.postedAt.getUTCDate()).toBe(15);
  });
});

describe('detectAndParse — generic money-in/out', () => {
  const csv = [
    'Date,Description,Money In,Money Out,Balance',
    '2026-05-01,Opening,1000.00,,1000.00',
    '2026-05-02,Rent,,750.00,250.00',
  ].join('\n');

  it('computes signed amount from separate in/out columns', () => {
    const r = detectAndParse(csv);
    expect(r.format).toBe('generic_inout');
    expect(r.rows[0]!.amountGbp).toBe(1000);
    expect(r.rows[1]!.amountGbp).toBe(-750);
  });
});

describe('detectAndParse — generic signed amount', () => {
  const csv = [
    'Date,Description,Amount',
    '2026-05-01,Dividend,£42.10',
    '2026-05-02,Fee,(£1.50)',
  ].join('\n');

  it('parses currency symbols and parenthesised negatives', () => {
    const r = detectAndParse(csv);
    expect(r.format).toBe('generic_signed');
    expect(r.rows[0]!.amountGbp).toBeCloseTo(42.1, 2);
    expect(r.rows[1]!.amountGbp).toBeCloseTo(-1.5, 2);
  });
});

describe('detectAndParse — unknown format', () => {
  it('returns unknown with a warning and the headers for manual mapping', () => {
    const r = detectAndParse('foo,bar,baz\n1,2,3\n');
    expect(r.format).toBe('unknown');
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.headers).toEqual(['foo', 'bar', 'baz']);
  });

  it('handles an empty file', () => {
    const r = detectAndParse('');
    expect(r.format).toBe('empty');
  });
});

describe('rowKey', () => {
  it('produces a stable dedupe key', () => {
    const r = detectAndParse([
      'Date,Description,Amount',
      '2026-05-01,Dividend,42.10',
    ].join('\n')).rows[0]!;
    const k1 = rowKey('acc-1', r);
    const k2 = rowKey('acc-1', r);
    expect(k1).toBe(k2);
    expect(k1).toContain('2026-05-01');
    expect(k1).toContain('42.10');
  });
});
