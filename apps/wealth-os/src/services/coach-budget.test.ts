import { describe, it, expect } from 'vitest';
import { budgetStatus, utcMonthStart } from './coach-budget';

describe('utcMonthStart', () => {
  it('returns the first millisecond of the UTC month for a mid-month date', () => {
    const r = utcMonthStart(new Date('2026-05-16T12:34:56Z'));
    expect(r.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('returns the same instant when called on the first second of the month', () => {
    const r = utcMonthStart(new Date('2026-05-01T00:00:00Z'));
    expect(r.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('crosses year boundaries cleanly', () => {
    const r = utcMonthStart(new Date('2027-01-03T08:00:00Z'));
    expect(r.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('budgetStatus', () => {
  it('is not exceeded when spend is below cap', () => {
    const s = budgetStatus({
      spentUsd: 0.5,
      capUsd: 2.0,
      monthStart: new Date('2026-05-01T00:00:00Z'),
    });
    expect(s).toEqual({
      monthSpentUsd: 0.5,
      monthCapUsd: 2.0,
      exceeded: false,
      monthStart: '2026-05-01T00:00:00.000Z',
    });
  });

  it('is exceeded when spend equals cap', () => {
    const s = budgetStatus({
      spentUsd: 2.0,
      capUsd: 2.0,
      monthStart: new Date('2026-05-01T00:00:00Z'),
    });
    expect(s.exceeded).toBe(true);
  });

  it('is exceeded when spend is over cap', () => {
    const s = budgetStatus({
      spentUsd: 5.5,
      capUsd: 2.0,
      monthStart: new Date('2026-05-01T00:00:00Z'),
    });
    expect(s.exceeded).toBe(true);
  });
});
