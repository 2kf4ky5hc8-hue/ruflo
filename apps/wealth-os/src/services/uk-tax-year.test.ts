import { describe, it, expect } from 'vitest';
import {
  currentUkTaxYear, ukTaxYearBoundariesUtc, formatUkTaxYear, parseUkTaxYear,
  isInUkTaxYear, ukTaxYearDaysRemaining,
} from './uk-tax-year';

describe('currentUkTaxYear', () => {
  it('returns the previous year for 5 April', () => {
    // 5 April 2026 at noon UK → still 2025/26
    expect(currentUkTaxYear(new Date('2026-04-05T12:00:00Z'))).toBe(2025);
  });

  it('returns the new year for 6 April', () => {
    // 6 April 2026 at noon UK (BST) → 2026/27
    expect(currentUkTaxYear(new Date('2026-04-06T12:00:00Z'))).toBe(2026);
  });

  it('handles the BST → UTC boundary on 6 April correctly', () => {
    // 2026-04-06 00:30 BST = 2026-04-05 23:30 UTC. UK calendar already
    // ticked over to the 6th, so this is 2026/27.
    expect(currentUkTaxYear(new Date('2026-04-05T23:30:00Z'))).toBe(2026);
    // 2026-04-05 22:30 UTC = 2026-04-05 23:30 BST → still 5 April UK → 2025/26
    expect(currentUkTaxYear(new Date('2026-04-05T22:30:00Z'))).toBe(2025);
  });

  it('mid-year cases', () => {
    expect(currentUkTaxYear(new Date('2026-01-15T00:00:00Z'))).toBe(2025);
    expect(currentUkTaxYear(new Date('2026-06-15T00:00:00Z'))).toBe(2026);
    expect(currentUkTaxYear(new Date('2026-12-31T00:00:00Z'))).toBe(2026);
  });

  it('does NOT use the calendar year as the tax year', () => {
    // Whole point: a calendar year crosses two UK tax years.
    expect(currentUkTaxYear(new Date('2026-01-01T00:00:00Z'))).toBe(2025);
    expect(currentUkTaxYear(new Date('2026-12-31T00:00:00Z'))).toBe(2026);
  });
});

describe('ukTaxYearBoundariesUtc', () => {
  it('window for 2026/27 covers the whole tax year', () => {
    const { start, nextStart } = ukTaxYearBoundariesUtc(2026);
    // Start is at or before 2026-04-06 00:00 BST = 2026-04-05 23:00 UTC.
    expect(start.getTime()).toBeLessThanOrEqual(Date.UTC(2026, 3, 5, 23, 0));
    // Next start is at or before 2027-04-06 00:00 BST.
    expect(nextStart.getTime()).toBeLessThanOrEqual(Date.UTC(2027, 3, 5, 23, 0));
    // The window contains 6 April noon and 5 April noon of the next year.
    expect(start.getTime()).toBeLessThan(Date.UTC(2026, 3, 6, 12, 0));
    expect(nextStart.getTime()).toBeGreaterThan(Date.UTC(2027, 3, 5, 12, 0));
  });
});

describe('formatUkTaxYear / parseUkTaxYear', () => {
  it('formats with two-digit next year', () => {
    expect(formatUkTaxYear(2026)).toBe('2026/27');
    expect(formatUkTaxYear(1999)).toBe('1999/00');
  });
  it('parses both numeric and string forms', () => {
    expect(parseUkTaxYear(2026)).toBe(2026);
    expect(parseUkTaxYear('2026/27')).toBe(2026);
    expect(parseUkTaxYear('2026-27')).toBe(2026);
    expect(parseUkTaxYear('2026')).toBe(2026);
  });
  it('rejects nonsense', () => {
    expect(() => parseUkTaxYear('not a year')).toThrow();
  });
});

describe('isInUkTaxYear', () => {
  it('boundary instants', () => {
    expect(isInUkTaxYear(new Date('2026-04-06T00:30:00Z'), 2026)).toBe(true);
    expect(isInUkTaxYear(new Date('2026-04-05T22:00:00Z'), 2026)).toBe(false);
    expect(isInUkTaxYear(new Date('2027-04-05T22:00:00Z'), 2026)).toBe(true);
    expect(isInUkTaxYear(new Date('2027-04-06T00:30:00Z'), 2026)).toBe(false);
  });
});

describe('ukTaxYearDaysRemaining', () => {
  it('counts days down to 5 April end-of-day', () => {
    const d = ukTaxYearDaysRemaining(new Date('2027-04-01T12:00:00Z'), 2026);
    expect(d).toBeGreaterThanOrEqual(4);
    expect(d).toBeLessThanOrEqual(6);
  });
  it('returns 0 once the next tax year has started', () => {
    expect(ukTaxYearDaysRemaining(new Date('2027-04-10T12:00:00Z'), 2026)).toBe(0);
  });
});
