import { describe, it, expect } from 'vitest';
import { analyseProtectionGaps } from './balance-sheet';

describe('analyseProtectionGaps', () => {
  it('always flags missing income protection as a warning', () => {
    const gaps = analyseProtectionGaps({
      hasLife: true, hasIncomeProtection: false, hasWill: true,
      isBusinessOwner: false, hasDependants: false,
    });
    const ip = gaps.find((g) => g.kind === 'income_protection');
    expect(ip).toBeDefined();
    expect(ip!.severity).toBe('warn');
  });

  it('flags missing life cover only when there are dependants', () => {
    const withDeps = analyseProtectionGaps({
      hasLife: false, hasIncomeProtection: true, hasWill: true,
      isBusinessOwner: false, hasDependants: true,
    });
    expect(withDeps.find((g) => g.kind === 'life')).toBeDefined();

    const noDeps = analyseProtectionGaps({
      hasLife: false, hasIncomeProtection: true, hasWill: true,
      isBusinessOwner: false, hasDependants: false,
    });
    expect(noDeps.find((g) => g.kind === 'life')).toBeUndefined();
  });

  it('suggests key-person cover for business owners', () => {
    const gaps = analyseProtectionGaps({
      hasLife: true, hasIncomeProtection: true, hasWill: true,
      isBusinessOwner: true, hasDependants: false,
    });
    expect(gaps.find((g) => g.kind === 'key_person')).toBeDefined();
  });

  it('returns no gaps for a fully-covered non-business-owner', () => {
    const gaps = analyseProtectionGaps({
      hasLife: true, hasIncomeProtection: true, hasWill: true,
      isBusinessOwner: false, hasDependants: true,
    });
    expect(gaps).toHaveLength(0);
  });
});
