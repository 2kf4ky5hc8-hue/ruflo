// UK tax year helpers. Pure, deterministic, Europe/London-aware.
//
// The UK tax year runs 6 April → 5 April. We identify a tax year by the year
// in which it STARTS: tax year `2026` runs 2026-04-06 → 2027-04-05.
//
// All boundary maths uses the Europe/London calendar so that BST does not
// cause the boundary to slip a day in either direction.

const UK_TZ = 'Europe/London';

/** Get UK calendar parts (year/month/day) for an instant. */
function ukParts(d: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: UK_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
  };
}

/**
 * The starting year of the UK tax year that contains the given instant.
 * Examples:
 *   2026-04-05 (any time, UK)  → 2025  (still in 2025/26)
 *   2026-04-06 (any time, UK)  → 2026  (start of 2026/27)
 *   2027-04-05 (any time, UK)  → 2026  (last day of 2026/27)
 *   2027-04-06 (any time, UK)  → 2027  (start of 2027/28)
 */
export function currentUkTaxYear(now: Date = new Date()): number {
  const { year, month, day } = ukParts(now);
  // Before 6 April → previous year is the starting year.
  if (month < 4 || (month === 4 && day < 6)) return year - 1;
  return year;
}

/** UTC half-open window [start, nextStart) for the UK tax year `taxYear`. */
export function ukTaxYearBoundariesUtc(taxYear: number): { start: Date; nextStart: Date } {
  // Tax year `Y` runs from Y-04-06 00:00 Europe/London to (Y+1)-04-06 00:00.
  // In April, the UK is in BST (UTC+1), so 00:00 London = 23:00 UTC the prior day.
  const start = new Date(Date.UTC(taxYear, 3, 5, 23, 0, 0));        // ~Y-04-06 00:00 BST
  const nextStart = new Date(Date.UTC(taxYear + 1, 3, 5, 23, 0, 0));
  return { start, nextStart };
}

/** Pretty form, e.g. 2026 → "2026/27". */
export function formatUkTaxYear(taxYear: number): string {
  const nextShort = String((taxYear + 1) % 100).padStart(2, '0');
  return `${taxYear}/${nextShort}`;
}

/** Inverse — accepts 2026 or "2026/27". */
export function parseUkTaxYear(input: number | string): number {
  if (typeof input === 'number') return input;
  const m = input.match(/^(\d{4})(?:[/-]\d{2,4})?$/);
  if (!m) throw new Error(`Invalid UK tax year: ${input}`);
  return Number(m[1]);
}

/** Is the given instant inside `taxYear`'s UK tax-year window? */
export function isInUkTaxYear(d: Date, taxYear: number): boolean {
  return currentUkTaxYear(d) === taxYear;
}

/** Days remaining (inclusive of today) until 5 April of `taxYear`. */
export function ukTaxYearDaysRemaining(now: Date, taxYear: number): number {
  const { nextStart } = ukTaxYearBoundariesUtc(taxYear);
  const diffMs = nextStart.getTime() - now.getTime();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}
