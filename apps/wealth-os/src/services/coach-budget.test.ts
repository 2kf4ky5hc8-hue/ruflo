import { describe, it, expect } from 'vitest';
import {
  budgetStatus,
  evaluateCoachLimits,
  utcDayEnd,
  utcDayStart,
  utcMonthEnd,
  utcMonthStart,
} from './coach-budget';

const CAPS = { dailyCap: 5, monthlyUsdCap: 2.5 };
const NOW = new Date('2026-05-16T12:34:56Z');

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

describe('utcDayStart / utcDayEnd', () => {
  it('start is today midnight UTC', () => {
    expect(utcDayStart(NOW).toISOString()).toBe('2026-05-16T00:00:00.000Z');
  });
  it('end is tomorrow midnight UTC', () => {
    expect(utcDayEnd(NOW).toISOString()).toBe('2026-05-17T00:00:00.000Z');
  });
});

describe('utcMonthEnd', () => {
  it('is the first instant of the following month', () => {
    expect(utcMonthEnd(NOW).toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });
  it('crosses year boundary cleanly', () => {
    expect(utcMonthEnd(new Date('2026-12-15T10:00:00Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('evaluateCoachLimits', () => {
  it('returns ok when both caps have room', () => {
    const d = evaluateCoachLimits({
      usage: { runsToday: 0, monthlyCostUsd: 0 },
      caps: CAPS,
      now: NOW,
    });
    expect(d.ok).toBe(true);
  });

  it('returns ok at the boundary (one below the daily cap)', () => {
    const d = evaluateCoachLimits({
      usage: { runsToday: 4, monthlyCostUsd: 2.49 },
      caps: CAPS,
      now: NOW,
    });
    expect(d.ok).toBe(true);
  });

  it('blocks with reason=daily when runs today >= cap', () => {
    const d = evaluateCoachLimits({
      usage: { runsToday: 5, monthlyCostUsd: 0 },
      caps: CAPS,
      now: NOW,
    });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe('daily');
    expect(d.resetsAt.toISOString()).toBe('2026-05-17T00:00:00.000Z');
    expect(d.message).toMatch(/Daily Coach cap reached/);
  });

  it('blocks with reason=monthly when monthly $ >= cap', () => {
    const d = evaluateCoachLimits({
      usage: { runsToday: 0, monthlyCostUsd: 2.5 },
      caps: CAPS,
      now: NOW,
    });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe('monthly');
    expect(d.resetsAt.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('daily takes precedence over monthly when both fire', () => {
    const d = evaluateCoachLimits({
      usage: { runsToday: 5, monthlyCostUsd: 3 },
      caps: CAPS,
      now: NOW,
    });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.reason).toBe('daily');
  });

  it('points resetsAt at the day end when one run remains in the daily quota', () => {
    const d = evaluateCoachLimits({
      usage: { runsToday: 4, monthlyCostUsd: 0 },
      caps: CAPS,
      now: NOW,
    });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.resetsAt.toISOString()).toBe('2026-05-17T00:00:00.000Z');
  });
});
